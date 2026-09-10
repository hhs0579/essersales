/**
 * 통합 KPI 세그먼트 — 클라 buildCombinedKpiSplitRows 규칙을 서버 API 형태로 변환
 */
import { buildCombinedKpiSplitRows, isManualAdKpiLabel } from '../../../src/utils/platformKpiSplit.js'
import { combinedSegmentKeyFromLabel } from '../../../src/utils/combinedKpiSegments.js'

function round2(n) {
  return Number(Number(n).toFixed(2))
}

/**
 * @param {{ label?: string, profit?: object, ad?: object, rowCount?: number }} row
 */
export function combinedUiRowToApiItem(row) {
  const label = String(row?.label || '').trim()
  const profit = row?.profit || {}
  const ad = row?.ad || {}
  const sales = Number(profit.sales ?? 0)
  const qty = Number(profit.salesQty ?? 0)
  const netProfit = Number(profit.netProfit ?? 0)
  const cost = Number(profit.totalCost ?? 0)
  const adSpend = Number(ad.adSpend ?? 0)
  const adSales = Number(ad.adSales ?? 0)
  const isSpecial = row?.kind === 'special_sale'
  const isExpense = row?.kind === 'manual_expense'
  const segmentKey = isSpecial
    ? 'special_sale'
    : isExpense
      ? 'manual_expense'
      : combinedSegmentKeyFromLabel(label)
  const estimateCostFromMargin = segmentKey === 'bh_ss' || segmentKey === 'sbn_ss'
  const isManual = isManualAdKpiLabel(label)

  return {
    platform: label,
    segment: label,
    segmentKey,
    estimateCostFromMargin,
    isManualAdRow: isManual,
    salesTotal: sales,
    quantityTotal: qty,
    recordCount: Number(row?.rowCount ?? 0),
    netProfitTotal: netProfit,
    adSpendTotal: adSpend,
    adSalesTotal: adSales,
    costTotal: cost,
    marginRate: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    averageOrderValue: qty > 0 ? round2(sales / qty) : 0,
    netProfitAfterManualAd: netProfit,
    marginRateAfterManualAd: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    manualAdSpendTotal: isManual ? adSpend : 0,
  }
}

/**
 * @param {object[]} records — enrich·기간 필터된 레거시 detail
 * @param {{ dateFrom?: string, dateTo?: string, specialSale?: object|null }} filterCtx
 * @param {Array<{ label: string, entries?: unknown[] }>} [channelGroups] — 수기 광고(Meta·GFA 등)
 */
export function aggregateCombinedSegmentKpiFromRecords(
  records,
  filterCtx = {},
  channelGroups = [],
) {
  const uiRows = buildCombinedKpiSplitRows(
    records || [],
    records || [],
    channelGroups || [],
    filterCtx,
  )
  const items = []
  let totalRow = null

  for (const row of uiRows) {
    const label = String(row?.label || '').trim()
    if (!label) continue
    if (label === '합계') {
      totalRow = combinedUiRowToApiItem(row)
      continue
    }
    // Meta·GFA·AD·구글 행 포함 (예전에는 제외 → 광고비 0원 버그)
    items.push(combinedUiRowToApiItem(row))
  }

  if (!totalRow) {
    totalRow = combinedUiRowToApiItem({
      label: '합계',
      profit: { sales: 0, salesQty: 0, totalCost: 0, netProfit: 0 },
      ad: { adSpend: 0, adSales: 0 },
      rowCount: 0,
    })
  }

  return {
    items,
    total: items.length,
    totalRow,
  }
}
