/** 표·엑셀에서 숨길 컬럼 (파싱용 필드만 유지) */
export const HIDDEN_DETAIL_COLUMN_KEYS = new Set([
  'channelKind',
  'channel_kind',
  'channelType',
  'channel_type',
  'importUnitCost',
  'import_unit_cost',
])

export function sanitizeDetailColumns(cols = []) {
  return cols.filter((c) => {
    if (!c?.key) return false
    if (HIDDEN_DETAIL_COLUMN_KEYS.has(c.key)) return false
    if (String(c.label || '').replace(/\s/g, '') === '채널종류') return false
    if (String(c.label || '').replace(/\s/g, '') === '수입단가') return false
    return true
  })
}

/** 통합 매출 리포트 엑셀 — 상세(거래) 행 컬럼 */
export const DETAIL_COLUMNS = [
  { key: 'date', label: '날짜' },
  { key: 'channel', label: '판매처' },
  { key: 'brand', label: '브랜드' },
  { key: 'productName', label: '상품명' },
  { key: 'option', label: '옵션' },
  { key: 'quantity', label: '수량' },
  { key: 'actualPayment', label: '실결제가' },
  { key: 'shippingFee', label: '배송비' },
  { key: 'channelFee', label: '채널 수수료' },
  { key: 'settlementPrice', label: '정산가' },
  { key: 'unitCost', label: '원가' },
  { key: 'totalCost', label: '총 원가' },
  { key: 'margin', label: '마진' },
  { key: 'marginRate', label: '마진율' },
]

/** 쿠팡 에쎄르·플랫폼 일일 엑셀 — 매출·광고·순이익 컬럼 포함 */
export const DETAIL_COLUMNS_ESSER = [
  { key: 'date', label: '날짜' },
  { key: 'platform', label: '플랫폼' },
  { key: 'salesMethod', label: '판매방식' },
  { key: 'brand', label: '스토어명' },
  { key: 'productName', label: '상품명' },
  { key: 'option', label: '옵션명' },
  { key: 'sales', label: '매출' },
  { key: 'salesQty', label: '판매수량' },
  { key: 'unitCost', label: '원가(단가)' },
  { key: 'totalCost', label: '원가(합계)' },
  { key: 'grossSales', label: '할인전매출' },
  { key: 'netProfit', label: '순이익금' },
  { key: 'marginRate', label: '순이익률' },
  { key: 'salePrice', label: '판매가' },
  { key: 'adSpend', label: '광고집행비' },
  { key: 'adSpendRate', label: '광고집행비 비율' },
  { key: 'adSales', label: '광고매출' },
  { key: 'adSalesRate', label: '광고매출 비율' },
  { key: 'adQty', label: '광고 판매수량' },
  { key: 'adQtyRate', label: '광고 판매수량 비율' },
  { key: 'organicQty', label: '자연 판매수량' },
  { key: 'organicQtyRate', label: '자연 판매수량 비율' },
  { key: 'adRoas', label: '광고 ROAS' },
  { key: 'adConversionRate', label: '광고판매전환율' },
  { key: 'adProfit', label: '광고집행 이익금' },
  { key: 'adNetProfit', label: '광고집행 순이익금' },
  { key: 'adNetProfitRate', label: '광고집행 순이익율' },
  { key: 'sourceFileName', label: '원본파일' },
]

export function isEsserDetailRow(row) {
  if (row?.uploadFormat === 'power_price_manual') return true
  if (row?.uploadFormat === 'coupang_1p_rocket_manual') return true
  if (
    row?.uploadFormat === 'coupang_esser' ||
    row?.uploadFormat === 'coupang_esser_period' ||
    row?.uploadFormat === 'coupang_esser_monthly'
  ) {
    return true
  }
  const hasAd =
    (row?.adSpend != null && row.adSpend !== '') ||
    (row?.adSales != null && row.adSales !== '') ||
    (row?.adRoas != null && row.adRoas !== '') ||
    (row?.uploadFormat === 'coupang_esser' && row?.channelFee != null && row.channelFee !== '')
  const hasEsserSales = row?.sales != null && row.sales !== ''
  return hasAd || hasEsserSales
}

/** 특판 폐쇄몰 상세 표 — 판매처·브랜드·옵션 분리 */
export const DETAIL_COLUMNS_CLOSED_MALL = [
  { key: 'date', label: '날짜' },
  { key: 'platform', label: '플랫폼' },
  { key: 'storeName', label: '판매처' },
  { key: 'brand', label: '브랜드' },
  { key: 'productName', label: '상품명' },
  { key: 'option', label: '옵션' },
  { key: 'sales', label: '매출' },
  { key: 'salesQty', label: '판매수량' },
  { key: 'unitCost', label: '원가(단가)' },
  { key: 'totalCost', label: '원가(합계)' },
  { key: 'shippingFee', label: '배송비' },
  { key: 'commission', label: '수수료' },
  { key: 'netProfit', label: '순이익금' },
  { key: 'sourceFileName', label: '원본파일' },
]

