#!/usr/bin/env bun
/**
 * Stage 3 Golden — 현재 서버 파싱(parseExcelUpload)이 DB Golden Master.
 * 브라우저 allowZeroSalesProducts:true 와 달라도 서버 옵션은 바꾸지 않는다.
 *
 * bun infra/scripts/phase-3-upload-golden-compare.mjs
 * GOLDEN_DIR=tmp/golden-excels GOLDEN_UPLOAD=1 bun infra/scripts/phase-3-upload-golden-compare.mjs
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { basename, join } from 'path'
import * as XLSX from 'xlsx'
import {
  readPlatformDailyBuffer,
  readPlatformMonthlyBuffer,
  readPlatformPeriodBuffer,
} from '../../src/utils/platformOrderParser.js'
import { parseFilenameDateSpec } from '../../src/utils/dateParse.js'
import { parseExcelUpload } from '../../backend/src/services/uploadParseService.js'
import { toIsoDate } from '../../backend/src/utils/recordBackfill.js'

const RAW_BASE = process.env.GOLDEN_API_BASE || process.env.VITE_PG_API_BASE || 'http://192.168.0.245:8080/api/v1'
const PG = (RAW_BASE.startsWith('http')
  ? RAW_BASE
  : `http://192.168.0.245:8080${RAW_BASE.startsWith('/') ? RAW_BASE : `/${RAW_BASE}`}`
).replace(/\/$/, '')
const ROOT = join(import.meta.dirname, '../..')

function okLine(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'PASS' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

function num(v) {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function str(v) {
  return v == null ? '' : String(v).trim()
}

function inferPlatform(fileName) {
  const n = String(fileName)
  if (/네이버|스마트스토어|스스/i.test(n)) return '스마트스토어'
  return '쿠팡'
}

function inferKind(fileName, hint = '') {
  if (hint) return hint
  const spec = parseFilenameDateSpec(fileName)
  if (spec.type === 'range' && spec.from && spec.to) {
    const [y1, m1, d1] = spec.from.split('-').map(Number)
    const [y2, m2, d2] = spec.to.split('-').map(Number)
    const last = new Date(y2, m2, 0).getDate()
    if (d1 === 1 && d2 === last && y1 === y2 && m1 === m2) return 'platform_monthly'
    if (spec.from !== spec.to) return 'platform_period'
  }
  return 'platform_daily'
}

function canonFromParsedDetail(row, uploadKind) {
  return {
    product_name: str(row.productName || row.product_name),
    option_name: str(row.option || row.optionName || row.option_name),
    date: toIsoDate(row.date || row.saleDate || row.order_date) || str(row.date).slice(0, 10),
    sales: num(row.actualPayment ?? row.sales ?? row.saleAmount),
    sales_qty: num(row.quantity ?? row.salesQty ?? row.sales_qty),
    platform: str(row.platform || row.channel),
    channel: str(row.channel || row.platform),
    sales_method: str(row.salesMethod || row.sales_method),
    record_type: str(row.recordType || row.record_type || 'detail'),
    upload_kind: str(row.uploadKind || uploadKind),
    sheet_total: Boolean(row.isEsserSheetTotal),
    ad_spend: num(row.adSpend ?? row.ad_spend),
    ad_sales: num(row.adSales ?? row.ad_sales),
  }
}

function canonFromServerRecord(row, uploadKind) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  return {
    product_name: str(row.product_name || data.productName),
    option_name: str(row.option_name || data.option || data.optionName),
    date: toIsoDate(row.order_date || data.date) || str(row.order_date || data.date).slice(0, 10),
    sales: num(row.sales ?? data.actualPayment ?? data.sales),
    sales_qty: num(row.sales_qty ?? data.quantity ?? data.salesQty),
    platform: str(row.platform || data.platform),
    channel: str(row.channel || data.channel || row.platform),
    sales_method: str(row.sales_method || data.salesMethod),
    record_type: str(row.record_type || 'detail'),
    upload_kind: str(row.upload_kind || uploadKind),
    sheet_total: Boolean(data.isEsserSheetTotal),
    ad_spend: num(row.ad_spend ?? data.adSpend),
    ad_sales: num(data.adSales),
  }
}

function sortKey(r) {
  return [
    r.record_type,
    r.sheet_total ? '1' : '0',
    r.product_name,
    r.option_name,
    r.date,
    r.platform,
    r.sales_method,
    String(r.sales),
    String(r.sales_qty),
    String(r.ad_spend),
  ].join('|')
}

function diffLists(a, b) {
  if (a.length !== b.length) return `len ${a.length} vs ${b.length}`
  const sa = [...a].sort((x, y) => sortKey(x).localeCompare(sortKey(y), 'ko'))
  const sb = [...b].sort((x, y) => sortKey(x).localeCompare(sortKey(y), 'ko'))
  const setA = new Set(sa.map(sortKey))
  const setB = new Set(sb.map(sortKey))
  for (const k of setA) if (!setB.has(k)) return `only-left ${k}`
  for (const k of setB) if (!setA.has(k)) return `only-right ${k}`
  for (let i = 0; i < sa.length; i += 1) {
    const ka = JSON.stringify(sa[i])
    const kb = JSON.stringify(sb[i])
    if (ka !== kb) return `row ${i}: ${ka} !== ${kb}`
  }
  return ''
}

async function clientParse(buffer, fileName, kind, platform, options) {
  if (kind === 'platform_monthly' || kind === 'sales_monthly_b') {
    return readPlatformMonthlyBuffer(buffer, fileName, platform, options)
  }
  if (kind === 'platform_period' || kind === 'sales_period_b') {
    return readPlatformPeriodBuffer(buffer, fileName, platform, options)
  }
  return readPlatformDailyBuffer(buffer, fileName, platform, options)
}

function buildFixtureXlsx() {
  const headers = ['상품명', '매출', '판매수량', '배송구분', '날짜', '순이익금', '광고비']
  const rows = [
    headers,
    ['합계', '3000', '3', '로켓그로스', '2026-06-01', '500', '100'],
    ['테스트상품A', '1000', '1', '로켓그로스', '2026-06-01', '200', '40'],
    ['테스트상품B', '2000', '2', '로켓그로스', '2026-06-01', '300', '60'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

function buildLargeFixtureXlsx(n = 2500) {
  const headers = ['상품명', '매출', '판매수량', '배송구분', '날짜', '순이익금', '광고비']
  const rows = [headers, ['합계', String(n * 10), String(n), '로켓그로스', '2026-06-01', '0', String(n)]]
  for (let i = 0; i < n; i += 1) {
    rows.push([`대용량상품${i}`, '10', '1', '로켓그로스', '2026-06-01', '1', '1'])
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

function collectCases() {
  const cases = []
  const goldenDir = String(process.env.GOLDEN_DIR || join(ROOT, 'tmp/golden-excels')).trim()
  const docsDir = join(ROOT, 'docs')

  function addFile(filePath, extra = {}) {
    if (!existsSync(filePath) || !/\.xlsx$/i.test(filePath)) return
    const fileName = basename(filePath)
    if (fileName.startsWith('통합')) return
    cases.push({
      name: extra.name || fileName,
      filePath,
      kind: extra.kind || inferKind(fileName),
      platform: extra.platform || inferPlatform(fileName),
      companyB: Boolean(extra.companyB),
    })
  }

  if (existsSync(goldenDir)) {
    for (const name of readdirSync(goldenDir)) {
      const p = join(goldenDir, name)
      if (!statSync(p).isFile()) continue
      const companyB = /savonnerie|sales_daily_b|company_b|_b_/i.test(name)
      let kind = inferKind(name)
      if (/monthly/i.test(name)) kind = name.includes('sales_monthly') ? 'sales_monthly_b' : 'platform_monthly'
      if (/period/i.test(name)) kind = name.includes('sales_period') ? 'sales_period_b' : 'platform_period'
      if (/daily_b|sales_daily_b/i.test(name)) kind = 'sales_daily_b'
      addFile(p, { companyB: companyB || kind.startsWith('sales_'), kind })
    }
  }

  if (existsSync(docsDir)) {
    for (const name of readdirSync(docsDir)) {
      if (!/\.xlsx$/i.test(name)) continue
      addFile(join(docsDir, name), { name: `docs:${name}` })
    }
  }

  const rocket = cases.find((c) => /로켓그로스/.test(c.name || '') && c.filePath)
  if (rocket?.filePath) {
    cases.push({
      name: 'as-monthly-filename(docs rocket bytes)',
      filePath: rocket.filePath,
      kind: 'platform_monthly',
      platform: '쿠팡',
      fileName: '빅셀_로켓그로스_매출분석_20260801_20260831.xlsx',
    })
    cases.push({
      name: 'as-period-filename(docs rocket bytes)',
      filePath: rocket.filePath,
      kind: 'platform_period',
      platform: '쿠팡',
      fileName: '빅셀_로켓그로스_매출분석_20260801_20260810.xlsx',
    })
    cases.push({
      name: 'as-sales_daily_b(docs rocket bytes)',
      filePath: rocket.filePath,
      kind: 'sales_daily_b',
      platform: '쿠팡',
      companyB: true,
    })
    cases.push({
      name: 'as-sales_monthly_b(docs rocket bytes)',
      filePath: rocket.filePath,
      kind: 'sales_monthly_b',
      platform: '쿠팡',
      companyB: true,
      fileName: '빅셀_로켓그로스_매출분석_20260801_20260831.xlsx',
    })
    cases.push({
      name: 'legacy-filename-일자(docs rocket bytes)',
      filePath: rocket.filePath,
      kind: 'platform_daily',
      platform: '쿠팡',
      fileName: '빅셀_로켓그로스_매출분석_일자20260810.xlsx',
    })
  }

  cases.unshift({
    name: 'fixture-daily-sheet-ad',
    buffer: buildFixtureXlsx(),
    fileName: '빅셀_로켓그로스_매출분석_일자20260601_phase3golden.xlsx',
    kind: 'platform_daily',
    platform: '쿠팡',
  })
  cases.push({
    name: 'large-fixture-2500',
    buffer: buildLargeFixtureXlsx(2500),
    fileName: '빅셀_로켓그로스_매출분석_일자20260601_large.xlsx',
    kind: 'platform_daily',
    platform: '쿠팡',
    skipUpload: true,
  })
  return cases
}

async function compareParse(c) {
  const fileName = c.fileName || basename(c.filePath)
  const buffer = c.buffer || readFileSync(c.filePath)
  const t0 = performance.now()
  const serverA = await parseExcelUpload(buffer, fileName, {
    upload_kind: c.kind,
    platform: c.platform,
  })
  const serverB = await parseExcelUpload(buffer, fileName, {
    upload_kind: c.kind,
    platform: c.platform,
  })
  const parseMs = Math.round(performance.now() - t0)
  const recA = serverA.records || []
  const recB = serverB.records || []
  const canonA = recA.map((r) => canonFromServerRecord(r, c.kind))
  const canonB = recB.map((r) => canonFromServerRecord(r, c.kind))
  const idDiff = diffLists(canonA, canonB)

  const clientSame = await clientParse(buffer, fileName, c.kind, c.platform, {})
  const clientCanon = (clientSame.details || []).map((r) => canonFromParsedDetail(r, c.kind))
  // 서버 저장 매핑(정규 컬럼)과 클라이언트 raw detail의 upload_kind는 비어 있을 수 있음
  const clientAligned = clientCanon.map((r) => ({ ...r, upload_kind: c.kind }))
  const vsClient = diffLists(clientAligned, canonA)

  let zeroNote = ''
  if (c.kind === 'sales_daily_b' || c.kind === 'sales_monthly_b') {
    try {
      const withZero = await clientParse(buffer, fileName, c.kind, c.platform, {
        allowZeroSalesProducts: true,
      })
      const nTrue = withZero.details?.length || 0
      const nFalse = clientSame.details?.length || 0
      if (nTrue !== nFalse) {
        zeroNote = `allowZero true=${nTrue} server/false=${nFalse} (서버 옵션 유지, DB 기준은 ${nFalse}행)`
      }
    } catch {
      /* period/monthly 미지원 시 무시 */
    }
  }

  return {
    fileName,
    bytes: buffer.length,
    parseMs,
    count: recA.length,
    sheets: canonA.filter((r) => r.sheet_total).length,
    adSpend: canonA.reduce((s, r) => s + r.ad_spend, 0),
    adSales: canonA.reduce((s, r) => s + r.ad_sales, 0),
    identityOk: !idDiff,
    identityDiff: idDiff,
    vsClientOk: !vsClient,
    vsClientDiff: vsClient,
    zeroNote,
    buffer,
    serverBundle: serverA,
  }
}

