import { getPool } from '../db/pool.js'
import { trimFilter } from '../utils/queryHelpers.js'

/**
 * own_mall_manual — salesSourceFiles dataBase64 제거 (메타만)
 * @param {unknown} data
 */
export function omitOwnMallSourcePayloads(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const o = /** @type {Record<string, unknown>} */ (data)
  if (!Array.isArray(o.salesSourceFiles)) return data
  return {
    ...o,
    salesSourceFiles: o.salesSourceFiles.map((item) => {
      if (!item || typeof item !== 'object') return item
      const s = /** @type {Record<string, unknown>} */ (item)
      const { dataBase64: _drop, ...meta } = s
      return meta
    }),
  }
}

function mapSettingRow(row, { omitSources = false } = {}) {
  let data = row.data
  if (omitSources && row.kind === 'own_mall_manual') {
    data = omitOwnMallSourcePayloads(data)
  }
  return {
    scope: row.scope,
    kind: row.kind,
    data,
    updatedAt: row.updated_at,
    dataSize: row.data_size != null ? Number(row.data_size) : undefined,
  }
}

/** Node가 dataBase64를 파싱하지 않도록 DB에서 제거 (부팅 502 방지) */
const OWN_MALL_DATA_OMIT_SOURCES_SQL = `CASE
  WHEN kind = 'own_mall_manual'
   AND data IS NOT NULL
   AND jsonb_typeof(data->'salesSourceFiles') = 'array'
  THEN jsonb_set(
    data,
    '{salesSourceFiles}',
    COALESCE((
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(elem) = 'object' THEN elem - 'dataBase64' ELSE elem END
      )
      FROM jsonb_array_elements(data->'salesSourceFiles') AS elem
    ), '[]'::jsonb)
  )
  ELSE data
END`

function settingSelectSql(omitSources) {
  const dataExpr = omitSources ? OWN_MALL_DATA_OMIT_SOURCES_SQL : 'data'
  return `SELECT scope, kind, ${dataExpr} AS data, updated_at,
            octet_length(data::text) AS data_size`
}

/**
 * @param {string} scope
 * @param {string} kind
 * @param {{ omitSources?: boolean }} [opts]
 */
export async function getSetting(scope, kind, opts = {}) {
  const pool = getPool()
  const omitSources = Boolean(opts.omitSources)
  const res = await pool.query(
    `${settingSelectSql(omitSources)}
     FROM app_settings
     WHERE scope = $1 AND kind = $2`,
    [scope, kind],
  )
  return res.rows[0] ? mapSettingRow(res.rows[0], opts) : null
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
  const omitRaw = String(query.omit_sources ?? query.include_sources ?? '').trim().toLowerCase()
  const omitSources =
    omitRaw === '1' ||
    omitRaw === 'true' ||
    omitRaw === 'yes' ||
    (query.include_sources != null &&
      ['0', 'false', 'no'].includes(String(query.include_sources).trim().toLowerCase()))
  return {
    scope: trimFilter(query.scope),
    kind: trimFilter(query.kind),
    omitSources,
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
    `${settingSelectSql(filters.omitSources)}
     FROM app_settings ${where}
     ORDER BY scope, kind`,
    params,
  )

  return {
    items: res.rows.map((r) => mapSettingRow(r, { omitSources: filters.omitSources })),
    total: res.rows.length,
  }
}
