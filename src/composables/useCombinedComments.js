import { computed, reactive, ref, watch } from 'vue'

import {
  COMBINED_COMMENT_LABELS,
  createEmptyCombinedComments,
  createEmptyCommentSlots,
  COMBINED_COMMENTS_SETTING_KIND,
  COMBINED_COMMENTS_SETTING_SCOPE,
  COMBINED_COMMENTS_SLOT_COUNT,
  getCommentSlotsForDate,
  listCombinedCommentsInRange,
  mergeDaySlotsIntoByDate,
  normalizeCombinedCommentsStore,
  normalizeCommentSlots,
} from '../config/combinedComments.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'

const STORAGE_KEY = 'essersales_combined_comments_v2'

const store = reactive(createEmptyCombinedComments())
const hydrated = ref(false)

function applyStore(normalized) {
  // 라벨은 항상 최신 정의(폐쇄몰 추가 등) — 저장소의 구 labels 무시
  store.labels.splice(0, store.labels.length, ...COMBINED_COMMENT_LABELS)
  for (const key of Object.keys(store.byDate)) {
    delete store.byDate[key]
  }
  for (const [ymd, slots] of Object.entries(normalized.byDate || {})) {
    store.byDate[ymd] = normalizeCommentSlots(slots)
  }
}

function saveLegacyLocal(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

function loadLegacyLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeCombinedCommentsStore(JSON.parse(raw))
  } catch {
    return null
  }
}

function clearLegacyLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('essersales_combined_comments_v1_combined_daily')
    localStorage.removeItem('essersales_combined_comments_v1_combined_monthly')
  } catch {
    /* ignore */
  }
}

function shouldFallbackToLocalStorage(err) {
  const msg = String(err?.message || '')
  return (
    /invalid scope or kind|PostgreSQL API|연결할 수 없습니다|404|요청 실패/.test(msg) ||
    err?.name === 'TypeError'
  )
}

function toPersistPayload() {
  const byDate = {}
  for (const [ymd, slots] of Object.entries(store.byDate)) {
    const normalized = normalizeCommentSlots(slots)
    if (normalized.some((c) => c.trim()) || ymd === '__legacy__') {
      byDate[ymd] = normalized
    }
  }
  return {
    labels: [...COMBINED_COMMENT_LABELS],
    byDate,
  }
}

/**
 * 서버 최신 스토어 fetch (실패 시 null)
 * @returns {Promise<ReturnType<typeof normalizeCombinedCommentsStore> | null>}
 */
async function fetchLatestCombinedCommentsStore() {
  try {
    const res = await fetchAppSetting(
      COMBINED_COMMENTS_SETTING_SCOPE,
      COMBINED_COMMENTS_SETTING_KIND,
    )
    if (res?.data) return normalizeCombinedCommentsStore(res.data)
  } catch {
    /* fall through */
  }
  return null
}

/**
 * 하루 칸 merge 후 저장 — 내용 있는 칸만 반영, 공란은 서버 유지
 * @param {string} ymd
 * @param {string[]} localSlots
 * @param {{ forceClearAll?: boolean }} [opts]
 * @returns {Promise<{ mode: 'server' | 'local', warning?: string }>}
 */
async function persistDayCommentsMerged(ymd, localSlots, opts = {}) {
  const localNormalized = normalizeCommentSlots(localSlots)

  try {
    const latest = (await fetchLatestCombinedCommentsStore()) || createEmptyCombinedComments()
    const byDate = mergeDaySlotsIntoByDate(latest.byDate, ymd, localNormalized, opts)
    const payload = {
      labels: latest.labels?.length ? [...latest.labels] : [...store.labels],
      byDate,
    }

    const res = await saveAppSetting(
      COMBINED_COMMENTS_SETTING_SCOPE,
      COMBINED_COMMENTS_SETTING_KIND,
      payload,
    )
    if (res?.data) {
      applyStore(normalizeCombinedCommentsStore(res.data))
    } else {
      applyStore(normalizeCombinedCommentsStore(payload))
    }
    clearLegacyLocal()
    return { mode: 'server' }
  } catch (err) {
    if (!shouldFallbackToLocalStorage(err)) throw err

    const localBase = loadLegacyLocal() || {
      labels: [...store.labels],
      byDate: { ...store.byDate },
    }
    const byDate = mergeDaySlotsIntoByDate(localBase.byDate, ymd, localNormalized, opts)
    const payload = {
      labels: localBase.labels?.length ? [...localBase.labels] : [...store.labels],
      byDate,
    }
    applyStore(normalizeCombinedCommentsStore(payload))
    saveLegacyLocal(payload)
    return {
      mode: 'local',
      warning:
        '서버 설정 API에 아직 반영되지 않아 이 브라우저에 저장했습니다. 엑셀에는 바로 반영됩니다.',
    }
  }
}

/**
 * 서버·로컬에서 통합 코멘트 스토어 로드
 * @param {string} [_scope]
 * @param {{ forceRefresh?: boolean }} [opts]
 */
