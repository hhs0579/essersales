import { ref, watch } from 'vue'
import {
  createEmptyManualAdList,
  createManualAdEntry,
  normalizeManualAdSource,
} from '../config/manualAdSpend.js'
import { EXTERNAL_AD_CHANNELS, resolveExternalAdScope } from '../config/externalAdChannels.js'
import { isCombinedScope, combinedManualAdScopes } from '../config/combinedChannel.js'
import { parseAmount, formatManualAdAmount } from '../utils/parseAmount.js'
import { debounce } from '../utils/debounce.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'

const STORAGE_PREFIX = 'essersales_manual_ad_'
const SETTING_KIND = 'manual_ad'
const watchStarted = new Set()
const hydratedScopes = new Set()

/** @param {string} scope */
function storageKey(scope) {
  return `${STORAGE_PREFIX}${scope || 'default'}`
}

/** @param {Record<string, unknown>} o */
function migrateLegacyEntry(o) {
  const base = createManualAdEntry()
  const date =
    (typeof o.date === 'string' && o.date) ||
    (typeof o.dateFrom === 'string' && o.dateFrom) ||
    (typeof o.dateTo === 'string' && o.dateTo) ||
    ''
  const adSpend =
    typeof o.adSpend === 'string' || typeof o.adSpend === 'number'
      ? formatManualAdAmount(o.adSpend)
      : typeof o.amount === 'string' || typeof o.amount === 'number'
        ? formatManualAdAmount(o.amount)
        : ''
  const adSales =
    typeof o.adSales === 'string' || typeof o.adSales === 'number'
      ? formatManualAdAmount(o.adSales)
      : ''
  return {
    id: typeof o.id === 'string' ? o.id : base.id,
    date,
    adSpend,
    adSales,
    source: normalizeManualAdSource(typeof o.source === 'string' ? o.source : 'meta'),
  }
}

/** @param {unknown} raw */
function normalizeList(raw) {
  if (!Array.isArray(raw)) return createEmptyManualAdList()
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return createManualAdEntry()
    return migrateLegacyEntry(/** @type {Record<string, unknown>} */ (item))
  })
}

function legacyScopeFor(scope) {
  if (scope === 'platform_monthly') return 'platform'
  if (scope === 'company_b_monthly') return 'company_b'
  return ''
}

/** 일별 scope 광고 → 월별 scope 월 합계 */
function migrateLegacyDailyToMonthly(scope) {
  const legacyScope = legacyScopeFor(scope)
  if (!legacyScope) return createEmptyManualAdList()

  const legacyRaw = localStorage.getItem(storageKey(legacyScope))
  if (!legacyRaw) return createEmptyManualAdList()

  const legacyList = normalizeList(JSON.parse(legacyRaw))
  if (!legacyList.length) return createEmptyManualAdList()

  /** @type {Map<string, { adSpend: number, adSales: number }>} */
  const byMonth = new Map()
  for (const e of legacyList) {
    if (!e?.date) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue
    const monthStart = `${e.date.slice(0, 7)}-01`
    const prev = byMonth.get(monthStart) || { adSpend: 0, adSales: 0 }
    prev.adSpend += parseAmount(e.adSpend)
    prev.adSales += parseAmount(e.adSales)
    byMonth.set(monthStart, prev)
  }

  return [...byMonth.entries()]
    .map(([date, v]) => {
      if (!v.adSpend && !v.adSales) return null
      const entry = createManualAdEntry()
      entry.date = date
      entry.adSpend = String(v.adSpend)
      entry.adSales = String(v.adSales)
      return entry
    })
    .filter(Boolean)
}

/** @param {string} scope */
function loadList(scope) {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (raw) {
      const list = normalizeList(JSON.parse(raw))
      // 빈 배열이 이미 저장된 경우에도 일별 → 월별 마이그레이션 시도
      if (list.length > 0 || !legacyScopeFor(scope)) return list
      const migrated = migrateLegacyDailyToMonthly(scope)
      if (!migrated.length) return list
      saveList(scope, migrated)
      return migrated
    }

    const migrated = migrateLegacyDailyToMonthly(scope)
    if (migrated.length) {
      saveList(scope, migrated)
      return migrated
    }
    return createEmptyManualAdList()
  } catch {
    return createEmptyManualAdList()
  }
}

/** @param {import('../config/manualAdSpend.js').ManualAdEntry[]} list */
function cloneManualAdEntryList(list) {
  return (list || []).map((e) => ({ ...e }))
}

/** @param {string} scope @param {import('../config/manualAdSpend.js').ManualAdEntry[]} list */
function saveList(scope, list) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

const saveListDebouncedByScope = new Map()
/** @param {string} scope */
function scheduleSaveList(scope, list) {
  if (!saveListDebouncedByScope.has(scope)) {
    saveListDebouncedByScope.set(
      scope,
      debounce((s, l) => saveList(s, l), 400),
    )
  }
  saveListDebouncedByScope.get(scope)(scope, list)
}

