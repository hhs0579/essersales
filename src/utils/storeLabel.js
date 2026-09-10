/**
 * 스토어명 집계용 정규화 (통합 리포트·스토어별 합산)
 * — 상세 표 표시에는 쓰지 말 것 (원문 스토어명 유지)
 */

function compactLabel(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
}

/** @param {object | null | undefined} row */
function isEsserStoreRow(row) {
  if (!row) return false
  if (row.coupang1pBrandKey === 'esser') return true
  if (/에쎄르/i.test(String(row.brand || ''))) return true
  if (/에쎄르/i.test(String(row.storeName || ''))) return true
  return false
}

/** @param {string} raw @param {object} [row] */
export function normalizeStoreLabel(raw, row = null) {
  if (isEsserStoreRow(row)) return '에쎄르'

  const s = String(raw || '').trim()
  if (!s || s === '미지정') return s

  const compact = compactLabel(s)

  if (/베스트하임/i.test(compact) || /주식회사.*베스트하임/i.test(compact)) {
    return '베스트하임'
  }

  if (/에쎄르/i.test(compact) || /사본느리/i.test(compact) || /드니옹/i.test(compact)) {
    return '에쎄르'
  }

  return s
}

/** @param {object} row */
export function storeLabelFromRow(row) {
  if (isEsserStoreRow(row)) return '에쎄르'

  const raw = String(row?.storeName || row?.brand || '').trim() || '미지정'
  if (raw === '미지정') {
    const src = String(row?.dataSourceLabel || '').trim()
    if (src) return normalizeStoreLabel(src, row)
    return raw
  }
  return normalizeStoreLabel(raw, row)
}
