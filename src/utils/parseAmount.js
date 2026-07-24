/**
 * 엑셀·수기 입력 숫자 파싱 (콤마, %, 괄호 음수, 원·₩·￦·KRW)
 */
export function parseAmount(val) {
  if (val == null || val === '') return 0
  let s = String(val).trim()
  if (!s || s === '-' || s === '–') return 0

  const negative = /^\(.*\)$/.test(s)
  if (negative) s = s.slice(1, -1)

  s = s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  s = s.replace(/,/g, '').replace(/%/g, '').replace(/\s/g, '')
  s = s.replace(/[원₩￦$]|won|krw|원화/gi, '')
  if (!s) return 0

  const n = Number(s)
  if (!Number.isFinite(n)) return 0
  return negative ? -n : n
}

/** 수기 광고 금액 — 파싱 후 정수 문자열 (0이면 빈 문자열) */
export function formatManualAdAmount(val) {
  const n = parseAmount(val)
  if (!Number.isFinite(n) || n === 0) return ''
  return String(Math.round(Math.abs(n)))
}

/** 수기 금액 — 음수 부호 유지 (특판 마진 등) */
export function formatSignedManualAdAmount(val) {
  if (val == null || val === '') return ''
  const s = String(val).trim()
  if (s === '-' || s === '–' || s === '−') return '-'
  const n = parseAmount(val)
  if (!Number.isFinite(n) || n === 0) return ''
  return String(Math.round(n))
}

/** 특판 마진율 — 소수·% 허용 (0이면 빈 문자열) */
export function formatSpecialSaleRate(val) {
  const n = parseAmount(val)
  if (!Number.isFinite(n) || n === 0) return ''
  const rounded = Math.round(Math.abs(n) * 100) / 100
  return String(rounded)
}

/** 빈 문자열('')도 없음으로 — Firestore/엑셀 별칭 필드 폴백용 */
export function coalesceField(obj, ...keys) {
  if (!obj) return ''
  for (const key of keys) {
    const v = obj[key]
    if (v != null && String(v).trim() !== '') return v
  }
  return ''
}

export function firstAmount(obj, ...keys) {
  return parseAmount(coalesceField(obj, ...keys))
}
