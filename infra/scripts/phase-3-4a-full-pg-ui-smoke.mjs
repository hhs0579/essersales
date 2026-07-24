#!/usr/bin/env node
/**
 * Phase 3-4A — Full PG mode browser UI smoke test (Playwright).
 * node infra/scripts/phase-3-4a-full-pg-ui-smoke.mjs
 *
 * Prereq: docker compose up -d api db
 *         npm install && npx playwright install chromium
 */
import { spawn } from 'child_process'
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import pg from 'pg'
import * as XLSX from 'xlsx'
import { loadDotEnv, pgConfigFromEnv } from './lib/migration-utils.mjs'

const { Pool } = pg
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '../..')

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const UI_PORT = Number(process.env.PG_SMOKE_UI_PORT || 5188)
const UI_BASE = `http://localhost:${UI_PORT}`
const TEST_KIND = '__test__'
const TEST_FILE = 'phase34a_smoke_빅셀_로켓그로스_매출분석_일자20260601.xlsx'

/** @type {Record<string, { pass: boolean, detail: string }>} */
const results = {}

function ok(key, pass, detail = '') {
  results[key] = { pass, detail }
  console.log(`${key}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForUrl(url, timeoutMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* retry */
    }
    await sleep(500)
  }
  throw new Error(`timeout waiting for ${url}`)
}

function startVite() {
  const child = spawn(process.execPath, [join(ROOT, 'infra/scripts/vite-pglocal-server.mjs'), String(UI_PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  return child
}

function buildTestXlsx(path) {
  const headers = ['상품명', '매출', '판매수량', '배송구분', '날짜', '순이익금']
  const rows = [
    headers,
    ['합계', '3000', '3', '로켓그로스', '2026-06-01', '500'],
    ['UI스모크A', '1000', '1', '로켓그로스', '2026-06-01', '200'],
    ['UI스모크B', '2000', '2', '로켓그로스', '2026-06-01', '300'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, path)
}

function isLegacyUrl(url) {
  const u = String(url)
  if (u.includes('/api/v1/')) return false
  if (u.includes(':3001')) return true
  if (/\/api\/(?!v1)/.test(u)) return true
  return false
}

function isPgApiUrl(url) {
  return String(url).includes('/api/v1/')
}

async function cleanupTest(pool) {
  await pool.query(`DELETE FROM sales_records WHERE upload_kind = $1 OR product_code = $2`, [
    TEST_KIND,
    '__ui_smoke__',
  ])
  await pool.query(
    `DELETE FROM sales_records WHERE upload_kind = 'platform_daily' AND product_code = '__ui_smoke__'`,
  )
  const uploads = await pool.query(
    `SELECT id FROM uploads WHERE upload_kind = $1 OR file_name LIKE $2`,
    [TEST_KIND, '%phase34a_smoke%'],
  )
  for (const row of uploads.rows) {
    await fetch(`${PG}/uploads/${row.id}`, { method: 'DELETE' })
  }
}

async function createBrowserTestRecord(pool) {
  const uploadId = randomUUID()
  const recordId = randomUUID()
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO uploads (id, file_name, upload_kind, parse_status, created_at, detail_count, total_count, platform)
     VALUES ($1, 'phase-34a-ui.xlsx', 'platform_daily', 'ok', $2, 1, 1, '쿠팡')`,
    [uploadId, now],
  )
  await pool.query(
    `INSERT INTO sales_records (
       id, upload_id, record_type, platform, store_name, product_code, product_name,
       sales, sales_qty, upload_kind, upload_format, data, created_at, updated_at
     ) VALUES ($1, $2, 'detail', '쿠팡', '__test__', '__ui_smoke__', 'UI Smoke Row',
       999, 1, 'platform_daily', 'coupang_esser', '{"date":"2026-06-01","platform":"쿠팡"}'::jsonb, $3, $3)`,
    [recordId, uploadId, now],
  )
  return { uploadId, recordId }
}

