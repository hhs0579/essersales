import * as XLSX from 'xlsx'
import { DETAIL_COLUMNS, RECORD_TYPES } from '../constants/salesColumns.js'
import { buildDailySummaryFromDetails, parseAmount } from './salesAggregation.js'
import { parseSalesDate } from './dateParse.js'
import { sortRecordsForTab } from './recordSort.js'

function rowToCells(row, columns) {
  return columns.map((c) => row[c.key] ?? '')
}

function padRows(rows, len) {
  const cols = rows[0]?.length ?? 0
  const out = rows.map((r) => [...r])
  while (out.length < len) out.push(Array(cols).fill(''))
  return out
}

function aggregateFromDetails(details, type) {
  const buckets = new Map()

  for (const row of details) {
    const revenue = parseAmount(row.actualPayment)
    const margin = parseAmount(row.margin)
    const quantity = parseAmount(row.quantity)

    let key = ''
    let seed = null
    if (type === 'channel') {
      key = row.channel || ''
      if (!key) continue
      seed = { channel: key, revenue: 0, margin: 0, marginRate: '' }
    } else if (type === 'product') {
      key = row.productName || ''
      if (!key) continue
      seed = { productName: key, revenue: 0, margin: 0, quantity: 0, marginRate: '' }
    } else if (type === 'productOption') {
      const p = row.productName || ''
      const o = row.option || ''
      key = `${p}__${o}`
      if (!p) continue
      seed = { productName: p, option: o, quantity: 0 }
    } else continue

    if (!buckets.has(key)) buckets.set(key, seed)
    const agg = buckets.get(key)
    if ('revenue' in agg) {
      agg.revenue += revenue
      agg.margin += margin
    }
    if ('quantity' in agg) agg.quantity += quantity
  }

  return [...buckets.values()].map((x) => ({
    ...x,
    revenue: x.revenue != null ? String(Math.round(x.revenue)) : undefined,
    margin: x.margin != null ? String(Math.round(x.margin)) : undefined,
    quantity: x.quantity != null ? String(Math.round(x.quantity)) : undefined,
    marginRate:
      x.revenue > 0 ? `${((x.margin / x.revenue) * 100).toFixed(2)}%` : x.marginRate || '',
  }))
}

/** 상세 거래 목록 → 통합 매출 리포트 시트 데이터 */
export function buildMergedReportRows(details) {
  const sortedDetails = sortRecordsForTab(details, 'detail')
  const daily = sortRecordsForTab(buildDailySummaryFromDetails(details), 'daily')
  const channel = sortRecordsForTab(aggregateFromDetails(details, 'channel'), 'channel')
  const product = sortRecordsForTab(aggregateFromDetails(details, 'product'), 'product')
  const productOption = sortRecordsForTab(
    aggregateFromDetails(details, 'productOption'),
    'productOption',
  )

  const detailCols = DETAIL_COLUMNS
  const dailyCols = RECORD_TYPES.daily.columns
  const channelCols = RECORD_TYPES.channel.columns.filter((c) => c.key !== 'date')
  const productCols = RECORD_TYPES.product.columns.filter((c) => c.key !== 'date')
  const optionCols = RECORD_TYPES.productOption.columns.filter((c) => c.key !== 'date')

  const header = [
    ...detailCols.map((c) => c.label),
    '',
    ...dailyCols.map((c) => c.label),
    '',
    ...channelCols.map((c) => c.label),
    '',
    ...productCols.map((c) => c.label),
    '',
    ...optionCols.map((c) => c.label),
  ]

  const detailRows = sortedDetails.map((r) => rowToCells(r, detailCols))
  const dailyRows = daily.map((r) => rowToCells(r, dailyCols))
  const channelRows = channel.map((r) => rowToCells(r, channelCols))
  const productRows = product.map((r) => rowToCells(r, productCols))
  const optionRows = productOption.map((r) => rowToCells(r, optionCols))

  const maxLen = Math.max(
    detailRows.length,
    dailyRows.length,
    channelRows.length,
    productRows.length,
    optionRows.length,
    1,
  )

  const pDetail = padRows(detailRows, maxLen)
  const pDaily = padRows(dailyRows, maxLen)
  const pChannel = padRows(channelRows, maxLen)
  const pProduct = padRows(productRows, maxLen)
  const pOption = padRows(optionRows, maxLen)

  const body = []
  for (let i = 0; i < maxLen; i++) {
    body.push([
      ...pDetail[i],
      '',
      ...pDaily[i],
      '',
      ...pChannel[i],
      '',
      ...pProduct[i],
      '',
      ...pOption[i],
    ])
  }

  return [header, ...body]
}

export function downloadMergedSalesReport(details, fileName = '통합_매출리포트.xlsx') {
  const aoa = buildMergedReportRows(details)
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '통합')
  XLSX.writeFile(wb, fileName)
}

export function mergedFileName(uploads) {
  const names = uploads.map((u) => u.fileName.replace(/\.(xlsx|xls|csv)$/i, ''))
  if (names.length === 1) return `${names[0]}_통합.xlsx`
  if (names.length <= 3) return `${names.join('_')}_통합.xlsx`
  return `매출통합_${names.length}개파일.xlsx`
}

export function dateRangeLabel(details) {
  const dates = details
    .map((r) => parseSalesDate(r.date))
    .filter(Boolean)
    .sort((a, b) => a.date - b.date)
  if (!dates.length) return ''
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (first.year === last.year && first.month === last.month) {
    return `${first.year}년 ${first.month}월`
  }
  return `${first.year}.${first.month} ~ ${last.year}.${last.month}`
}
