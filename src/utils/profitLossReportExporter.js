import {
  summarizeEsserKpis,
  finalizeEsserBucket,
  isEsserSheetTotalRecord,
  resolveGroupTotalCost,
  expandPeriodUploadRowsForDaily,
  formatDayBucketLabel,
} from './esserMetrics.js'
import { summarizeKpis } from './salesAggregation.js'
import { getSalesMethod, salesMethodGroupLabel } from './salesMethodDetect.js'
import {
  summarizeManualAdExportByDay,
  aggregateEsserByDayWithManual,
  aggregateEsserByDayWithManualSpendOnly,
  groupManualAdEntriesBySource,
  summarizeManualAdKpiOnly,
  summarizeEsserKpisWithManual,
} from './manualAdSpend.js'
import {
  buildKpiSplitRowsForChannel,
  summarizeCombinedKpis,
  summarizePowerPriceKpis,
  summarizeBrandKpis,
  COMBINED_BRAND_KPI_LABELS,
} from './platformKpiSplit.js'
import { resolveRecordSourceLabel } from './recordSourceLabel.js'
import { MANUAL_AD_SOURCE_DEFS, isManualAdKpiLabel } from '../config/manualAdSpend.js'
import { isPowerPriceRecord } from '../config/powerPrice.js'
import { isReturnRecord } from './transactionType.js'
import { parsePlaceholderToken } from './profitLossTemplateParser.js'
import { PROFIT_LOSS_FIELD_LABELS } from '../config/profitLossReport.js'
import { getRecordDate } from './recordFilters.js'
import { parseSalesDate, parseMonthDayLabel } from './dateParse.js'
import { normalizeStoreLabel } from './storeLabel.js'
import { parseAmount } from './parseAmount.js'
import { formatDayOverDayPct, salesComparisonSectionTitle, salesComparisonCurrentColumnLabel, salesComparisonPrevColumnLabel, salesComparisonChangeColumnLabel, resolveSalesComparisonMode } from './dayOverDaySales.js'
import { buildIntegratedSegmentKpiExcelRows } from './integratedKpiExcel.js'
import { buildCombinedCommentsExcelBlock } from './combinedCommentsExcel.js'
import { COMBINED_HIDDEN_KPI_KEYS } from '../config/combinedChannel.js'
import { UI_BUILD_ID } from '../constants/appVersion.js'
import { summarizeSpecialSaleEntry, specialSaleEntryLabel, getSpecialSaleEntries, hasSpecialSaleEntryInput } from './specialSaleKpi.js'

/** ①요약리포트 레이아웃 버전 — 엑셀에 표시해 적용 여부 확인 */
export const INTEGRATED_REPORT_LAYOUT_VER = 31

const PERCENT_FIELDS = new Set(['netProfitRate', 'organicSalesRate', 'roas', 'salesRoas'])
const POWER_PRICE_LABEL = '파워프라이스'
const DAILY_BRAND_ORDER = ['베스트하임', '사본느리', POWER_PRICE_LABEL]
const HIDDEN_GROUP_LABELS = new Set(['미지정', '미분류', ''])
const INTEGRATED_TITLE = '통합 매출 손익계산 요약 리포트'

const SALES_METHOD_HEADERS = [
  '판매방식',
  '매출',
  '원가',
  '판매수량',
  '순이익금',
  '순이익률',
  '광고비',
  '광고매출',
  '자연매출',
  '매출비중',
]

const STORE_HEADERS = [
  '스토어명',
  '매출',
  '원가',
  '판매수량',
  '순이익금',
  '순이익률',
  '광고비',
  '광고매출',
  '자연매출',
  '상품행수',
]

const DAILY_HEADERS = [
  '기간',
  '매출',
  '원가',
  '판매수량',
  '순이익금',
  '순이익률(%)',
  '광고비',
  '광고매출',
  'ROAS(광고)(%)',
  'ROAS(전체)(%)',
  '자연매출',
  '자연매출 비율(%)',
]

/** @param {string[][]} aoa */
function cloneAoa(aoa) {
  return (aoa || []).map((row) => [...(row || [])])
}

function mergeTitleRow(text) {
  return [text]
}

function fmtAmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  const v = Math.round(Number(n))
  return v === 0 ? '' : v
}

function fmtPctDisp(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  const v = Number(n)
  if (v === 0) return ''
  return `${v.toFixed(1)}%`
}

function fmtPctPoints(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return Number(Number(n).toFixed(2))
}

