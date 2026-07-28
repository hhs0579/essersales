/** @deprecated — src/config/closedMall.js 사용 */
export {
  BESTHEIM_CLOSED_MALL_UPLOAD_KIND,
  BESTHEIM_CLOSED_MALL_UPLOAD_FORMAT,
  BESTHEIM_CLOSED_MALL_PLATFORM,
  BESTHEIM_CLOSED_MALL_SALES_METHOD,
  BESTHEIM_CLOSED_MALL_DATA_SOURCE,
  BESTHEIM_CLOSED_MALL_BUSINESS_LINE,
  BESTHEIM_CLOSED_MALL_REQUIRED_HEADERS,
  normalizeClosedMallSeller,
  isClosedMallSummaryLabel,
  closedMallDuplicateFingerprint,
  isClosedMallRecord,
  resolveClosedMallSeller,
  isClosedMallKpiLabel,
  closedMallSellerFromKpiLabel,
  CLOSED_MALL_PLATFORM,
  CLOSED_MALL_SALES_METHOD,
  CLOSED_MALL_BUSINESS_LINE,
  CLOSED_MALL_REQUIRED_HEADERS,
} from './closedMall.js'

import { formatClosedMallKpiLabel as formatBrandSeller } from './closedMall.js'

/** 레거시: 판매처만 받던 시그니처 유지 */
export function formatClosedMallKpiLabel(seller) {
  return formatBrandSeller('베스트하임', seller)
}
