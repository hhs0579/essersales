/**
 * 스토어명 표시·집계용 정규화
 * — 통합 리포트에서 동일 브랜드의 다른 표기를 하나로 묶음
 */

function compactLabel(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
}

/** @param {string} raw @param {object} [row] */
export function normalizeStoreLabel(raw, row = null) {
  const s = String(raw || '').trim()
  if (!s || s === '미지정') return s

  const compact = compactLabel(s)

  if (/베스트하임/i.test(compact) || /주식회사.*베스트하임/i.test(compact)) {
    return '베스트하임'
  }

  if (/사본느리/i.test(compact) || /드니옹/i.test(compact) || /에쎄르/i.test(compact)) {
    return '사본느리'
  }

  return s
}

/** @param {object} row */
export function storeLabelFromRow(row) {
  const raw = String(row?.storeName || row?.brand || '').trim() || '미지정'
  if (raw === '미지정') return raw
  return normalizeStoreLabel(raw, row)
}
