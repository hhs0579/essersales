#!/usr/bin/env bun
/**
 * Stage 3 NAS ops smoke: health, asset, Playwright daily upload, API monthly/period, pagination, export.
 * bun infra/scripts/phase-3-nas-ops-smoke.mjs
 */
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { basename, join } from 'path'
import { chromium } from 'playwright'

const BASE = process.env.NAS_BASE || 'http://192.168.0.245:8080'
const API = `${BASE}/api/v1`
const ROOT = join(import.meta.dirname, '../..')
const DOCS = join(ROOT, 'docs')
const TMP = join(ROOT, 'tmp', 'nas-smoke')
const rocket = join(DOCS, '빅셀_로켓그로스_매출분석_20260810_20260810.xlsx')

function ok(label, pass, extra = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  return pass
}

async function fetchJson(path, opts) {
  const res = await fetch(`${API}${path}`, opts)
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function uploadExcel(filePath, fileName, fields) {
  const buf = Buffer.from(await Bun.file(filePath).arrayBuffer())
  const fd = new FormData()
  fd.append('file', new Blob([buf]), fileName)
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v))
  const t0 = performance.now()
  const res = await fetch(`${API}/uploads/excel`, { method: 'POST', body: fd })
  const ms = Math.round(performance.now() - t0)
  const body = await res.json().catch(() => ({}))
  return { res, body, ms }
}

async function deleteUpload(id) {
  if (!id) return
  await fetch(`${API}/uploads/${id}`, { method: 'DELETE' })
}

async function recordsFor(uploadId) {
  const items = []
  let page = 1
  for (;;) {
    const q = new URLSearchParams({
      upload_ids: uploadId,
      record_type: 'detail',
      include_data: 'full',
      page: String(page),
      limit: '100',
    })
    const { body } = await fetchJson(`/records?${q}`)
    const batch = body.items || []
    items.push(...batch)
    if (batch.length < 100 || items.length >= Number(body.total || items.length)) break
    page += 1
    if (page > 30) break
  }
  return items
}

