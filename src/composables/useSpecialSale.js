import { reactive } from 'vue'

import {
  createEmptySpecialSaleEntry,
  SPECIAL_SALE_SETTING_KIND,
} from '../config/specialSale.js'
import { specialSaleScopeFor } from '../config/dataChannels.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'
import {
  getSpecialSaleEntries,
  normalizeSpecialSaleEntry,
} from '../utils/specialSaleKpi.js'

const STORAGE_PREFIX = 'essersales_special_sale_v2_'
const MONTH_RE = /^\d{4}-\d{2}$/

/** @param {string} scope */
function legacyStorageKey(scope) {
  return `${STORAGE_PREFIX}${scope || 'default'}`
}

/** 현재(달력) 월 YYYY-MM */
export function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * app_settings data → { months: { 'YYYY-MM': [entry,...] }, legacyEntries: [entry,...] }
 * - 신규 구조: { months: { 'YYYY-MM': { entries } } }
 * - 레거시(월 구분 없음): { entries } / { totalSales } → legacyEntries 로 보관 (조회 월에 폴백)
 * @param {unknown} raw
 */
function normalizeMonthlyStore(raw) {
  const months = {}
  let legacyEntries = []
  if (raw && typeof raw === 'object') {
    const o = /** @type {Record<string, unknown>} */ (raw)
    if (o.months && typeof o.months === 'object') {
      for (const [mk, bucket] of Object.entries(o.months)) {
        if (!MONTH_RE.test(mk)) continue
        months[mk] = getSpecialSaleEntries(bucket).map(normalizeSpecialSaleEntry)
      }
    } else {
      legacyEntries = getSpecialSaleEntries(raw).map(normalizeSpecialSaleEntry)
    }
  }
  return { months, legacyEntries }
}

/** @typedef {{ months: Record<string, ReturnType<typeof normalizeSpecialSaleEntry>[]>, legacyEntries: ReturnType<typeof normalizeSpecialSaleEntry>[] }} SpecialSaleStore */

const storeByScope = reactive(/** @type {Record<string, SpecialSaleStore>} */ ({}))
const hydratedScopes = new Set()

/** @param {string} scope */
function ensureStore(scope) {
  const key = specialSaleScopeFor(scope)
  if (!storeByScope[key]) {
    storeByScope[key] = { months: {}, legacyEntries: [] }
  }
  return storeByScope[key]
}

/** 특정 월의 입력행 (없으면 레거시 폴백, 그래도 없으면 빈 배열) */
function resolveEntriesForMonth(store, monthKey) {
  if (store.months[monthKey]) return store.months[monthKey]
  if (store.legacyEntries.length) return store.legacyEntries.map((e) => ({ ...e }))
  return []
}

/** 월 버킷 확보 (편집용) — 레거시가 있으면 초기값으로 채움 */
function ensureMonthBucket(store, monthKey) {
  if (!store.months[monthKey]) {
    store.months[monthKey] =
      store.legacyEntries.length && !Object.keys(store.months).length
        ? store.legacyEntries.map((e) => ({ ...e }))
        : [createEmptySpecialSaleEntry()]
  }
  return store.months[monthKey]
}

function applyStore(target, normalized) {
  target.months = {}
  for (const [mk, entries] of Object.entries(normalized.months)) {
    target.months[mk] = entries.map((e) => ({ ...e }))
  }
  target.legacyEntries = normalized.legacyEntries.map((e) => ({ ...e }))
}

/** 저장 payload — 월별 구조로 통일 (빈 월은 제외) */
function buildPayload(store) {
  const months = {}
  for (const [mk, entries] of Object.entries(store.months)) {
    const clean = (entries || [])
      .map(normalizeSpecialSaleEntry)
      .filter((e) => e.name || e.sales || e.margin)
    if (clean.length) months[mk] = { entries: clean }
  }
  return { months }
}

