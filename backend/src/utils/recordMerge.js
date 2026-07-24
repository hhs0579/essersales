import {
  RECORD_PROTECTED_KEYS,
  RECORD_PATCH_FIELD_MAP,
  RECORD_NUMERIC_COLUMNS,
  RECORD_DATE_COLUMNS,
} from '../constants/recordFields.js'
import { parseOptionalDate } from './queryHelpers.js'

function coalesceStr(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

function parseNumeric(val) {
  if (val == null || val === '') return null
  const n = Number(String(val).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * DB row → legacy rowToRecord 호환 flat 객체
 * @param {object} row
 */
export function rowToFlatRecord(row) {
  const data =
    row.data && typeof row.data === 'object'
      ? row.data
      : typeof row.data === 'string'
        ? JSON.parse(row.data || '{}')
        : {}

  return {
    id: row.id,
    uploadId: row.upload_id,
    recordType: row.record_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    platform: row.platform || data.platform || '',
    salesMethod: row.sales_method || data.salesMethod || '',
    storeName: row.store_name || data.storeName || data.brand || '',
    productCode: row.product_code || data.productCode || '',
    productName: row.product_name || data.productName || '',
    optionName: row.option_name || data.option || data.optionName || '',
    sales: row.sales != null ? String(row.sales) : coalesceStr(data.sales, data.actualPayment),
    salesQty:
      row.sales_qty != null
        ? String(row.sales_qty)
        : coalesceStr(data.salesQty, data.quantity),
    netProfit:
      row.net_profit != null ? String(row.net_profit) : coalesceStr(data.netProfit, data.margin),
    adSpend: row.ad_spend != null ? String(row.ad_spend) : coalesceStr(data.adSpend),
    businessDate: row.business_date || data.businessDate || data.date || '',
    periodFrom: row.period_from || data.periodFrom || '',
    periodTo: row.period_to || data.periodTo || '',
    transactionType: row.transaction_type || data.transactionType || '',
    uploadKind: row.upload_kind || data.uploadKind || '',
    uploadFormat: row.upload_format || data.uploadFormat || '',
    ...data,
  }
}

function stripProtected(obj) {
  const copy = { ...obj }
  for (const k of RECORD_PROTECTED_KEYS) delete copy[k]
  return copy
}

/**
 * @param {Record<string, unknown>} incoming raw PATCH body (fields wrapper stripped)
 */
export function normalizePatchBody(incoming) {
  const out = { ...incoming }
  if (incoming.data && typeof incoming.data === 'object' && !Array.isArray(incoming.data)) {
    Object.assign(out, incoming.data)
    delete out.data
  }
  return out
}

/**
 * legacy PATCH와 동일: protected 제외 후 data JSON 병합 + 정규 컬럼 동기화 값 반환
 * @param {object} row DB row
 * @param {Record<string, unknown>} incoming
 */
export function mergeRecordPatch(row, incoming) {
  const current = rowToFlatRecord(row)
  const patch = stripProtected(normalizePatchBody(incoming))
  const merged = { ...stripProtected(current), ...patch }

  const dataPayload = stripProtected(merged)
  const columns = backfillColumnsFromFlat(merged, row)

  return { dataPayload, columns }
}

function backfillColumnsFromFlat(flat, row) {
  const orderDate =
    parseOptionalDate(flat.date) ||
    parseOptionalDate(flat.orderDate) ||
    row.order_date ||
    null
  const businessDate =
    parseOptionalDate(flat.businessDate) ||
    parseOptionalDate(flat.date) ||
    row.business_date ||
    orderDate
  const periodFrom =
    parseOptionalDate(flat.periodFrom) || businessDate || row.period_from || null
  const periodTo = parseOptionalDate(flat.periodTo) || periodFrom || row.period_to || null

  return {
    order_date: orderDate,
    business_date: businessDate,
    period_from: periodFrom,
    period_to: periodTo,
    platform: coalesceStr(flat.platform, flat.channel, row.platform),
    sales_method: coalesceStr(flat.salesMethod, row.sales_method),
    channel: coalesceStr(flat.channel, flat.platform, row.channel),
    store_name: coalesceStr(flat.storeName, flat.brand, row.store_name),
    product_code: coalesceStr(flat.productCode, row.product_code),
    product_name: coalesceStr(flat.productName, row.product_name),
    option_name: coalesceStr(flat.option, flat.optionName, row.option_name),
    sales: parseNumeric(flat.sales ?? flat.actualPayment),
    sales_qty: parseNumeric(flat.salesQty ?? flat.quantity),
    net_profit: parseNumeric(flat.netProfit ?? flat.margin),
    ad_spend: parseNumeric(flat.adSpend),
    transaction_type: coalesceStr(flat.transactionType, row.transaction_type),
    upload_kind: coalesceStr(flat.uploadKind, row.upload_kind),
    upload_format: coalesceStr(flat.uploadFormat, row.upload_format),
  }
}

/**
 * PATCH body에 허용되지 않은 키가 있으면 에러
 * @param {Record<string, unknown>} incoming
 */
export function assertPatchKeysAllowed(incoming) {
  const normalized = normalizePatchBody(incoming)
  const allowed = new Set([
    ...Object.keys(RECORD_PATCH_FIELD_MAP),
    ...Object.values(RECORD_PATCH_FIELD_MAP),
    'data',
    'date',
    'brand',
    'option',
    'actualPayment',
    'quantity',
    'margin',
    'channel',
  ])

  for (const key of Object.keys(normalized)) {
    if (RECORD_PROTECTED_KEYS.has(key)) continue
    if (allowed.has(key)) continue
    const err = new Error(`field not patchable: ${key}`)
    err.status = 400
    err.code = 'INVALID_FIELD'
    throw err
  }

  for (const [camel, col] of Object.entries(RECORD_PATCH_FIELD_MAP)) {
    if (normalized[camel] === undefined && normalized[col] === undefined) continue
    const val = normalized[camel] ?? normalized[col]
    if (RECORD_NUMERIC_COLUMNS.has(col) && val != null && val !== '') {
      const n = parseNumeric(val)
      if (n === null) {
        const err = new Error(`invalid numeric value for ${camel}`)
        err.status = 400
        err.code = 'INVALID_NUMERIC'
        throw err
      }
    }
    if (RECORD_DATE_COLUMNS.has(col) && val != null && val !== '') {
      const d = parseOptionalDate(val)
      if (!d) {
        const err = new Error(`invalid date value for ${camel} (expected YYYY-MM-DD)`)
        err.status = 400
        err.code = 'INVALID_DATE'
        throw err
      }
    }
  }
}
