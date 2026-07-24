/**
 * ISO 날짜(YYYY-MM-DD)만 10자 절단 — "2026. 6. 30" 등 한글·점 형식은 그대로 유지
 * @param {string | Date | null | undefined} val
 */
export function toLegacyDateString(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'string') {
    const s = val.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    return s
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10)
  }
  return String(val)
}

/** multipart 업로드 파일명 — latin1 → UTF-8 (한글 파일명 깨짐 방지) */
export function decodeMultipartFilename(name) {
  if (!name) return ''
  try {
    const decoded = Buffer.from(String(name), 'latin1').toString('utf8')
    if (decoded.includes('\uFFFD')) return String(name)
    return decoded
  } catch {
    return String(name)
  }
}
