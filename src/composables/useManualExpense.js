import { reactive } from 'vue'

import {
  createEmptyManualExpenseEntry,
  MANUAL_EXPENSE_SETTING_KIND,
} from '../config/manualExpense.js'
import { specialSaleScopeFor } from '../config/dataChannels.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'
import {
  getManualExpenseEntries,
  normalizeManualExpenseEntry,
} from '../utils/manualExpenseKpi.js'
import { padMonthKey } from '../utils/specialSaleKpi.js'

const STORAGE_PREFIX = 'essersales_manual_expense_v1_'
const MONTH_RE = /^\d{4}-\d{2}$/

/** @param {string} scope */
function storageKey(scope) {
  return `${STORAGE_PREFIX}${scope || 'default'}`
}

/** 현재(달력) 월 YYYY-MM */
export function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * @param {unknown} raw
 */
function normalizeMonthlyStore(raw) {
  const months = {}
  /** @type {Record<string, { from?: string, to?: string, entries: ReturnType<typeof normalizeManualExpenseEntry>[] }>} */
  const weeks = {}
  let legacyEntries = []
  if (raw && typeof raw === 'object') {
    const o = /** @type {Record<string, unknown>} */ (raw)
    if (o.months && typeof o.months === 'object') {
      for (const [mk, bucket] of Object.entries(o.months)) {
        const padded = padMonthKey(mk)
        if (!padded) continue
        months[padded] = getManualExpenseEntries(
          Array.isArray(bucket) ? { entries: bucket } : bucket,
        ).map(normalizeManualExpenseEntry)
      }
    } else if (!o.weeks) {
      legacyEntries = getManualExpenseEntries(raw).map(normalizeManualExpenseEntry)
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
          entries: getManualExpenseEntries(
            Array.isArray(bucket) ? { entries: bucket } : bucket,
          ).map(normalizeManualExpenseEntry),
        }
      }
    }
  }
  return { months, weeks, legacyEntries }
}

/** @typedef {{ months: Record<string, ReturnType<typeof normalizeManualExpenseEntry>[]>, weeks: Record<string, { from?: string, to?: string, entries: ReturnType<typeof normalizeManualExpenseEntry>[] }>, legacyEntries: ReturnType<typeof normalizeManualExpenseEntry>[] }} ManualExpenseStore */

const storeByScope = reactive(/** @type {Record<string, ManualExpenseStore>} */ ({}))
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

