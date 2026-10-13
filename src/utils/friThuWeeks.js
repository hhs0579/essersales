/**
 * 통합 주간 — 금~목 로컬 주차 (달 기준, ISO 주와 무관)
 * 예: 2026-09 → 1주차(9.1~9.3), 2주차(9.4~9.10), …
 */

const WEEK_KEY_RE = /^(\d{4})-(\d{2})-W([1-6])$/

/** @param {number} y @param {number} m0 0-based @param {number} day */
function ymd(y, m0, day) {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** @param {string} ymdStr */
function parseYmd(ymdStr) {
  const m = String(ymdStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { y: Number(m[1]), m0: Number(m[2]) - 1, d: Number(m[3]) }
}

/** @param {number} y @param {number} m0 @param {number} day */
function weekdaySun0(y, m0, day) {
  return new Date(y, m0, day).getDay()
}

/** 표시용 M.D (앞자리 0 없음) */
export function formatMdLabel(ymdStr) {
  const p = parseYmd(ymdStr)
  if (!p) return String(ymdStr || '')
  return `${p.m0 + 1}.${p.d}`
}

/**
 * @param {number} weekIndex 1..6
 * @param {string} fromYmd
 * @param {string} toYmd
 */
export function formatFriThuWeekTabLabel(weekIndex, fromYmd, toYmd) {
  return `${weekIndex}주차(${formatMdLabel(fromYmd)}~${formatMdLabel(toYmd)})`
}

/**
 * @param {string} monthKey YYYY-MM
 * @param {number} weekIndex 1..6
 */
export function friThuWeekKey(monthKey, weekIndex) {
  const mk = String(monthKey || '').trim()
  const n = Number(weekIndex)
  if (!/^\d{4}-\d{2}$/.test(mk) || !Number.isInteger(n) || n < 1 || n > 6) return ''
  return `${mk}-W${n}`
}

/** @param {string} weekKey */
export function parseFriThuWeekKey(weekKey) {
  const m = String(weekKey || '').trim().match(WEEK_KEY_RE)
  if (!m) return null
  return { monthKey: `${m[1]}-${m[2]}`, weekIndex: Number(m[3]) }
}

/**
 * 해당 연월의 금~목 주차 목록 (최대 6)
 * @param {string} monthKey YYYY-MM
 * @returns {Array<{ weekIndex: number, weekKey: string, from: string, to: string, label: string }>}
 */
export function listFriThuWeeksInMonth(monthKey) {
  const mk = String(monthKey || '').trim()
  const mm = mk.match(/^(\d{4})-(\d{2})$/)
  if (!mm) return []
  const y = Number(mm[1])
  const m0 = Number(mm[2]) - 1
  if (m0 < 0 || m0 > 11) return []

  const lastDay = new Date(y, m0 + 1, 0).getDate()
  /** @type {Array<{ weekIndex: number, weekKey: string, from: string, to: string, label: string }>} */
  const weeks = []

  // 1주: 1일 ~ 그달 첫 목요일 (목=4)
  const dow1 = weekdaySun0(y, m0, 1)
  // days until Thursday: (4 - dow1 + 7) % 7; if already Thu, 0
  const daysToFirstThu = (4 - dow1 + 7) % 7
  let weekEnd = 1 + daysToFirstThu
  if (weekEnd > lastDay) weekEnd = lastDay

  let fromDay = 1
  let toDay = weekEnd
  weeks.push(makeWeek(mk, 1, y, m0, fromDay, toDay))

  // 이후: 다음 금요일 ~ 목요일
  let nextFri = toDay + 1
  let index = 2
  while (nextFri <= lastDay && index <= 6) {
    fromDay = nextFri
    // Friday + 6 days = Thursday
    toDay = Math.min(fromDay + 6, lastDay)
    weeks.push(makeWeek(mk, index, y, m0, fromDay, toDay))
    nextFri = toDay + 1
    index += 1
  }

  return weeks
}

function makeWeek(monthKey, weekIndex, y, m0, fromDay, toDay) {
  const from = ymd(y, m0, fromDay)
  const to = ymd(y, m0, toDay)
  return {
    weekIndex,
    weekKey: friThuWeekKey(monthKey, weekIndex),
    from,
    to,
    label: formatFriThuWeekTabLabel(weekIndex, from, to),
  }
}

/**
 * 사용자가 저장한 주차 기간으로 주차 목록 생성 (주차 번호 = 순서)
 * @param {string} monthKey YYYY-MM
 * @param {Array<{ from: string, to: string }>} periods
 */
export function buildWeeksFromPeriods(monthKey, periods) {
  const mk = String(monthKey || '').trim()
  if (!/^\d{4}-\d{2}$/.test(mk) || !Array.isArray(periods)) return []
  return periods.slice(0, 6).map((p, i) => {
    const weekIndex = i + 1
    return {
      weekIndex,
      weekKey: friThuWeekKey(mk, weekIndex),
      from: p.from,
      to: p.to,
      label: formatFriThuWeekTabLabel(weekIndex, p.from, p.to),
    }
  })
}

/**
 * 주차 기간 검증 — 시작≤종료, 날짜 순서대로, 겹치지 않음, 1~6개
 * @param {Array<{ from: string, to: string }>} periods
 * @returns {string} 오류 메시지 (정상이면 '')
 */
export function validateWeekPeriods(periods) {
  if (!Array.isArray(periods) || !periods.length) return '주차가 최소 1개 있어야 합니다.'
  if (periods.length > 6) return '주차는 최대 6개까지입니다.'
  for (let i = 0; i < periods.length; i += 1) {
    const { from, to } = periods[i] || {}
    if (!parseYmd(from) || !parseYmd(to)) return `${i + 1}주차 날짜를 입력하세요.`
    if (from > to) return `${i + 1}주차 시작일이 종료일보다 늦습니다.`
    if (i > 0 && from <= periods[i - 1].to) {
      return `${i + 1}주차가 ${i}주차와 겹치거나 순서가 바뀌었습니다.`
    }
  }
  return ''
}

/**
 * @param {string} monthKey
 * @param {number} weekIndex
 */
export function getFriThuWeekInMonth(monthKey, weekIndex) {
  return listFriThuWeeksInMonth(monthKey).find((w) => w.weekIndex === weekIndex) || null
}