function pctOfSales(part, sales) {
  const s = Number(sales) || 0
  if (!s) return ''
  return fmtPctDisp((Number(part) / s) * 100)
}

/** @param {number} n @param {string} fieldKey */
function formatFieldValue(n, fieldKey) {
  if (n == null || !Number.isFinite(n)) return ''
  if (PERCENT_FIELDS.has(fieldKey)) return fmtPctPoints(n)
  return fmtAmt(n)
}

function periodLabel(bucket, filterCtx = {}) {
  return formatDayBucketLabel(bucket, filterCtx)
}

function dateRangeText(records, filters = {}) {
  if (filters.dateFrom && filters.dateTo) {
    return `${filters.dateFrom} ~ ${filters.dateTo}`
  }
  const dates = (records || [])
    .map((r) => parseSalesDate(getRecordDate(r)))
    .filter(Boolean)
    .sort((a, b) => a.date - b.date)
  if (!dates.length) return '기간 미상'
  const f = dates[0]
  const l = dates[dates.length - 1]
  return `${f.year}.${f.month}.${f.day} ~ ${l.year}.${l.month}.${l.day}`
}

function reportBasisLabel(records, filters = {}) {
  if (filters.dateFrom && filters.dateTo && filters.dateFrom === filters.dateTo) {
    const p = parseSalesDate(filters.dateFrom)
    if (p) return `${p.year}년 ${p.month}월 ${p.day}일 기준`
  }
  if (filters.dateFrom && filters.dateTo) {
    return `${filters.dateFrom} ~ ${filters.dateTo} 기준`
  }
  const text = dateRangeText(records, filters)
  return text === '기간 미상' ? text : `${text} 기준`
}

function finalizeCombinedKpi(kpi, costKpi) {
  const totalCost = costKpi?.totalCost ?? kpi?.totalCost ?? 0
  return finalizeEsserBucket({ ...kpi, totalCost })
}

/**
 * @param {Array<{ label: string, entries: import('../config/manualAdSpend.js').ManualAdEntry[] }>} channelGroups
 * @param {object} manualFilterCtx
 */
function buildExternalAdRows(channelGroups, manualFilterCtx) {
  const rows = [['■ 외부 광고비 (선택 기간 · 일자별)']]
  const from = manualFilterCtx.dateFrom || ''
  const to = manualFilterCtx.dateTo || ''
  if (from || to) {
    rows.push(['적용 기간', from || '—', '~', to || '—'])
  }
  rows.push(['채널', '일자', '광고비용', '전환매출액'])

  let hasAny = false
  for (const { label, entries } of channelGroups || []) {
    const bySource = groupManualAdEntriesBySource(entries)
    for (const def of MANUAL_AD_SOURCE_DEFS) {
      const list = bySource[def.value] || []
      for (const [ymd, sums] of summarizeManualAdExportByDay(list, manualFilterCtx)) {
        hasAny = true
        const dateLabel =
          manualFilterCtx?.period === 'monthly' ? ymd.slice(0, 7) : ymd
        rows.push([
          `${label} · ${def.kpiLabel}`,
          dateLabel,
          fmtAmt(sums.adSpend),
          fmtAmt(sums.adSales),
        ])
      }
    }
  }

  if (!hasAny) {
    rows.push(['(선택 기간·일자에 해당하는 외부 광고 입력 없음)'])
  }
  rows.push([])
  return rows
}

/** @param {object} kpi @param {object} costKpi */
function buildHorizontalKpiRows(kpi, costKpi) {
  const b = finalizeCombinedKpi(kpi, costKpi)
  return [
    [
      '총매출',
      '총원가',
      '광고비',
      '최종 순이익',
      '순이익률',
      '판매수량',
      '광고매출',
      'ROAS(광고)',
      '자연매출',
      '자연매출비율',
    ],
    [
      fmtAmt(b.sales),
      fmtAmt(b.totalCost),
      fmtAmt(b.adSpend),
      fmtAmt(b.netProfit),
      fmtPctDisp(b.netProfitRate),
      fmtAmt(b.salesQty),
      fmtAmt(b.adSales),
      fmtPctDisp(b.roas),
      fmtAmt(b.organicSales),
      fmtPctDisp(b.organicSalesRate),
    ],
    [],
  ]
}

function shouldIncludeAggregateGroup(label, group) {
  if (HIDDEN_GROUP_LABELS.has(String(label || '').trim())) return false
  const k = summarizeEsserKpis(group)
  const c = summarizeKpis(group)
  return k.sales > 0 || c.totalCost > 0 || k.salesQty > 0
}

