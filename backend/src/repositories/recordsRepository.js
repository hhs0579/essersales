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
import { allowedUploadKindsForScope } from '../utils/scopeFilter.js'

/** lean: 화면·집계에 필요한 data 키만 (전체 JSONB 제외).
 * 통합 KPI 세그먼트는 프론트에서 include_data=full 사용. */
const LEAN_DATA_SQL = `jsonb_strip_nulls(jsonb_build_object(
  'date', data->'date',
  'contextDate', data->'contextDate',
  'deliveryMethod', data->'deliveryMethod',
  '배송구분', data->'배송구분',
  'sourceFileName', data->'sourceFileName',
  'channel', data->'channel'
))`

const SORT_WHITELIST = [
  'order_date',
  'kpi_date',
  'sales',
  'sales_qty',
  'platform',
  'store_name',
  'product_name',
  'created_at',
  'upload_kind',
]

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseUploadIds(raw) {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw || '')
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
}

function parseYearMonth(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return ''
  return String(Math.floor(n))
}

/**
 * @param {'none' | 'lean' | 'full'} mode
 */
function mapRecordRow(row, { dataMode = 'none' } = {}) {
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
  if (dataMode !== 'none' && row.data) {
    item.data = row.data
  }
  return item
}

/**
 * @param {string | undefined} raw
 * @returns {'none' | 'lean' | 'full'}
 */
function parseIncludeDataMode(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'full') return 'full'
  if (v === 'lean') return 'lean'
  return 'none'
}

/**
 * @param {Record<string, string | undefined>} query
 */
export function parseRecordsQuery(query = {}) {
  const from =
    parseOptionalDate(query.start_date) || parseOptionalDate(query.from)
  const to = parseOptionalDate(query.end_date) || parseOptionalDate(query.to)
  const rowKindRaw = trimFilter(query.row_kind).toLowerCase()
  const rowKind = rowKindRaw === 'sale' || rowKindRaw === 'return' ? rowKindRaw : ''
  const dayOfWeek = String(query.day_of_week ?? query.dayOfWeek ?? '').trim()
  return {
    page: parsePage(query.page),
    limit: parseLimit(query.limit, 100, 500),
    recordType: trimFilter(query.record_type),
    from,
    to,
    platform: trimFilter(query.platform),
    salesMethod: trimFilter(query.sales_method),
    storeName: trimFilter(query.store_name || query.brand),
    brand: trimFilter(query.brand),
    channel: trimFilter(query.channel),
    productCode: trimFilter(query.product_code),
    productName: trimFilter(query.product_name),
    optionName: trimFilter(query.option || query.option_name),
    dateContains: trimFilter(query.date),
    year: parseYearMonth(query.year),
    month: parseYearMonth(query.month),
    dayOfWeek: /^\d$/.test(dayOfWeek) ? dayOfWeek : '',
    transactionType: trimFilter(query.transaction_type),
    rowKind,
    uploadKind: trimFilter(query.upload_kind),
    uploadFormat: trimFilter(query.upload_format),
    uploadIds: parseUploadIds(query.upload_ids || query.upload_id),
    scope: trimFilter(query.scope),
    sort: parseSort(query.sort, SORT_WHITELIST, 'order_date'),
    order: parseOrder(query.order),
    dataMode: parseIncludeDataMode(query.include_data),
    jsMatch:
      String(query.filter_engine || query.js_match || '')
        .trim()
        .toLowerCase() === 'js' ||
      String(query.filter_engine || '').trim() === '1',
  }
}

