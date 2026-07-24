/** 파워프라이스 — 직접 입력 채널 */

export const POWER_PRICE_SCOPE = 'power_price'
export const POWER_PRICE_UPLOAD_KIND = 'power_price_manual'
/** 통합 탭 출처·엑셀 브랜드 라벨 */
export const POWER_PRICE_DATA_SOURCE_LABEL = '파워프라이스'

/** @param {object} row */
export function isPowerPriceRecord(row) {
  if (!row) return false
  return (
    row.scope === POWER_PRICE_SCOPE ||
    row.uploadKind === POWER_PRICE_UPLOAD_KIND ||
    row.dataSourceLabel === POWER_PRICE_DATA_SOURCE_LABEL ||
    row.brand === POWER_PRICE_DATA_SOURCE_LABEL
  )
}

/** 판매수수료 + 배송료 — 매출 대비 7% */
export const POWER_PRICE_PLATFORM_FEE_RATE = 0.07

/** 파워프라이스 KPI·엑셀 — 숨길 지표 없음 (수동 전환매출·자연매출·객단가·ROAS 모두 표시) */
export const POWER_PRICE_HIDDEN_KPI_KEYS = []

/**
 * @typedef {Object} PowerPriceProduct
 * @property {string} id
 * @property {string} name
 * @property {string} salePrice
 * @property {string} unitCost
 */

/**
 * @typedef {Object} PowerPriceSaleEntry
 * @property {string} id
 * @property {string} date YYYY-MM-DD
 * @property {string} productId
 * @property {string} quantity
 * @property {string} optionPrice — 판매 행별 옵션 추가금(단가)
 */

/** @returns {string} */
function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `pp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** @returns {PowerPriceProduct} */
export function createPowerPriceProduct() {
  return {
    id: newId(),
    name: '',
    salePrice: '',
    unitCost: '',
  }
}

/** @returns {PowerPriceSaleEntry} */
export function createPowerPriceSaleEntry(defaultDate = '') {
  return {
    id: newId(),
    date: defaultDate || '',
    productId: '',
    quantity: '1',
    optionPrice: '',
  }
}

/** @returns {{ products: PowerPriceProduct[], sales: PowerPriceSaleEntry[] }} */
export function createEmptyPowerPriceStore() {
  return { products: [], sales: [] }
}
