/**
 * Shared helpers for Phase 1-2 migration scripts.
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { parseSalesDate } from '../../../src/utils/dateParse.js'
import { parseAmount } from '../../../src/utils/parseAmount.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = join(__dirname, '../../..')

export function loadDotEnv(envPath = join(PROJECT_ROOT, '.env')) {
  if (!existsSync(envPath)) return
  const text = readFileSync(envPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

export function pgConfigFromEnv() {
  loadDotEnv()
  let host = process.env.DB_HOST || 'localhost'
  if (host === 'db') host = 'localhost'
  const port = Number(process.env.DB_PORT || 5432)
  const database = process.env.DB_NAME || 'essersales'
  const user = process.env.DB_USER || 'essersales'
  const password = process.env.DB_PASSWORD ?? 'essersales_dev'
  const connectionString =
    process.env.DATABASE_URL ||
    `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
  return { host, port, database, user, password, connectionString }
}

export function sqlitePathFromEnv() {
  return (
    process.env.SQLITE_PATH ||
    join(PROJECT_ROOT, 'archive/legacy-sqlite-server/server/data/essersales.db')
  )
}

/** @returns {string | null} YYYY-MM-DD */
export function toIsoDate(val) {
  if (val == null || val === '') return null
  const parsed = parseSalesDate(val)
  if (!parsed) return null
  const y = parsed.year
  const m = String(parsed.month).padStart(2, '0')
  const d = String(parsed.day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * @returns {{ periodFrom: string | null, periodTo: string | null, singleDate: string | null }}
 */
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
  const ext = extname(fileName).toLowerCase()
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (ext === '.xls') return 'application/vnd.ms-excel'
  if (ext === '.csv') return 'text/csv'
  return ext ? ext.slice(1) : ''
}

export function safeUuid(id) {
  if (!id) return null
  const s = String(id).trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return null
  }
  return s.toLowerCase()
}

export function parseJsonObject(text) {
  try {
    const obj = JSON.parse(text)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

export function coalesceStr(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/**
 * @param {object} data
 * @param {object} [upload]
 */
export function mapSalesRecordBackfill(data, upload = null) {
  const dateRaw = coalesceStr(data.date, data.saleDate, data.business_date)
  const uploadDateInfo = upload ? parseBusinessDateRange(upload.business_date) : null
  const orderDate = toIsoDate(dateRaw) || uploadDateInfo?.singleDate || null

  let periodFrom = uploadDateInfo?.periodFrom || null
  let periodTo = uploadDateInfo?.periodTo || null
  if (!periodFrom && orderDate) {
    periodFrom = orderDate
    periodTo = orderDate
  }

  const businessDate = orderDate || periodFrom

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
    sales: parseNumeric(coalesceStr(data.sales, data.actualPayment, data.saleAmount)),
    sales_qty: parseNumeric(coalesceStr(data.salesQty, data.quantity, data.qty)),
    net_profit: parseNumeric(coalesceStr(data.netProfit, data.margin)),
    ad_spend: parseNumeric(data.adSpend),
    transaction_type: coalesceStr(data.transactionType, data.transaction_type),
    upload_kind: coalesceStr(data.uploadKind, upload?.upload_kind),
    upload_format: coalesceStr(data.uploadFormat, data.upload_format),
  }
}

export function mapUploadRow(sqliteRow) {
  const dateInfo = parseBusinessDateRange(sqliteRow.business_date)
  return {
    id: safeUuid(sqliteRow.id),
    file_name: sqliteRow.file_name,
    file_type: inferFileType(sqliteRow.file_name),
    platform: sqliteRow.platform || '',
    sales_method: sqliteRow.sales_method || '',
    upload_kind: sqliteRow.upload_kind || 'sales_report',
    business_date: dateInfo.singleDate,
    period_from: dateInfo.periodFrom,
    period_to: dateInfo.periodTo,
    detail_count: sqliteRow.detail_count ?? 0,
    daily_count: sqliteRow.daily_count ?? 0,
    channel_count: sqliteRow.channel_count ?? 0,
    product_count: sqliteRow.product_count ?? 0,
    product_option_count: sqliteRow.product_option_count ?? 0,
    total_count: sqliteRow.total_count ?? 0,
    parse_status: 'ok',
    parse_error: null,
    created_at: sqliteRow.created_at,
  }
}
