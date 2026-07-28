/** 주간 보고용 — 베스트하임 + 사본느리 + 파워프라이스(일별) 통합 대시보드 */

export const COMBINED_DAILY_SCOPE = 'combined_daily'
export const COMBINED_MONTHLY_SCOPE = 'combined_monthly'
export const COMBINED_CHANNEL_ID = 'channel_combined'

/** @typedef {import('./dataChannels.js').DataChannel} DataChannel */

/** @type {DataChannel} */
export const COMBINED_CHANNEL = {
  id: COMBINED_CHANNEL_ID,
  tabLabel: '통합',
  reportTitle: '베스트하임·사본느리·파워프라이스 통합',
  description: '주간 보고용 — 베스트하임·사본느리·파워프라이스 매출·광고를 기간별로 합산합니다.',
  esserDashboard: true,
  combinedOnly: true,
  modes: [
    {
      id: 'daily',
      label: '일별 통합',
      scope: COMBINED_DAILY_SCOPE,
      uploadKind: 'combined_daily',
    },
    {
      id: 'monthly',
      label: '월별 통합',
      scope: COMBINED_MONTHLY_SCOPE,
      uploadKind: 'combined_monthly',
    },
  ],
}

/** @param {string} scope */
export function isCombinedScope(scope) {
  return scope === COMBINED_DAILY_SCOPE || scope === COMBINED_MONTHLY_SCOPE
}

/** 통합(일별·월별) — 모두 일별 데이터 기반 (월별은 월 단위 집계) */
export function combinedSourceScopes(scope) {
  if (isCombinedScope(scope)) return ['platform', 'company_b', 'power_price', 'other_sellers']
  return []
}

/** 통합 일별·월별 모두 파워프라이스 직접입력 포함 */
export function combinedIncludesPowerPrice(scope) {
  return isCombinedScope(scope)
}

/** 외부 광고 scope (브랜드 + 파워프라이스) — 통합 일별·월별 공통 */
export function combinedManualAdScopes(scope) {
  if (isCombinedScope(scope)) return ['platform', 'company_b', 'power_price', 'other_sellers']
  return ['platform', 'company_b']
}

/** 통합 탭 KPI·엑셀에서 숨길 지표 (자연매출은 브랜드·플랫폼 행에 표시) */
export const COMBINED_HIDDEN_KPI_KEYS = ['aov']

/** @param {Array<{ key: string }>} cards @param {string[]} [hiddenKeys] */
export function filterKpiCards(cards, hiddenKeys = []) {
  const hidden = new Set(hiddenKeys)
  return cards.filter((c) => !hidden.has(c.key))
}
