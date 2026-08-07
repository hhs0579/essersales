/** 통합 코멘트 — 담당 구분별 · 날짜별 저장 (엑셀 ①요약리포트 포함) */

export const COMBINED_COMMENT_LABELS = [
  '베스트하임',
  '사본느리',
  '파워프라이스',
  '폐쇄몰',
  '마케팅',
]

/** 레거시 저장(4칸) — 마케팅이 index 3이던 시절 */
const LEGACY_COMMENT_SLOT_COUNT = 4

export const COMBINED_COMMENTS_SLOT_COUNT = COMBINED_COMMENT_LABELS.length

export const COMBINED_COMMENTS_SETTING_KIND = 'combined_comments'

/** app_settings scope — 일별 byDate 단일 저장소 */
export const COMBINED_COMMENTS_SETTING_SCOPE = 'combined_comments'

export const COMBINED_COMMENTS_ROW_LABEL = '코멘트'

/**
 * @deprecated 레거시 hydrate용 — 신규는 COMBINED_COMMENTS_SETTING_SCOPE 사용
 * @param {string} scope
 */
export function combinedCommentScopeFor(scope) {
  if (
    scope === 'combined_daily' ||
    scope === 'combined_monthly' ||
    scope === COMBINED_COMMENTS_SETTING_SCOPE
  ) {
    return COMBINED_COMMENTS_SETTING_SCOPE
  }
  return scope
}

/** @returns {string[]} */
export function createEmptyCommentSlots() {
  return Array(COMBINED_COMMENTS_SLOT_COUNT).fill('')
}

/**
 * @returns {{ labels: string[], byDate: Record<string, string[]> }}
 */
export function createEmptyCombinedComments() {
  return {
    labels: [...COMBINED_COMMENT_LABELS],
    byDate: {},
  }
}

/** @param {string[] | undefined} slots */
export function commentSlotsHaveContent(slots) {
  return (slots || []).some((c) => String(c || '').trim())
}

/** @param {{ byDate?: Record<string, string[]>, comments?: string[] } | null | undefined} data */
export function combinedCommentsHasContent(data) {
  if (!data) return false
  if (commentSlotsHaveContent(data.comments)) return true
  return Object.values(data.byDate || {}).some((slots) => commentSlotsHaveContent(slots))
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function slotToString(v) {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

/**
 * @param {string[]} slots
 * @returns {string[]}
 */
export function normalizeCommentSlots(slots) {
  const src = Array.isArray(slots) ? slots : []
  // 레거시 4칸 [BH, SBN, PP, 마케팅] → 폐쇄몰(빈칸) 끼워 넣고 마케팅을 끝으로
  if (src.length === LEGACY_COMMENT_SLOT_COUNT && COMBINED_COMMENTS_SLOT_COUNT === 5) {
    return [
      slotToString(src[0]),
      slotToString(src[1]),
      slotToString(src[2]),
      '',
      slotToString(src[3]),
    ]
  }
  return COMBINED_COMMENT_LABELS.map((_, i) => slotToString(src[i]))
}

/**
 * 동시 저장용 merge — 로컬에서 내용이 있는 칸만 반영, 공란은 server 유지
 * @param {string[]} serverSlots
 * @param {string[]} localSlots
 * @param {{ forceClearAll?: boolean }} [opts]
 * @returns {string[]}
 */
export function mergeCommentSlotsPreferFilled(serverSlots, localSlots, opts = {}) {
  const server = normalizeCommentSlots(serverSlots)
  const local = normalizeCommentSlots(localSlots)
  if (opts.forceClearAll) {
    return createEmptyCommentSlots()
  }
  return server.map((serverVal, i) => {
    const localVal = local[i] ?? ''
    if (String(localVal).trim()) return String(localVal)
    return serverVal
  })
}

/**
 * 서버 최신 byDate에 하루·칸 merge (다른 날짜는 서버 그대로)
 * @param {Record<string, string[]>} serverByDate
 * @param {string} ymd
 * @param {string[]} localSlots
 * @param {{ forceClearAll?: boolean }} [opts]
 * @returns {Record<string, string[]>}
 */
export function mergeDaySlotsIntoByDate(serverByDate, ymd, localSlots, opts = {}) {
  const next = {}
  for (const [key, slots] of Object.entries(serverByDate || {})) {
    next[key] = normalizeCommentSlots(slots)
  }
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return next

  if (opts.forceClearAll) {
    delete next[ymd]
    return next
  }

  const merged = mergeCommentSlotsPreferFilled(next[ymd], localSlots)
  if (merged.some((c) => String(c).trim())) next[ymd] = merged
  else delete next[ymd]
  return next
}

/**
 * @param {unknown} raw
 * @returns {{ labels: string[], byDate: Record<string, string[]> }}
 */
export function normalizeCombinedCommentsStore(raw) {
  const base = createEmptyCombinedComments()
  if (!raw || typeof raw !== 'object') return base
  const o = /** @type {Record<string, unknown>} */ (raw)

  if (o.byDate && typeof o.byDate === 'object' && !Array.isArray(o.byDate)) {
    for (const [ymd, slots] of Object.entries(/** @type {Record<string, unknown>} */ (o.byDate))) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue
      base.byDate[ymd] = normalizeCommentSlots(/** @type {string[]} */ (slots))
    }
  }

  // 레거시: 날짜 없이 comments[] 한 세트만 있던 경우 → __legacy__ 키로 보존
  if (Array.isArray(o.comments) && commentSlotsHaveContent(/** @type {string[]} */ (o.comments))) {
    if (!Object.keys(base.byDate).length) {
      base.byDate.__legacy__ = normalizeCommentSlots(/** @type {string[]} */ (o.comments))
    }
  }

  return base
}

/**
 * @param {Record<string, string[]>} byDate
 * @param {string} dateFrom
 * @param {string} dateTo
 * @returns {{ date: string, comments: string[], isLegacy?: boolean }[]}
 */
export function listCombinedCommentsInRange(byDate, dateFrom = '', dateTo = '') {
  const entries = Object.entries(byDate || {})
    .filter(([key, slots]) => commentSlotsHaveContent(slots))
    .map(([key, slots]) => ({
      date: key === '__legacy__' ? '' : key,
      comments: normalizeCommentSlots(slots),
      isLegacy: key === '__legacy__',
    }))

  const dated = entries.filter((e) => e.date)
  const legacy = entries.filter((e) => e.isLegacy)

  dated.sort((a, b) => a.date.localeCompare(b.date))

  if (!dateFrom && !dateTo) {
    return [...dated, ...legacy]
  }

  const filtered = dated.filter((e) => {
    if (dateFrom && e.date < dateFrom) return false
    if (dateTo && e.date > dateTo) return false
    return true
  })

  // 기간 조회 시 레거시(날짜 없음)는 제외 — 일별만 표시
  return filtered
}

/**
 * @param {Record<string, string[]>} byDate
 * @param {string} ymd
 * @returns {string[]}
 */
export function getCommentSlotsForDate(byDate, ymd) {
  if (!ymd) return createEmptyCommentSlots()
  return normalizeCommentSlots(byDate?.[ymd])
}
