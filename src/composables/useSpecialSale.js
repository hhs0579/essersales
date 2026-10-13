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
  padMonthKey,
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
 * app_settings data → { months, weeks, legacyEntries }
 * @param {unknown} raw
 */
function normalizeMonthlyStore(raw) {
  const months = {}
  /** @type {Record<string, { from?: string, to?: string, entries: ReturnType<typeof normalizeSpecialSaleEntry>[] }>} */
  const weeks = {}
  let legacyEntries = []
  if (raw && typeof raw === 'object') {
    const o = /** @type {Record<string, unknown>} */ (raw)
    if (o.months && typeof o.months === 'object') {
      for (const [mk, bucket] of Object.entries(o.months)) {
        const padded = padMonthKey(mk)
        if (!padded) continue
        months[padded] = getSpecialSaleEntries(
          Array.isArray(bucket) ? { entries: bucket } : bucket,
        ).map(normalizeSpecialSaleEntry)
      }
    } else if (!o.weeks) {
      legacyEntries = getSpecialSaleEntries(raw).map(normalizeSpecialSaleEntry)
    }
    if (o.weeks && typeof o.weeks === 'object') {
      for (const [wk, bucket] of Object.entries(o.weeks)) {
        const key = String(wk || '').trim()
        if (!/^\d{4}-\d{2}-W[1-6]$/.test(key)) continue
        const b =
          bucket && typeof bucket === 'object' && !Array.isArray(bucket)
            ? /** @type {Record<string, unknown>} */ (bucket)
            : { entries: bucket }
        weeks[key] = {
          from: typeof b.from === 'string' ? b.from : '',
          to: typeof b.to === 'string' ? b.to : '',
          entries: getSpecialSaleEntries(
            Array.isArray(bucket) ? { entries: bucket } : bucket,
          ).map(normalizeSpecialSaleEntry),
        }
      }
    }
  }
  return { months, weeks, legacyEntries }
}

/** @typedef {{ months: Record<string, ReturnType<typeof normalizeSpecialSaleEntry>[]>, weeks: Record<string, { from?: string, to?: string, entries: ReturnType<typeof normalizeSpecialSaleEntry>[] }>, legacyEntries: ReturnType<typeof normalizeSpecialSaleEntry>[] }} SpecialSaleStore */

const storeByScope = reactive(/** @type {Record<string, SpecialSaleStore>} */ ({}))
const hydratedScopes = new Set()
/** hydrate/persist 레이스 — 저장 직후 늦게 도착한 옛 GET이 weeks를 지우지 않게 */
const storeEpochByKey = new Map()

function bumpStoreEpoch(key) {
  const next = (storeEpochByKey.get(key) || 0) + 1
  storeEpochByKey.set(key, next)
  return next
}

function currentStoreEpoch(key) {
  return storeEpochByKey.get(key) || 0
}

/** @param {string} scope */
function ensureStore(scope) {
  const key = specialSaleScopeFor(scope)
  if (!storeByScope[key]) {
    storeByScope[key] = { months: {}, weeks: {}, legacyEntries: [] }
  }
  if (!storeByScope[key].weeks) storeByScope[key].weeks = {}
  return storeByScope[key]
}

/** 특정 월의 입력행 (없으면 레거시 폴백, 그래도 없으면 빈 배열) */
function resolveEntriesForMonth(store, monthKey, allowLegacy = true) {
  const padded = padMonthKey(monthKey)
  if (padded && store.months[padded]) return store.months[padded]
  if (monthKey && store.months[monthKey]) return store.months[monthKey]
  if (padded) {
    for (const [mk, entries] of Object.entries(store.months)) {
      if (padMonthKey(mk) === padded) return entries
    }
  }
  if (allowLegacy && store.legacyEntries.length) return store.legacyEntries.map((e) => ({ ...e }))
  return []
}