export function buildRecordsWhere(filters) {
  const clauses = []
  const params = []
  let i = 1

  if (filters.from && filters.to) {
    clauses.push(`(
      (kpi_date IS NOT NULL AND kpi_date BETWEEN $${i}::date AND $${i + 1}::date)
      OR (order_date IS NOT NULL AND order_date BETWEEN $${i}::date AND $${i + 1}::date)
      OR (business_date IS NOT NULL AND business_date BETWEEN $${i}::date AND $${i + 1}::date)
      OR (
        period_from IS NOT NULL AND period_to IS NOT NULL
        AND period_from <= $${i + 1}::date AND period_to >= $${i}::date
      )
      OR (
        data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND SUBSTRING(data->>'date' FROM 1 FOR 10)::date BETWEEN $${i}::date AND $${i + 1}::date
      )
      OR (
        data->>'contextDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND SUBSTRING(data->>'contextDate' FROM 1 FOR 10)::date BETWEEN $${i}::date AND $${i + 1}::date
      )
    )`)
    params.push(filters.from, filters.to)
    i += 2
  } else if (filters.from) {
    clauses.push(`(
      kpi_date >= $${i}::date
      OR order_date >= $${i}::date
      OR business_date >= $${i}::date
      OR period_to >= $${i}::date
    )`)
    params.push(filters.from)
    i += 1
  } else if (filters.to) {
    clauses.push(`(
      kpi_date <= $${i}::date
      OR order_date <= $${i}::date
      OR business_date <= $${i}::date
      OR period_from <= $${i}::date
    )`)
    params.push(filters.to)
    i += 1
  }

  const dateExpr = `COALESCE(kpi_date, order_date, business_date, period_from)`
  if (!filters.jsMatch) {
    if (filters.year) {
      clauses.push(`EXTRACT(YEAR FROM ${dateExpr}) = $${i++}`)
      params.push(Number(filters.year))
    }
    if (filters.month) {
      clauses.push(`EXTRACT(MONTH FROM ${dateExpr}) = $${i++}`)
      params.push(Number(filters.month))
    }
    if (filters.dayOfWeek !== '') {
      clauses.push(`EXTRACT(DOW FROM ${dateExpr}) = $${i++}`)
      params.push(Number(filters.dayOfWeek))
    }
    if (filters.dateContains) {
      clauses.push(`COALESCE(${dateExpr}::text, '') ILIKE $${i++}`)
      params.push(`%${filters.dateContains}%`)
    }

    const eqFilters = [
      ['platform', filters.platform],
      ['sales_method', filters.salesMethod],
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

    if (filters.storeName) {
      clauses.push(
        `(COALESCE(store_name, '') ILIKE $${i} OR COALESCE(data->>'brand', '') ILIKE $${i})`,
      )
      params.push(`%${filters.storeName}%`)
      i += 1
    }

    if (filters.channel) {
      clauses.push(
        `(COALESCE(channel, '') ILIKE $${i} OR COALESCE(platform, '') ILIKE $${i})`,
      )
      params.push(`%${filters.channel}%`)
      i += 1
    }

    if (filters.productName) {
      clauses.push(`product_name ILIKE $${i++}`)
      params.push(`%${filters.productName}%`)
    }

    if (filters.optionName) {
      clauses.push(`COALESCE(option_name, data->>'option', '') ILIKE $${i++}`)
      params.push(`%${filters.optionName}%`)
    }

    if (filters.rowKind === 'sale') {
      clauses.push(`(transaction_type IS NULL OR transaction_type <> 'return')`)
      clauses.push(`COALESCE(sales, 0) >= 0`)
      clauses.push(`COALESCE(sales_qty, 0) >= 0`)
      clauses.push(
        `COALESCE(data->>'isEsserSheetTotal', 'false') NOT IN ('true', '1', 't')`,
      )
    } else if (filters.rowKind === 'return') {
      clauses.push(`(
        transaction_type = 'return'
        OR COALESCE(sales, 0) < 0
        OR COALESCE(sales_qty, 0) < 0
      )`)
    }
  }

  if (filters.recordType) {
    clauses.push(`record_type = $${i++}`)
    params.push(filters.recordType)
  }

  if (filters.uploadIds?.length) {
    clauses.push(`upload_id = ANY($${i++}::uuid[])`)
    params.push(filters.uploadIds)
  }

  if (filters.scope) {
    const kinds = allowedUploadKindsForScope(filters.scope)
    if (kinds.length) {
      clauses.push(`upload_kind = ANY($${i++}::text[])`)
      params.push(kinds)
    } else if (filters.scope === 'sales_report') {
      clauses.push(
        `(upload_kind IS NULL OR upload_kind = '' OR NOT (upload_kind = ANY($${i++}::text[])))`,
      )
      params.push([
        'platform_daily',
        'platform_monthly',
        'sales_daily_b',
        'sales_monthly_b',
        'power_price_daily',
      ])
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}

function orderBySql(filters) {
  return `${filters.sort} ${filters.order} NULLS LAST, channel ASC NULLS LAST, product_name ASC NULLS LAST, id ASC`
}

function paginationPayload(page, limit, total) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / (limit || 1)))
  return { page, limit, total, totalPages }
}

