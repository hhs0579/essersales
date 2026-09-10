/** 쿠팡 1P 로켓배송 발주 — 베스트하임·에쎄르 직접 입력 (플랫폼 업로드) */

export const COUPANG_1P_ROCKET_SCOPE = 'coupang_1p_rocket'
export const COUPANG_1P_ROCKET_UPLOAD_KIND = 'coupang_1p_rocket_manual'
export const COUPANG_1P_ROCKET_DATA_SOURCE_LABEL = '쿠팡 1P 로켓'
export const COUPANG_1P_SALES_METHOD = '1P 로켓'
export const COUPANG_1P_ROCKET_SETTING_KIND = 'coupang_1p_rocket'

/** @typedef {'bestheim'|'esser'} Coupang1pBrandKey */

/**
 * @typedef {Object} Coupang1pBrandDef
 * @property {Coupang1pBrandKey} key
 * @property {string} tabLabel
 * @property {string} recordBrand 행 brand 필드
 * @property {string} dataSourceLabel KPI·통합 라벨 (에쎄르→사본느리)
 */

/** @type {Coupang1pBrandDef[]} */
export const COUPANG_1P_ROCKET_BRANDS = [
  {
    key: 'bestheim',
    tabLabel: '베스트하임',
    recordBrand: '베스트하임',
    dataSourceLabel: '베스트하임',
  },
  {
    key: 'esser',
    tabLabel: '에쎄르',
    recordBrand: '에쎄르',
    dataSourceLabel: '사본느리',
  },
]

/** @param {Coupang1pBrandKey|string} key */
export function getCoupang1pBrand(key) {
  return COUPANG_1P_ROCKET_BRANDS.find((b) => b.key === key) || COUPANG_1P_ROCKET_BRANDS[0]
}

/** @param {object} row */
export function coupang1pBrandKeyFromRow(row) {
  if (!row) return 'bestheim'
  const tagged = String(row.coupang1pBrandKey || '').trim()
  if (tagged === 'esser' || tagged === 'bestheim') return tagged
  const brand = String(row.brand || '').trim()
  if (brand === '에쎄르' || brand === '사본느리') return 'esser'
  return 'bestheim'
}

/** @param {object} row */
export function isEsserCoupang1pRow(row) {
  return isCoupang1pRocketRecord(row) && coupang1pBrandKeyFromRow(row) === 'esser'
}

/** @param {object} row */
export function isBestheimCoupang1pRow(row) {
  return isCoupang1pRocketRecord(row) && coupang1pBrandKeyFromRow(row) === 'bestheim'
}

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

/** @returns {Record<Coupang1pBrandKey, { products: Coupang1pProduct[], orders: Coupang1pOrderEntry[] }>} */
export function createEmptyCoupang1pMultiStore() {
  return {
    bestheim: createEmptyCoupang1pStore(),
    esser: createEmptyCoupang1pStore(),
  }
}

/**
 * 서버·로컬 저장 형식 — brands 래퍼 (레거시 flat은 hydrate 시 bestheim으로 이전)
 * @returns {{ brands: Record<Coupang1pBrandKey, { products: Coupang1pProduct[], orders: Coupang1pOrderEntry[] }> }}
 */
export function createEmptyCoupang1pPersistPayload() {
  return { brands: createEmptyCoupang1pMultiStore() }
}

/** @param {Coupang1pProduct} product */
export function coupang1pProductDisplayName(product) {
  if (!product) return ''
  const name = String(product.name || '').trim()
  const opt = String(product.option || '').trim()
  if (name && opt) return `${name} / ${opt}`
  return name || opt
}
