#!/usr/bin/env bun
/**
 * NAS records API + 로컬 ExcelJS 파이프라인 실측 (운영 DB 직접 연결 없이)
 * bun infra/scripts/profile-table-export-local.mjs
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fetchUploads } from '../../src/services/apiClient.js'

const API = 'http://192.168.0.245:8080/api/v1'
const ROOT = join(import.meta.dirname, '../..')

async function fetchAllDetails({ scope, from, to }) {
  const items = []
  let page = 1
  const t0 = performance.now()
  for (;;) {
    const q = new URLSearchParams({
      record_type: 'detail',
      include_data: 'full',
      scope: scope || 'platform',
      page: String(page),
      limit: '500',
    })
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const res = await fetch(`${API}/records?${q}`)
    const body = await res.json()
    const batch = body.items || []
    items.push(...batch)
    if (batch.length < 500 || items.length >= Number(body.total || items.length)) break
    page += 1
    if (page > 80) break
  }
  return { items, ms: Math.round(performance.now() - t0), total: items.length }
}

function memSnap() {
  const m = process.memoryUsage()
  return {
    heapUsedMb: Math.round((m.heapUsed / 1024 / 1024) * 10) / 10,
    rssMb: Math.round((m.rss / 1024 / 1024) * 10) / 10,
  }
}

const CASES = [
  { id: 'month', scope: 'platform', from: '2026-08-01', to: '2026-08-31' },
]

async function main() {
  const {
    buildLegacyTableRows,
    filterObjFromQuery,
  } = await import('../../src/utils/legacyTableRows.js')
  const { enrichExportRecords } = await import('../../src/utils/combinedExportRecords.js')
  const { buildTableWorkbook } = await import('../../src/utils/dashboardExporter.js')
  const { applyKoreanFontToWorkbook } = await import('../../src/utils/excelWorkbookStyle.js')
  const { sanitizeDetailColumns, resolveDetailColumns } = await import('../../src/constants/salesColumns.js')
  const uploadsRes = await fetch(`${API}/uploads?limit=500`)
  const uploadsJson = await uploadsRes.json()
  const uploads = uploadsJson.items || []

  const out = []
  mkdirSync(join(ROOT, 'tmp/export-profile'), { recursive: true })

  for (const c of CASES) {
    global.gc?.()
    const mem0 = memSnap()
    const fetched = await fetchAllDetails(c)
    const mem1 = memSnap()

    const tEnrich = performance.now()
    const manuals = enrichExportRecords([], c.scope, {
      powerPriceStore: null,
      ownMallStore: null,
      coupang1pStore: null,
    })
    const enrichMs = Math.round(performance.now() - tEnrich)

    const filters = filterObjFromQuery({ from: c.from, to: c.to, scope: c.scope })
    const tLegacy = performance.now()
    const rows = buildLegacyTableRows({
      pgRecords: fetched.items,
      uploads,
      manualRecords: manuals,
      scope: c.scope,
      tab: 'detail',
      filters,
    })
    const legacyMs = Math.round(performance.now() - tLegacy)
    const filterSort = buildLegacyTableRows.lastTimings || {}
    const mem2 = memSnap()

    const columns = sanitizeDetailColumns(resolveDetailColumns(rows))
    const tWb = performance.now()
    const { wb, fileName } = buildTableWorkbook({
      rows,
      columns,
      sheetName: '상세',
      channelLabel: '베스트하임',
      filters,
    })
    const wbMs = Math.round(performance.now() - tWb)
    const wbParts = buildTableWorkbook.lastTimings || {}
    const mem3 = memSnap()

    const tFont = performance.now()
    applyKoreanFontToWorkbook(wb)
    const fontMs = Math.round(performance.now() - tFont)
    const mem4 = memSnap()

    const tWrite = performance.now()
    const buf = Buffer.from(await wb.xlsx.writeBuffer())
    const writeMs = Math.round(performance.now() - tWrite)
    const tWriteFast = performance.now()
    const bufFast = Buffer.from(
      await wb.xlsx.writeBuffer({
        zip: { compression: 'DEFLATE', compressionOptions: { level: 1 } },
      }),
    )
    const writeFastMs = Math.round(performance.now() - tWriteFast)
    const mem5 = memSnap()

    const row = {
      id: c.id,
      apiFetchMs: fetched.ms,
      apiRows: fetched.total,
      exportRows: rows.length,
      enrichMs,
      legacyMs,
      ...filterSort,
      wbMs,
      ...wbParts,
      fontMs,
      writeMs,
        bytes: buf.length,
        bytesFast: bufFast.length,
        writeFastMs,
      mem0,
      memAfterFetch: mem1,
      memAfterRows: mem2,
      memAfterWorkbook: mem3,
      memAfterFont: mem4,
      memAfterBuffer: mem5,
    }
    out.push(row)
    console.log(JSON.stringify(row, null, 2))
  }
  writeFileSync(join(ROOT, 'tmp/export-profile/local.json'), JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
