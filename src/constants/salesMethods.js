import { COUPANG_SALES_METHODS, SMARTSTORE_SALES_METHODS } from '../utils/salesMethodDetect.js'

export { COUPANG_SALES_METHODS, SMARTSTORE_SALES_METHODS }

export const COUPANG_SALES_METHOD_OPTIONS = [
  { value: '', label: '전체 취합 (로켓+판매자)' },
  { value: '로켓그로스', label: '로켓그로스' },
  { value: '판매자배송', label: '판매자배송' },
]

export const SMARTSTORE_SALES_METHOD_OPTIONS = [
  { value: '', label: '전체 취합 (일반+N)' },
  { value: '일반배송', label: '일반배송' },
  { value: 'N배송', label: 'N배송' },
]

export const ALL_SALES_METHOD_OPTIONS = [
  { value: '', label: '전체 판매방식' },
  ...COUPANG_SALES_METHOD_OPTIONS.filter((o) => o.value),
  ...SMARTSTORE_SALES_METHOD_OPTIONS.filter((o) => o.value),
]

/** @deprecated COUPANG_SALES_METHOD_OPTIONS 사용 */
export const SALES_METHOD_OPTIONS = COUPANG_SALES_METHOD_OPTIONS

export function salesMethodOptionsForPlatform(platform = '') {
  const p = platform === '네이버' ? '스마트스토어' : platform
  if (p === '쿠팡') return COUPANG_SALES_METHOD_OPTIONS
  if (p === '스마트스토어') return SMARTSTORE_SALES_METHOD_OPTIONS
  return ALL_SALES_METHOD_OPTIONS
}

export function salesMethodFilterHint(platform = '', salesMethod = '') {
  if (salesMethod) return salesMethod
  const p = platform === '네이버' ? '스마트스토어' : platform
  if (p === '쿠팡') return '로켓+판매자 취합'
  if (p === '스마트스토어') return '일반+N 취합'
  return '전체 판매방식'
}
