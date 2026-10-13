/** 파워프라이스 — 직접 입력 채널 */

export const POWER_PRICE_SCOPE = 'power_price'
export const POWER_PRICE_UPLOAD_KIND = 'power_price_manual'
export const POWER_PRICE_CONFIRM_UPLOAD_KIND = 'power_price_confirm'
/** 통합 탭 출처·엑셀 브랜드 라벨 */
export const POWER_PRICE_DATA_SOURCE_LABEL = '파워프라이스'

/** @param {object} row */
export function isPowerPriceRecord(row) {
  if (!row) return false
  return (
    row.scope === POWER_PRICE_SCOPE ||
    row.uploadKind === POWER_PRICE_UPLOAD_KIND ||
    row.uploadKind === POWER_PRICE_CONFIRM_UPLOAD_KIND ||
    row.dataSourceLabel === POWER_PRICE_DATA_SOURCE_LABEL ||
    row.brand === POWER_PRICE_DATA_SOURCE_LABEL
  )
}

/** 판매수수료 + 배송료 — 매출 대비 7% (수기 입력용) */
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

/**
 * @typedef {Object} PowerPriceCostMasterEntry
 * @property {string} key productId::option
 * @property {string} productId
 * @property {string} productName
 * @property {string} option
 * @property {string} unitCost
 */

/**
 * @typedef {Object} PowerPriceConfirmLine
 * @property {string} id
 * @property {string} productOrderId
 * @property {string} orderId
 * @property {string} date
 * @property {string} productId
 * @property {string} productName
 * @property {string} option
 * @property {string} quantity
 * @property {string} orderAmount
 * @property {string} feeNpay
 * @property {string} feeSales
 * @property {string} settleAmount
 * @property {string} costKey
 * @property {string} sourceFileName
 */

/**
 * @typedef {Object} PowerPriceConfirmUpload
 * @property {string} id
 * @property {string} fileName
 * @property {string} uploadedAt ISO
 * @property {number} lineCount
 * @property {string} dateFrom
 * @property {string} dateTo
 */

/** @param {string} productId @param {string} [option] */
export function powerPriceCostKey(productId, option = '') {
  const pid = String(productId || '').trim()
  const opt = String(option || '')
    .trim()
    .replace(/\s+/g, ' ')
  return `${pid}::${opt}`
}

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

/** @returns {PowerPriceCostMasterEntry} */
export function createPowerPriceCostMasterEntry(partial = {}) {
  const productId = String(partial.productId || '').trim()
  const option = String(partial.option || '').trim()
  return {
    key: partial.key || powerPriceCostKey(productId, option),
    productId,
    productName: String(partial.productName || '').trim(),
    option,
    unitCost:
      partial.unitCost != null && partial.unitCost !== ''
        ? String(partial.unitCost)
        : '',
  }
}

/** @returns {PowerPriceConfirmUpload} */
export function createPowerPriceConfirmUpload(partial = {}) {
  return {
    id: partial.id || newId(),
    fileName: String(partial.fileName || '').trim() || '구매확정내역',
    uploadedAt: String(partial.uploadedAt || new Date().toISOString()),
    lineCount: Number(partial.lineCount) || 0,
    dateFrom: String(partial.dateFrom || ''),
    dateTo: String(partial.dateTo || ''),
  }
}

/**
 * @returns {{
 *   products: PowerPriceProduct[],
 *   sales: PowerPriceSaleEntry[],
 *   costMaster: PowerPriceCostMasterEntry[],
 *   confirmLines: PowerPriceConfirmLine[],
 *   confirmUploads: PowerPriceConfirmUpload[],
 * }}
 */
export function createEmptyPowerPriceStore() {
  return {
    products: [],
    sales: [],
    costMaster: [],
    confirmLines: [],
    confirmUploads: [],
  }
}