function ensureMonthBucket(store, monthKey) {
  const mk = padMonthKey(monthKey) || monthKey
  if (!store.months[mk]) {
    store.months[mk] =
      store.legacyEntries.length && !Object.keys(store.months).length
        ? store.legacyEntries.map((e) => ({ ...e }))
        : [createEmptyManualExpenseEntry()]
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

function buildPayload(store) {
  const months = {}
  for (const [mk, entries] of Object.entries(store.months)) {
    const padded = padMonthKey(mk) || mk
    const clean = (entries || [])
      .map(normalizeManualExpenseEntry)
      .filter((e) => e.name || e.amount)
    if (clean.length) months[padded] = { entries: clean }
  }
  const weeks = {}
  for (const [wk, bucket] of Object.entries(store.weeks || {})) {
    const clean = (bucket?.entries || [])
      .map(normalizeManualExpenseEntry)
      .filter((e) => e.name || e.amount)
    if (!clean.length) continue
    weeks[wk] = {
      from: bucket.from || '',
      to: bucket.to || '',
      entries: clean,
    }
  }
  return { version: 2, months, weeks }
}

/** 엑셀 export — 전체 월 버킷 */
export function getManualExpenseSettingPayload(scope) {
  return buildPayload(ensureStore(scope))
}

function saveLegacyLocal(key, payload) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

function loadLegacyLocal(key) {
  try {
    const raw = localStorage.getItem(storageKey(key))
    if (!raw) return null
    return normalizeMonthlyStore(JSON.parse(raw))
  } catch {
    return null
  }
}

function clearLegacyLocal(key) {
  try {
    localStorage.removeItem(storageKey(key))
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
export async function hydrateManualExpenseForScope(scope, opts = {}) {
  const key = specialSaleScopeFor(scope)
  const store = ensureStore(scope)
  if (!opts.forceRefresh && hydratedScopes.has(key)) return store

  const epoch = bumpStoreEpoch(key)

  try {
    const res = await fetchAppSetting(key, MANUAL_EXPENSE_SETTING_KIND)
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
export async function persistManualExpense(scope) {
  const key = specialSaleScopeFor(scope)
  const store = ensureStore(scope)
  // 다른 화면이 먼저 저장한 월·주 버킷은 saveAppSetting(409 → 3-way 병합)이 보존
  const payload = buildPayload(store)
  // 저장 직중·직후 늦게 끝나는 hydrate가 덮어쓰지 못하게 epoch 올림
  const epoch = bumpStoreEpoch(key)

  try {
    const res = await saveAppSetting(key, MANUAL_EXPENSE_SETTING_KIND, payload)
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
 * @param {string} scope
 * @param {string} monthKey
 * @param {{ allowLegacy?: boolean, includeWeeks?: boolean, dateFrom?: string, dateTo?: string }} [opts]
 */
export function getManualExpenseSnapshot(scope, monthKey, opts = {}) {
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
    : resolveEntriesForMonth(store, targetMk, allowLegacy).map(normalizeManualExpenseEntry)
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

/** @param {ManualExpenseStore} store @param {string} monthKey @param {{ from: string, to: string } | null} [range] */
function collectWeekEntriesForMonth(store, monthKey, range = null) {
  const mk = padMonthKey(monthKey)
  if (!mk || !store.weeks) return []
  const keys = Object.keys(store.weeks)
    .filter((wk) => wk.startsWith(`${mk}-W`) && /^\d{4}-\d{2}-W[1-6]$/.test(wk))
    .sort()
  /** @type {ReturnType<typeof normalizeManualExpenseEntry>[]} */
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
    for (const e of bucket?.entries || []) out.push(normalizeManualExpenseEntry(e))
  }
  return out
}

/**
 * @param {string} scope
 * @param {string} weekKey
 */
export function getManualExpenseWeekSnapshot(scope, weekKey) {
  const store = ensureStore(scope)
  const wk = String(weekKey || '').trim()
  const bucket = store.weeks?.[wk]
  return {
    entries: (bucket?.entries || []).map(normalizeManualExpenseEntry),
    from: bucket?.from || '',
    to: bucket?.to || '',
    weekKey: wk,
  }
}

/** @param {object} store @param {string} weekKey @param {{ from?: string, to?: string }} [meta] */
function ensureWeekBucket(store, weekKey, meta = {}) {
  const wk = String(weekKey || '').trim()
  if (!store.weeks) store.weeks = {}
  if (!store.weeks[wk]) {
    store.weeks[wk] = {
      from: meta.from || '',
      to: meta.to || '',
      entries: [createEmptyManualExpenseEntry()],
    }
  } else {
    if (meta.from) store.weeks[wk].from = meta.from
    if (meta.to) store.weeks[wk].to = meta.to
  }
  return store.weeks[wk].entries
}

export function getManualExpenseReactiveStore(scope) {
  return ensureStore(scope)
}

/**
 * @param {string} scope
 * @param {import('vue').Ref<string> | (() => string)} monthKeyRef
 */
export function useManualExpense(scope, monthKeyRef) {
  const store = ensureStore(scope)

  if (!hydratedScopes.has(specialSaleScopeFor(scope))) {
    hydrateManualExpenseForScope(scope).catch(() => {})
  }

  const resolveMonth = () => {
    const raw = typeof monthKeyRef === 'function' ? monthKeyRef() : monthKeyRef?.value
    return padMonthKey(raw) || currentMonthKey()
  }

  function currentEntries() {
    return ensureMonthBucket(store, resolveMonth())
  }

  function addEntry() {
    currentEntries().push(createEmptyManualExpenseEntry())
  }

  function removeEntry(id) {
    const entries = currentEntries()
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return
    entries.splice(idx, 1)
    if (!entries.length) entries.push(createEmptyManualExpenseEntry())
  }

  async function saveExpense() {
    return persistManualExpense(scope)
  }

  function resetExpense() {
    store.months[resolveMonth()] = [createEmptyManualExpenseEntry()]
  }

  return {
    store,
    currentEntries,
    addEntry,
    removeEntry,
    saveExpense,
    resetExpense,
  }
}

/**
 * @param {string} scope
 * @param {import('vue').Ref<string> | (() => string)} weekKeyRef
 * @param {import('vue').Ref<{ from?: string, to?: string }> | (() => { from?: string, to?: string }) | null} [metaRef]
 */
export function useManualExpenseWeek(scope, weekKeyRef, metaRef = null) {
  const store = ensureStore(scope)

  if (!hydratedScopes.has(specialSaleScopeFor(scope))) {
    hydrateManualExpenseForScope(scope).catch(() => {})
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
    ensureWeekBucket(store, wk, resolveMeta()).push(createEmptyManualExpenseEntry())
  }

  function removeEntry(id) {
    const entries = currentEntries()
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return
    entries.splice(idx, 1)
    if (!entries.length) entries.push(createEmptyManualExpenseEntry())
  }

  async function saveExpense() {
    return persistManualExpense(scope)
  }

  function resetExpense() {
    const wk = resolveWeek()
    const meta = resolveMeta()
    store.weeks[wk] = {
      from: meta.from || store.weeks[wk]?.from || '',
      to: meta.to || store.weeks[wk]?.to || '',
      entries: [createEmptyManualExpenseEntry()],
    }
  }

  return {
    store,
    currentEntries,
    addEntry,
    removeEntry,
    saveExpense,
    resetExpense,
  }
}