function saveLegacyLocal(key, payload) {
  try {
    localStorage.setItem(legacyStorageKey(key), JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

function loadLegacyLocal(key) {
  try {
    const raw = localStorage.getItem(legacyStorageKey(key))
    if (!raw) return null
    return normalizeMonthlyStore(JSON.parse(raw))
  } catch {
    return null
  }
}

function clearLegacyLocal(key) {
  try {
    localStorage.removeItem(legacyStorageKey(key))
  } catch {
    /* ignore */
  }
}

function shouldFallbackToLocalStorage(err) {
  const msg = String(err?.message || '')
  return (
    /invalid scope or kind|설정 API|연결할 수 없습니다|404|요청 실패/.test(msg) ||
    err?.name === 'TypeError'
  )
}

/**
 * @param {string} scope
 * @param {{ forceRefresh?: boolean }} [opts]
 */
export async function hydrateSpecialSaleForScope(scope, opts = {}) {
  const key = specialSaleScopeFor(scope)
  const store = ensureStore(scope)
  if (!opts.forceRefresh && hydratedScopes.has(key)) return store

  try {
    const res = await fetchAppSetting(key, SPECIAL_SALE_SETTING_KIND)
    if (res?.data) {
      applyStore(store, normalizeMonthlyStore(res.data))
      hydratedScopes.add(key)
      return store
    }
  } catch {
    /* 서버 미연결 — 로컬 폴백 */
  }

  const legacy = loadLegacyLocal(key)
  if (legacy) applyStore(store, legacy)
  hydratedScopes.add(key)
  return store
}

/** @param {string} scope */
export async function persistSpecialSale(scope) {
  const key = specialSaleScopeFor(scope)
  const store = ensureStore(scope)
  const payload = buildPayload(store)

  try {
    const res = await saveAppSetting(key, SPECIAL_SALE_SETTING_KIND, payload)
    if (res?.data) applyStore(store, normalizeMonthlyStore(res.data))
    clearLegacyLocal(key)
    return { mode: 'server' }
  } catch (err) {
    if (!shouldFallbackToLocalStorage(err)) throw err
    saveLegacyLocal(key, payload)
    return {
      mode: 'local',
      warning:
        '서버 설정 API에 아직 반영되지 않아 이 브라우저에 저장했습니다. KPI·엑셀에는 바로 반영됩니다.',
    }
  }
}

/** 특정 월의 특판 스냅샷 — 다운스트림(KPI·엑셀)은 { entries } 평면 구조로 소비 */
export function getSpecialSaleSnapshot(scope, monthKey) {
  const store = ensureStore(scope)
  const mk = MONTH_RE.test(String(monthKey || '')) ? monthKey : currentMonthKey()
  const entries = resolveEntriesForMonth(store, mk).map(normalizeSpecialSaleEntry)
  return { entries }
}

/** 월별 특판 매출 맵 { 'YYYY-MM': [entry,...] } — 전월대비 총매출 계산용 */
export function getSpecialSaleMonthlyMap(scope, refMonthKey) {
  const store = ensureStore(scope)
  const map = {}
  for (const [mk, entries] of Object.entries(store.months)) {
    map[mk] = entries.map(normalizeSpecialSaleEntry)
  }
  const ref = MONTH_RE.test(String(refMonthKey || '')) ? refMonthKey : ''
  if (ref && !map[ref] && store.legacyEntries.length) {
    map[ref] = store.legacyEntries.map(normalizeSpecialSaleEntry)
  }
  return map
}

/** 특판 데이터가 있는(입력된) 월 목록 정렬 */
export function specialSaleMonthsWithData(scope) {
  const store = ensureStore(scope)
  return Object.keys(store.months)
    .filter((mk) => (store.months[mk] || []).some((e) => e.name || e.sales || e.margin))
    .sort()
}

/**
 * 월 단위 특판 입력 편집 composable
 * @param {string} scope
 * @param {import('vue').Ref<string> | (() => string)} monthKeyRef 현재 편집 대상 월
 */
export function useSpecialSale(scope, monthKeyRef) {
  const store = ensureStore(scope)

  if (!hydratedScopes.has(specialSaleScopeFor(scope))) {
    hydrateSpecialSaleForScope(scope).catch(() => {})
  }

  const resolveMonth = () => {
    const raw = typeof monthKeyRef === 'function' ? monthKeyRef() : monthKeyRef?.value
    return MONTH_RE.test(String(raw || '')) ? raw : currentMonthKey()
  }

  function currentEntries() {
    return ensureMonthBucket(store, resolveMonth())
  }

  function addEntry() {
    currentEntries().push(createEmptySpecialSaleEntry())
  }

  function removeEntry(id) {
    const entries = currentEntries()
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return
    entries.splice(idx, 1)
    if (!entries.length) entries.push(createEmptySpecialSaleEntry())
  }

  async function saveSale() {
    return persistSpecialSale(scope)
  }

  function resetSale() {
    store.months[resolveMonth()] = [createEmptySpecialSaleEntry()]
  }

  return {
    store,
    currentEntries,
    addEntry,
    removeEntry,
    saveSale,
    resetSale,
  }
}
