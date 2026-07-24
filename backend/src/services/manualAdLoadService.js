import { getPool } from '../db/pool.js'
import { resolveManualAdScopes } from '../utils/manualAdKpiMerge.js'

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
    const data = row.data
    if (Array.isArray(data)) {
      entries.push(...data)
    }
  }
  return entries
}