async function pgMultipartUpload(buffer, fileName, fields = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([buffer]), fileName)
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, String(v))
  }
  const res = await fetch(`${PG}/uploads/excel`, { method: 'POST', body: fd })
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function fetchAllRecords(uploadId) {
  const items = []
  let page = 1
  for (;;) {
    const qs = new URLSearchParams({
      upload_ids: uploadId,
      record_type: 'detail',
      include_data: 'full',
      page: String(page),
      limit: '500',
    })
    const res = await fetch(`${PG}/records?${qs}`)
    const body = await res.json().catch(() => ({}))
    const batch = body.items || []
    items.push(...batch)
    if (batch.length < 500 || items.length >= Number(body.total || items.length)) break
    page += 1
    if (page > 40) break
  }
  return items
}

async function kpiBundle(from, to, scope) {
  const q = new URLSearchParams({ from, to, scope, include_manual_ads: 'true' })
  const [summary, daily, platform, segment] = await Promise.all([
    fetch(`${PG}/kpi/summary?${q}`).then((r) => r.json()),
    fetch(`${PG}/kpi/daily?${q}`).then((r) => r.json()),
    fetch(`${PG}/kpi/by-platform?${q}`).then((r) => r.json()),
    fetch(`${PG}/kpi/by-segment?${q}`).then((r) => r.json()).catch(() => ({ items: [] })),
  ])
  return { summary, daily, platform, segment }
}