/** @type {Record<string, import('vue').Ref<import('../config/manualAdSpend.js').ManualAdEntry[]>>} */
const listByScope = {}

/** @param {string} scope */
function ensureListRef(scope) {
  if (!listByScope[scope]) {
    listByScope[scope] = ref(loadList(scope))
  } else if (legacyScopeFor(scope) && !listByScope[scope].value.length) {
    const migrated = migrateLegacyDailyToMonthly(scope)
    if (migrated.length) {
      listByScope[scope].value = migrated
      saveList(scope, migrated)
    }
  }
  if (!watchStarted.has(scope)) {
    watchStarted.add(scope)
    watch(
      listByScope[scope],
      (val) => scheduleSaveList(scope, val),
      { deep: true },
    )
  }
  return listByScope[scope]
}

/** @param {string} scope @param {import('../config/manualAdSpend.js').ManualAdEntry[]} list */
function applyList(target, list) {
  target.splice(0, target.length, ...list)
}

/** @type {Map<string, Promise<unknown>>} */
const hydratePromiseByScope = new Map()

/**
 * @param {string} scope
 * @param {{ forceRefresh?: boolean }} [opts]
 */
export async function hydrateManualAdForScope(scope, opts = {}) {
  const entries = ensureListRef(scope)
  if (!opts.forceRefresh && hydratedScopes.has(scope)) return entries.value
  if (!opts.forceRefresh && hydratePromiseByScope.has(scope)) {
    return hydratePromiseByScope.get(scope)
  }

  const p = (async () => {
    try {
      const res = await fetchAppSetting(scope, SETTING_KIND)
      if (res?.data != null && Array.isArray(res.data)) {
        applyList(entries.value, normalizeList(res.data))
        hydratedScopes.add(scope)
        return entries.value
      }
    } catch {
      /* 서버 미연결 — 로컬 폴백 */
    }
    hydratedScopes.add(scope)
    return entries.value
  })().finally(() => {
    if (hydratePromiseByScope.get(scope) === p) hydratePromiseByScope.delete(scope)
  })
  hydratePromiseByScope.set(scope, p)
  return p
}

/** @param {string} scope */
export async function persistManualAd(scope) {
  const entries = ensureListRef(scope)
  const res = await saveAppSetting(scope, SETTING_KIND, JSON.parse(JSON.stringify(entries.value)))
  if (res?.data != null && Array.isArray(res.data)) {
    applyList(entries.value, normalizeList(res.data))
  }
}

/** @param {string} scope */
export function getManualAdSnapshot(scope) {
  if (isCombinedScope(scope)) {
    return combinedManualAdScopes(scope).flatMap((s) => getManualAdSnapshot(s))
  }
  ensureListRef(scope)
  return cloneManualAdEntryList(listByScope[scope].value)
}

/** @param {'daily'|'monthly'} [period] */
export function getManualAdByChannelSnapshot(period = 'daily') {
  return EXTERNAL_AD_CHANNELS.map((ch) => ({
    label: ch.label,
    scope: resolveExternalAdScope(ch, period),
    entries: getManualAdSnapshot(resolveExternalAdScope(ch, period)),
  }))
}

/**
 * @param {string} scope
 */
export function useManualAdSpend(scope) {
  const entries = ensureListRef(scope)

  if (!hydratedScopes.has(scope)) {
    hydrateManualAdForScope(scope).catch(() => {})
  }

  /** @param {string} [defaultDate] @param {import('../config/manualAdSpend.js').ManualAdSource} [source] */
  function addEntry(defaultDate = '', source = 'meta') {
    const entry = createManualAdEntry(source)
    if (defaultDate) entry.date = defaultDate
    entries.value.push(entry)
  }

  /** @param {string} id */
  function removeEntry(id) {
    const i = entries.value.findIndex((e) => e.id === id)
    if (i >= 0) entries.value.splice(i, 1)
  }

  function clearAll() {
    entries.value.splice(0, entries.value.length)
  }

  async function saveEntries() {
    await persistManualAd(scope)
  }

  /**
   * @param {File} file
   * @param {{ period?: string }} [opts]
   */
  async function importNaverAdCenterExcel(file, opts = {}) {
    const { parseNaverAdCenterExcelFile, mergeNaverAdIntoManualEntries } = await import(
      '../utils/naverAdCenterParser.js'
    )
    const parsed = await parseNaverAdCenterExcelFile(file)
    const additive = scope === 'company_b' || scope === 'company_b_monthly'
    const mergeResult = mergeNaverAdIntoManualEntries(entries.value, parsed.rows, {
      period: opts.period,
      additive,
    })
    return { parsed, mergeResult }
  }

  return {
    entries,
    addEntry,
    removeEntry,
    clearAll,
    saveEntries,
    importNaverAdCenterExcel,
  }
}
