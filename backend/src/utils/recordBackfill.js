/**
 * SQLite 마이그레이션과 동일한 sales_records 정규 컬럼 backfill
 */
import { parseSalesDate } from '../../../src/utils/dateParse.js'
import { parseAmount } from '../../../src/utils/parseAmount.js'

export function coalesceStr(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

export function toIsoDate(val) {
  if (val == null || val === '') return null
  const parsed = parseSalesDate(val)
  if (!parsed) return null
  const y = parsed.year
  const m = String(parsed.month).padStart(2, '0')
  const d = String(parsed.day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseBusinessDateRange(val) {
  if (val == null || val === '') {
    return { periodFrom: null, periodTo: null, singleDate: null }
  }
  const s = String(val).trim()
  const range = s.match(/^(\d{4}-\d{2}-\d{2})\s*[~～\-–—]\s*(\d{4}-\d{2}-\d{2})$/)
  if (range) {
    return { periodFrom: range[1], periodTo: range[2], singleDate: range[1] }
  }
  const single = toIsoDate(s)
  return { periodFrom: single, periodTo: single, singleDate: single }
}

export function parseNumeric(val) {
  if (val == null || val === '') return null
  const n = parseAmount(val)
  if (!Number.isFinite(n)) return null
  return n
}

export function inferFileType(fileName = '') {
  const lower = String(fileName).toLowerCase()
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel'
  if (lower.endsWith('.csv')) return 'text/csv'
  return ''
}

/**
 * @param {object} data record data JSON
 * @param {object | null} upload uploads row
 */
export function mapSalesRecordBackfill(data, upload = null) {
  const dateRaw = coalesceStr(data.date, data.saleDate, data.business_date)
  const uploadDateInfo = upload?.business_date
    ? parseBusinessDateRange(upload.business_date)
    : upload?.period_from
      ? {
          periodFrom: upload.period_from,
          periodTo: upload.period_to,
          singleDate: upload.business_date,
        }
      : null
  const orderDate = toIsoDate(dateRaw) || uploadDateInfo?.singleDate || null

  let periodFrom = upload?.period_from || uploadDateInfo?.periodFrom || null
  let periodTo = upload?.period_to || uploadDateInfo?.periodTo || null
  if (!periodFrom && orderDate) {
    periodFrom = orderDate
    periodTo = orderDate
  }

  const businessDate = orderDate || periodFrom || upload?.business_date || null

  return {
    order_date: orderDate,
    business_date: businessDate,
    period_from: periodFrom,
    period_to: periodTo,
    platform: coalesceStr(data.platform, data.channel, upload?.platform),
    sales_method: coalesceStr(data.salesMethod, data.sales_type, upload?.sales_method),
    channel: coalesceStr(data.channel, data.platform),
    store_name: coalesceStr(data.brand, data.storeName, data.store_name),
    product_code: coalesceStr(data.productCode, data.product_code),
    product_name: coalesceStr(data.productName, data.product_name),
    option_name: coalesceStr(data.option, data.optionName, data.option_name),
    sales: parseNumeric(coalesceStr(data.sales, data.actualPayment, data.saleAmount, data.revenue)),
    sales_qty: parseNumeric(coalesceStr(data.salesQty, data.quantity, data.qty)),
    net_profit: parseNumeric(coalesceStr(data.netProfit, data.margin)),
    ad_spend: parseNumeric(data.adSpend),
    transaction_type: coalesceStr(data.transactionType, data.transaction_type),
    upload_kind: coalesceStr(data.uploadKind, upload?.upload_kind),
    upload_format: coalesceStr(data.uploadFormat, data.upload_format, upload?.upload_format),
  }
}