function kpiFingerprint(k) {
  return JSON.stringify({
    sales: k.summary?.salesTotal ?? k.summary?.totalRow?.sales,
    qty: k.summary?.salesQtyTotal ?? k.summary?.totalRow?.salesQty,
    dailyN: k.daily?.items?.length ?? k.daily?.total,
    platN: k.platform?.items?.length ?? k.platform?.total,
    segN: k.segment?.items?.length ?? k.segment?.total,
    plat: (k.platform?.items || []).map((r) => [r.platform || r.label, r.sales, r.salesQty]),
  })
}

async function uploadAndCheckDb(c, parsed, allOkRef) {
  const origName = parsed.fileName
  const testName = `__golden_${Date.now()}_${origName}`
  const kind = c.kind
  const tUp = performance.now()
  const { res, body } = await pgMultipartUpload(parsed.buffer, testName, {
    upload_kind: kind,
    platform: c.platform,
    replace_same_name: 'false',
    force: 'true',
  })
  const uploadMs = Math.round(performance.now() - tUp)
  const okApi = res.ok && body.ok === true && Number(body.count) === parsed.count
  allOkRef.v =
    okLine(
      `  DB API 저장 ${c.name}`,
      okApi,
      `status=${res.status} count=${body.count} uploadMs=${uploadMs} parseMs=${parsed.parseMs}`,
    ) && allOkRef.v
  const uploadId = body.uploadId
  if (!uploadId) return

  const dbRows = await fetchAllRecords(uploadId)
  allOkRef.v =
    okLine(`  DB 행 수 ${c.name}`, dbRows.length === parsed.count, `db=${dbRows.length} parsed=${parsed.count}`) &&
    allOkRef.v

  const dbCanon = dbRows.map((r) => canonFromServerRecord(r, kind))
  const parsedCanon = (parsed.serverBundle.records || []).map((r) => canonFromServerRecord(r, kind))
  const diff = diffLists(parsedCanon, dbCanon)
  allOkRef.v = okLine(`  DB 필드 집합 ${c.name}`, !diff, diff) && allOkRef.v

  const idsOk = dbRows.every((r) => r.uploadId === uploadId || r.upload_id === uploadId)
  allOkRef.v = okLine(`  upload_id 연결 ${c.name}`, idsOk) && allOkRef.v

  const kindsOk = dbRows.every((r) => str(r.uploadKind || r.upload_kind) === kind)
  allOkRef.v = okLine(`  upload_kind ${c.name}`, kindsOk, dbRows[0]?.uploadKind || dbRows[0]?.upload_kind) && allOkRef.v

  const dated = dbRows.filter((r) => r.orderDate || r.order_date || r.date)
  allOkRef.v =
    okLine(
      `  저장 행 날짜 컬럼 ${c.name}`,
      dated.length === dbRows.length,
      `dated=${dated.length}`,
    ) && allOkRef.v

  const typesOk = dbRows.every((r) => str(r.recordType || r.record_type || 'detail') === 'detail')
  allOkRef.v = okLine(`  record_type ${c.name}`, typesOk) && allOkRef.v

  return { uploadId, uploadMs }
}