/** 월 버킷 확보 (편집용) — 레거시가 있으면 초기값으로 채움 */
function ensureMonthBucket(store, monthKey) {
  const mk = padMonthKey(monthKey) || monthKey
  if (!store.months[mk]) {
    store.months[mk] =
      store.legacyEntries.length && !Object.keys(store.months).length
        ? store.legacyEntries.map((e) => ({ ...e }))
        : [createEmptySpecialSaleEntry()]
  }
  return store.months[mk]
}

function applyStore(target, normalized) {
  target.months = {}
  for (const [mk, entries] of Object.entries(normalized.months)) {
    const padded = padMonthKey(mk) || mk
    target.months[padded] = entries.map((e) => ({ ...e }))
  }
  target.weeks = {}
  for (const [wk, bucket] of Object.entries(normalized.weeks || {})) {
    target.weeks[wk] = {
      from: bucket.from || '',
      to: bucket.to || '',
      entries: (bucket.entries || []).map((e) => ({ ...e })),
    }
  }
  target.legacyEntries = normalized.legacyEntries.map((e) => ({ ...e }))
}

/** 저장 직후 서버 응답에 weeks가 빠지면 방금 보낸 payload로 보강 */
function applyStoreAfterSave(target, serverData, sentPayload) {
  const fromServer = normalizeMonthlyStore(serverData || {})
  const fromSent = normalizeMonthlyStore(sentPayload || {})
  const weeks = { ...fromSent.weeks }
  for (const [wk, bucket] of Object.entries(fromServer.weeks || {})) {
    weeks[wk] = bucket
  }
  const months = { ...fromSent.months }
  for (const [mk, entries] of Object.entries(fromServer.months || {})) {
    months[mk] = entries
  }
  applyStore(target, {
    months,
    weeks,
    legacyEntries: fromServer.legacyEntries.length
      ? fromServer.legacyEntries
      : fromSent.legacyEntries,
  })
}

/** 저장 payload — months + weeks (빈 버킷 제외) */
function buildPayload(store) {
  const months = {}
  for (const [mk, entries] of Object.entries(store.months)) {
    const padded = padMonthKey(mk) || mk
    const clean = (entries || [])
      .map(normalizeSpecialSaleEntry)
      .filter((e) => e.name || e.sales || e.margin)
    if (clean.length) months[padded] = { entries: clean }
  }
  const weeks = {}
  for (const [wk, bucket] of Object.entries(store.weeks || {})) {
    const clean = (bucket?.entries || [])
      .map(normalizeSpecialSaleEntry)
      .filter((e) => e.name || e.sales || e.margin)
    if (!clean.length) continue
    weeks[wk] = {
      from: bucket.from || '',
      to: bucket.to || '',
      entries: clean,
    }
  }
  return { version: 2, months, weeks }
}

/** 엑셀 export 등 — 전체 월 버킷 (당월 스냅샷만 보내면 전월 특판이 지워짐) */
export function getSpecialSaleSettingPayload(scope) {
  return buildPayload(ensureStore(scope))
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
  // 서버가 응답한 오류(500·409 등)는 로컬 저장으로 숨기지 않음 — 저장 실패로 표시
  if (err?.status && err.status !== 404) return false
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

  const epoch = bumpStoreEpoch(key)

  try {
    const res = await fetchAppSetting(key, SPECIAL_SALE_SETTING_KIND)
    if (epoch !== currentStoreEpoch(key)) return store
    if (res?.data) {
      applyStore(store, normalizeMonthlyStore(res.data))
      hydratedScopes.add(key)
      return store
    }
  } catch {
    /* 서버 미연결 — 로컬 폴백 */
  }

  if (epoch !== currentStoreEpoch(key)) return store
  const legacy = loadLegacyLocal(key)
  if (legacy) applyStore(store, legacy)
  hydratedScopes.add(key)
  return store
}

