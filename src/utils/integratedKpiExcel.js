import { ESSER_PROFIT_KPI_CARDS, ESSER_AD_KPI_CARDS } from './esserMetrics.js'
import { filterKpiCards, COMBINED_HIDDEN_KPI_KEYS } from '../config/combinedChannel.js'
import {
  buildKpiSplitRowsForChannel,
  kpiSplitSectionTitle,
  filterKpiRowsWithAdSpend,
  isExternalAdKpiNA,
  isPowerPriceKpiNA,
  isSpecialSaleKpiNA,
  isManualExpenseKpiNA,
} from './platformKpiSplit.js'
import { isSpecialSaleRowLabel } from './specialSaleKpi.js'
import { isManualExpenseRowLabel, isManualExpenseSegmentKind } from './manualExpenseKpi.js'
import { isManualAdKpiLabel } from '../config/manualAdSpend.js'

const KPI_PERCENT_KEYS = new Set([
  'netProfitRate',
  'costRate',
  'roas',
  'salesRoas',
  'organicSalesRate',
])

function formatExcelKpiNumber(key, value) {
  const n = Number(value) || 0
  if (KPI_PERCENT_KEYS.has(key)) return Number((n / 100).toFixed(6))
  if (key === 'aov' || key === 'salesQty') return Math.round(n)
  return Math.round(n)
}

function segmentKpiRaw(rowLabel, section, key, value, specialSale = null, manualExpense = null, row = null) {
  if (isExternalAdKpiNA(rowLabel, section, key)) return null
  if (isPowerPriceKpiNA(rowLabel, section, key)) return null
  if (isSpecialSaleKpiNA(rowLabel, section, key, specialSale)) return null
  if (isManualExpenseKpiNA(rowLabel, section, key, manualExpense, row)) return null
  return value ?? 0
}

/** @param {string} key @param {number|null} value */
export function integratedSegmentKpiCell(key, value) {
  if (value == null) return '—'
  if (KPI_PERCENT_KEYS.has(key)) {
    const n = Number(value) || 0
    return Number(n.toFixed(2))
  }
  return formatExcelKpiNumber(key, value)
}

/**
 * 통합 엑셀 — 웹 대시보드와 동일한 세그먼트 KPI 표 (매출·수익 / 광고·판매량)
 * @param {object[]} saleRecords
 * @param {object[]} channelGroups
 * @param {object} manualFilterCtx
 * @param {string[]} [hiddenKpiKeys]
 * @param {object[]|null} [splitRowsInput] 동일 SoT용 미리 계산된 세그먼트 행
 * @returns {string[][]}
 */
export function buildIntegratedSegmentKpiExcelRows(
  saleRecords,
  channelGroups,
  manualFilterCtx,
  hiddenKpiKeys = COMBINED_HIDDEN_KPI_KEYS,
  splitRowsInput = null,
) {
  const splitRows =
    splitRowsInput ||
    buildKpiSplitRowsForChannel(
      '통합',
      saleRecords,
      channelGroups,
      manualFilterCtx,
    )
  const rows = []

  const profitCards = filterKpiCards(ESSER_PROFIT_KPI_CARDS, hiddenKpiKeys)
  rows.push([`■ ${kpiSplitSectionTitle(splitRows, 'profit', { compact: true })}`])
  rows.push(['구분', ...profitCards.map((c) => c.label), '상품행수'])
  for (const row of splitRows) {
    rows.push([
      row.label,
      ...profitCards.map((c) =>
        integratedSegmentKpiCell(
          c.key,
          segmentKpiRaw(
            row.label,
            'profit',
            c.key,
            row.profit[c.key],
            manualFilterCtx?.specialSale,
            manualFilterCtx?.manualExpense,
            row,
          ),
        ),
      ),
      isManualAdKpiLabel(row.label) ||
      isSpecialSaleRowLabel(row.label, manualFilterCtx?.specialSale) ||
      isManualExpenseSegmentKind(row) ||
      isManualExpenseRowLabel(row.label, manualFilterCtx?.manualExpense)
        ? ''
        : row.rowCount ?? '',
    ])
  }
  rows.push([])

  // 통합 광고·판매량 — 광고비 0원 행 제외 (웹 대시보드와 동일)
  const adRows = filterKpiRowsWithAdSpend(splitRows)
  const adCards = filterKpiCards(ESSER_AD_KPI_CARDS, hiddenKpiKeys)
  rows.push([`■ ${kpiSplitSectionTitle(adRows, 'ad', { compact: true })}`])
  rows.push(['구분', ...adCards.map((c) => c.label)])
  for (const row of adRows) {
    rows.push([
      row.label,
      ...adCards.map((c) =>
        integratedSegmentKpiCell(
          c.key,
          segmentKpiRaw(
            row.label,
            'ad',
            c.key,
            row.ad[c.key],
            manualFilterCtx?.specialSale,
            manualFilterCtx?.manualExpense,
            row,
          ),
        ),
      ),
    ])
  }
  rows.push([])

  return rows
}