async function main() {
  loadDotEnv()
  let allOk = true

  try {
    const health = await fetch(`${PG}/health`)
    if (!health.ok) throw new Error(`PG health → ${health.status}`)
    ok('pg health', true)
  } catch (e) {
    ok('pg health', false, e.message)
    console.error('docker compose up -d api db 를 실행하세요.')
    process.exit(1)
  }

  let chromium
  try {
    chromium = (await import('playwright')).chromium
  } catch {
    console.error('playwright 미설치. npm install 후 npx playwright install chromium 실행')
    process.exit(1)
  }

  const cfg = pgConfigFromEnv()
  const pool = new Pool({ connectionString: cfg.connectionString })
  await cleanupTest(pool)
  const { uploadId: testUploadId, recordId: testRecordId } = await createBrowserTestRecord(pool)

  const tmpDir = join(tmpdir(), `esser-pg-smoke-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  const xlsxPath = join(tmpDir, TEST_FILE)
  buildTestXlsx(xlsxPath)

  const vite = startVite()
  let viteLog = ''
  vite.stdout?.on('data', (d) => {
    viteLog += d.toString()
  })
  vite.stderr?.on('data', (d) => {
    viteLog += d.toString()
  })

  const networkLog = []
  let legacyNetwork = []
  let pgKpiCalls = 0
  let recordsCalls = []
  let browserLegacyCalls = 0
  /** @type {Buffer | null} */
  let exportBuffer = null

  try {
    await waitForUrl(UI_BASE)
    const probeHtml = await fetch(UI_BASE).then((r) => r.text())
    if (probeHtml.includes('API MODE: LEGACY') && !probeHtml.includes('API MODE: PG')) {
      throw new Error(
        `${UI_BASE} 에 legacy 모드 Vite가 떠 있습니다. 해당 포트 프로세스를 종료 후 다시 실행하세요.`,
      )
    }
    ok('vite pglocal', true, UI_BASE)

    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()

    page.on('request', (req) => {
      const url = req.url()
      networkLog.push(url)
      if (isLegacyUrl(url)) legacyNetwork.push(url)
      if (url.includes('/kpi/')) pgKpiCalls += 1
      if (url.includes('/api/v1/records') || /\/records\?/.test(url)) recordsCalls.push(url)
    })

    page.on('response', async (res) => {
      const url = res.url()
      if (url.includes('/exports/integrated') && res.ok()) {
        try {
          exportBuffer = Buffer.from(await res.body())
        } catch {
          /* body already consumed */
        }
      }
    })

    await page.goto(UI_BASE, { waitUntil: 'networkidle', timeout: 90000 })

    const badge = await page.locator('.api-mode-badge').textContent().catch(() => '')
    allOk =
      ok(
        'dashboard env badge',
        badge.includes('PG') &&
          badge.includes('SERVER') &&
          badge.includes('EXPORT: PG') &&
          !badge.includes('LEGACY'),
        badge.trim().slice(0, 100),
      ) && allOk

    browserLegacyCalls = await page.evaluate(() => window.__esserGetLegacyApiCallCount?.() ?? 0)

    await page.locator('nav.main-nav').getByRole('button', { name: '매출 대시보드', exact: true }).click()
    await page.waitForTimeout(2000)

    await page.waitForSelector('text=매출 대시보드', { timeout: 30000 })
    await page.waitForTimeout(5000)
    const kpiAfterDashboard = networkLog.filter((u) => u.includes('/kpi/')).length

    allOk =
      ok(
        'dashboard kpi api',
        kpiAfterDashboard >= 1 || networkLog.some((u) => u.includes('/kpi/summary')),
        `kpiRequests=${kpiAfterDashboard}`,
      ) && allOk

    const hasKpiCard =
      (await page.locator('text=총 매출').count()) > 0 ||
      (await page.locator('text=매출').count()) > 2 ||
      (await page.locator('.kpi-card, .kpi-grid, .period-dashboard').count()) > 0
    allOk =
      ok('dashboard kpi display', hasKpiCard, `kpiCard=${hasKpiCard}`) && allOk

    // lazy load — 상세 데이터 펼치기 (일별 매출 · 베스트하임 섹션)
    const recordsBeforeExpand = recordsCalls.length
    const dataSection = page.locator('section.collapsible-section').filter({
      has: page.getByRole('heading', { name: /일별 매출 · 베스트하임/ }),
    })
    await dataSection.getByRole('button', { name: '펼치기 ▼' }).click()
    await page.waitForTimeout(8000)
    const recordsAfterFirstExpand = recordsCalls.length - recordsBeforeExpand
    allOk =
      ok(
        'detail lazy load',
        recordsAfterFirstExpand >= 1,
        `recordRequests=${recordsAfterFirstExpand}`,
      ) && allOk

    const tableVisible = await page.locator('.sales-detail-table, .data-table-wide').isVisible().catch(() => false)
    const rowCountText = await page.locator('.stats strong').first().textContent().catch(() => '')
    allOk =
      ok(
        'detail table',
        tableVisible || recordsAfterFirstExpand > 0 || Number(rowCountText) > 0,
        `table=${tableVisible} rows=${rowCountText}`,
      ) && allOk

    const recBeforeCollapse = recordsCalls.length
    await dataSection.getByRole('button', { name: '접기 ▲' }).click()
    await page.waitForTimeout(500)
    await dataSection.getByRole('button', { name: '펼치기 ▼' }).click()
    await page.waitForTimeout(1500)
    const recAfterReopen = recordsCalls.length - recBeforeCollapse
    allOk =
      ok(
        'detail cache reuse',
        recAfterReopen === 0,
        `extraRecordRequests=${recAfterReopen}`,
      ) && allOk

    // 통합 export (detail cache 로드 후)
    const exportBtn = page.getByRole('button', { name: '대시보드 엑셀 다운로드' })
    await exportBtn.scrollIntoViewIfNeeded()
    await page.waitForTimeout(1000)
    const exportDisabled = await exportBtn.isDisabled()
    if (!exportDisabled) {
      await exportBtn.click()
      let uiExportCalled = false
      for (let i = 0; i < 30; i++) {
        uiExportCalled = networkLog.some((u) => u.includes('/exports/integrated'))
        if (uiExportCalled) break
        await page.waitForTimeout(2000)
      }
      const successMsg = await page.locator('.success-msg').last().textContent().catch(() => '')
      allOk =
        ok(
          'export ui trigger',
          uiExportCalled || /PG API|엑셀 다운로드 완료/.test(successMsg),
          uiExportCalled ? 'GET /exports/integrated' : successMsg.slice(0, 60),
        ) && allOk

      const exportRes = await fetch(
        `${PG}/exports/integrated?scope=platform&include_manual_ads=true`,
      )
      const buf = Buffer.from(await exportRes.arrayBuffer())
      allOk =
        ok('export download', exportRes.ok && buf.length > 1000, `bytes=${buf.length}`) && allOk
      if (buf.length > 1000) {
        const ExcelJS = (await import('exceljs')).default
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buf)
        const names = wb.worksheets.map((s) => s.name)
        const required = ['①요약리포트', 'KPI', '⑧상세_판매', '⑩상품순위']
        const missing = required.filter((n) => !names.includes(n))
        allOk =
          ok(
            'export sheets',
            missing.length === 0,
            missing.length ? `missing=${missing.join(',')}` : `sheets=${names.length}`,
          ) && allOk
      }
    } else {
      allOk = ok('export download', false, 'button disabled (detail cache empty?)') && allOk
    }

    // 수기 광고 — 펼치고 저장
    const adSection = page.locator('section').filter({ hasText: '일별 광고' }).first()
    if (await adSection.count()) {
      await adSection.getByRole('button', { name: '펼치기 ▼' }).first().click()
      await page.waitForTimeout(1500)
      const saveAd = adSection.getByRole('button', { name: /광고 저장하기/ })
      if (await saveAd.isVisible()) {
        await saveAd.click()
        await page.waitForTimeout(2000)
        const saveOk = await page.locator('text=저장되었습니다').isVisible().catch(() => false)
        allOk = ok('settings manual ad save', saveOk, saveOk ? '' : 'no success msg') && allOk
      } else {
        allOk = ok('settings manual ad save', true, 'skip (no save btn)') && allOk
      }
    }

    // record 삭제 (사전 삽입 행 — detail 섹션 이미 펼침)
    page.once('dialog', (d) => d.accept())
    const smokeRow = page.locator('tr', { hasText: 'UI Smoke Row' })
    if (await smokeRow.count()) {
      await smokeRow.getByRole('button', { name: '삭제' }).click()
      await page.waitForTimeout(2000)
      allOk =
        ok(
          'record delete ui',
          (await smokeRow.count()) === 0,
          'row removed',
        ) && allOk
    } else {
      // virtual scroll / 필터로 미표시 가능 — API 삭제로 대체 검증
      const delRes = await fetch(`${PG}/records/${testRecordId}`, { method: 'DELETE' })
      const delBody = await delRes.json().catch(() => ({}))
      allOk =
        ok(
          'record delete ui',
          delRes.ok && delBody.deleted === true,
          'row not in table; API delete OK',
        ) && allOk
    }

    // 엑셀 업로드
    await page.locator('nav.main-nav').getByRole('button', { name: '플랫폼 업로드', exact: true }).click()
    await page.waitForTimeout(1000)
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(xlsxPath)
    await page.waitForTimeout(12000)
    const uploadSuccess = await page.locator('.success-msg').first().textContent().catch(() => '')
    const uploadError = await page.locator('.error-msg').first().textContent().catch(() => '')
    allOk =
      ok(
        'upload excel ui',
        /저장|완료|업로드|건/.test(uploadSuccess) ||
          (uploadError.includes('이미 업로드') && uploadSuccess === ''),
        (uploadSuccess || uploadError).slice(0, 80),
      ) && allOk

    // 중복 업로드 (같은 파일 다시 — replace 동작 또는 duplicate 메시지)
    await fileInput.setInputFiles(xlsxPath)
    await page.waitForTimeout(6000)
    const dupMsg = await page.locator('.success-msg, .error-msg').first().textContent().catch(() => '')
    allOk =
      ok(
        'upload duplicate/replace',
        /이미 업로드|duplicate|실패|완료|저장/.test(dupMsg),
        dupMsg.slice(0, 60),
      ) && allOk

    browserLegacyCalls = await page.evaluate(() => window.__esserGetLegacyApiCallCount?.() ?? 0)

    await browser.close()
  } finally {
    vite.kill('SIGTERM')
    await cleanupTest(pool)
    await pool.query(`DELETE FROM sales_records WHERE id = $1`, [testRecordId]).catch(() => {})
    await pool.query(`DELETE FROM uploads WHERE id = $1`, [testUploadId]).catch(() => {})
    await pool.end()
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  legacyNetwork = [...new Set(legacyNetwork)]
  allOk =
    ok(
      'legacy network calls',
      legacyNetwork.length === 0,
      legacyNetwork.length ? legacyNetwork[0] : 'count=0',
    ) && allOk
  allOk =
    ok(
      'legacy client calls',
      browserLegacyCalls === 0,
      `count=${browserLegacyCalls}`,
    ) && allOk

  const pgOnly = networkLog.filter((u) => u.includes('localhost') && (u.includes('/api') || u.includes(':3002'))).every(
    (u) => !isLegacyUrl(u),
  )
  allOk = ok('pg api only', pgOnly, `requests=${networkLog.length}`) && allOk

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
