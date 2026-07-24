/** 매출 리포트 — 데이터는 전일(어제)까지 기준 */

export function formatYmdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** @param {number} [days=0] 오늘 기준 일수 오프셋 */
export function offsetYmdFromToday(days = 0) {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return formatYmdLocal(d)
}

export function yesterdayYmd() {
  return offsetYmdFromToday(-1)
}

/** 조회 가능한 마지막 일자 = 어제 */
export function maxReportDateYmd() {
  return yesterdayYmd()
}

/** 기본 조회: 최근 7일(어제 포함) */
export function defaultReportDateRange() {
  return {
    dateFrom: offsetYmdFromToday(-7),
    dateTo: yesterdayYmd(),
  }
}

/** @param {string} ymd */
export function clampToMaxReportDate(ymd) {
  const max = maxReportDateYmd()
  if (!ymd) return max
  return ymd > max ? max : ymd
}