function salesMethodLabelForRow(row) {
  if (isPowerPriceRecord(row)) return POWER_PRICE_LABEL
  return salesMethodGroupLabel(row) || ''
}

/** 통합 리포트 — 베스트하임·사본느리 수동 광고 (파워프라이스 제외) */
function collectBhSbnEntriesBySource(channelGroups, sourceValue) {
  const items = []
  for (const g of channelGroups || []) {
    if (g.label === POWER_PRICE_LABEL) continue
    const bySource = groupManualAdEntriesBySource(g.entries)
    items.push(...(bySource[sourceValue] || []))
  }
  return items
}

/** 외부·GFA 등 광고 전용 행 (매출 없음 — 광고비·순이익만) */
function externalAdSupplementRow(label, kpi) {
  const k = finalizeEsserBucket(kpi)
  if (!k.adSpend && !k.adSales) return null
  return [
    label,
    '',
    '',
    '',
    fmtAmt(k.netProfit),
    '',
    fmtAmt(k.adSpend),
    fmtAmt(k.adSales),
    '',
    '',
  ]
}

function specialSaleSalesMethodRow(entry, totalSales) {
  if (!hasSpecialSaleEntryInput(entry)) return null
  const k = summarizeSpecialSaleEntry(entry)
  const share =
    totalSales > 0 ? Number(((k.sales / totalSales) * 100).toFixed(1)) : null
  return [
    specialSaleEntryLabel(entry),
    fmtAmt(k.sales),
    fmtAmt(k.totalCost),
    '',
    fmtAmt(k.netProfit),
    fmtPctDisp(k.netProfitRate),
    '',
    '',
    '',
    share != null && share > 0 ? fmtPctDisp(share) : '',
  ]
}

function specialSaleStoreRow(entry) {
  if (!hasSpecialSaleEntryInput(entry)) return null
  const k = summarizeSpecialSaleEntry(entry)
  return [
    specialSaleEntryLabel(entry),
    fmtAmt(k.sales),
    fmtAmt(k.totalCost),
    '',
    fmtAmt(k.netProfit),
    fmtPctDisp(k.netProfitRate),
    '',
    '',
    '',
    '',
  ]
}

function collectExternalAdSupplementRows(channelGroups, manualFilterCtx) {
  const rows = []
  for (const def of MANUAL_AD_SOURCE_DEFS) {
    const row = externalAdSupplementRow(
      def.kpiLabel,
      summarizeManualAdKpiOnly(
        collectBhSbnEntriesBySource(channelGroups, def.value),
        manualFilterCtx,
      ),
    )
    if (row) rows.push(row)
  }
  return rows
}

function powerPriceManualEntries(channelGroups) {
  return (channelGroups || []).find((g) => g.label === POWER_PRICE_LABEL)?.entries || []
}

function summarizeStoreGroup(storeLabel, group, channelGroups, manualFilterCtx) {
  if (storeLabel === POWER_PRICE_LABEL) {
    const k = summarizePowerPriceKpis(group, powerPriceManualEntries(channelGroups), manualFilterCtx)
    return { k, totalCost: k.totalCost || summarizeKpis(group).totalCost }
  }
  const manual = manualEntriesForBrand(channelGroups, storeLabel)
  const k = summarizeEsserKpisWithManual(group, manual, manualFilterCtx)
  const rawCost = summarizeKpis(group).totalCost
  return { k, totalCost: resolveGroupTotalCost(storeLabel, group, k, rawCost) }
}

function storeHasExternalAd(channelGroups, storeLabel, manualFilterCtx) {
  const entries = manualEntriesForBrand(channelGroups, storeLabel)
  const bySource = groupManualAdEntriesBySource(entries)
  return MANUAL_AD_SOURCE_DEFS.some((def) => {
    const kpi = summarizeManualAdKpiOnly(bySource[def.value] || [], manualFilterCtx)
    return (kpi.adSpend || 0) > 0 || (kpi.adSales || 0) > 0
  })
}

function summarizeSalesMethodGroup(label, group, channelGroups, manualFilterCtx) {
  if (label === POWER_PRICE_LABEL) {
    const k = summarizePowerPriceKpis(group, powerPriceManualEntries(channelGroups), manualFilterCtx)
    return { k, totalCost: k.totalCost || summarizeKpis(group).totalCost }
  }
  const k = summarizeEsserKpis(group)
  const rawCost = summarizeKpis(group).totalCost
  return { k, totalCost: resolveGroupTotalCost(label, group, k, rawCost) }
}