/** @param {string} scope */
export async function persistSpecialSale(scope) {
  const key = specialSaleScopeFor(scope)
  const store = ensureStore(scope)
  // 다른 화면이 먼저 저장한 월·주 버킷은 saveAppSetting(409 → 3-way 병합)이 보존
  const payload = buildPayload(store)
  const epoch = bumpStoreEpoch(key)

  try {
    const res = await saveAppSetting(key, SPECIAL_SALE_SETTING_KIND, payload)
    if (epoch === currentStoreEpoch(key)) {
      applyStoreAfterSave(store, res?.data, payload)
    }
    clearLegacyLocal(key)
    hydratedScopes.add(key)
    return { mode: 'server' }
  } catch (err) {
    if (!shouldFallbackToLocalStorage(err)) throw err
    saveLegacyLocal(key, payload)
    if (epoch === currentStoreEpoch(key)) {
      applyStoreAfterSave(store, payload, payload)
    }
    hydratedScopes.add(key)
    return {
      mode: 'local',
      warning:
        '서버 설정 API에 아직 반영되지 않아 이 브라우저에 저장했습니다. KPI·엑셀에는 바로 반영됩니다.',
    }
  }
}

/**
 * 특정 월의 특판 스냅샷 — 다운스트림(KPI·엑셀)은 { entries } 평면 구조로 소비.
 * 기본: 월 버킷 + 같은 달 주간(weeks) 엔트리를 합산 (주간→월별 반영).
 * dateFrom/dateTo가 달 전체가 아니면 월 버킷은 빼고, 구간과 겹치는 주차만 포함.
 * @param {string} scope
 * @param {string} monthKey
 * @param {{ allowLegacy?: boolean, includeWeeks?: boolean, dateFrom?: string, dateTo?: string }} [opts]
 */
export function getSpecialSaleSnapshot(scope, monthKey, opts = {}) {
  const store = ensureStore(scope)
  const mk = padMonthKey(monthKey) || (MONTH_RE.test(String(monthKey || '')) ? monthKey : '')
  const allowLegacy = opts.allowLegacy !== false
  const includeWeeks = opts.includeWeeks !== false
  const targetMk = mk || currentMonthKey()
  const from = String(opts.dateFrom || '').trim()
  const to = String(opts.dateTo || '').trim()
  const partialRange =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    !isFullCalendarMonthRange(from, to)

  const monthEntries = partialRange
    ? []
    : resolveEntriesForMonth(store, targetMk, allowLegacy).map(normalizeSpecialSaleEntry)
  const weekEntries = includeWeeks
    ? collectWeekEntriesForMonth(store, targetMk, partialRange ? { from, to } : null)
    : []
  return { entries: [...monthEntries, ...weekEntries] }
}

function isFullCalendarMonthRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false
  if (from.slice(0, 7) !== to.slice(0, 7)) return false
  const y = Number(from.slice(0, 4))
  const m = Number(from.slice(5, 7))
  const last = new Date(y, m, 0).getDate()
  return from.endsWith('-01') && to === `${from.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

/** @param {SpecialSaleStore} store @param {string} monthKey @param {{ from: string, to: string } | null} [range] */
function collectWeekEntriesForMonth(store, monthKey, range = null) {
  const mk = padMonthKey(monthKey)
  if (!mk || !store.weeks) return []
  const keys = Object.keys(store.weeks)
    .filter((wk) => wk.startsWith(`${mk}-W`) && /^\d{4}-\d{2}-W[1-6]$/.test(wk))
    .sort()
  /** @type {ReturnType<typeof normalizeSpecialSaleEntry>[]} */
  const out = []
  for (const wk of keys) {
    const bucket = store.weeks[wk]
    if (range) {
      const wf = String(bucket?.from || '').trim()
      const wt = String(bucket?.to || '').trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(wf) && /^\d{4}-\d{2}-\d{2}$/.test(wt)) {
        if (wt < range.from || wf > range.to) continue
      }
    }
    for (const e of bucket?.entries || []) out.push(normalizeSpecialSaleEntry(e))
  }
  return out
}

/**
 * 주간 특판 스냅샷 — 해당 주차만 (주간 KPI·다운)
 * @param {string} scope
 * @param {string} weekKey YYYY-MM-Wn
 */
export function getSpecialSaleWeekSnapshot(scope, weekKey) {
  const store = ensureStore(scope)
  const wk = String(weekKey || '').trim()
  const bucket = store.weeks?.[wk]
  const entries = (bucket?.entries || []).map(normalizeSpecialSaleEntry)
  return {
    entries,
    from: bucket?.from || '',
    to: bucket?.to || '',
    weekKey: wk,
  }
}

/** @param {string} scope @param {string} weekKey @param {{ from?: string, to?: string }} [meta] */
function ensureWeekBucket(store, weekKey, meta = {}) {
  const wk = String(weekKey || '').trim()
  if (!store.weeks) store.weeks = {}
  if (!store.weeks[wk]) {
    store.weeks[wk] = {
      from: meta.from || '',
      to: meta.to || '',
      entries: [createEmptySpecialSaleEntry()],
    }
  } else {
    if (meta.from) store.weeks[wk].from = meta.from
    if (meta.to) store.weeks[wk].to = meta.to
  }
  return store.weeks[wk].entries
}

/**
 * 주 단위 특판 입력
 * @param {string} scope
 * @param {import('vue').Ref<string> | (() => string)} weekKeyRef
 * @param {import('vue').Ref<{ from?: string, to?: string }> | (() => { from?: string, to?: string }) | null} [metaRef]
 */
export function useSpecialSaleWeek(scope, weekKeyRef, metaRef = null) {
  const store = ensureStore(scope)

  if (!hydratedScopes.has(specialSaleScopeFor(scope))) {
    hydrateSpecialSaleForScope(scope).catch(() => {})
  }

  const resolveWeek = () => {
    const raw = typeof weekKeyRef === 'function' ? weekKeyRef() : weekKeyRef?.value
    return String(raw || '').trim()
  }

  const resolveMeta = () => {
    if (!metaRef) return {}
    return typeof metaRef === 'function' ? metaRef() || {} : metaRef?.value || {}
  }

  function currentEntries() {
    const wk = resolveWeek()
    if (!/^\d{4}-\d{2}-W[1-6]$/.test(wk)) return []
    return ensureWeekBucket(store, wk, resolveMeta())
  }

  function addEntry() {
    const wk = resolveWeek()
    if (!/^\d{4}-\d{2}-W[1-6]$/.test(wk)) return
    ensureWeekBucket(store, wk, resolveMeta()).push(createEmptySpecialSaleEntry())
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
    const wk = resolveWeek()
    const meta = resolveMeta()
    store.weeks[wk] = {
      from: meta.from || store.weeks[wk]?.from || '',
      to: meta.to || store.weeks[wk]?.to || '',
      entries: [createEmptySpecialSaleEntry()],
    }
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

/** 반응형 스토어 — 대시보드 전월대비 특판 반영 watch용 */
export function getSpecialSaleReactiveStore(scope) {
  return ensureStore(scope)
}

/** 월별 특판 매출 맵 { 'YYYY-MM': [entry,...] } — 월 + 해당 달 주간 합산 */
export function getSpecialSaleMonthlyMap(scope, refMonthKey) {
  const store = ensureStore(scope)
  const map = {}
  for (const [mk, entries] of Object.entries(store.months)) {
    const padded = padMonthKey(mk) || mk
    map[padded] = entries.map(normalizeSpecialSaleEntry)
  }
  const ref = padMonthKey(refMonthKey)
  if (ref && !map[ref] && store.legacyEntries.length) {
    map[ref] = store.legacyEntries.map(normalizeSpecialSaleEntry)
  }
  for (const [wk, bucket] of Object.entries(store.weeks || {})) {
    const m = String(wk).match(/^(\d{4}-\d{2})-W[1-6]$/)
    if (!m) continue
    const padded = m[1]
    if (!map[padded]) map[padded] = []
    for (const e of bucket?.entries || []) map[padded].push(normalizeSpecialSaleEntry(e))
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
    return padMonthKey(raw) || currentMonthKey()
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
