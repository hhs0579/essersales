/** 시각화 차트 지표 (상세 거래 엑셀 컬럼 기반) */
export const CHART_METRICS = {
  revenue: {
    label: '매출(실결제가)',
    unit: 'won',
    color: 'rgba(37, 99, 235, 0.75)',
    hint: '실결제가 합계',
  },
  settlement: {
    label: '정산가',
    unit: 'won',
    color: 'rgba(59, 130, 246, 0.75)',
    hint: '정산가 합계',
  },
  margin: {
    label: '마진',
    unit: 'won',
    color: 'rgba(5, 150, 105, 0.75)',
    hint: '마진 합계',
  },
  totalCost: {
    label: '총 원가',
    unit: 'won',
    color: 'rgba(100, 116, 139, 0.75)',
    hint: '총 원가 합계',
  },
  quantity: {
    label: '수량',
    unit: 'count',
    color: 'rgba(217, 119, 6, 0.75)',
    hint: '판매 수량',
  },
  salesQty: {
    label: '판매수량',
    unit: 'count',
    color: 'rgba(217, 119, 6, 0.75)',
    hint: '판매 수량 합계',
  },
  shippingFee: {
    label: '배송비',
    unit: 'won',
    color: 'rgba(148, 163, 184, 0.85)',
    hint: '배송비 합계',
  },
  marginRate: {
    label: '마진율',
    unit: 'percent',
    color: 'rgba(16, 185, 129, 0.75)',
    hint: '마진 ÷ 실결제가 × 100',
  },
  costRate: {
    label: '원가율',
    unit: 'percent',
    color: 'rgba(239, 68, 68, 0.7)',
    hint: '총 원가 ÷ 실결제가 × 100',
  },
  aov: {
    label: '객단가',
    unit: 'won',
    color: 'rgba(139, 92, 246, 0.75)',
    hint: '실결제가 ÷ 수량',
  },
  revenuePerCost: {
    label: '매출/원가',
    unit: 'ratio',
    color: 'rgba(234, 88, 12, 0.75)',
    hint: '실결제가 ÷ 총 원가 (광고 ROAS와 무관)',
  },
  roi: {
    label: 'ROI',
    unit: 'percent',
    color: 'rgba(190, 24, 93, 0.75)',
    hint: '마진 ÷ 총 원가 × 100',
  },
}

export const CHART_METRIC_OPTIONS = Object.entries(CHART_METRICS).map(([key, meta]) => ({
  key,
  label: meta.label,
  hint: meta.hint,
}))

export function formatChartValue(metricKey, value) {
  const meta = CHART_METRICS[metricKey] || CHART_METRICS.revenue
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  switch (meta.unit) {
    case 'percent':
      return `${n.toFixed(2)}%`
    case 'ratio':
      return `${n.toFixed(2)}배`
    case 'count':
      return Math.round(n).toLocaleString('ko-KR')
    default:
      return Math.round(n).toLocaleString('ko-KR')
  }
}