async function main() {
  let all = true
  mkdirSync(TMP, { recursive: true })

  const health = await fetchJson('/health')
  console.log('HEALTH', JSON.stringify(health.body, null, 2))
  all =
    ok(
      'health stage3 stamp',
      health.body.ok === true &&
        health.body.stage3DirectUpload === true &&
        health.body.codeStamp === 'stage3-direct-upload-20260820' &&
        health.body.kpiSqlRevision === 3 &&
        health.body.db?.migrationVersion === 6,
      `rev=${health.body.kpiSqlRevision} mig=${health.body.db?.migrationVersion} stamp=${health.body.codeStamp}`,
    ) && all

  const indexHtml = await (await fetch(`${BASE}/`)).text()
  all = ok('frontend index hash', indexHtml.includes('index-BDd0XPE7.js'), indexHtml.slice(0, 120)) && all
  const pageJs = await (await fetch(`${BASE}/assets/PlatformUploadPage-Bp2ifU2N.js`)).text()
  all = ok('bundle 파일 선택 완료', pageJs.includes('파일 선택 완료')) && all
  all = ok('bundle 서버 처리 중', pageJs.includes('서버 처리 중')) && all
  all = ok('bundle no parseExcelInWorker', !pageJs.includes('parseExcelInWorker')) && all
  all = ok('bundle no excelParse.worker', !pageJs.includes('excelParse.worker')) && all
  all = ok('bundle no parsePlatformDailyInWorker', !pageJs.includes('parsePlatformDailyInWorker')) && all

  const dailyName = '빅셀_로켓그로스_매출분석_일자20260810__nas_smoke_daily.xlsx'
  const monthlyName = '빅셀_로켓그로스_매출분석_20260801_20260831__nas_smoke_monthly.xlsx'
  const periodName = '빅셀_로켓그로스_매출분석_20260801_20260810__nas_smoke_period.xlsx'
  const dailyPath = join(TMP, dailyName)
  const monthlyPath = join(TMP, monthlyName)
  const periodPath = join(TMP, periodName)
  copyFileSync(rocket, dailyPath)
  copyFileSync(rocket, monthlyPath)
  copyFileSync(rocket, periodPath)

  const created = []

  let browserOk = false
  if (process.env.SKIP_PLAYWRIGHT === '1') {
    console.log('\n=== Playwright skipped (SKIP_PLAYWRIGHT=1) ===')
  } else {
  try {
    console.log('\n=== Playwright daily (browser) ===')
    const chromeCandidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    const exe = chromeCandidates.find((p) => existsSync(p))
    const browser = await chromium.launch({
      headless: true,
      executablePath: exe,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 30000,
    })
    const page = await browser.newPage()
    const net = []
    page.on('request', (req) => {
      net.push({
        method: req.method(),
        url: req.url(),
        post: req.postDataBuffer()?.byteLength || 0,
      })
    })
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.getByText('엑셀 파일을 드래그하거나 클릭', { timeout: 20000 }).waitFor()
    const tUi = performance.now()
    await page.locator('input[type=file]').first().setInputFiles(dailyPath)
    const success = page.locator('.success-msg')
    await success.waitFor({ timeout: 120000 })
    const uiMs = Math.round(performance.now() - tUi)
    const msg = (await success.textContent()) || ''
    console.log('UI success:', msg.trim(), `uiMs=${uiMs}`)
    all = ok('daily UI completed', /건 저장/.test(msg), msg.trim()) && all
    all = ok('daily UI not stuck', uiMs < 60000, `${uiMs}ms`) && all

    const excelPosts = net.filter((r) => r.method === 'POST' && r.url.includes('/api/v1/uploads/excel'))
    all = ok('network POST excel only for save', excelPosts.length >= 1, `excelPosts=${excelPosts.length}`) && all
    const detailsPosts = net.filter((r) => /details|records/.test(r.url) && r.method === 'POST')
    all = ok('no details JSON POST', detailsPosts.length === 0, JSON.stringify(detailsPosts)) && all
    const lastExcel = excelPosts[excelPosts.length - 1]
    console.log('excel post bytes', lastExcel?.post, 'url', lastExcel?.url)
    all =
      ok(
        'multipart size ~ file not JSON dump',
        lastExcel && lastExcel.post > 40000 && lastExcel.post < 120000,
        `post=${lastExcel?.post}`,
      ) && all

    await page.locator('input[type=file]').first().setInputFiles({
      name: 'not-excel.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    })
    const err = page.locator('.error-msg')
    const errVisible = await err.isVisible().catch(() => false)
    const errText = errVisible ? (await err.textContent()) || '' : ''
    all = ok('invalid file error shown', /지원하지 않는 파일/.test(errText), errText) && all
    await browser.close()
    browserOk = true
  } catch (e) {
    console.log('Playwright unavailable:', e.message?.slice(0, 240))
  }
  }

  if (!browserOk) {
    console.log('\n=== Fallback: same Vue multipart as browser (no Worker) ===')
    const daily = await uploadExcel(dailyPath, dailyName, {
      upload_kind: 'platform_daily',
      platform: '쿠팡',
      replace_same_name: 'true',
      force: 'true',
    })
    console.log('daily API', daily.res.status, daily.body.count, daily.body.parseMeta, `ms=${daily.ms}`)
    all = ok('daily API upload', daily.res.ok && daily.body.count === 267, `count=${daily.body.count}`) && all
    all = ok('daily parseMeta present', Boolean(daily.body.parseMeta)) && all
    if (daily.body.uploadId) created.push(daily.body.uploadId)
  }

  const uploads = await fetchJson('/uploads?limit=50')
  const smokeDaily = (uploads.body.items || []).find((u) => (u.fileName || u.file_name) === dailyName)
  all = ok('daily upload exists', Boolean(smokeDaily?.id), smokeDaily?.id) && all
  if (smokeDaily?.id) created.push(smokeDaily.id)

  const dailyRows = smokeDaily?.id ? await recordsFor(smokeDaily.id) : []
  all = ok('daily record count 267', dailyRows.length === 267, `n=${dailyRows.length}`) && all
  const sheetN = dailyRows.filter((r) => r.data?.isEsserSheetTotal).length
  all = ok('daily sheet total', sheetN === 1, `sheet=${sheetN}`) && all
  const ad = dailyRows.reduce((s, r) => s + Number(r.adSpend || r.ad_spend || 0), 0)
  all = ok('daily ad spend', ad === 104708, `ad=${ad}`) && all

  console.log('\n=== API monthly / period (UI tab hidden / unmounted) ===')
  const monthly = await uploadExcel(monthlyPath, monthlyName, {
    upload_kind: 'platform_monthly',
    platform: '쿠팡',
    replace_same_name: 'true',
    force: 'true',
  })
  console.log('monthly', monthly.res.status, monthly.body.count, monthly.body.parseMeta, `ms=${monthly.ms}`)
  all = ok('monthly upload', monthly.res.ok && monthly.body.count === 266, `count=${monthly.body.count}`) && all
  if (monthly.body.uploadId) created.push(monthly.body.uploadId)
  all = ok('monthly parseMeta skipped', monthly.body.parseMeta != null) && all

  const period = await uploadExcel(periodPath, periodName, {
    upload_kind: 'platform_period',
    platform: '쿠팡',
    replace_same_name: 'true',
    force: 'true',
  })
  console.log('period', period.res.status, period.body.count, period.body.parseMeta, `ms=${period.ms}`)
  all = ok('period upload', period.res.ok && period.body.count === 266, `count=${period.body.count}`) && all
  if (period.body.uploadId) created.push(period.body.uploadId)

  console.log('\n=== pagination / export ===')
  const p1 = await fetchJson('/records?record_type=detail&page=1&limit=100&include_data=lean')
  const p2 = await fetchJson('/records?record_type=detail&page=2&limit=100&include_data=lean')
  all = ok('records page1 100', (p1.body.items || []).length === 100, `n=${p1.body.items?.length} total=${p1.body.total}`) && all
  all = ok('records page2 different', (p2.body.items || [])[0]?.id !== (p1.body.items || [])[0]?.id) && all
  all = ok('records not full dump', (p1.body.items || []).length < Number(p1.body.total || 0), `total=${p1.body.total}`) && all

  const exp = await fetch(`${API}/exports/table?scope=platform&tab=detail`)
  const expOk = exp.ok
  const expLen = Number(exp.headers.get('content-length') || 0)
  const buf = Buffer.from(await exp.arrayBuffer())
  all = ok('table excel download', expOk && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b, `bytes=${buf.length}`) && all

  const dup = await uploadExcel(dailyPath, dailyName, {
    upload_kind: 'platform_daily',
    platform: '쿠팡',
    replace_same_name: 'true',
    force: 'false',
  })
  all = ok('dup same file 409 without client delete', dup.res.status === 409 && dup.body.duplicate === true) && all

  console.log('\n=== cleanup smoke uploads ===')
  for (const id of created) await deleteUpload(id)
  const after = await fetchJson('/uploads?limit=50')
  const leftover = (after.body.items || []).filter((u) => /__nas_smoke/.test(u.fileName || u.file_name || ''))
  all = ok('smoke uploads deleted', leftover.length === 0, leftover.map((u) => u.fileName).join(',')) && all

  all = ok('browser UI smoke', browserOk, browserOk ? '' : 'Playwright launch blocked; used identical multipart API') && all

  console.log(`\nOVERALL: ${all ? 'PASS' : 'FAIL'}`)
  if (!all) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
