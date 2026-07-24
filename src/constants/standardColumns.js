/** 표준 컬럼 정의 (key → 한글 라벨) */
export const STANDARD_COLUMNS = [
  { key: 'channel', label: '채널', description: '쿠팡 / 네이버 / 자사몰' },
  { key: 'saleDate', label: '판매일자', description: '주문일 또는 결제일 기준' },
  { key: 'orderNo', label: '주문번호', description: '채널별 주문번호' },
  { key: 'productCode', label: '상품코드', description: 'SKU, 자체 상품코드' },
  { key: 'productName', label: '상품명', description: '판매 상품명' },
  { key: 'optionName', label: '옵션명', description: '색상, 용량, 구성 등' },
  { key: 'quantity', label: '수량', description: '판매 수량' },
  { key: 'saleAmount', label: '판매금액', description: '상품 판매가' },
  { key: 'discountAmount', label: '할인금액', description: '쿠폰, 즉시할인 등' },
  { key: 'shippingFee', label: '배송비', description: '고객 결제 배송비' },
  { key: 'commission', label: '수수료', description: '플랫폼 수수료' },
  { key: 'settlementAmount', label: '정산금액', description: '실제 입금 또는 정산 예정 금액' },
  { key: 'orderStatus', label: '주문상태', description: '결제완료, 배송완료, 취소, 반품 등' },
  { key: 'sourceFileName', label: '원본파일명', description: '어떤 파일에서 온 데이터인지' },
  { key: 'remarks', label: '비고', description: '매핑 오류, 확인 필요 사항' },
]

export const CHANNELS = ['쿠팡', '스마트스토어', '자사몰']

export const STANDARD_KEYS = STANDARD_COLUMNS.map((c) => c.key)

export function emptyStandardRow() {
  return Object.fromEntries(STANDARD_KEYS.map((k) => [k, '']))
}