export async function hydrateCombinedCommentsForScope(_scope, opts = {}) {
  if (!opts.forceRefresh && hydrated.value) return store

  try {
    const res = await fetchAppSetting(
      COMBINED_COMMENTS_SETTING_SCOPE,
      COMBINED_COMMENTS_SETTING_KIND,
    )
    if (res?.data) {
      applyStore(normalizeCombinedCommentsStore(res.data))
      hydrated.value = true
      return store
    }
  } catch {
    /* fall through */
  }

  // 레거시 scope(combined_daily)에만 있던 데이터 이전
  try {
    const legacyRes = await fetchAppSetting('combined_daily', COMBINED_COMMENTS_SETTING_KIND)
    if (legacyRes?.data) {
      applyStore(normalizeCombinedCommentsStore(legacyRes.data))
      hydrated.value = true
      return store
    }
  } catch {
    /* fall through */
  }

  const local = loadLegacyLocal()
  if (local) applyStore(local)
  hydrated.value = true
  return store
}

/**
 * 전체 store 통째 저장 (레거시·내부용). 일별 UI 저장은 persistDayCommentsMerged 사용.
 * @returns {Promise<{ mode: 'server' | 'local', warning?: string }>}
 */
export async function persistCombinedComments() {
  const payload = toPersistPayload()

  try {
    const res = await saveAppSetting(
      COMBINED_COMMENTS_SETTING_SCOPE,
      COMBINED_COMMENTS_SETTING_KIND,
      payload,
    )
    if (res?.data) {
      applyStore(normalizeCombinedCommentsStore(res.data))
    }
    clearLegacyLocal()
    return { mode: 'server' }
  } catch (err) {
    if (!shouldFallbackToLocalStorage(err)) throw err
    saveLegacyLocal(payload)
    return {
      mode: 'local',
      warning:
        '서버 설정 API에 아직 반영되지 않아 이 브라우저에 저장했습니다. 엑셀에는 바로 반영됩니다.',
    }
  }
}

/**
 * 엑셀·스냅샷용
 * @param {string} [_scope]
 * @param {{ dateFrom?: string, dateTo?: string }} [range]
 */
export function getCombinedCommentsSnapshot(_scope, range = {}) {
  const dateFrom = range.dateFrom || ''
  const dateTo = range.dateTo || ''
  const days = listCombinedCommentsInRange(store.byDate, dateFrom, dateTo)

  // 단일일 + 해당일 비어 있으면 빈 슬롯이라도 엑셀 표 유지
  if (dateFrom && dateTo && dateFrom === dateTo) {
    const existing = days.find((d) => d.date === dateFrom)
    return {
      labels: [...COMBINED_COMMENT_LABELS],
      byDate: { [dateFrom]: existing?.comments || getCommentSlotsForDate(store.byDate, dateFrom) },
      days: [
        {
          date: dateFrom,
          comments: existing?.comments || getCommentSlotsForDate(store.byDate, dateFrom),
        },
      ],
    }
  }

  const byDate = {}
  for (const d of days) {
    const key = d.isLegacy ? '__legacy__' : d.date
    byDate[key] = d.comments
  }
  return {
    labels: [...COMBINED_COMMENT_LABELS],
    byDate,
    days,
  }
}

/**
 * @param {string} [_scope]
 * @param {{ dateFrom?: string, dateTo?: string }} [range]
 */
export function useCombinedComments(_scope, range = null) {
  if (!hydrated.value) {
    hydrateCombinedCommentsForScope(COMBINED_COMMENTS_SETTING_SCOPE).catch(() => {})
  }

  const dateFrom = computed(() => range?.dateFrom?.value ?? range?.dateFrom ?? '')
  const dateTo = computed(() => range?.dateTo?.value ?? range?.dateTo ?? '')

  const isSingleDay = computed(
    () => Boolean(dateFrom.value && dateTo.value && dateFrom.value === dateTo.value),
  )

  const editDate = computed(() => (isSingleDay.value ? dateFrom.value : ''))

  const editSlots = reactive(createEmptyCommentSlots())

  function loadEditSlots() {
    const slots = getCommentSlotsForDate(store.byDate, editDate.value)
    for (let i = 0; i < COMBINED_COMMENTS_SLOT_COUNT; i += 1) {
      editSlots[i] = slots[i] || ''
    }
  }

  watch(editDate, () => loadEditSlots(), { immediate: true })

  const rangeDays = computed(() =>
    listCombinedCommentsInRange(store.byDate, dateFrom.value, dateTo.value),
  )

  async function saveDayComments() {
    if (!editDate.value) {
      throw new Error('날짜를 하루로 지정한 뒤 저장하세요.')
    }
    const result = await persistDayCommentsMerged(editDate.value, [...editSlots])
    loadEditSlots()
    return result
  }

  async function clearDayComments() {
    if (!editDate.value) return
    const result = await persistDayCommentsMerged(editDate.value, createEmptyCommentSlots(), {
      forceClearAll: true,
    })
    for (let i = 0; i < COMBINED_COMMENTS_SLOT_COUNT; i += 1) editSlots[i] = ''
    return result
  }

  function resetEditSlots() {
    for (let i = 0; i < COMBINED_COMMENTS_SLOT_COUNT; i += 1) editSlots[i] = ''
  }

  return {
    store,
    hydrated,
    slotCount: COMBINED_COMMENTS_SLOT_COUNT,
    isSingleDay,
    editDate,
    editSlots,
    rangeDays,
    saveDayComments,
    clearDayComments,
    resetEditSlots,
    loadEditSlots,
  }
}

/** @deprecated 호환 — persistCombinedComments 사용 */
export async function persistCombinedCommentsForScope(_scope) {
  return persistCombinedComments()
}
