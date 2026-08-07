/**
 * 스토어명 집계용 정규화 (통합 리포트·스토어별 합산)
 * — 상세 표 표시에는 쓰지 말 것 (원문 스토어명 유지)
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

  // 사본느리 구 표기만 묶음. 에쎄르(특판·브랜드)는 사본느리로 바꾸지 않음
  if (/사본느리/i.test(compact) || /드니옹/i.test(compact)) {
    return '사본느리'
  }

  if (/에쎄르/i.test(compact)) {
    return '에쎄르'
  }

  return s
}

/** @param {object} row */
export function storeLabelFromRow(row) {
  const raw = String(row?.storeName || row?.brand || '').trim() || '미지정'
  if (raw === '미지정') return raw
  return normalizeStoreLabel(raw, row)
}