function collectSalesMethodGroups(records, channelGroups = [], manualFilterCtx = {}) {
  const productRows = (records || []).filter((r) => !isEsserSheetTotalRecord(r))
  const map = new Map()
  for (const row of productRows) {
    const label = salesMethodLabelForRow(row)
    if (HIDDEN_GROUP_LABELS.has(label)) continue
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(row)
  }

  const allForKpi = (records || []).filter((r) => !isReturnRecord(r))
  const combinedTotal = summarizeCombinedKpis(
    allForKpi.length ? allForKpi : records,
    channelGroups,
    manualFilterCtx,
  )
  const totalSales = combinedTotal.sales || 0

  const body = [...map.entries()]
    .filter(([label, group]) => shouldIncludeAggregateGroup(label, group))
    .sort(
      (a, b) =>
        summarizeSalesMethodGroup(b[0], b[1], channelGroups, manualFilterCtx).k.sales -
        summarizeSalesMethodGroup(a[0], a[1], channelGroups, manualFilterCtx).k.sales,
    )
    .map(([label, group]) =>
      salesMethodDataRow(label || '기타', group, totalSales, channelGroups, manualFilterCtx),
    )

  for (const entry of getSpecialSaleEntries(manualFilterCtx?.specialSale)) {
    const ssRow = specialSaleSalesMethodRow(entry, combinedTotal.sales || 0)
    if (ssRow) body.push(ssRow)
  }

  body.push(...collectExternalAdSupplementRows(channelGroups, manualFilterCtx))

  let salesMethodTotalCost = 0
  for (const [label, group] of map.entries()) {
    if (!shouldIncludeAggregateGroup(label, group)) continue
    salesMethodTotalCost += summarizeSalesMethodGroup(
      label,
      group,
      channelGroups,
      manualFilterCtx,
    ).totalCost
  }

  const totalRow = [
    '【합계】',
    fmtAmt(combinedTotal.sales),
    fmtAmt(salesMethodTotalCost),
    fmtAmt(combinedTotal.salesQty),
    fmtAmt(combinedTotal.netProfit),
    fmtPctDisp(combinedTotal.netProfitRate),
    fmtAmt(combinedTotal.adSpend),
    fmtAmt(combinedTotal.adSales),
    fmtAmt(combinedTotal.organicSales),
    totalSales ? '100.0%' : '',
  ]
  return { body, totalRow, productRows }
}

function buildPnlSummarySection(kpi, costKpi) {
  const b = finalizeCombinedKpi(kpi, costKpi)
  const sales = b.sales || 0
  const totalCost = b.totalCost || 0
  const gross = sales - totalCost
  const afterAd = gross - (b.adSpend || 0)

  const lines = [
    ['① 총 매출액', fmtAmt(sales), sales ? '100.0%' : ''],
    ['② 상품 원가', fmtAmt(totalCost), pctOfSales(totalCost, sales)],
    ['③ 매출총이익', fmtAmt(gross), pctOfSales(gross, sales)],
    ['④ 광고비', fmtAmt(b.adSpend), pctOfSales(b.adSpend, sales)],
    ['⑤ 광고비 차감 후 이익', fmtAmt(afterAd), pctOfSales(afterAd, sales)],
    ['⑥ 데이터상 최종 순이익', fmtAmt(b.netProfit), pctOfSales(b.netProfit, sales)],
    ['⑦ 최종 순이익률', fmtPctDisp(b.netProfitRate), fmtPctDisp(b.netProfitRate)],
  ]

  return [['손익계산 요약'], ['구분', '금액', '매출대비'], ...lines, []]
}

const INTEGRATED_DOD_GAP_COLS = 1
const INTEGRATED_DOD_LEFT_COLS = 3

function integratedDodRightCols(mode = 'day') {
  return mode === 'month' ? 6 : 5
}

/**
 * 손익계산 요약(A~C) + 전일 대비 매출(E~I) — ①요약리포트 나란히 배치
 * @param {ReturnType<import('./dayOverDaySales.js').computeDayOverDaySales>} dayOverDayRows
 */
