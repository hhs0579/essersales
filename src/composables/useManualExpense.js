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
    } else {
      legacyEntries = getManualExpenseEntries(raw).map(normalizeManualExpenseEntry)
    }
  }
  return { months, legacyEntries }
}

/** @typedef {{ months: Record<string, ReturnType<typeof normalizeManualExpenseEntry>[]>, legacyEntries: ReturnType<typeof normalizeManualExpenseEntry>[] }} ManualExpenseStore */

const storeByScope = reactive(/** @type {Record<string, ManualExpenseStore>} */ ({}))
const hydratedScopes = new Set()

/** @param {string} scope */
function ensureStore(scope) {
  const key = specialSaleScopeFor(scope)
  if (!storeByScope[key]) {
    storeByScope[key] = { months: {}, legacyEntries: [] }
  }
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
  target.legacyEntries = normalized.legacyEntries.map((e) => ({ ...e }))
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
  return { months }
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

  try {
    const res = await fetchAppSetting(key, MANUAL_EXPENSE_SETTING_KIND)
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
export async function persistManualExpense(scope) {
  const key = specialSaleScopeFor(scope)
  const store = ensureStore(scope)
  try {
    const existing = await fetchAppSetting(key, MANUAL_EXPENSE_SETTING_KIND)
    if (existing?.data) {
      const incoming = normalizeMonthlyStore(existing.data)
      for (const [mk, entries] of Object.entries(incoming.months)) {
        if (!store.months[mk]) {
          store.months[mk] = entries.map((e) => ({ ...e }))
        }
      }
    }
  } catch {
    /* 서버 월 버킷 병합 실패 — 로컬만 저장 */
  }
  const payload = buildPayload(store)

  try {
    const res = await saveAppSetting(key, MANUAL_EXPENSE_SETTING_KIND, payload)
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

/**
 * @param {string} scope
 * @param {string} monthKey
 * @param {{ allowLegacy?: boolean }} [opts]
 */
export function getManualExpenseSnapshot(scope, monthKey, opts = {}) {
  const store = ensureStore(scope)
  const mk = padMonthKey(monthKey) || (MONTH_RE.test(String(monthKey || '')) ? monthKey : '')
  const allowLegacy = opts.allowLegacy !== false
  if (!mk) {
    const fallback = currentMonthKey()
    const entries = resolveEntriesForMonth(store, fallback, allowLegacy).map(
      normalizeManualExpenseEntry,
    )
    return { entries }
  }
  const entries = resolveEntriesForMonth(store, mk, allowLegacy).map(normalizeManualExpenseEntry)
  return { entries }
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
