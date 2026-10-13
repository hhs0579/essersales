import { getPool } from '../db/pool.js'
import { resolveManualAdScopes } from '../utils/manualAdKpiMerge.js'
import {
  EXTERNAL_AD_CHANNELS,
  findExternalAdChannelByScope,
} from '../../../src/config/externalAdChannels.js'
import { isCombinedScope } from '../../../src/config/dataChannels.js'
import { combinedIncludesPowerPrice } from '../../../src/config/combinedChannel.js'

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
  const groups = await loadManualAdChannelGroups(scope)
  return groups.flatMap((g) => g.entries || [])
}

/**
 * 브랜드(채널)별로 분리된 수기 광고 — KPI 라벨 베스트하임-Meta 등
 * @param {string} [scope]
 * @returns {Promise<Array<{ label: string, entries: unknown[] }>>}
 */
export async function loadManualAdChannelGroups(scope) {
  const scopes = resolveManualAdScopes(scope)
  const pool = getPool()
  const res = await pool.query(
    `SELECT scope, data FROM app_settings WHERE kind = 'manual_ad' AND scope = ANY($1::text[])`,
    [scopes],
  )
  /** @type {Map<string, unknown[]>} */
  const byScope = new Map()
  for (const row of res.rows) {
    byScope.set(String(row.scope), normalizeManualAdSettingData(row.data))
  }

  if (isCombinedScope(scope)) {
    const groups = EXTERNAL_AD_CHANNELS.filter((ch) =>
      combinedIncludesPowerPrice(scope) ? true : ch.dailyScope !== 'power_price',
    ).map((ch) => ({
      label: ch.label,
      entries: byScope.get(ch.dailyScope) || [],
    }))
    const known = new Set(EXTERNAL_AD_CHANNELS.map((ch) => ch.dailyScope))
    for (const s of scopes) {
      if (known.has(s)) continue
      const entries = byScope.get(s) || []
      if (!entries.length) continue
      const label = s === 'other_sellers' ? '기타 판매처' : s
      groups.push({ label, entries })
    }
    return groups.filter((g) => (g.entries || []).length > 0)
  }

  const primary = scopes[0] || scope || 'platform'
  const ch = findExternalAdChannelByScope(primary)
  const entries = scopes.flatMap((s) => byScope.get(s) || [])
  if (!entries.length) return []
  return [{ label: ch?.label || '외부 광고', entries }]
}
