#!/usr/bin/env node
/**
 * Phase 3-3 — Full PG mode E2E regression (PG API only, no legacy calls).
 * node infra/scripts/phase-3-3-full-pg-e2e-regression.mjs
 *
 * Simulates:
 *   VITE_API_MODE=pg
 *   VITE_KPI_SOURCE=server
 *   VITE_WRITE_API_MODE=pg
 *   VITE_EXPORT_API_MODE=pg
 */
import pg from 'pg'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { randomUUID } from 'crypto'
import { loadDotEnv, pgConfigFromEnv } from './lib/migration-utils.mjs'

const { Pool } = pg

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const LEGACY_BASE = (process.env.VITE_LEGACY_API_BASE || 'http://localhost:3001/api').replace(
  /\/$/,
  '',
)

const TEST_KIND = '__test__'
const TEST_SCOPE = '__test__'
const TEST_KIND_SETTINGS = 'settings_write_regression'
const TEST_FILE = 'phase33_e2e_빅셀_로켓그로스_매출분석_일자20260601.xlsx'
const KPI_SCOPE = 'platform'
const KPI_QS = `scope=${KPI_SCOPE}&upload_kind=platform_daily`

const EXPORT_SHEETS = [
  '①요약리포트',
  '②전일대비',
  '②판매방식별',
  '③일별',
  '④주별',
  '⑤월별',
  '⑥기간통합',
  '⑦스토어별',
  'KPI',
]

/** @type {string[]} */
const requestLog = []
let legacyCallCount = 0

