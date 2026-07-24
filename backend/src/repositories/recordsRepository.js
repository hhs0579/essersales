import { getPool } from '../db/pool.js'
import {
  parsePage,
  parseLimit,
  parseOffset,
  parseOptionalDate,
  parseSort,
  parseOrder,
  trimFilter,
} from '../utils/queryHelpers.js'

const SORT_WHITELIST = [
  'order_date',
  'sales',
  'sales_qty',
  'platform',
  'store_name',
  'product_name',
  'created_at',
  'upload_kind',
]

function mapRecordRow(row, { includeData = false } = {}) {
  const item = {
    id: row.id,
    uploadId: row.upload_id,
    recordType: row.record_type,
    orderDate: row.order_date,
    businessDate: row.business_date,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    platform: row.platform || '',
    salesMethod: row.sales_method || '',
    channel: row.channel || '',
    storeName: row.store_name || '',
    productCode: row.product_code || '',
    productName: row.product_name || '',
    optionName: row.option_name || '',
    sales: row.sales != null ? Number(row.sales) : null,
    salesQty: row.sales_qty != null ? Number(row.sales_qty) : null,
    netProfit: row.net_profit != null ? Number(row.net_profit) : null,
    adSpend: row.ad_spend != null ? Number(row.ad_spend) : null,
    transactionType: row.transaction_type || '',
    uploadKind: row.upload_kind || '',
    uploadFormat: row.upload_format || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (includeData && row.data) {
    item.data = row.data
  }
  return item
}

/**
 * @param {Record<string, string | undefined>} query
 */
export function parseRecordsQuery(query = {}) {
  return {
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    recordType: trimFilter(query.record_type),
    from: parseOptionalDate(query.from),
    to: parseOptionalDate(query.to),
    platform: trimFilter(query.platform),
    salesMethod: trimFilter(query.sales_method),
    storeName: trimFilter(query.store_name),
    productCode: trimFilter(query.product_code),
    productName: trimFilter(query.product_name),
    transactionType: trimFilter(query.transaction_type),
    uploadKind: trimFilter(query.upload_kind),
    uploadFormat: trimFilter(query.upload_format),
    sort: parseSort(query.sort, SORT_WHITELIST, 'order_date'),
    order: parseOrder(query.order),
    includeData: query.include_data === '1' || query.include_data === 'true',
  }
}

function buildRecordsWhere(filters) {
  const clauses = []
  const params = []
  let i = 1

  if (filters.from && filters.to) {
    clauses.push(`(
      (order_date IS NOT NULL AND order_date BETWEEN $${i}::date AND $${i + 1}::date)
      OR (business_date IS NOT NULL AND business_date BETWEEN $${i}::date AND $${i + 1}::date)
      OR (period_from IS NOT NULL AND period_to IS NOT NULL AND period_from <= $${i + 1}::date AND period_to >= $${i}::date)
    )`)
    params.push(filters.from, filters.to)
    i += 2
  } else if (filters.from) {
    clauses.push(`(
      order_date >= $${i}::date OR business_date >= $${i}::date OR period_to >= $${i}::date
    )`)
    params.push(filters.from)
    i += 1
  } else if (filters.to) {
    clauses.push(`(
      order_date <= $${i}::date OR business_date <= $${i}::date OR period_from <= $${i}::date
    )`)
    params.push(filters.to)
    i += 1
  }

  const eqFilters = [
    ['platform', filters.platform],
    ['sales_method', filters.salesMethod],
    ['store_name', filters.storeName],
    ['product_code', filters.productCode],
    ['transaction_type', filters.transactionType],
    ['upload_kind', filters.uploadKind],
    ['upload_format', filters.uploadFormat],
  ]
  for (const [col, val] of eqFilters) {
    if (val) {
      clauses.push(`${col} = $${i++}`)
      params.push(val)
    }
  }

  if (filters.productName) {
    clauses.push(`product_name ILIKE $${i++}`)
    params.push(`%${filters.productName}%`)
  }

  if (filters.recordType) {
    clauses.push(`record_type = $${i++}`)
    params.push(filters.recordType)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}

export async function listRecords(query) {
  const filters = parseRecordsQuery(query)
  const { where, params } = buildRecordsWhere(filters)
  const pool = getPool()
  const offset = parseOffset(filters.page, filters.limit)
  const sortCol = filters.sort
  const sortDir = filters.order

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM sales_records ${where}`,
    params,
  )
  const total = countRes.rows[0].total

  const summaryRes = await pool.query(
    `SELECT
       COALESCE(SUM(sales), 0)::numeric AS sales_total,
       COALESCE(SUM(sales_qty), 0)::numeric AS quantity_total
     FROM sales_records ${where}`,
    params,
  )

  const listRes = await pool.query(
    `SELECT
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       created_at, updated_at
       ${filters.includeData ? ', data' : ''}
     FROM sales_records ${where}
     ORDER BY ${sortCol} ${sortDir} NULLS LAST, id ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset],
  )

  return {
    items: listRes.rows.map((r) => mapRecordRow(r, { includeData: filters.includeData })),
    page: filters.page,
    limit: filters.limit,
    total,
    summary: {
      salesTotal: Number(summaryRes.rows[0].sales_total),
      quantityTotal: Number(summaryRes.rows[0].quantity_total),
    },
  }
}

export async function getRecordById(id) {
  const pool = getPool()
  const res = await pool.query(
    `SELECT
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       data, created_at, updated_at
     FROM sales_records
     WHERE id = $1`,
    [id],
  )
  return res.rows[0] || null
}

/**
 * @param {string} id
 * @param {object} dataPayload
 * @param {object} columns
 */
export async function patchRecordById(id, dataPayload, columns) {
  const pool = getPool()
  const res = await pool.query(
    `UPDATE sales_records SET
       data = $2::jsonb,
       order_date = $3::date,
       business_date = $4::date,
       period_from = $5::date,
       period_to = $6::date,
       platform = $7,
       sales_method = $8,
       channel = $9,
       store_name = $10,
       product_code = $11,
       product_name = $12,
       option_name = $13,
       sales = $14,
       sales_qty = $15,
       net_profit = $16,
       ad_spend = $17,
       transaction_type = $18,
       upload_kind = $19,
       upload_format = $20,
       updated_at = NOW()
     WHERE id = $1
     RETURNING
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       data, created_at, updated_at`,
    [
      id,
      JSON.stringify(dataPayload),
      columns.order_date,
      columns.business_date,
      columns.period_from,
      columns.period_to,
      columns.platform,
      columns.sales_method,
      columns.channel,
      columns.store_name,
      columns.product_code,
      columns.product_name,
      columns.option_name,
      columns.sales,
      columns.sales_qty,
      columns.net_profit,
      columns.ad_spend,
      columns.transaction_type,
      columns.upload_kind,
      columns.upload_format,
    ],
  )
  return res.rows[0] || null
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteRecordById(id) {
  const pool = getPool()
  const res = await pool.query(`DELETE FROM sales_records WHERE id = $1`, [id])
  return res.rowCount > 0
}
