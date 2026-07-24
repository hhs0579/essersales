const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function fromYmd(year, month, day) {
  const date = new Date(year, month - 1, day)
  if (isNaN(date.getTime())) return null
  return {
    year,
    month,
    day,
    dayOfWeek: date.getDay(),
    weekdayLabel: WEEKDAY_LABELS[date.getDay()],
    date,
  }
}

/** 엑셀 일련번호(44927 등) → 날짜 */
function fromExcelSerial(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n) || n < 1 || n > 60000) return null
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000
  const d = new Date(utc)
  return fromYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** "2026. 3. 3" 등 매출 리포트 날짜 문자열 파싱 */
export function parseSalesDate(str) {
  if (str == null || str === '') return null

  if (str instanceof Date && !isNaN(str.getTime())) {
    return fromYmd(str.getFullYear(), str.getMonth() + 1, str.getDate())
  }

  const s = String(str).trim()
  if (!s || s === '-' || s === '–') return null

  const asNum = Number(s)
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 80000 && !s.includes('.')) {
    const fromSerial = fromExcelSerial(asNum)
    if (fromSerial) return fromSerial
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    return fromYmd(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10))
  }

  const dotted = s.match(/(\d{4})\s*[.\-/년．]\s*(\d{1,2})\s*[.\-/월．]?\s*(\d{1,2})/)
  if (dotted) {
    return fromYmd(parseInt(dotted[1], 10), parseInt(dotted[2], 10), parseInt(dotted[3], 10))
  }

  const naverPeriod = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\.?(?:\([^)]*\))?$/)
  if (naverPeriod) {
    return fromYmd(
      parseInt(naverPeriod[1], 10),
      parseInt(naverPeriod[2], 10),
      parseInt(naverPeriod[3], 10),
    )
  }

  const slash = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/)
  if (slash) {
    return fromYmd(parseInt(slash[1], 10), parseInt(slash[2], 10), parseInt(slash[3], 10))
  }

  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) {
    return fromYmd(parseInt(compact[1], 10), parseInt(compact[2], 10), parseInt(compact[3], 10))
  }

  const m = s.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/)
  if (!m) return null
  return fromYmd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10))
}

/** 엑셀 셀 값 → 표시용 "YYYY. M. D" 또는 파싱 실패 시 원문 */
export function normalizeExcelDateValue(val) {
  if (val == null || val === '') return ''
  const parsed = parseSalesDate(val)
  if (parsed) return `${parsed.year}. ${parsed.month}. ${parsed.day}`
  return String(val).trim()
}

/** 파일명에서 YYYY-MM-DD 목록 (빅셀: ..._20260501_20260601, 일자20260601) */
export function parseFilenameCompactDates(fileName) {
  const out = []
  const seen = new Set()
  for (const m of String(fileName).matchAll(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/g)) {
    const ymd = `${m[1]}-${m[2]}-${m[3]}`
    if (!seen.has(ymd)) {
      seen.add(ymd)
      out.push(ymd)
    }
  }
  return out.sort()
}

/**
 * 파일명 날짜 해석
 * - 하루: …20260601.xlsx, 일자20260601, …20260531_20260531 (같은 날 2번)
 * - 기간: …20260501_20260601 (서로 다른 날짜 2개)
 */
export function parseFilenameDateSpec(fileName) {
  const dates = parseFilenameCompactDates(fileName)
  if (dates.length === 0) {
    return { type: 'unknown' }
  }
  if (dates.length === 1 || (dates.length >= 2 && dates[0] === dates[dates.length - 1])) {
    return { type: 'day', date: dates[0] }
  }
  return { type: 'range', from: dates[0], to: dates[dates.length - 1] }
}

export function isFilenameDateRange(fileName) {
  return parseFilenameDateSpec(fileName).type === 'range'
}

export function formatPeriodLabel(fromYmd, toYmd) {
  const f = parseSalesDate(fromYmd)
  const t = parseSalesDate(toYmd || fromYmd)
  if (f && t) {
    if (f.year === t.year && f.month === t.month && f.day === t.day) {
      return `${f.year}. ${f.month}. ${f.day}`
    }
    return `${f.year}. ${f.month}. ${f.day} ~ ${t.year}. ${t.month}. ${t.day}`
  }
  return fromYmd && toYmd ? `${fromYmd} ~ ${toYmd}` : fromYmd || toYmd || ''
}

export function getWeekdayLabel(dayOfWeek) {
  return WEEKDAY_LABELS[dayOfWeek] ?? ''
}

/** M.D / M-D (연도 생략) — defaultYear 필요 */
export function parseMonthDayLabel(str, defaultYear) {
  const s = String(str || '').trim()
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})$/)
  if (!m || !defaultYear) return null
  return fromYmd(Number(defaultYear), parseInt(m[1], 10), parseInt(m[2], 10))
}

/** 일별 집계·표시용 YYYY-MM-DD (형식 혼합 시 동일 일자 병합) */
export function toDayKey(str, defaultYear) {
  const raw = String(str || '').trim()
  const p = parseSalesDate(raw) || (defaultYear ? parseMonthDayLabel(raw, defaultYear) : null)
  if (!p) return raw
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export { WEEKDAY_LABELS }