export function buildIntegratedPnlAndDayOverDaySection(kpi, costKpi, dayOverDayRows, filterCtx = {}) {
  const pnlSection = buildPnlSummarySection(kpi, costKpi)
  const pnlTitle = pnlSection[0]
  const pnlHeader = pnlSection[1]
  const pnlLines = pnlSection.slice(2, -1)

  const mode = resolveSalesComparisonMode(filterCtx)
  const first = dayOverDayRows?.[0]
  const rightCols = integratedDodRightCols(mode)
  const dodTitle = [salesComparisonSectionTitle(mode)]
  const dodHeader =
    mode === 'month'
      ? [
          '구분',
          salesComparisonCurrentColumnLabel(mode),
          salesComparisonPrevColumnLabel(mode, first),
          salesComparisonChangeColumnLabel(mode),
          `${salesComparisonChangeColumnLabel(mode)}(%)`,
          '추이',
        ]
      : [
          '구분',
          salesComparisonCurrentColumnLabel(mode),
          salesComparisonPrevColumnLabel(mode, first),
          `${salesComparisonChangeColumnLabel(mode)}(%)`,
          '추이',
        ]
  const dodBody = (dayOverDayRows || []).map((r) =>
    mode === 'month'
      ? [
          r.platform,
          Math.round(r.currentSales),
          Math.round(r.prevSales),
          Math.round(r.changeAmount ?? r.currentSales - r.prevSales),
          r.changePct != null ? formatDayOverDayPct(r.changePct) : 'N/A',
          r.trend,
        ]
      : [
          r.platform,
          Math.round(r.currentSales),
          Math.round(r.prevSales),
          r.changePct != null ? formatDayOverDayPct(r.changePct) : '',
          r.trend,
        ],
  )

  const padLeft = (row) => {
    const out = [...(row || [])]
    while (out.length < INTEGRATED_DOD_LEFT_COLS) out.push('')
    return out.slice(0, INTEGRATED_DOD_LEFT_COLS)
  }
  const padRight = (row) => {
    const out = [...(row || [])]
    while (out.length < rightCols) out.push('')
    return out.slice(0, rightCols)
  }
  const gap = Array.from({ length: INTEGRATED_DOD_GAP_COLS }, () => '')
  const joinRow = (left, right) => [...padLeft(left), ...gap, ...padRight(right)]

  const rows = []
  rows.push(joinRow(pnlTitle, dodTitle))
  rows.push(joinRow(pnlHeader, dodHeader))

  const maxLen = Math.max(pnlLines.length, dodBody.length, 1)
  for (let i = 0; i < maxLen; i += 1) {
    rows.push(joinRow(pnlLines[i] || ['', '', ''], dodBody[i] || ['', '', '', '', '']))
  }
  rows.push([])
  return rows
}

/** @param {ReturnType<import('./dayOverDaySales.js').computeDayOverDaySales>} dayOverDayRows */
function buildIntegratedPnlSection(kpi, costKpi, dayOverDayRows, filterCtx = {}) {
  if (dayOverDayRows?.length) {
    return buildIntegratedPnlAndDayOverDaySection(kpi, costKpi, dayOverDayRows, filterCtx)
  }
  return buildPnlSummarySection(kpi, costKpi)
}

function buildSalesMethodSection(records, channelGroups, manualFilterCtx) {
  const { body, totalRow } = collectSalesMethodGroups(records, channelGroups, manualFilterCtx)
  return [['판매방식별 손익 계산'], SALES_METHOD_HEADERS, ...body, totalRow, []]
}

function salesMethodDataRow(label, group, totalSales, channelGroups, manualFilterCtx) {
  const { k, totalCost } = summarizeSalesMethodGroup(label, group, channelGroups, manualFilterCtx)
  const share = totalSales > 0 ? Number(((k.sales / totalSales) * 100).toFixed(1)) : null
  return [
    label,
    fmtAmt(k.sales),
    fmtAmt(totalCost),
    fmtAmt(k.salesQty),
    fmtAmt(k.netProfit),
    fmtPctDisp(k.netProfitRate),
    fmtAmt(k.adSpend),
    fmtAmt(k.adSales),
    fmtAmt(k.organicSales),
    share != null && share > 0 ? fmtPctDisp(share) : '',
  ]
}

function resolveStoreLabel(row) {
  const store = String(row.storeName || '').trim()
  if (store && !HIDDEN_GROUP_LABELS.has(store)) {
    return normalizeStoreLabel(store, row)
  }
  const brand = String(row.brand || '').trim()
  if (brand && !HIDDEN_GROUP_LABELS.has(brand)) {
    return normalizeStoreLabel(brand, row)
  }
  const src = String(row.dataSourceLabel || '').trim()
  if (src && !HIDDEN_GROUP_LABELS.has(src)) return src
  return ''
}

