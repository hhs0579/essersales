import { getPool } from '../db/pool.js'
import { resolveManualAdScopes } from '../utils/manualAdKpiMerge.js'

/**
 * app_settings.data → 수기 광고 entry 배열
 * (배열 또는 { entries: [] } 저장 형식 모두 허용)
 * @param {unknown} data
 * @returns {unknown[]}
 */
export function normalizeManualAdSettingData(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const entries = /** @type {{ entries?: unknown }} */ (data).entries
    if (Array.isArray(entries)) return entries
  }
  return []
}

/**
 * @param {string} [scope]
 * @returns {Promise<import('../utils/manualAdKpiMerge.js').ManualAdEntry[]>}
 */
export async function loadManualAdEntriesForScope(scope) {
  const scopes = resolveManualAdScopes(scope)
  const pool = getPool()
  const res = await pool.query(
    `SELECT scope, data FROM app_settings WHERE kind = 'manual_ad' AND scope = ANY($1::text[])`,
    [scopes],
  )
  const entries = []
  for (const row of res.rows) {
    entries.push(...normalizeManualAdSettingData(row.data))
  }
  return entries
}
