import { maxReportDateYmd } from './reportDateRange.js'

/** @typedef {'daily' | 'monthly'} ManualEntryPeriodMode */

/** @param {object} [filterCtx] */
export function isDailyFilterSingleDay(filterCtx) {
  const { dateFrom, dateTo } = filterCtx || {}
  return Boolean(dateFrom && dateTo && dateFrom === dateTo)
}

/** @param {object} [filterCtx] */
export function resolveManualEntryMonthStart(filterCtx) {
  const { year, month, dateFrom, dateTo } = filterCtx || {}
  if (year && month) {
    return `${year}-${String(month).padStart(2, '0')}-01`
  }
  if (!dateFrom || !dateTo) return ''
  if (dateFrom.slice(0, 7) !== dateTo.slice(0, 7)) return ''
  return `${dateFrom.slice(0, 7)}-01`
}

/**
 * 수기 입력(발주·판매·광고) 기본 일자 — 조회 기간에서 유도
 * 일별: 단일일 → 그 날, 기간 → 종료일(최근일)
 * @param {object} [filterCtx]
 * @param {ManualEntryPeriodMode} [mode]
 */
export function resolveManualEntryDefaultDate(filterCtx, mode = 'daily') {
  const ctx = filterCtx || {}
  if (mode === 'monthly') {
    const monthStart = resolveManualEntryMonthStart(ctx)
    if (monthStart) return monthStart
    const { year, month, dateFrom, dateTo } = ctx
    if (year && month) return `${year}-${String(month).padStart(2, '0')}-01`
    if (dateFrom && dateTo && dateFrom.slice(0, 7) === dateTo.slice(0, 7)) {
      return `${dateFrom.slice(0, 7)}-01`
    }
    return ''
  }
  if (isDailyFilterSingleDay(ctx)) return ctx.dateFrom
  if (ctx.dateTo) return ctx.dateTo
  if (ctx.dateFrom) return ctx.dateFrom
  return maxReportDateYmd()
}

/** @param {object} [filterCtx] @param {ManualEntryPeriodMode} [mode] */
export function resolveManualEntryDateSuggest(filterCtx, mode = 'daily') {
  return resolveManualEntryDefaultDate(filterCtx, mode)
}

/**
 * 조회 기간이 바뀔 때 빈 일자 행에 기본값 적용
 * @param {Array<{ date?: string }>} rows
 * @param {object} filterCtx
 * @param {ManualEntryPeriodMode} [mode]
 */
export function applyManualEntryDefaultToEmptyRows(rows, filterCtx, mode = 'daily') {
  const date = resolveManualEntryDefaultDate(filterCtx, mode)
  if (!date) return
  for (const row of rows || []) {
    if (!String(row?.date || '').trim()) row.date = date
  }
}