function okLine(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

function assertPgOnly(url) {
  const normalized = String(url)
  if (normalized.includes('3001') || normalized.startsWith(LEGACY_BASE)) {
    legacyCallCount += 1
    throw new Error(`legacy API 호출 금지: ${url}`)
  }
}

async function pgFetch(path, options = {}) {
  const url = `${PG}${path}`
  assertPgOnly(url)
  requestLog.push(url)
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const body = await res.json().catch(() => ({}))
  return { res, body, url }
}

function buildTestEsserXlsxBuffer() {
  const headers = ['상품명', '매출', '판매수량', '배송구분', '날짜', '순이익금']
  const rows = [
    headers,
    ['합계', '3000', '3', '로켓그로스', '2026-06-01', '500'],
    ['E2E상품A', '1000', '1', '로켓그로스', '2026-06-01', '200'],
    ['E2E상품B', '2000', '2', '로켓그로스', '2026-06-01', '300'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

async function pgMultipartUpload(buffer, fileName, fields = {}) {
  const url = `${PG}/uploads/excel`
  assertPgOnly(url)
  requestLog.push(url)
  const fd = new FormData()
  fd.append('file', new Blob([buffer]), fileName)
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, String(v))
  }
  const res = await fetch(url, { method: 'POST', body: fd })
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function fetchKpi(path) {
  const { res, body } = await pgFetch(path)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return body
}

function sheetRowCount(ws) {
  let n = 0
  ws.eachRow(() => {
    n += 1
  })
  return n
}

async function cleanupTest(pool) {
  await pool.query(`DELETE FROM sales_records WHERE upload_kind = $1`, [TEST_KIND])
  const uploads = await pool.query(`SELECT id FROM uploads WHERE upload_kind = $1`, [TEST_KIND])
  for (const row of uploads.rows) {
    await pgFetch(`/uploads/${row.id}`, { method: 'DELETE' })
  }
  try {
    await pgFetch(`/settings/${TEST_SCOPE}/${TEST_KIND_SETTINGS}`, { method: 'DELETE' }).catch(
      () => {},
    )
  } catch {
    /* DELETE not supported — overwrite in test only */
  }
}

async function createTestUploadAndRecord(pool) {
  const uploadId = randomUUID()
  const recordId = randomUUID()
  const now = new Date().toISOString()

  await pool.query(
    `INSERT INTO uploads (
       id, file_name, upload_kind, parse_status, created_at,
       platform, sales_method, detail_count, total_count
     ) VALUES ($1, $2, $3, 'ok', $4, '', '', 1, 1)`,
    [uploadId, 'phase-3-3-test.xlsx', TEST_KIND, now],
  )

  await pool.query(
    `INSERT INTO sales_records (
       id, upload_id, record_type, platform, store_name, product_code,
       product_name, sales, sales_qty, upload_kind, upload_format, data,
       created_at, updated_at
     ) VALUES (
       $1, $2, 'detail', '', '__test__', '__test_record__',
       'Phase 3-3 Test', 1000, 2, $3, 'phase-3-3', '{}'::jsonb,
       $4, $4
     )`,
    [recordId, uploadId, TEST_KIND, now],
  )

  return { uploadId, recordId }
}

async function main() {
  loadDotEnv()
  let allOk = true

  // API 가용성 선검사 (Docker 미기동 시 명확한 메시지)
  try {
    const probe = await fetch(`${PG}/health`)
    if (!probe.ok) {
      console.error(`PG API health → ${probe.status}. docker compose up -d api db 를 실행하세요.`)
      process.exit(1)
    }
  } catch {
    console.error(
      `PG API(${PG})에 연결할 수 없습니다. Docker Desktop 실행 후 docker compose up -d api db`,
    )
    process.exit(1)
  }

  const cfg = pgConfigFromEnv()
  let pool
  try {
    pool = new Pool({ connectionString: cfg.connectionString })
    await pool.query('SELECT 1')
  } catch {
    console.error(
      `PostgreSQL에 연결할 수 없습니다 (${cfg.connectionString?.replace(/:[^:@]+@/, ':***@')}). docker compose up -d db`,
    )
    process.exit(1)
  }

  await cleanupTest(pool)

  // --- health ---
  const { res: healthRes, body: healthBody } = await pgFetch('/health')
  allOk =
    okLine(
      'health',
      healthRes.ok && healthBody.ok === true && healthBody.db?.connected === true,
      `service=${healthBody.service}`,
    ) && allOk

  // --- settings read/write ---
  const { res: settingsListRes, body: settingsList } = await pgFetch(
    '/settings?scope=platform&kind=manual_ad',
  )
  allOk =
    okLine(
      'settings GET list',
      settingsListRes.ok && Array.isArray(settingsList.items),
      `items=${settingsList.items?.length}`,
    ) && allOk

  const { res: settingsGetRes, body: settingsGet } = await pgFetch(
    '/settings/platform/staff_memo',
  )
  allOk =
    okLine('settings GET single', settingsGetRes.ok && settingsGet.scope === 'platform') && allOk

  const testPayload = { phase: '3-3', savedAt: new Date().toISOString(), ok: true }
  const { res: putRes, body: putBody } = await pgFetch(
    `/settings/${TEST_SCOPE}/${TEST_KIND_SETTINGS}`,
    { method: 'PUT', body: JSON.stringify({ data: testPayload }) },
  )
  const { res: verifyRes, body: verifyBody } = await pgFetch(
    `/settings/${TEST_SCOPE}/${TEST_KIND_SETTINGS}`,
  )
  allOk =
    okLine(
      'settings write',
      putRes.ok &&
        putBody.ok === true &&
        verifyRes.ok &&
        verifyBody.data?.phase === '3-3',
      `updatedAt=${putBody.updatedAt}`,
    ) && allOk

  // --- uploads list ---
  const { res: uploadsRes, body: uploadsBody } = await pgFetch('/uploads?page=1&limit=5')
  allOk =
    okLine(
      'uploads list',
      uploadsRes.ok && Array.isArray(uploadsBody.items),
      `total=${uploadsBody.total}`,
    ) && allOk

  // --- records lazy load (paginated) ---
  const { res: recPage1, body: recBody1 } = await pgFetch(
    '/records?page=1&limit=500&record_type=detail&include_data=false',
  )
  const { res: recPage2, body: recBody2 } = await pgFetch(
    '/records?page=2&limit=500&record_type=detail&include_data=false',
  )
  allOk =
    okLine(
      'records lazy load',
      recPage1.ok &&
        recBody1.items?.length > 0 &&
        recBody1.total > 0 &&
        (recBody1.total <= 500 || recPage2.ok),
      `page1=${recBody1.items?.length} total=${recBody1.total}`,
    ) && allOk

  // --- KPI 4종 ---
  const kpiSummary = await fetchKpi(`/kpi/summary?${KPI_QS}`)
  const kpiDaily = await fetchKpi(`/kpi/daily?${KPI_QS}`)
  const kpiPlatform = await fetchKpi(`/kpi/by-platform?${KPI_QS}`)
  const kpiDod = await fetchKpi(`/kpi/compare-yesterday?${KPI_QS}`)

  allOk =
    okLine(
      'kpi summary/daily/platform/dod',
      kpiSummary.salesTotal != null &&
        Array.isArray(kpiDaily.items) &&
        (kpiPlatform.items?.length > 0 || kpiPlatform.totalRow) &&
        kpiDod != null,
      `sales=${kpiSummary.salesTotal} daily=${kpiDaily.items?.length} platform=${kpiPlatform.items?.length}`,
    ) && allOk

  // --- record patch/delete ---
  const { recordId, uploadId: patchUploadId } = await createTestUploadAndRecord(pool)
  const { res: patchRes, body: patchBody } = await pgFetch(`/records/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { sales: '3300', productName: 'E2E Patched' } }),
  })
  const { body: getPatched } = await pgFetch(
    `/records?product_code=__test_record__&include_data=true&limit=5`,
  )
  const patched = getPatched.items?.find((r) => r.id === recordId)
  allOk =
    okLine(
      'record patch/delete',
      patchRes.ok &&
        patchBody.ok === true &&
        patched &&
        Number(patched.sales) === 3300 &&
        patched.productName === 'E2E Patched',
      `sales=${patched?.sales}`,
    ) && allOk

  const { res: delRecRes, body: delRecBody } = await pgFetch(`/records/${recordId}`, {
    method: 'DELETE',
  })
  allOk =
    okLine(
      'record DELETE',
      delRecRes.ok && delRecBody.deleted === true,
      `deleted=${delRecBody.deleted}`,
    ) && allOk

  // --- excel upload + KPI + delete ---
  const kpiTestBefore = await fetchKpi(`/kpi/summary?upload_kind=${TEST_KIND}`)
  const salesTestBefore = Number(kpiTestBefore.salesTotal || 0)
  const buffer = buildTestEsserXlsxBuffer()

  const { res: upRes, body: upBody } = await pgMultipartUpload(buffer, TEST_FILE, {
    upload_kind: TEST_KIND,
    platform: '쿠팡',
    replace_same_name: 'true',
  })
  allOk =
    okLine(
      'upload excel',
      upRes.ok && upBody.ok === true && upBody.count >= 2,
      `count=${upBody.count}`,
    ) && allOk

  const uploadId = upBody.uploadId
  const kpiTestAfterUpload = await fetchKpi(`/kpi/summary?upload_kind=${TEST_KIND}`)
  allOk =
    okLine(
      'upload 후 KPI 반영',
      Number(kpiTestAfterUpload.salesTotal) > salesTestBefore,
      `before=${salesTestBefore} after=${kpiTestAfterUpload.salesTotal}`,
    ) && allOk

  const { res: delUpRes, body: delUpBody } = await pgFetch(`/uploads/${uploadId}`, {
    method: 'DELETE',
  })
  const kpiTestAfterDelete = await fetchKpi(`/kpi/summary?upload_kind=${TEST_KIND}`)
  allOk =
    okLine(
      'upload delete + KPI 복구',
      delUpRes.ok &&
        delUpBody.deleted === true &&
        Math.abs(Number(kpiTestAfterDelete.salesTotal) - salesTestBefore) <= 1,
      `afterDel=${kpiTestAfterDelete.salesTotal} baseline=${salesTestBefore}`,
    ) && allOk

  // cleanup patch upload
  await pgFetch(`/uploads/${patchUploadId}`, { method: 'DELETE' }).catch(() => {})

  // --- export integrated ---
  const exportUrl = `${PG}/exports/integrated?scope=${KPI_SCOPE}&include_manual_ads=true`
  assertPgOnly(exportUrl)
  requestLog.push(exportUrl)
  const exportRes = await fetch(exportUrl)
  const exportBuf = Buffer.from(await exportRes.arrayBuffer())
  allOk =
    okLine(
      'export integrated',
      exportRes.ok &&
        exportBuf.length > 1000 &&
        exportRes.headers.get('content-type')?.includes('spreadsheet'),
      `bytes=${exportBuf.length}`,
    ) && allOk

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(exportBuf)
  const sheetNames = wb.worksheets.map((s) => s.name)
  for (const name of EXPORT_SHEETS) {
    allOk = okLine(`export sheet: ${name}`, sheetNames.includes(name)) && allOk
  }

  const detailSheet = wb.getWorksheet('⑧상세_판매')
  if (detailSheet) {
    allOk =
      okLine(
        'export 상세판매 rows',
        sheetRowCount(detailSheet) > 1,
        `rows=${sheetRowCount(detailSheet)}`,
      ) && allOk
  }

  const rankSheet = wb.getWorksheet('⑩상품순위')
  if (rankSheet) {
    allOk =
      okLine(
        'export 상품순위',
        sheetRowCount(rankSheet) > 1,
        `rows=${sheetRowCount(rankSheet)}`,
      ) && allOk
  }

  const kpiSheet = wb.getWorksheet('KPI')
  let sheetSales = null
  if (kpiSheet) {
    kpiSheet.eachRow((row) => {
      const label = String(row.getCell(1).value || '').trim()
      if (label === '매출' || label === '총 매출') {
        const v = row.getCell(2).value
        if (v != null) sheetSales = Number(String(v).replace(/,/g, ''))
      }
    })
    allOk =
      okLine(
        'export KPI 매출',
        sheetSales != null && Math.abs(sheetSales - Number(kpiSummary.salesTotal)) <= 1,
        `sheet=${sheetSales} api=${kpiSummary.salesTotal}`,
      ) && allOk
  }

  await cleanupTest(pool)
  await pool.end()

  const pgOnly = requestLog.every(
    (u) => !u.includes('3001') && !u.startsWith(LEGACY_BASE),
  )
  allOk = okLine('legacy api calls', legacyCallCount === 0 && pgOnly, `count=${legacyCallCount}`) && allOk
  allOk = okLine('pg requests', pgOnly, `total=${requestLog.length}`) && allOk

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
