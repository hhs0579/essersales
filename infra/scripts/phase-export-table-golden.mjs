#!/usr/bin/env bun
/**
 * 표 엑셀 Golden — GET /api/v1/exports/table 을 파일로 저장하거나 두 폴더를 셀 단위 비교.
 *
 * 저장: bun infra/scripts/phase-export-table-golden.mjs save
 * 비교: bun infra/scripts/phase-export-table-golden.mjs compare tmp/export-golden-before tmp/export-golden-after
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import ExcelJS from 'exceljs'

const API = (process.env.GOLDEN_API_BASE || 'http://192.168.0.245:8080/api/v1').replace(/\/$/, '')
const ROOT = join(import.meta.dirname, '../..')

export const EXPORT_CASES = [
  { id: 'day', qs: { scope: 'platform', tab: 'detail', from: '2026-08-19', to: '2026-08-19' } },
  { id: 'week', qs: { scope: 'platform', tab: 'detail', from: '2026-08-01', to: '2026-08-07' } },
  { id: 'month', qs: { scope: 'platform', tab: 'detail', from: '2026-08-01', to: '2026-08-31' } },
  { id: 'ytd', qs: { scope: 'platform', tab: 'detail', from: '2026-01-01', to: '2026-08-20' } },
  { id: 'all', qs: { scope: 'platform', tab: 'detail' } },
  { id: 'coupang', qs: { scope: 'platform', tab: 'detail', from: '2026-08-01', to: '2026-08-31', platform: '쿠팡' } },
  { id: 'rocket', qs: { scope: 'platform', tab: 'detail', from: '2026-08-01', to: '2026-08-31', sales_method: '로켓그로스' } },
  { id: 'product', qs: { scope: 'platform', tab: 'detail', from: '2026-08-01', to: '2026-08-31', product_name: '제스톰' } },
  { id: 'company_b', qs: { scope: 'company_b', tab: 'detail', from: '2026-08-01', to: '2026-08-31' } },
]

function qs(obj) {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && String(v).trim() !== '') u.set(k, String(v))
  }
  return u.toString()
}

function cellDump(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if (value.result != null) return cellDump(value.result)
    if (value.formula != null) return `=${value.formula}`
    if (value.text != null) return String(value.text)
    if (value.richText) return value.richText.map((t) => t.text).join('')
    if (value.sharedFormula != null) return `shared:${value.sharedFormula}`
    return JSON.stringify(value)
  }
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value)
  return String(value)
}

function styleDump(cell) {
  const font = cell.font || {}
  const fill = cell.fill || {}
  const align = cell.alignment || {}
  const border = cell.border || {}
  return {
    numFmt: cell.numFmt || '',
    fontName: font.name || '',
    fontSize: font.size || '',
    fontBold: Boolean(font.bold),
    fontCharset: font.charset || '',
    fontColor: font.color?.argb || '',
    fill: fill.fgColor?.argb || fill.pattern || '',
    hAlign: align.horizontal || '',
    vAlign: align.vertical || '',
    wrap: Boolean(align.wrapText),
    border: [border.top?.style, border.left?.style, border.bottom?.style, border.right?.style].join(','),
  }
}

export async function snapshotWorkbook(buf) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheets = wb.worksheets.map((ws) => {
    const rows = []
    const styles = []
    const maxCol = ws.columnCount || 1
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells = []
      const st = []
      for (let c = 1; c <= Math.max(maxCol, row.cellCount || 0); c += 1) {
        const cell = row.getCell(c)
        cells.push(cellDump(cell.value))
        st.push(styleDump(cell))
      }
      rows.push({ n: rowNumber, h: row.height || '', cells })
      styles.push(st)
    })
    const cols = []
    ws.columns?.forEach((col, i) => {
      if (col?.width != null) cols.push({ i, w: col.width })
    })
    return {
      name: ws.name,
      views: JSON.stringify(ws.views || []),
      autoFilter: JSON.stringify(ws.autoFilter || null),
      cols,
      rows,
      styles,
    }
  })
  return { sheetCount: sheets.length, sheets }
}

function diffSnap(a, b) {
  const diffs = []
  if (a.sheetCount !== b.sheetCount) diffs.push(`sheetCount ${a.sheetCount} vs ${b.sheetCount}`)
  const n = Math.max(a.sheets.length, b.sheets.length)
  for (let s = 0; s < n; s += 1) {
    const sa = a.sheets[s]
    const sb = b.sheets[s]
    if (!sa || !sb) {
      diffs.push(`sheet ${s} missing`)
      continue
    }
    if (sa.name !== sb.name) diffs.push(`sheet${s} name ${sa.name} vs ${sb.name}`)
    if (sa.views !== sb.views) diffs.push(`sheet${s} views`)
    if (sa.autoFilter !== sb.autoFilter) diffs.push(`sheet${s} autoFilter`)
    if (JSON.stringify(sa.cols) !== JSON.stringify(sb.cols)) diffs.push(`sheet${s} col widths`)
    if (sa.rows.length !== sb.rows.length) diffs.push(`sheet${s} rowCount ${sa.rows.length} vs ${sb.rows.length}`)
    const rmax = Math.max(sa.rows.length, sb.rows.length)
    for (let i = 0; i < rmax && diffs.length < 30; i += 1) {
      const ra = sa.rows[i]
      const rb = sb.rows[i]
      if (!ra || !rb) {
        diffs.push(`sheet${s} row ${i + 1} missing`)
        continue
      }
      if (ra.h !== rb.h) diffs.push(`sheet${s} r${i + 1} height ${ra.h} vs ${rb.h}`)
      const cmax = Math.max(ra.cells.length, rb.cells.length)
      if (ra.cells.length !== rb.cells.length) {
        diffs.push(`sheet${s} r${i + 1} colCount ${ra.cells.length} vs ${rb.cells.length}`)
      }
      for (let c = 0; c < cmax && diffs.length < 30; c += 1) {
        if ((ra.cells[c] ?? '') !== (rb.cells[c] ?? '')) {
          diffs.push(`sheet${s} r${i + 1}c${c + 1} value ${JSON.stringify(ra.cells[c])} vs ${JSON.stringify(rb.cells[c])}`)
        }
        const sta = sa.styles[i]?.[c]
        const stb = sb.styles[i]?.[c]
        if (JSON.stringify(sta) !== JSON.stringify(stb)) {
          diffs.push(`sheet${s} r${i + 1}c${c + 1} style ${JSON.stringify(sta)} vs ${JSON.stringify(stb)}`)
        }
      }
    }
  }
  return diffs
}

export async function downloadCase(c) {
  const url = `${API}/exports/table?${qs(c.qs)}`
  const t0 = performance.now()
  const res = await fetch(url)
  const ms = Math.round(performance.now() - t0)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${c.id} HTTP ${res.status} ${err.slice(0, 200)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
    const profile = res.headers.get('x-export-profile') || ''
    let profileJson = null
    if (profile) {
      try {
        profileJson = JSON.parse(Buffer.from(profile, 'base64').toString('utf8'))
      } catch {
        profileJson = profile
      }
    }
  return {
    id: c.id,
    ms,
    bytes: buf.length,
    rowCount: res.headers.get('x-row-count'),
    sheetCount: res.headers.get('x-sheet-count'),
    profile: profileJson,
    buf,
  }
}

async function saveAll(dir) {
  mkdirSync(dir, { recursive: true })
  const summary = []
  for (const c of EXPORT_CASES) {
    console.log('download', c.id)
    const got = await downloadCase(c)
    writeFileSync(join(dir, `${c.id}.xlsx`), got.buf)
    summary.push({
      id: c.id,
      ms: got.ms,
      bytes: got.bytes,
      rowCount: got.rowCount,
      sheetCount: got.sheetCount,
      profile: got.profile,
    })
    console.log(`  ${got.ms}ms ${got.bytes}B rows=${got.rowCount} profile=${JSON.stringify(got.profile)?.slice(0, 400)}`)
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(summary, null, 2))
  console.log('saved', dir)
}

async function compareDirs(aDir, bDir) {
  let all = true
  for (const c of EXPORT_CASES) {
    const pa = join(aDir, `${c.id}.xlsx`)
    const pb = join(bDir, `${c.id}.xlsx`)
    if (!existsSync(pa) || !existsSync(pb)) {
      console.log(`FAIL  ${c.id} missing file`)
      all = false
      continue
    }
    const sa = await snapshotWorkbook(readFileSync(pa))
    const sb = await snapshotWorkbook(readFileSync(pb))
    const diffs = diffSnap(sa, sb)
    const pass = diffs.length === 0
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.id}${pass ? '' : ` — ${diffs.slice(0, 8).join(' | ')}`}`)
    all = all && pass
  }
  console.log(`\nGOLDEN: ${all ? 'PASS' : 'FAIL'}`)
  if (!all) process.exit(1)
}

const cmd = process.argv[2] || 'save'
if (import.meta.main) {
  if (cmd === 'save') {
    const dir = process.argv[3] || join(ROOT, 'tmp/export-golden-before')
    await saveAll(dir)
  } else if (cmd === 'compare') {
    await compareDirs(process.argv[3], process.argv[4])
  } else {
    console.error('save | compare')
    process.exit(1)
  }
}
