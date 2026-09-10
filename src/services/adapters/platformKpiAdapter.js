import {
  deriveEsserProfitKpis,
  finalizeEsserBucket,
  summarizeEsserKpis,
} from '../../utils/esserMetrics.js'
import {
  formatDayOverDayPct,
  formatComparisonTrendLabel,
} from '../../utils/dayOverDaySales.js'
import { formatEsserValue } from '../../utils/esserMetrics.js'

/** @param {Record<string, unknown>} item */
function platformItemToRow(item) {
  const sales = Number(item.salesTotal ?? 0)
  const qty = Number(item.quantityTotal ?? 0)
  const netProfit =
    item.netProfitAfterManualAd != null
      ? Number(item.netProfitAfterManualAd)
      : Number(item.netProfitTotal ?? 0)
  const cost = Number(item.costTotal ?? 0)
  const adSpend = Number(item.adSpendTotal ?? 0)
  const adSales = Number(item.adSalesTotal ?? 0)

  const adBucket = finalizeEsserBucket({
    sales,
    salesQty: qty,
    netProfit,
    totalCost: cost,
    adSpend,
    adSales,
  })

  const productKpi = summarizeEsserKpis([])
  productKpi.sales = sales
  productKpi.salesQty = qty
  productKpi.netProfit = netProfit
  productKpi.totalCost = cost
  productKpi.adSpend = adSpend

  const estimateMargin =
    item.estimateCostFromMargin === true ||
    item.segmentKey === 'bh_ss' ||
    item.segmentKey === 'sbn_ss' ||
    item.platform === '스마트스토어'

  return {
    label: item.segment || item.platform,
    kind:
      item.segmentKey === 'special_sale'
        ? 'special_sale'
        : item.segmentKey === 'manual_expense'
          ? 'manual_expense'
          : undefined,
    segmentKey: item.segmentKey ?? null,
    profit: deriveEsserProfitKpis(adBucket, {
      estimateCostFromMargin: estimateMargin,
      productKpi: adBucket,
    }),
    ad: adBucket,
    rowCount: Number(item.recordCount ?? 0),
  }
}

/**
 * Server by-platform → buildPlatformKpiSplitRows 호환
 * @param {{ items?: unknown[], totalRow?: unknown }} res
 */
export function adaptServerPlatformKpiRows(res) {
  if (!res?.items?.length && !res?.manualAdItems?.length) return []
  const rows = (res.items || []).map((item) => platformItemToRow(item))
  for (const item of res.manualAdItems || []) {
    rows.push(platformItemToRow(item))
  }
  if (res.totalRow) {
    rows.push(platformItemToRow({ ...res.totalRow, platform: '합계', segment: '합계' }))
  }
  return rows
}

/** by-platform 실패·빈 응답 시 summary만으로 합계 행 생성 */
export function buildFallbackPlatformRowsFromSummary(summary) {
  if (!summary) return []
  return [
    platformItemToRow({
      platform: '합계',
      segment: '합계',
      salesTotal: summary.salesTotal,
      quantityTotal: summary.quantityTotal,
      netProfitAfterManualAd: summary.netProfitAfterManualAd,
      netProfitTotal: summary.netProfitTotal,
      costTotal: summary.costTotal,
      adSpendTotal: summary.adSpendTotal,
      adSalesTotal: summary.adSalesTotal,
      recordCount: summary.recordCount,
    }),
  ]
}

/**
 * Server by-segment → buildCombinedKpiSplitRows 호환 (동일 row 형태)
 * @param {{ items?: unknown[], totalRow?: unknown, manualAdItems?: unknown[] }} res
 */
export function adaptServerSegmentKpiRows(res) {
  return adaptServerPlatformKpiRows(res)
}

/**
 * Server compare-yesterday items → computeDayOverDaySales 호환
 * @param {{ items?: unknown[] }} res
 */
export function adaptServerDayOverDayRows(res) {
  const items = res?.items || []
  return items.map((item) => {
    const pct = item.diff?.salesDiffRate ?? null
    const mode = 'day'
    return {
      platform: item.label,
      comparisonMode: mode,
      referenceDate: item.current?.date || '',
      prevDate: item.previous?.date || '',
      periodFrom: '',
      periodTo: '',
      prevPeriodFrom: '',
      prevPeriodTo: '',
      currentSales: item.current?.salesTotal ?? 0,
      prevSales: item.previous?.salesTotal ?? 0,
      changePct: pct,
      trend: formatComparisonTrendLabel(pct, mode),
      changeLabel: formatDayOverDayPct(pct),
      currentSalesLabel: formatEsserValue('sales', item.current?.salesTotal ?? 0),
      prevSalesLabel: formatEsserValue('sales', item.previous?.salesTotal ?? 0),
    }
  })
}

export function adaptPgKpiByPlatform(res) {
  if (!res) return { items: [], total: 0, totalRow: null, manualAdItems: [] }
  const mapItem = (item) => ({
    platform: item.platform || item.segment || '',
    segment: item.segment || item.platform || '',
    segmentKey: item.segmentKey ?? null,
    estimateCostFromMargin: item.estimateCostFromMargin === true,
    salesTotal: Number(item.salesTotal ?? 0),
    quantityTotal: Number(item.quantityTotal ?? 0),
    recordCount: Number(item.recordCount ?? 0),
    netProfitTotal: Number(item.netProfitTotal ?? 0),
    adSpendTotal: Number(item.adSpendTotal ?? 0),
    adSalesTotal: Number(item.adSalesTotal ?? 0),
    manualAdSpendTotal: Number(item.manualAdSpendTotal ?? 0),
    costTotal: Number(item.costTotal ?? 0),
    marginRate: Number(item.marginRate ?? 0),
    averageOrderValue: Number(item.averageOrderValue ?? 0),
    netProfitAfterManualAd: Number(
      item.netProfitAfterManualAd ?? item.netProfitTotal ?? 0,
    ),
  })
  return {
    items: (res.items || []).map(mapItem),
    manualAdItems: (res.manualAdItems || []).map(mapItem),
    total: Number(res.total ?? res.items?.length ?? 0),
    totalRow: res.totalRow
      ? mapItem({ ...res.totalRow, platform: '합계', segment: '합계' })
      : null,
    manualAdSpendTotal: Number(res.manualAdSpendTotal ?? 0),
    filters: res.filters ?? null,
  }
}

/** @param {{ items?: unknown[], totalRow?: unknown, manualAdItems?: unknown[] } | null} res */
export function adaptPgKpiBySegment(res) {
  return adaptPgKpiByPlatform(res)
}

export function adaptPgKpiCompareYesterday(res) {
  if (!res) return { items: [], current: null, previous: null, diff: null }
  const mapItem = (item) => ({
    label: item.label || '',
    current: item.current || null,
    previous: item.previous || null,
    diff: item.diff || null,
  })
  return {
    items: (res.items || []).map(mapItem),
    current: res.current || null,
    previous: res.previous || null,
    diff: res.diff || null,
    filters: res.filters ?? null,
  }
}
