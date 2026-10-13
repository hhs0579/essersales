import { ref } from 'vue'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'
import {
  buildWeeksFromPeriods,
  listFriThuWeeksInMonth,
  validateWeekPeriods,
} from '../utils/friThuWeeks.js'

/** 통합 주간 매출 — 월별 주차 기간 (미설정 월은 금~목 자동 계산) */
export const WEEK_PERIODS_SCOPE = 'combined_daily'
export const WEEK_PERIODS_KIND = 'week_periods'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** @type {import('vue').Ref<{ version: 1, months: Record<string, Array<{ from: string, to: string }>> }>} */
const storeRef = ref({ version: 1, months: {} })
let hydratePromise = null
let hydrated = false

function normalizeStore(raw) {
  const months = {}
  const src = raw && typeof raw === 'object' && raw.months && typeof raw.months === 'object' ? raw.months : {}
  for (const [mk, list] of Object.entries(src)) {
    if (!/^\d{4}-\d{2}$/.test(mk) || !Array.isArray(list)) continue
    const periods = list
      .map((p) => ({ from: String(p?.from || ''), to: String(p?.to || '') }))
      .filter((p) => YMD_RE.test(p.from) && YMD_RE.test(p.to))
    if (periods.length && !validateWeekPeriods(periods)) months[mk] = periods
  }
  return { version: 1, months }
}

/** @param {{ forceRefresh?: boolean }} [opts] */
export async function hydrateWeekPeriods(opts = {}) {
  if (!opts.forceRefresh && hydrated) return storeRef.value
  if (!opts.forceRefresh && hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    try {
      const res = await fetchAppSetting(WEEK_PERIODS_SCOPE, WEEK_PERIODS_KIND)
      storeRef.value = normalizeStore(res?.data)
      hydrated = true
    } catch (err) {
      console.warn('[week_periods] 주차 기간 불러오기 실패 — 자동 계산 사용:', err?.message || err)
    }
    return storeRef.value
  })().finally(() => {
    hydratePromise = null
  })
  return hydratePromise
}

/** @param {string} monthKey */
export function hasCustomWeekPeriods(monthKey) {
  return Boolean(storeRef.value.months[monthKey]?.length)
}

/** 주차 목록 — 저장된 기간 우선, 없으면 금~목 자동 계산 */
export function getWeeksForMonth(monthKey) {
  const custom = storeRef.value.months[monthKey]
  if (custom?.length) return buildWeeksFromPeriods(monthKey, custom)
  return listFriThuWeeksInMonth(monthKey)
}

/**
 * @param {string} monthKey
 * @param {Array<{ from: string, to: string }> | null} periods null이면 자동 계산으로 되돌림
 */
export async function saveWeekPeriods(monthKey, periods) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) throw new Error('연월이 올바르지 않습니다.')
  if (periods) {
    const msg = validateWeekPeriods(periods)
    if (msg) throw new Error(msg)
  }
  const months = { ...storeRef.value.months }
  if (periods) months[monthKey] = periods.map((p) => ({ from: p.from, to: p.to }))
  else delete months[monthKey]
  const res = await saveAppSetting(WEEK_PERIODS_SCOPE, WEEK_PERIODS_KIND, { version: 1, months })
  storeRef.value = normalizeStore(res?.data ?? { months })
  hydrated = true
}

export function useWeekPeriods() {
  return { store: storeRef, hydrateWeekPeriods, getWeeksForMonth, hasCustomWeekPeriods, saveWeekPeriods }
}
