/** 쿠팡 1P 로켓배송 발주 — 베스트하임 직접 입력 */

export const COUPANG_1P_ROCKET_SCOPE = 'coupang_1p_rocket'
export const COUPANG_1P_ROCKET_UPLOAD_KIND = 'coupang_1p_rocket_manual'
export const COUPANG_1P_ROCKET_DATA_SOURCE_LABEL = '쿠팡 1P 로켓'
export const COUPANG_1P_SALES_METHOD = '1P 로켓'

/** @param {object} row */
export function isCoupang1pRocketRecord(row) {
  if (!row) return false
  return (
    row.scope === COUPANG_1P_ROCKET_SCOPE ||
    row.uploadKind === COUPANG_1P_ROCKET_UPLOAD_KIND ||
    row.dataSourceLabel === COUPANG_1P_ROCKET_DATA_SOURCE_LABEL ||
    row.uploadFormat === 'coupang_1p_rocket_manual'
  )
}

/** 쿠팡 1P KPI·엑셀 — 쿠팡 단일 행, 광고매출·자연매출 등 제외 */
export const COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS = [
  'aov',
  'adSales',
  'organicSales',
  'organicSalesRate',
  'salesRoas',
  'roas',
]

/**
 * @typedef {Object} Coupang1pProduct
 * @property {string} id
 * @property {string} name — 상품명
 * @property {string} option — 옵션
 * @property {string} purchasePrice — 쿠팡 매입단가 (쿠팡이 우리에게 지급)
 * @property {string} supplyPrice — 공급원가 (우리 원가 단가)
 */

/**
 * @typedef {Object} Coupang1pOrderEntry
 * @property {string} id
 * @property {string} date — 발주일 YYYY-MM-DD
 * @property {string} productId
 * @property {string} quantity — 발주수량
 */

/** @returns {string} */
function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `c1p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** @returns {Coupang1pProduct} */
export function createCoupang1pProduct() {
  return {
    id: newId(),
    name: '',
    option: '',
    purchasePrice: '',
    supplyPrice: '',
  }
}

/** @returns {Coupang1pOrderEntry} */
export function createCoupang1pOrderEntry(defaultDate = '') {
  return {
    id: newId(),
    date: defaultDate || '',
    productId: '',
    quantity: '1',
  }
}

/** @returns {{ products: Coupang1pProduct[], orders: Coupang1pOrderEntry[] }} */
export function createEmptyCoupang1pStore() {
  return { products: [], orders: [] }
}

/** @param {Coupang1pProduct} product */
export function coupang1pProductDisplayName(product) {
  if (!product) return ''
  const name = String(product.name || '').trim()
  const opt = String(product.option || '').trim()
  if (name && opt) return `${name} / ${opt}`
  return name || opt
}
