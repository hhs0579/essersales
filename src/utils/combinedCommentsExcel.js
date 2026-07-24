import {
  COMBINED_COMMENT_LABELS,
  COMBINED_COMMENTS_SLOT_COUNT,
  listCombinedCommentsInRange,
} from '../config/combinedComments.js'

/**
 * @param {{
 *   labels?: string[],
 *   comments?: string[],
 *   byDate?: Record<string, string[]>,
 *   days?: { date: string, comments: string[], isLegacy?: boolean }[],
 * } | null | undefined} data
 * @returns {string[][]}
 */
export function buildCombinedCommentsExcelBlock(data) {
  const labels = data?.labels?.length ? data.labels : COMBINED_COMMENT_LABELS
  const rows = []
  rows.push(['■ 통합 담당 코멘트'])

  const days =
    data?.days ||
    listCombinedCommentsInRange(data?.byDate || {}, '', '') ||
    []

  // 레거시 단일 comments[] (날짜 없음)
  if (!days.length && Array.isArray(data?.comments)) {
    for (let i = 0; i < COMBINED_COMMENTS_SLOT_COUNT; i += 1) {
      rows.push([labels[i], data.comments[i] != null ? String(data.comments[i]) : ''])
    }
    rows.push([])
    return rows
  }

  if (!days.length) {
    for (let i = 0; i < COMBINED_COMMENTS_SLOT_COUNT; i += 1) {
      rows.push([labels[i], ''])
    }
    rows.push([])
    return rows
  }

  for (const day of days) {
    const title = day.isLegacy || !day.date ? '날짜 미지정(이전 저장)' : day.date
    rows.push([`■ ${title}`])
    for (let i = 0; i < COMBINED_COMMENTS_SLOT_COUNT; i += 1) {
      const cell = day.comments?.[i] != null ? String(day.comments[i]) : ''
      rows.push([labels[i], cell])
    }
    rows.push([])
  }

  return rows
}