function buildStoreTableRows(records, channelGroups = [], manualFilterCtx = {}) {
  const productRows = (records || []).filter((r) => !isEsserSheetTotalRecord(r))
  const map = new Map()
  for (const row of productRows) {
    const key = resolveStoreLabel(row)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  for (const { label } of channelGroups || []) {
    if (!label || map.has(label)) continue
    if (storeHasExternalAd(channelGroups, label, manualFilterCtx)) {
      map.set(label, [])
    }
  }

  const body = [...map.entries()]
    .filter(
      ([label, group]) =>
        shouldIncludeAggregateGroup(label, group) ||
        storeHasExternalAd(channelGroups, label, manualFilterCtx),
    )
    .sort(
      (a, b) =>
        summarizeStoreGroup(b[0], b[1], channelGroups, manualFilterCtx).k.sales -
        summarizeStoreGroup(a[0], a[1], channelGroups, manualFilterCtx).k.sales,
    )
    .map(([store, group]) => {
      const { k, totalCost } = summarizeStoreGroup(store, group, channelGroups, manualFilterCtx)
      const qty = group.length
      return [
        store,
        fmtAmt(k.sales),
        fmtAmt(totalCost),
        fmtAmt(k.salesQty),
        fmtAmt(k.netProfit),
        fmtPctDisp(k.netProfitRate),
        fmtAmt(k.adSpend),
        fmtAmt(k.adSales),
        fmtAmt(k.organicSales),
        qty > 0 ? qty : '',
      ]
    })

  for (const entry of getSpecialSaleEntries(manualFilterCtx?.specialSale)) {
    const ssRow = specialSaleStoreRow(entry)
    if (ssRow) body.push(ssRow)
  }
  body.sort((a, b) => parseAmount(b[1]) - parseAmount(a[1]))

  const allForKpi = (records || []).filter((r) => !isReturnRecord(r))
  const combinedTotal = summarizeCombinedKpis(
    allForKpi.length ? allForKpi : records,
    channelGroups,
    manualFilterCtx,
  )
  const totalRow = [
    '【전체 합계】',
    fmtAmt(combinedTotal.sales),
    fmtAmt(combinedTotal.totalCost),
    fmtAmt(combinedTotal.salesQty),
    fmtAmt(combinedTotal.netProfit),
    fmtPctDisp(combinedTotal.netProfitRate),
    fmtAmt(combinedTotal.adSpend),
    fmtAmt(combinedTotal.adSales),
    fmtAmt(combinedTotal.organicSales),
    productRows.length || '',
  ]

  return [['스토어별 손익 현황'], STORE_HEADERS, ...body, [], totalRow, []]
}

function bucketToDailyDisplayRow(bucket, manualFilterCtx = {}) {
  const b = finalizeEsserBucket(bucket)
  return [
    periodLabel(bucket, manualFilterCtx),
    fmtAmt(b.sales),
    fmtAmt(b.totalCost),
    fmtAmt(b.salesQty),
    fmtAmt(b.netProfit),
    fmtPctDisp(b.netProfitRate),
    fmtAmt(b.adSpend),
    fmtAmt(b.adSales),
    fmtPctDisp(b.roas),
    fmtPctDisp(b.salesRoas),
    fmtAmt(b.organicSales),
    fmtPctDisp(b.organicSalesRate),
  ]
}

function inferSourceLabel(row) {
  return resolveRecordSourceLabel(row)
}

function filterRecordsBySourceLabel(records, sourceLabel) {
  return (records || []).filter((r) => resolveRecordSourceLabel(r) === sourceLabel)
}

function manualEntriesForBrand(channelGroups, brand) {
  if (brand === POWER_PRICE_LABEL) {
    return (channelGroups || []).find((g) => g.label === POWER_PRICE_LABEL)?.entries || []
  }
  return (channelGroups || [])
    .filter((g) => g.label === brand)
    .flatMap((g) => g.entries || [])
}

function aggregateBrandDailyBuckets(brand, records, channelGroups, manualFilterCtx) {
  const brandRecords = expandPeriodUploadRowsForDaily(
    filterRecordsBySourceLabel(records, brand),
  )
  const manual = manualEntriesForBrand(channelGroups, brand)
  if (!brandRecords.length && !manual.length) return []
  if (brand === POWER_PRICE_LABEL) {
    return aggregateEsserByDayWithManualSpendOnly(brandRecords, manual, manualFilterCtx)
  }
  return aggregateEsserByDayWithManual(brandRecords, manual, manualFilterCtx)
}

function dailyTotalRow(label, buckets) {
  if (!buckets?.length) return null
  const b = summarizeDailyBuckets(buckets)
  return [
    label,
    fmtAmt(b.sales),
    fmtAmt(b.totalCost),
    fmtAmt(b.salesQty),
    fmtAmt(b.netProfit),
    fmtPctDisp(b.netProfitRate),
    fmtAmt(b.adSpend),
    fmtAmt(b.adSales),
    fmtPctDisp(b.roas),
    fmtPctDisp(b.salesRoas),
    fmtAmt(b.organicSales),
    fmtPctDisp(b.organicSalesRate),
  ]
}

function appendDailyBlock(rows, sectionTitle, buckets, manualFilterCtx = {}) {
  if (!buckets?.length) return
  rows.push([], [`■ ${sectionTitle}`], DAILY_HEADERS)
  for (const b of buckets) {
    rows.push(bucketToDailyDisplayRow(b, manualFilterCtx))
  }
  const total = dailyTotalRow(`【${sectionTitle} 합계】`, buckets)
  if (total) rows.push([], total)
}

/** 일별 표시 합계 — 상단 KPI가 아닌 표에 나온 일별 행 합과 맞춤 */
function summarizeDailyBuckets(buckets) {
  const acc = {
    sales: 0,
    salesQty: 0,
    netProfit: 0,
    totalCost: 0,
    adSpend: 0,
    adSales: 0,
  }
  for (const bucket of buckets || []) {
    const b = finalizeEsserBucket(bucket)
    acc.sales += b.sales || 0
    acc.salesQty += b.salesQty || 0
    acc.netProfit += b.netProfit || 0
    acc.totalCost += b.totalCost || 0
    acc.adSpend += b.adSpend || 0
    acc.adSales += b.adSales || 0
  }
  return finalizeEsserBucket(acc)
}

function buildDailyTableRows(saleRecords, channelGroups, manualFilterCtx) {
  const rows = [['일별 요약']]

  for (const brand of DAILY_BRAND_ORDER) {
    const brandBuckets = aggregateBrandDailyBuckets(
      brand,
      saleRecords,
      channelGroups,
      manualFilterCtx,
    )
    appendDailyBlock(rows, brand, brandBuckets, manualFilterCtx)
  }

  return rows
}

/** ①요약리포트 맨 하단 — 통합 담당 코멘트 (비어 있어도 표 출력) */
function appendIntegratedCommentsSection(rows, combinedComments) {
  rows.push([])
  rows.push(...buildCombinedCommentsExcelBlock(combinedComments))
}

/**
 * 통합 매출 손익계산 요약리포트 (①요약리포트) — 참고 양식 레이아웃
 * @param {object} ctx
 */
export function buildIntegratedProfitLossSummaryRows(ctx) {
  const {
    saleRecords = [],
    channelGroups = [],
    manualFilterCtx = {},
    filters = {},
    totalKpi: totalKpiInput,
    costKpi = null,
    dayOverDayComputed = null,
    combinedComments = null,
  } = ctx

  const totalKpi =
    totalKpiInput ||
    summarizeCombinedKpis(saleRecords, channelGroups, manualFilterCtx)

  const rows = []
  rows.push(mergeTitleRow(INTEGRATED_TITLE))
  rows.push([reportBasisLabel(saleRecords, filters)])
  rows.push([
    `양식 v${INTEGRATED_REPORT_LAYOUT_VER} · 빌드 ${UI_BUILD_ID} · ①요약리포트 (통합 탭 전용)`,
  ])
  rows.push([])

  rows.push(...buildExternalAdRows(channelGroups, manualFilterCtx))
  rows.push(
    ...buildIntegratedSegmentKpiExcelRows(
      saleRecords,
      channelGroups,
      manualFilterCtx,
      COMBINED_HIDDEN_KPI_KEYS,
    ),
  )
  rows.push(...buildIntegratedPnlSection(totalKpi, costKpi, dayOverDayComputed, filters))
  rows.push(...buildSalesMethodSection(saleRecords, channelGroups, manualFilterCtx))
  rows.push(...buildStoreTableRows(saleRecords, channelGroups, manualFilterCtx))
  rows.push(...buildDailyTableRows(saleRecords, channelGroups, manualFilterCtx))
  appendIntegratedCommentsSection(rows, combinedComments)

  return rows
}

// ——— 템플릿 업로드용 (선택) ———

export function buildProfitLossReportContext(ctx) {
  const {
    saleRecords = [],
    channelGroups = [],
    manualFilterCtx = {},
    filters = {},
    splitRows: splitRowsInput,
  } = ctx

  const splitRows =
    splitRowsInput ||
    buildKpiSplitRowsForChannel('통합', saleRecords, channelGroups, manualFilterCtx)

  const totalRow = splitRows.find((r) => r.label === '합계')
  const totalKpi = totalRow
    ? { ...totalRow.ad, ...totalRow.profit }
    : summarizeCombinedKpis(saleRecords, channelGroups, manualFilterCtx)

  /** @type {Record<string, Record<string, number|null>>} */
  const byBrand = {}
  for (const brand of [...COMBINED_BRAND_KPI_LABELS, '파워프라이스']) {
    let kpi = null
    if (brand === '파워프라이스') {
      const ppRows = (saleRecords || []).filter((r) => isPowerPriceRecord(r))
      const ppManual =
        (channelGroups || []).find((g) => g.label === '파워프라이스')?.entries || []
      if (ppRows.length || ppManual.length) {
        kpi = summarizePowerPriceKpis(
          ppRows.filter((r) => !isEsserSheetTotalRecord(r)),
          ppManual,
          manualFilterCtx,
        )
      }
    } else {
      kpi = summarizeBrandKpis(brand, saleRecords, channelGroups, manualFilterCtx)
    }
    if (kpi) byBrand[brand] = { ...kpi }
  }
  for (const row of splitRows) {
    if (isManualAdKpiLabel(row.label)) continue
    byBrand[row.label] = { ...row.ad, ...row.profit }
  }

  return {
    splitRows,
    totalKpi,
    byBrand,
    meta: {
      period: dateRangeText(saleRecords, filters),
      generatedAt: new Date().toLocaleString('ko-KR'),
      reportTitle: '통합 매출 손익계산 리포트',
      dateFrom: filters.dateFrom || '',
      dateTo: filters.dateTo || '',
    },
  }
}

function kpiValue(kpi, fieldKey) {
  if (!kpi) return null
  const v = kpi[fieldKey]
  return v == null ? null : Number(v)
}

function resolvePlaceholderValue(reportCtx, parsed) {
  if (!parsed) return ''
  if (parsed.type === 'meta') return reportCtx.meta[parsed.key] ?? ''
  if (parsed.type === 'brand') {
    const n = kpiValue(reportCtx.byBrand[parsed.brand], parsed.fieldKey)
    return n == null ? '' : formatFieldValue(n, parsed.fieldKey)
  }
  if (parsed.type === 'field') {
    const n = kpiValue(reportCtx.totalKpi, parsed.fieldKey)
    return n == null ? '' : formatFieldValue(n, parsed.fieldKey)
  }
  return ''
}

export function buildProfitLossReportSheets(template, ctx) {
  if (!template?.sheets?.length) return []
  const reportCtx = buildProfitLossReportContext(ctx)
  const out = []
  for (const sheet of template.sheets) {
    const rows = cloneAoa(sheet.aoa)
    for (const ph of sheet.placeholders || []) {
      const val = resolvePlaceholderValue(reportCtx, ph.parsed)
      const current = String(rows[ph.row]?.[ph.col] ?? '')
      rows[ph.row][ph.col] = current.replace(
        new RegExp(`\\{\\{${ph.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g'),
        String(val),
      )
    }
    for (const binding of sheet.labelBindings || []) {
      const brandKpi = reportCtx.byBrand[binding.brand] || reportCtx.totalKpi
      const n = kpiValue(brandKpi, binding.fieldKey)
      if (n == null) continue
      if (!rows[binding.sheetRow]) rows[binding.sheetRow] = []
      rows[binding.sheetRow][binding.col] = formatFieldValue(n, binding.fieldKey)
    }
    out.push({ name: sheet.name, rows })
  }
  return out
}

export function profitLossTemplateGuideRows(template) {
  const rows = [
    ['■ 손익계산 템플릿 인식 요약'],
    ['원본 파일', template.fileName],
    ['업로드 시각', template.uploadedAt],
    [],
    ['※ 통합 엑셀 ①요약리포트는 고정 손익계산 양식으로 자동 생성됩니다.'],
    ['■ 사용 가능한 플레이스홀더 (선택 시트용)'],
    ['형식', '설명'],
    ['{{period}}', '선택 기간'],
    ['{{generatedAt}}', '생성 시각'],
  ]
  for (const [key, label] of Object.entries(PROFIT_LOSS_FIELD_LABELS)) {
    rows.push([`{{${key}}}`, `합계 ${label}`])
  }
  return rows
}