function dataSelectSql(dataMode) {
  if (dataMode === 'full') return ', data'
  if (dataMode === 'lean') return `, ${LEAN_DATA_SQL} AS data`
  return ''
}

export async function listRecords(query) {
  const filters = parseRecordsQuery(query)
  const { where, params } = buildRecordsWhere(filters)
  const pool = getPool()
  const offset = parseOffset(filters.page, filters.limit)
  const dataMode = filters.dataMode

  const countRes = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(sales), 0)::numeric AS sales_total,
       COALESCE(SUM(sales_qty), 0)::numeric AS quantity_total
     FROM sales_records ${where}`,
    params,
  )
  const total = countRes.rows[0].total

  const listRes = await pool.query(
    `SELECT
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       created_at, updated_at
       ${dataSelectSql(dataMode)}
     FROM sales_records ${where}
     ORDER BY ${orderBySql(filters)}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset],
  )

  const pagination = paginationPayload(filters.page, filters.limit, total)
  const items = listRes.rows.map((r) => mapRecordRow(r, { dataMode }))
  return {
    items,
    data: items,
    page: filters.page,
    limit: filters.limit,
    total,
    pagination,
    summary: {
      salesTotal: Number(countRes.rows[0].sales_total),
      quantityTotal: Number(countRes.rows[0].quantity_total),
    },
  }
}

/**
 * 엑셀용 — 페이지 없이 조회 조건에 맞는 전체 행 (Vue 메모리에 올리지 않음)
 * @param {Record<string, string | undefined>} query
 */
export async function listMatchingRecords(query) {
  const filters = parseRecordsQuery(query)
  const { where, params } = buildRecordsWhere(filters)
  const pool = getPool()
  const dataMode = filters.dataMode === 'none' ? 'full' : filters.dataMode

  const listRes = await pool.query(
    `SELECT
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       created_at, updated_at
       ${dataSelectSql(dataMode)}
     FROM sales_records ${where}
     ORDER BY ${orderBySql(filters)}`,
    params,
  )

  const items = listRes.rows.map((r) => mapRecordRow(r, { dataMode }))
  const total = items.length
  return {
    items,
    data: items,
    total,
    pagination: paginationPayload(1, total || 1, total),
  }
}

/**
 * export 전용 — 결과는 listMatchingRecords 와 동일 행·순서.
 * LIMIT/OFFSET 반복 없이 FETCH 로 읽어 node-pg 가 전체 resultset 을 한 번에 버퍼링하지 않게 한다.
 * 호출측 배열은 여전히 전체 행을 담는다(JS 필터/정렬 유지).
 */
export async function listMatchingRecordsCursor(query, { batchSize = 3000 } = {}) {
  const filters = parseRecordsQuery(query)
  const { where, params } = buildRecordsWhere(filters)
  const pool = getPool()
  const dataMode = filters.dataMode === 'none' ? 'full' : filters.dataMode
  const fetchN = Math.min(10000, Math.max(500, Number(batchSize) || 3000))
  const sql = `SELECT
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       created_at, updated_at
       ${dataSelectSql(dataMode)}
     FROM sales_records ${where}
     ORDER BY ${orderBySql(filters)}`

  const client = await pool.connect()
  const items = []
  try {
    await client.query('BEGIN')
    await client.query(`DECLARE esser_export_cur NO SCROLL CURSOR FOR ${sql}`, params)
    for (;;) {
      const fetched = await client.query(`FETCH ${fetchN} FROM esser_export_cur`)
      if (!fetched.rows.length) break
      for (const r of fetched.rows) {
        items.push(mapRecordRow(r, { dataMode }))
      }
    }
    await client.query('CLOSE esser_export_cur')
    await client.query('COMMIT')
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
  }

  const total = items.length
  return {
    items,
    data: items,
    total,
    pagination: paginationPayload(1, total || 1, total),
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
