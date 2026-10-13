import { loadXlsx } from './lazyXlsx.js'
import { parseSalesDate } from './dateParse.js'
import { parseAmount, formatManualAdAmount } from './parseAmount.js'
import { createManualAdEntry, isGfaManualAdSource } from '../config/manualAdSpend.js'

const DEFAULT_PERIOD_COL = 0
const DEFAULT_SPEND_COL = 3

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toYmd(parsed) {
  if (!parsed) return ''
  return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`
}

function cellText(v) {
  if (v == null) return ''
  return String(v).trim()
}

function parseNaverPeriodCell(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toYmd(parseSalesDate(value))
  }
  const text = cellText(value).replace(/[．﹒]/g, '.')
  if (!text) return ''
  const ymd = toYmd(parseSalesDate(text))
  if (ymd) return ymd
  const range = text.match(/(\d{4})\s*[.\-/년．]?\s*(\d{1,2})\s*[.\-/월．]?\s*(\d{1,2})/)
  if (range) {
    return `${range[1]}-${pad2(range[2])}-${pad2(range[3])}`
  }
  return ''
}

function parseNaverSpendCell(rawValue, formattedValue) {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue
  }
  const candidates = [formattedValue, rawValue]
  for (const candidate of candidates) {
    const amount = parseAmount(candidate)
    if (amount !== 0) return amount
  }
  for (const candidate of candidates) {
    const amount = parseAmount(candidate)
    if (Number.isFinite(amount)) return amount
  }
  return 0
}

function isHeaderRow(periodCell, spendCell) {
  const a = cellText(periodCell)
  const d = cellText(spendCell)
  if (/^기간$|^날짜$|^일자$|^date$/i.test(a.replace(/\s/g, ''))) return true
  if (/^기간/.test(a) && !parseNaverPeriodCell(a)) return true
  if (/소진|총비용|광고비/i.test(d) && !parseAmount(d)) return true
  return false
}

function isSummaryRow(periodCell) {
  const t = cellText(periodCell)
  return /^(합계|총계|소계|total|전체|평균)/i.test(t)
}

function detectNaverAdColumns(fmtAoa) {
  let periodCol = DEFAULT_PERIOD_COL
  let spendCol = DEFAULT_SPEND_COL
  let headerRow = -1

  for (let r = 0; r < Math.min(20, fmtAoa.length); r += 1) {
    const row = fmtAoa[r] || []
    let foundPeriod = -1
    let foundSpend = -1
    for (let c = 0; c < row.length; c += 1) {
      const text = cellText(row[c]).replace(/\s/g, '')
      if (/^기간/.test(text) || text === '날짜' || text === '일자') foundPeriod = c
      if (/소진/.test(text) || text === '총비용' || text === '광고비') foundSpend = c
    }
    if (foundPeriod >= 0 && foundSpend >= 0) {
      periodCol = foundPeriod
      spendCol = foundSpend
      headerRow = r
      break
    }
  }

  return { periodCol, spendCol, headerRow }
}

/**
 * @param {File} file
 * @returns {Promise<{ fileName: string, rows: { date: string, adSpend: number }[], skipped: number }>}
 */
export async function parseNaverAdCenterExcelFile(file) {
  const XLSX = await loadXlsx()
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: true,
    dateNF: 'yyyy-mm-dd',
  })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const fmtAoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  const rawAoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })

  const { periodCol, spendCol, headerRow } = detectNaverAdColumns(fmtAoa)

  /** @type {{ date: string, adSpend: number }[]} */
  const rows = []
  let skipped = 0
  const startRow = headerRow >= 0 ? headerRow + 1 : 0

  for (let ri = startRow; ri < fmtAoa.length; ri += 1) {
    const fmtRow = fmtAoa[ri] || []
    const rawRow = rawAoa[ri] || []
    if (!fmtRow.length) continue

    const period = fmtRow[periodCol] ?? rawRow[periodCol]
    const spendFmt = fmtRow[spendCol]
    const spendRaw = rawRow[spendCol]

    if (isHeaderRow(period, spendFmt ?? spendRaw)) continue
    if (isSummaryRow(period)) continue
    if (!cellText(period) && !cellText(spendFmt) && spendRaw !== 0 && !spendRaw) continue

    const ymd = parseNaverPeriodCell(period)
    if (!ymd) {
      skipped += 1
      continue
    }

    const adSpend = parseNaverSpendCell(spendRaw, spendFmt)
    if (!Number.isFinite(adSpend)) {
      skipped += 1
      continue
    }

    rows.push({ date: ymd, adSpend })
  }

  if (!rows.length) {
    throw new Error(
      '네이버 광고주센터 엑셀에서 반영할 행이 없습니다. A열(기간)·D열(소진액) 형식인지 확인해 주세요.',
    )
  }

  return { fileName: file.name, rows: sumNaverAdRowsByDate(rows), skipped }
}

/**
 * @param {{ date: string, adSpend: number }[]} rows
 */
export function sumNaverAdRowsByDate(rows) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const row of rows) {
    map.set(row.date, (map.get(row.date) || 0) + row.adSpend)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, adSpend]) => ({ date, adSpend }))
}

/**
 * 일별 → 월별(YYYY-MM-01) 합산
 * @param {{ date: string, adSpend: number }[]} rows
 */
export function aggregateNaverAdRowsByMonth(rows) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const row of rows) {
    const monthStart = `${row.date.slice(0, 7)}-01`
    map.set(monthStart, (map.get(monthStart) || 0) + row.adSpend)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, adSpend]) => ({ date, adSpend }))
}

/**
 * GFA 엑셀 병합 — 같은 날짜 GFA 행만 갱신. Meta·AD 등 다른 구분은 건드리지 않음.
 * @param {import('../config/manualAdSpend.js').ManualAdEntry[]} entries
 * @param {{ date: string, adSpend: number }[]} importedRows
 * @param {{ period?: string, additive?: boolean }} [opts]
 */
export function mergeNaverAdIntoManualEntries(entries, importedRows, opts = {}) {
  const rows =
    opts.period === 'monthly' ? aggregateNaverAdRowsByMonth(importedRows) : importedRows

  /** @type {Map<string, string>} */
  const preservedAdSalesByDate = new Map()

  let added = 0
  let updated = 0
  let naverReplaced = 0

  if (opts.additive) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i]
      if (!isGfaManualAdSource(e?.source)) continue
      const pay = formatManualAdAmount(e.adSales)
      if (pay && !preservedAdSalesByDate.has(e.date)) {
        preservedAdSalesByDate.set(e.date, pay)
      }
      entries.splice(i, 1)
      naverReplaced += 1
    }
  }

  for (const row of rows) {
    const adSpendText = String(Math.round(row.adSpend))
    const date = row.date

    if (!opts.additive) {
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const e = entries[i]
        if (e.date !== date || !isGfaManualAdSource(e.source)) continue
        const pay = formatManualAdAmount(e.adSales)
        if (pay && !preservedAdSalesByDate.has(date)) {
          preservedAdSalesByDate.set(date, pay)
        }
        entries.splice(i, 1)
        naverReplaced += 1
      }
    }

    const entry = createManualAdEntry('gfa')
    entry.date = date
    entry.adSpend = adSpendText
    entry.adSales = preservedAdSalesByDate.get(date) || ''
    entries.push(entry)
    added += 1
  }

  return { added, updated, applied: rows.length, naverReplaced, additive: !!opts.additive }
}

/**
 * @param {{ fileName: string, rows: { date: string, adSpend: number }[], skipped: number }} parsed
 * @param {{ added: number, updated: number, applied: number }} mergeResult
 */
export function formatNaverAdImportMessage(parsed, mergeResult) {
  const sample = parsed.rows.find((r) => r.adSpend > 0) || parsed.rows[0]
  const sampleText = sample
    ? `예: ${sample.date} → ${Math.round(sample.adSpend).toLocaleString('ko-KR')}원`
    : ''
  const parts = [`${parsed.fileName}: ${mergeResult.applied}일(건) · GFA 반영`]
  if (mergeResult.additive) {
    parts.push(
      `${mergeResult.added}건${mergeResult.naverReplaced ? ` (기존 ${mergeResult.naverReplaced}건 교체)` : ''}`,
    )
  } else {
    parts.push(`신규 ${mergeResult.added} · 갱신 ${mergeResult.updated}`)
  }
  if (sampleText) parts.push(sampleText)
  if (parsed.skipped > 0) parts.push(`건너뜀 ${parsed.skipped}`)
  return parts.join(' · ')
}
