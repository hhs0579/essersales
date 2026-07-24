import { getPool } from '../db/pool.js'
import {
  parsePage,
  parseLimit,
  parseOffset,
  parseOptionalDate,
  trimFilter,
} from '../utils/queryHelpers.js'

function mapUploadRow(row) {
  return {
    id: row.id,
    fileName: row.file_name,
    fileType: row.file_type || '',
    platform: row.platform || '',
    salesMethod: row.sales_method || '',
    uploadKind: row.upload_kind,
    businessDate: row.business_date,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    detailCount: row.detail_count,
    dailyCount: row.daily_count,
    channelCount: row.channel_count,
    productCount: row.product_count,
    productOptionCount: row.product_option_count,
    totalCount: row.total_count,
    status: row.parse_status,
    errorMessage: row.parse_error,
    uploadedAt: row.created_at,
    createdAt: row.created_at,
  }
}

/**
 * @param {Record<string, string | undefined>} query
 */
export function parseUploadsQuery(query = {}) {
  return {
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    fileType: trimFilter(query.file_type),
    status: trimFilter(query.status),
    from: parseOptionalDate(query.from),
    to: parseOptionalDate(query.to),
    keyword: trimFilter(query.keyword),
  }
}

function buildUploadsWhere(filters) {
  const clauses = []
  const params = []
  let i = 1

  if (filters.fileType) {
    clauses.push(`file_type = $${i++}`)
    params.push(filters.fileType)
  }
  if (filters.status) {
    clauses.push(`parse_status = $${i++}`)
    params.push(filters.status)
  }
  if (filters.from) {
    clauses.push(`created_at::date >= $${i++}::date`)
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push(`created_at::date <= $${i++}::date`)
    params.push(filters.to)
  }
  if (filters.keyword) {
    clauses.push(`file_name ILIKE $${i++}`)
    params.push(`%${filters.keyword}%`)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}

export async function listUploads(query) {
  const filters = parseUploadsQuery(query)
  const { where, params } = buildUploadsWhere(filters)
  const pool = getPool()
  const offset = parseOffset(filters.page, filters.limit)

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM uploads ${where}`,
    params,
  )
  const total = countRes.rows[0].total

  const listRes = await pool.query(
    `SELECT * FROM uploads ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset],
  )

  return {
    items: listRes.rows.map(mapUploadRow),
    page: filters.page,
    limit: filters.limit,
    total,
  }
}

export async function getUploadById(id) {
  const pool = getPool()
  const uploadRes = await pool.query(`SELECT * FROM uploads WHERE id = $1`, [id])
  if (!uploadRes.rows.length) return null

  const statsRes = await pool.query(
    `SELECT
       COUNT(*)::int AS record_count,
       COALESCE(SUM(sales), 0)::numeric AS sales_total,
       COALESCE(SUM(sales_qty), 0)::numeric AS quantity_total
     FROM sales_records
     WHERE upload_id = $1`,
    [id],
  )

  const stats = statsRes.rows[0]
  return {
    upload: mapUploadRow(uploadRes.rows[0]),
    recordCount: stats.record_count,
    salesTotal: Number(stats.sales_total),
    quantityTotal: Number(stats.quantity_total),
  }
}

/**
 * legacy 와 동일: records 선삭제 후 upload 삭제 (hard delete)
 * @param {string} id
 * @returns {Promise<{ recordsDeleted: number } | null>}
 */
export async function deleteUploadById(id) {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const uploadCheck = await client.query(`SELECT id FROM uploads WHERE id = $1`, [id])
    if (!uploadCheck.rows.length) {
      await client.query('ROLLBACK')
      return null
    }
    const delRecords = await client.query(
      `DELETE FROM sales_records WHERE upload_id = $1`,
      [id],
    )
    await client.query(`DELETE FROM uploads WHERE id = $1`, [id])
    await client.query('COMMIT')
    return { recordsDeleted: delRecords.rowCount }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