async function runDuplicateScenarios(allOkRef) {
  console.log('\n=== 중복 시나리오 (fixture, platform_daily, 운영 데이터 미삭제) ===')
  const buffer = buildFixtureXlsx()
  const nameA = '빅셀_로켓그로스_매출분석_일자20260601__dupA.xlsx'
  const nameB = '빅셀_로켓그로스_매출분석_일자20260601__dupB.xlsx'
  const fields = { upload_kind: 'platform_daily', platform: '쿠팡', replace_same_name: 'true', force: 'false' }

  const prior = await fetch(`${PG}/uploads?limit=200`).then((r) => r.json()).catch(() => ({}))
  for (const u of prior.items || []) {
    if (/__dup[AB]/i.test(String(u.fileName || u.file_name || ''))) {
      await fetch(`${PG}/uploads/${u.id}`, { method: 'DELETE' })
    }
  }

  const dump = (body) =>
    `status-body=${JSON.stringify({ ok: body.ok, duplicate: body.duplicate, error: body.error, message: body.message, code: body.code }).slice(0, 240)}`

  const first = await pgMultipartUpload(buffer, nameA, fields)
  allOkRef.v =
    okLine('D 첫 업로드', first.res.ok && first.body.ok === true, dump(first.body)) && allOkRef.v
  const id1 = first.body.uploadId

  const sameNameSame = await pgMultipartUpload(buffer, nameA, fields)
  allOkRef.v =
    okLine(
      'A 같은 파일명+같은 내용 (클라이언트 DELETE 없이)',
      sameNameSame.res.status === 409 && sameNameSame.body.duplicate === true,
      `status=${sameNameSame.res.status} ${dump(sameNameSame.body)}`,
    ) && allOkRef.v

  if (id1) await fetch(`${PG}/uploads/${id1}`, { method: 'DELETE' })
  const afterClientDelete = await pgMultipartUpload(buffer, nameA, fields)
  allOkRef.v =
    okLine(
      'A 클라이언트 DELETE 후 재업로드',
      afterClientDelete.res.ok && afterClientDelete.body.ok === true,
      `status=${afterClientDelete.res.status} ${dump(afterClientDelete.body)}`,
    ) && allOkRef.v
  const id1b = afterClientDelete.body.uploadId

  const otherBuf = Buffer.from(buffer)
  otherBuf[otherBuf.length - 1] = (otherBuf[otherBuf.length - 1] + 1) % 256
  let otherXlsx = buffer
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    XLSX.utils.sheet_add_aoa(sheet, [['테스트상품C', '50', '1', '로켓그로스', '2026-06-01', '10', '1']], {
      origin: -1,
    })
    otherXlsx = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  } catch {
    otherXlsx = otherBuf
  }

  const diffNameSame = await pgMultipartUpload(buffer, nameB, fields)
  allOkRef.v =
    okLine(
      'C 다른 파일명+같은 내용',
      diffNameSame.res.status === 409 && diffNameSame.body.duplicate === true,
      `status=${diffNameSame.res.status}`,
    ) && allOkRef.v

  const sameNameDiff = await pgMultipartUpload(otherXlsx, nameA, { ...fields, force: 'true' })
  allOkRef.v =
    okLine(
      'B 같은 파일명+다른 내용 (force 후 replace)',
      sameNameDiff.res.ok === true && sameNameDiff.body.ok === true,
      `status=${sameNameDiff.res.status} count=${sameNameDiff.body.count}`,
    ) && allOkRef.v
  const id2 = sameNameDiff.body.uploadId

  const diffNameDiff = await pgMultipartUpload(otherXlsx, nameB, { ...fields, force: 'true' })
  allOkRef.v =
    okLine('D 다른 파일명+다른 내용 (force)', diffNameDiff.res.ok === true || diffNameDiff.body.ok === true) &&
    allOkRef.v

  for (const id of [id1b, id2, diffNameDiff.body.uploadId]) {
    if (id) await fetch(`${PG}/uploads/${id}`, { method: 'DELETE' })
  }
  const leftover = await fetch(`${PG}/uploads?limit=200`).then((r) => r.json()).catch(() => ({}))
  const tests = (leftover.items || []).filter((u) =>
    /__dup[AB]/i.test(String(u.fileName || u.file_name || '')),
  )
  for (const u of tests) await fetch(`${PG}/uploads/${u.id}`, { method: 'DELETE' })
}

