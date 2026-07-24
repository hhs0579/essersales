/** 사본느리 자사몰 — 직접 입력 (상품·일별 판매) */

export const OWN_MALL_MANUAL_SCOPE = 'company_b'
export const OWN_MALL_MANUAL_UPLOAD_KIND = 'own_mall_manual'
export const OWN_MALL_MANUAL_DATA_SOURCE = '사본느리'
export const OWN_MALL_MANUAL_PLATFORM = '자사몰'
export const OWN_MALL_MANUAL_SETTING_KIND = 'own_mall_manual'

/** @param {object} row */
export function isOwnMallManualRecord(row) {
  if (!row) return false
  return (
    row.uploadKind === OWN_MALL_MANUAL_UPLOAD_KIND ||
    row.uploadFormat === 'own_mall_manual' ||
    row.isOwnMallManual === true
  )
}

/**
 * @typedef {Object} OwnMallProduct
 * @property {string} id
 * @property {string} [productCode] 상품번호 (엑셀 A열)
 * @property {string} name
 * @property {string} salePrice
 * @property {string} unitCost
 */

/**
 * @typedef {Object} OwnMallSaleEntry
 * @property {string} id
 * @property {string} date YYYY-MM-DD
 * @property {string} productId
 * @property {string} quantity
 * @property {string} optionPrice
 * @property {string} [lineTotal] 엑셀 X열 품목 실결제가 — 있으면 매출 기준
 * @property {'excel'|'manual'} [source]
 * @property {string} [importSourceId]
 */

/**
 * @typedef {Object} OwnMallSalesSourceFile
 * @property {string} id
 * @property {string} fileName
 * @property {string} dataBase64
 * @property {string} uploadedAt ISO
 */

function newId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** @returns {OwnMallProduct} */
export function createOwnMallProduct() {
  return {
    id: newId('om-p'),
    productCode: '',
    name: '',
    salePrice: '',
    unitCost: '',
  }
}

/** @returns {OwnMallSaleEntry} */
export function createOwnMallSaleEntry(defaultDate = '') {
  return {
    id: newId('om-s'),
    date: defaultDate || '',
    productId: '',
    quantity: '1',
    optionPrice: '',
  }
}

/** @returns {{ products: OwnMallProduct[], sales: OwnMallSaleEntry[], salesSourceFiles: OwnMallSalesSourceFile[] }} */
export function createEmptyOwnMallStore() {
  return { products: [], sales: [], salesSourceFiles: [] }
}
