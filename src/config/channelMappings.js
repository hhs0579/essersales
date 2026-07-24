/**
 * 채널별 기본 컬럼 매핑 (표준 key → 원본 엑셀 헤더 후보)
 * 업로드 시 헤더명과 일치하는 항목을 자동 선택합니다.
 */
export const CHANNEL_PRESETS = {
  쿠팡: {
    saleDate: ['주문일', '결제일', '주문일시', '결제완료일'],
    orderNo: ['주문번호', '주문ID', '주문 id'],
    productCode: ['업체상품코드', '상품코드', 'SKU', '옵션ID'],
    productName: ['등록상품명', '상품명', '노출상품명'],
    optionName: ['등록옵션명', '옵션명', '옵션'],
    quantity: ['구매수량', '수량', '주문수량'],
    saleAmount: ['판매가', '판매금액', '결제금액', '주문금액'],
    discountAmount: ['할인금액', '즉시할인', '쿠폰할인'],
    shippingFee: ['배송비', '배송료'],
    commission: ['수수료', '판매수수료', '서비스이용료'],
    settlementAmount: ['정산금액', '정산예정금액', '입금예정금액'],
    orderStatus: ['주문상태', '배송상태', '클레임상태'],
  },
  네이버: {
    saleDate: ['주문일시', '결제일', '주문일', '결제완료일시'],
    orderNo: ['주문번호', '상품주문번호', '주문ID'],
    productCode: ['상품번호', '옵션관리코드', '판매자상품코드', 'SKU'],
    productName: ['상품명', '상품정보'],
    optionName: ['옵션정보', '옵션명', '옵션'],
    quantity: ['수량', '주문수량'],
    saleAmount: ['상품가격', '판매금액', '결제금액', '총결제금액'],
    discountAmount: ['할인금액', '판매자부담할인', '네이버부담할인'],
    shippingFee: ['배송비', '배송비합계'],
    commission: ['수수료', '결제수수료', '서비스이용료'],
    settlementAmount: ['정산예정금액', '정산금액', '판매정산금액'],
    orderStatus: ['주문상태', '배송상태', '클레임상태'],
  },
  자사몰: {
    saleDate: ['주문일', '결제일', '주문일시', 'created_at'],
    orderNo: ['주문번호', 'order_no', '주문 ID'],
    productCode: ['상품고유번호', '상품고유', '상품코드', 'SKU', '품번', 'product_code'],
    productName: ['상품명', 'product_name', '품명'],
    optionName: ['옵션', '옵션명', 'option'],
    quantity: ['구매수량', '수량', 'qty', 'quantity'],
    saleAmount: ['품목실결제가', '품목 실결제가', '품목별실결제', '판매금액', 'price'],
    discountAmount: ['할인금액', 'discount'],
    shippingFee: ['배송비', 'shipping'],
    commission: ['수수료', 'commission'],
    settlementAmount: ['정산금액', 'settlement'],
    orderStatus: ['주문상태', 'status', '배송상태'],
  },
}

/** 표준 key 중 채널 필드는 매핑 UI에서 제외 (파일 단위로 지정) */
export const MAPPABLE_KEYS = [
  'saleDate',
  'orderNo',
  'productCode',
  'productName',
  'optionName',
  'quantity',
  'saleAmount',
  'discountAmount',
  'shippingFee',
  'commission',
  'settlementAmount',
  'orderStatus',
]

/**
 * 채널 프리셋 + 실제 헤더 목록으로 초기 매핑 생성
 * @returns {Record<string, string>} standardKey → sourceHeader
 */
export function buildAutoMapping(channel, headers) {
  const preset = CHANNEL_PRESETS[channel] || {}
  const normalized = headers.map((h) => ({ raw: h, norm: String(h).trim().toLowerCase() }))
  const mapping = {}

  for (const key of MAPPABLE_KEYS) {
    const candidates = preset[key] || []
    let matched = ''
    for (const candidate of candidates) {
      const cNorm = candidate.trim().toLowerCase()
      const found = normalized.find((h) => h.norm === cNorm || h.norm.includes(cNorm) || cNorm.includes(h.norm))
      if (found) {
        matched = found.raw
        break
      }
    }
    if (!matched) {
      const keyHint = key.replace(/([A-Z])/g, ' $1').toLowerCase()
      const fuzzy = normalized.find((h) => candidates.some((c) => h.norm.includes(c.toLowerCase())))
      if (fuzzy) matched = fuzzy.raw
      else {
        const byKey = normalized.find((h) => h.norm.includes(keyHint.split(' ')[0]))
        if (byKey) matched = byKey.raw
      }
    }
    mapping[key] = matched
  }
  return mapping
}