async function main() {
  const doUpload = process.env.GOLDEN_UPLOAD === '1'
  const cases = collectCases()
  console.log(`케이스 ${cases.length}건, API ${PG}, GOLDEN_UPLOAD=${doUpload ? '1' : '0'}`)
  const allOkRef = { v: true }

  for (const c of cases) {
    console.log(`\n=== ${c.name} kind=${c.kind} platform=${c.platform} ===`)
    let parsed
    try {
      parsed = await compareParse(c)
    } catch (e) {
      allOkRef.v = okLine(`파싱 ${c.name}`, false, e.message) && allOkRef.v
      continue
    }
    console.log(
      `size=${parsed.bytes}B rows=${parsed.count} sheets=${parsed.sheets} adSpend=${parsed.adSpend} parseMs=${parsed.parseMs}`,
    )
    allOkRef.v = okLine('  서버 파싱 2회 동일', parsed.identityOk, parsed.identityDiff) && allOkRef.v
    allOkRef.v =
      okLine(
        '  클라이언트(서버와 동일 옵션, allowZero 없음) vs 서버',
        parsed.vsClientOk,
        parsed.vsClientDiff,
      ) && allOkRef.v
    if (parsed.zeroNote) console.log(`  참고: ${parsed.zeroNote}`)

    if (doUpload && !c.skipUpload) {
      const dates = (parsed.serverBundle.records || [])
        .map((r) => toIsoDate(r.order_date || r.data?.date))
        .filter(Boolean)
        .sort()
      const from = dates[0] || '2026-08-01'
      const to = dates[dates.length - 1] || from
      const scope = c.kind.startsWith('sales_') ? 'company_b' : 'platform'
      const before = await kpiBundle(from, to, scope)
      const uploaded = await uploadAndCheckDb(c, parsed, allOkRef)
      try {
        if (uploaded?.uploadId) {
          const afterIns = await kpiBundle(from, to, scope)
          const kpiChanged = kpiFingerprint(before) !== kpiFingerprint(afterIns)
          allOkRef.v =
            okLine(`  KPI 업로드 직후 반영 ${c.name}`, kpiChanged, kpiChanged ? '' : 'fingerprint unchanged') &&
            allOkRef.v
          console.log(
            `  성능(사용자 기준 추정) ${c.name}: 기존≈parse+upload ${parsed.parseMs + uploaded.uploadMs}ms / 신규≈upload ${uploaded.uploadMs}ms (브라우저 파싱 ${parsed.parseMs}ms 제거, parse는 2회 측정)`,
          )
        }
      } finally {
        if (uploaded?.uploadId) {
          const del = await fetch(`${PG}/uploads/${uploaded.uploadId}`, { method: 'DELETE' })
          allOkRef.v = okLine(`  테스트 업로드 삭제 ${c.name}`, del.ok, `status=${del.status}`) && allOkRef.v
        }
      }
      const afterDel = await kpiBundle(from, to, scope)
      const sameKpi = kpiFingerprint(before) === kpiFingerprint(afterDel)
      allOkRef.v = okLine(`  KPI 삭제 후 복원 ${c.name}`, sameKpi) && allOkRef.v
    } else if (c.skipUpload) {
      console.log(
        `  대용량 파싱만: size=${parsed.bytes}B rows=${parsed.count} parseMs=${parsed.parseMs} (업로드 생략)`,
      )
    }
  }

  if (doUpload) await runDuplicateScenarios(allOkRef)

  console.log(`\nOVERALL: ${allOkRef.v ? 'PASS' : 'FAIL'}`)
  if (!allOkRef.v) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