function isClosedMallDetailRow(row) {
  const kind = String(row?.uploadKind || row?.upload_kind || '').trim()
  if (kind === 'bestheim_closed_mall' || kind === 'esser_closed_mall') return true
  const format = String(row?.uploadFormat || row?.upload_format || '').trim()
  return format === 'BESTHEIM_CLOSED_MALL' || format === 'ESSER_CLOSED_MALL'
}

export function resolveDetailColumns(records = []) {
  if (records.some(isClosedMallDetailRow)) {
    const base = sanitizeDetailColumns(DETAIL_COLUMNS_CLOSED_MALL)
    if (records.some((r) => r.dataSourceLabel)) {
      return [{ key: 'dataSourceLabel', label: '출처' }, ...base]
    }
    return base
  }
  const cols = records.some(isEsserDetailRow) ? DETAIL_COLUMNS_ESSER : DETAIL_COLUMNS
  const base = sanitizeDetailColumns(cols)
  if (records.some((r) => r.dataSourceLabel)) {
    return [{ key: 'dataSourceLabel', label: '출처' }, ...base]
  }
  return base
}

/** 플랫폼 일일(에쎄르) — 집계 탭 컬럼 */
export const SUMMARY_COLUMNS_ESSER = {
  daily: [
    { key: 'date', label: '날짜' },
    { key: 'revenue', label: '매출' },
    { key: 'adSpend', label: '광고비' },
    { key: 'adSales', label: '광고매출' },
    { key: 'totalCost', label: '원가' },
    { key: 'salesQty', label: '판매수량' },
    { key: 'margin', label: '순이익' },
    { key: 'marginRate', label: '순이익률' },
    { key: 'roas', label: 'ROAS(광고)' },
    { key: 'salesRoas', label: 'ROAS(전체)' },
  ],
  channel: [
    { key: 'channel', label: '판매처' },
    { key: 'revenue', label: '매출' },
    { key: 'totalCost', label: '원가' },
    { key: 'margin', label: '순이익' },
    { key: 'marginRate', label: '순이익률' },
    { key: 'quantity', label: '판매수량' },
  ],
  product: [
    { key: 'productName', label: '상품명' },
    { key: 'revenue', label: '매출' },
    { key: 'totalCost', label: '원가' },
    { key: 'quantity', label: '판매수량' },
    { key: 'margin', label: '순이익' },
    { key: 'marginRate', label: '순이익률' },
  ],
  productOption: [
    { key: 'productName', label: '상품명' },
    { key: 'option', label: '옵션' },
    { key: 'revenue', label: '매출' },
    { key: 'totalCost', label: '원가' },
    { key: 'quantity', label: '판매수량' },
    { key: 'margin', label: '순이익' },
  ],
}

export function resolveSummaryColumns(tab, records = []) {
  if (records.some(isEsserDetailRow) && SUMMARY_COLUMNS_ESSER[tab]) {
    return SUMMARY_COLUMNS_ESSER[tab]
  }
  return RECORD_TYPES[tab]?.columns || []
}

/** 표 하단 탭 순서 — 반품(returns)은 항상 맨 끝 */
export const RECORD_TYPES = {
  detail: { label: '판매', columns: sanitizeDetailColumns(DETAIL_COLUMNS_ESSER) },
  daily: {
    label: '일별 집계',
    columns: [
      { key: 'date', label: '날짜' },
      { key: 'revenue', label: '매출(실결제가 합계)' },
      { key: 'totalCost', label: '원가' },
      { key: 'salesQty', label: '판매수량' },
      { key: 'margin', label: '마진' },
      { key: 'marginRate', label: '마진율' },
    ],
  },
  channel: {
    label: '판매처별',
    columns: [
      { key: 'date', label: '날짜' },
      { key: 'channel', label: '판매처' },
      { key: 'revenue', label: '매출' },
      { key: 'margin', label: '마진' },
      { key: 'marginRate', label: '마진율' },
    ],
  },
  product: {
    label: '상품별',
    columns: [
      { key: 'date', label: '날짜' },
      { key: 'productName', label: '상품명' },
      { key: 'revenue', label: '매출' },
      { key: 'quantity', label: '수량' },
      { key: 'marginRate', label: '마진율' },
    ],
  },
  productOption: {
    label: '상품·옵션별',
    columns: [
      { key: 'date', label: '날짜' },
      { key: 'productName', label: '상품명' },
      { key: 'option', label: '옵션' },
      { key: 'quantity', label: '수량' },
    ],
  },
  returns: { label: '반품', columns: sanitizeDetailColumns(DETAIL_COLUMNS_ESSER) },
}

/** 판매·집계 탭 (반품 제외) */
export const RECORD_TAB_KEYS_MAIN = Object.keys(RECORD_TYPES).filter((k) => k !== 'returns')

/** 맨 아래 반품 전용 탭 */
export const RECORD_TAB_KEY_RETURNS = 'returns'

export const DETAIL_FILTER_FIELDS = [
  { key: 'date', label: '날짜' },
  { key: 'channel', label: '판매처' },
  { key: 'brand', label: '브랜드' },
  { key: 'productName', label: '상품명' },
]
