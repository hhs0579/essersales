import { ESSER_PROFIT_KPI_CARDS, ESSER_AD_KPI_CARDS } from './esserMetrics.js'
import { filterKpiCards, COMBINED_HIDDEN_KPI_KEYS } from '../config/combinedChannel.js'
import {
  buildKpiSplitRowsForChannel,
  kpiSplitSectionTitle,
  isExternalAdKpiNA,
  isPowerPriceKpiNA,
  isSpecialSaleKpiNA,
} from './platformKpiSplit.js'
import { isSpecialSaleRowLabel } from './specialSaleKpi.js'
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

function segmentKpiRaw(rowLabel, section, key, value, specialSale = null) {
  if (isExternalAdKpiNA(rowLabel, section, key)) return null
  if (isPowerPriceKpiNA(rowLabel, section, key)) return null
  if (isSpecialSaleKpiNA(rowLabel, section, key, specialSale)) return null
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
 * @returns {string[][]}
 */
export function buildIntegratedSegmentKpiExcelRows(
  saleRecords,
  channelGroups,
  manualFilterCtx,
  hiddenKpiKeys = COMBINED_HIDDEN_KPI_KEYS,
) {
  const splitRows = buildKpiSplitRowsForChannel(
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
          segmentKpiRaw(row.label, 'profit', c.key, row.profit[c.key], manualFilterCtx?.specialSale),
        ),
      ),
      isManualAdKpiLabel(row.label) || isSpecialSaleRowLabel(row.label, manualFilterCtx?.specialSale)
        ? ''
        : row.rowCount ?? '',
    ])
  }
  rows.push([])

  const adCards = filterKpiCards(ESSER_AD_KPI_CARDS, hiddenKpiKeys)
  rows.push([`■ ${kpiSplitSectionTitle(splitRows, 'ad', { compact: true })}`])
  rows.push(['구분', ...adCards.map((c) => c.label)])
  for (const row of splitRows) {
    rows.push([
      row.label,
      ...adCards.map((c) =>
        integratedSegmentKpiCell(
          c.key,
          segmentKpiRaw(row.label, 'ad', c.key, row.ad[c.key], manualFilterCtx?.specialSale),
        ),
      ),
    ])
  }
  rows.push([])

  return rows
}
