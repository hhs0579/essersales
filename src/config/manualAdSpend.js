/** 원본 엑셀에 없는 외부·타 채널 일별 광고 실적 (수동 입력) */



/**

 * @typedef {'meta'|'gfa'|'ad'|'google_traffic'|'manual'|'naver'} ManualAdSource

 */



/**

 * @typedef {Object} ManualAdEntry

 * @property {string} id

 * @property {string} date — YYYY-MM-DD

 * @property {string} adSpend — 광고비용

 * @property {string} adSales — 전환매출액

 * @property {ManualAdSource} [source]

 */



/** @type {Array<{ value: ManualAdSource, label: string, kpiLabel: string }>} */

export const MANUAL_AD_SOURCE_DEFS = [

  { value: 'meta', label: 'Meta', kpiLabel: 'Meta' },

  { value: 'gfa', label: 'GFA', kpiLabel: 'GFA' },

  { value: 'ad', label: 'AD', kpiLabel: 'AD' },

  { value: 'google_traffic', label: '구글 트래픽', kpiLabel: '구글 트래픽' },

]



export const MANUAL_AD_SOURCE_OPTIONS = MANUAL_AD_SOURCE_DEFS.map(({ value, label }) => ({

  value,

  label,

}))



export const MANUAL_AD_KPI_LABELS = MANUAL_AD_SOURCE_DEFS.map((d) => d.kpiLabel)



/** @deprecated — Meta KPI 행 라벨 */

export const EXTERNAL_AD_KPI_LABEL = 'Meta'

/** @deprecated — GFA KPI 행 라벨 */

export const NAVER_DISPLAY_AD_KPI_LABEL = 'GFA'

export const AD_KPI_LABEL = 'AD'

export const GOOGLE_TRAFFIC_KPI_LABEL = '구글 트래픽'



const LEGACY_SOURCE_MAP = {

  manual: 'meta',

  naver: 'gfa',

}



const VALID_SOURCES = new Set(MANUAL_AD_SOURCE_DEFS.map((d) => d.value))



/** @param {string} [source] @returns {ManualAdSource} */

export function normalizeManualAdSource(source) {

  if (source && LEGACY_SOURCE_MAP[source]) return LEGACY_SOURCE_MAP[source]

  if (source && VALID_SOURCES.has(source)) return source

  return 'meta'

}



/** @param {string} [source] */

export function manualAdSourceLabel(source) {

  const v = normalizeManualAdSource(source)

  return MANUAL_AD_SOURCE_DEFS.find((o) => o.value === v)?.label || 'Meta'

}



/** @param {string} label */

export function isManualAdKpiLabel(label) {

  return MANUAL_AD_KPI_LABELS.includes(String(label || '').trim())

}



/** GFA(구 네이버) 엑셀·수기 source 여부 */

export function isGfaManualAdSource(source) {

  return normalizeManualAdSource(source) === 'gfa'

}



/** @returns {string} */

function newEntryId() {

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {

    return crypto.randomUUID()

  }

  return `ad-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

}



/** @param {ManualAdSource} [source] */

export function createManualAdEntry(source = 'meta') {

  return {

    id: newEntryId(),

    date: '',

    adSpend: '',

    adSales: '',

    source: normalizeManualAdSource(source),

  }

}



export function createEmptyManualAdList() {

  return /** @type {ManualAdEntry[]} */ ([])

}


