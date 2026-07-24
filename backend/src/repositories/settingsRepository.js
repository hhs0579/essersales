import { getPool } from '../db/pool.js'
import { trimFilter } from '../utils/queryHelpers.js'

function mapSettingRow(row) {
  return {
    scope: row.scope,
    kind: row.kind,
    data: row.data,
    updatedAt: row.updated_at,
    dataSize: row.data_size != null ? Number(row.data_size) : undefined,
  }
}

/**
 * @param {string} scope
 * @param {string} kind
 */
export async function getSetting(scope, kind) {
  const pool = getPool()
  const res = await pool.query(
    `SELECT scope, kind, data, updated_at,
            octet_length(data::text) AS data_size
     FROM app_settings
     WHERE scope = $1 AND kind = $2`,
    [scope, kind],
  )
  return res.rows[0] ? mapSettingRow(res.rows[0]) : null
}

/**
 * @param {string} scope
 * @param {string} kind
 * @param {unknown} data
 */
export async function upsertSetting(scope, kind, data) {
  const pool = getPool()
  const res = await pool.query(
    `INSERT INTO app_settings (scope, kind, data, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (scope, kind)
     DO UPDATE SET
       data = EXCLUDED.data,
       updated_at = NOW()
     RETURNING scope, kind, data, updated_at,
               octet_length(data::text) AS data_size`,
    [scope, kind, JSON.stringify(data ?? null)],
  )
  return mapSettingRow(res.rows[0])
}

/**
 * @param {Record<string, string | undefined>} query
 */
export function parseSettingsQuery(query = {}) {
  return {
    scope: trimFilter(query.scope),
    kind: trimFilter(query.kind),
  }
}

export async function listSettings(query) {
  const filters = parseSettingsQuery(query)
  const pool = getPool()
  const clauses = []
  const params = []
  let i = 1

  if (filters.scope) {
    clauses.push(`scope = $${i++}`)
    params.push(filters.scope)
  }
  if (filters.kind) {
    clauses.push(`kind = $${i++}`)
    params.push(filters.kind)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const res = await pool.query(
    `SELECT scope, kind, data, updated_at,
            octet_length(data::text) AS data_size
     FROM app_settings ${where}
     ORDER BY scope, kind`,
    params,
  )

  return {
    items: res.rows.map(mapSettingRow),
    total: res.rows.length,
  }
}
