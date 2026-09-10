import * as XLSX from 'xlsx'
import {
  addStyledSheet,
  colWidthsFromHeaders,
  colWidthsForIntegratedSummary,
  createBrandedWorkbook,
  downloadExcelWorkbook,
} from './excelWorkbookStyle.js'
import { COUPANG_ESSER_COLUMN_MAP } from '../config/coupangEsserColumnMap.js'
import {
  summarizeEsserKpis,
  summarizeReturnKpis,
  aggregateEsserByDay,
  aggregateEsserByWeek,
  aggregateEsserByMonth,
  finalizeEsserBucket,
  ESSER_KPI_CARDS,
  ESSER_PROFIT_KPI_CARDS,
  ESSER_AD_KPI_CARDS,
  deriveEsserProfitKpis,
  getEsserProfitKpiValue,
  resolveGroupTotalCost,
  resolveRowAdSpend,
  isEsserSheetTotalRecord,
} from './esserMetrics.js'
import { storeLabelFromRow } from './storeLabel.js'
import { getSalesMethod, salesMethodGroupLabel } from './salesMethodDetect.js'
import { parseSalesDate } from './dateParse.js'
import { getRecordDate } from './recordFilters.js'
import { parseAmount } from './parseAmount.js'
import { summarizeKpis } from './salesAggregation.js'
import { isReturnRecord, partitionSalesAndReturns } from './transactionType.js'
import { buildManualAdExcelBlocksByChannel } from './manualAdExcel.js'
import {
  summarizeEsserKpisWithManual,
  aggregateEsserByDayWithManual,
  aggregateEsserByDayWithManualSpendOnly,
  aggregateCombinedByDayWithManual,
  aggregateEsserByWeekWithManual,
  aggregateEsserByMonthWithManual,
} from './manualAdSpend.js'
import {
  AMOUNT_KEYS,
  normalizeEsserDetailFields,
  resolveDetailField,
  PERCENT_KEYS,
} from './formatDisplay.js'
import { resolveRecordPlatform } from './platformDetect.js'
import {
  buildKpiSplitRowsForChannel,
  summarizePowerPriceKpis,
  summarizeCombinedKpis,
  EXTERNAL_AD_KPI_LABEL,
  isExternalAdKpiNA,
  isPowerPriceKpiNA,
  kpiSplitSectionTitle,
} from './platformKpiSplit.js'
import {
  POWER_PRICE_DATA_SOURCE_LABEL,
  POWER_PRICE_HIDDEN_KPI_KEYS,
} from '../config/powerPrice.js'
import { matchesCombinedReportBrand, isEsserReportBrandChannel } from './recordSourceLabel.js'
import { OTHER_SELLERS_BRAND_LABEL } from '../config/closedMall.js'
import {
  buildProfitLossReportSheets,
  buildIntegratedProfitLossSummaryRows,
} from './profitLossReportExporter.js'
import { filterKpiCards } from '../config/combinedChannel.js'
import { buildIntegratedSegmentKpiExcelRows } from './integratedKpiExcel.js'
import {
  computeDayOverDaySales,
  computeCombinedBrandDayOverDaySales,
  computeCombinedSegmentDayOverDaySales,
  buildCombinedBrandMonthOverMonthFromSegmentRows,
  brandPrevSalesMapFromLookupRecords,
  buildDayOverDayExcelRows,
  resolveReferenceDateKey,
  resolveSalesComparisonMode,
} from './dayOverDaySales.js'
import { getSpecialSaleDisplayLabels } from './specialSaleKpi.js'

const REPORT_TITLE = '플랫폼 일별 매출 리포트'

/** 세그먼트 행·수기 특판에서 전월대비 특판 라벨 수집 */
function collectSpecialSaleLabelsFromRows(segmentRows, specialSale) {
  const labels = new Set(getSpecialSaleDisplayLabels(specialSale))
  for (const row of segmentRows || []) {
    if (row?.kind === 'special_sale' || row?.segmentKey === 'special_sale') {
      const label = String(row?.label || '').trim()
      if (label) labels.add(label)
    }
  }
  return [...labels]
}

/** 통합 엑셀 — 브랜드별 요약리포트 시트 */
const COMBINED_BRAND_SUMMARY_REPORTS = [
  {
    sourceLabel: '베스트하임',
    sheetName: '베스트하임 요약리포트',
    reportTitle: '베스트하임 일별 매출 리포트',
  },
  {
    sourceLabel: '에쎄르',
    sheetName: '에쎄르 요약리포트',
    reportTitle: '에쎄르 일별 매출 리포트',
  },
  {
    sourceLabel: POWER_PRICE_DATA_SOURCE_LABEL,
    sheetName: '파워프라이스 요약리포트',
    reportTitle: '파워프라이스 일별 매출 리포트',
    powerPrice: true,
  },
  {
    sourceLabel: OTHER_SELLERS_BRAND_LABEL,
    sheetName: '기타 판매처 요약리포트',
    reportTitle: '기타 판매처 일별 매출 리포트',
    otherSellers: true,
  },
]

function filterRecordsBySourceLabel(records, sourceLabel) {
  return (records || []).filter((r) => matchesCombinedReportBrand(r, sourceLabel))
}

function hasCombinedSourceLabels(records) {
  return COMBINED_BRAND_SUMMARY_REPORTS.some((b) =>
    (records || []).some((r) => matchesCombinedReportBrand(r, b.sourceLabel)),
  )
}

function buildCombinedBrandSummarySheets({
  saleRecords,
  returnRecords,
  filters,
  manualFilterCtx,
  channelGroups,
  dayOverDayLookupProductRecords,
  dodRefProductRecords,
}) {
  const sheets = []

  for (const brand of COMBINED_BRAND_SUMMARY_REPORTS) {
    const brandSale = filterRecordsBySourceLabel(saleRecords, brand.sourceLabel)
    const brandReturns = filterRecordsBySourceLabel(returnRecords, brand.sourceLabel)
    if (!brandSale.length && !brandReturns.length) continue

    const brandManualGroup = channelGroups.filter(
      (g) =>
        g.label === brand.sourceLabel ||
        (brand.sourceLabel === '에쎄르' && isEsserReportBrandChannel(g.label)),
    )
    const brandManualEntries = brandManualGroup.flatMap((g) => g.entries || [])

    const brandDodRef = filterRecordsBySourceLabel(dodRefProductRecords, brand.sourceLabel)
    const brandDodLookup = filterRecordsBySourceLabel(
      dayOverDayLookupProductRecords,
      brand.sourceLabel,
    )
    const brandDayOverDay = brandDodRef.length
      ? computeDayOverDaySales(brandDodRef, {
          manualAdEntries: brandManualEntries,
          manualFilterCtx,
          lookupRows: brandDodLookup,
          referenceDateKey:
            resolveReferenceDateKey(brandDodRef, manualFilterCtx) || undefined,
        })
      : null

    const brandKpi = brand.powerPrice
      ? summarizePowerPriceKpis(
          brandSale.filter((r) => !isEsserSheetTotalRecord(r)),
          brandManualEntries,
          manualFilterCtx,
        )
      : summarizeEsserKpisWithManual(brandSale, brandManualEntries, manualFilterCtx)
    const brandReturnKpi = summarizeReturnKpis(brandReturns)

    sheets.push({
      name: brand.sheetName,
      rows: buildSummaryReportSheet({
        kpi: brandKpi,
        returnKpi: brandReturnKpi,
        returnCount: brandReturns.length,
        filters,
        records: brandSale,
        manualAdByChannel: brandManualGroup,
        manualFilterCtx,
        dayOverDayComputed: brandDayOverDay,
        hiddenKpiKeys: brand.powerPrice ? POWER_PRICE_HIDDEN_KPI_KEYS : [],
        reportTitle: brand.reportTitle,
        brandLabel: brand.sourceLabel,
        channelLabel: brand.powerPrice ? POWER_PRICE_DATA_SOURCE_LABEL : '',
      }),
    })
  }

  return sheets
}

const DETAIL_TOTAL_SKIP_KEYS = new Set([
  'date',
  'platform',
  'salesMethod',
  'storeName',
  'productName',
  'option',
  'productId',
  'optionId',
  'productCode',
  'sourceFileName',
  'unitCost',
  'salePrice',
])

/** ①요약리포트 · 판매/반품 품목 블록 */
const SUMMARY_PRODUCT_COLUMNS = [
  { key: 'date', label: '날짜' },
  { key: 'platform', label: '플랫폼' },
  { key: 'salesMethod', label: '판매방식' },
  { key: 'storeName', label: '스토어' },
  { key: 'productName', label: '상품명' },
  { key: 'option', label: '옵션' },
  { key: 'salesQty', label: '판매수량' },
  { key: 'salePrice', label: '판매가' },
  { key: 'grossSales', label: '할인전매출' },
  { key: 'sales', label: '매출' },
  { key: 'unitCost', label: '원가단가' },
  { key: 'totalCost', label: '원가합계' },
  { key: 'netProfit', label: '순이익금' },
  { key: 'adSpend', label: '광고비' },
]

const PERIOD_HEADERS = [
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

/** 파워프라이스 — 일반 기간표와 동일 지표 (광고·자연매출·ROAS) */
const POWER_PRICE_PERIOD_HEADERS = [
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

const EXPORT_FORMAT_VERSION = '서식v5'
const DETAIL_SHEET_NAME = '⑧상세_판매'

/** 스마트스토어 KPI — 원가 미입력 시 매출−마진 임시 역산 (대시보드와 동일) */
function shouldEstimateKpiCostFromMargin(platformLabel, manualFilterCtx = {}) {
  if (platformLabel === '스마트스토어') return true
  const p = manualFilterCtx.platform === '네이버' ? '스마트스토어' : manualFilterCtx.platform
  return p === '스마트스토어'
}

function appendPlatformProfitKpiTable(rows, splitRows, hiddenKpiKeys = []) {
  const profitCards = filterKpiCards(ESSER_PROFIT_KPI_CARDS, hiddenKpiKeys)
  rows.push([`■ ${kpiSplitSectionTitle(splitRows, 'profit')}`])
  rows.push(['구분', ...profitCards.map((c) => c.label), '상품행수'])
  for (const row of splitRows) {
    rows.push([
      row.label,
      ...profitCards.map((c) =>
        kpiExportValue(
          c.key,
          isExternalAdKpiNA(row.label, 'profit', c.key) ||
            isPowerPriceKpiNA(row.label, 'profit', c.key)
            ? null
            : (row.profit[c.key] ?? 0),
        ),
      ),
      row.rowCount,
    ])
  }
  rows.push([])
}

function appendPlatformAdKpiTable(rows, splitRows, hiddenKpiKeys = []) {
  const adCards = filterKpiCards(ESSER_AD_KPI_CARDS, hiddenKpiKeys)
  rows.push([`■ ${kpiSplitSectionTitle(splitRows, 'ad')}`])
  rows.push(['구분', ...adCards.map((c) => c.label)])
  for (const row of splitRows) {
    rows.push([
      row.label,
      ...adCards.map((c) =>
        kpiExportValue(
          c.key,
          isExternalAdKpiNA(row.label, 'ad', c.key) ||
            isPowerPriceKpiNA(row.label, 'ad', c.key)
            ? null
            : (row.ad[c.key] ?? 0),
        ),
      ),
    ])
  }
  rows.push([])
}

/** 통합 KPI 시트 — 세그먼트 표 (웹과 동일) */
function appendCombinedSegmentKpiTables(rows, saleRecords, channelGroups, manualFilterCtx, hiddenKpiKeys) {
  rows.push(
    ...buildIntegratedSegmentKpiExcelRows(
      saleRecords,
      channelGroups,
      manualFilterCtx,
      hiddenKpiKeys,
    ),
  )
}

function appendCostVerificationRow(rows, profitKpi, skip = false) {
  if (skip) return
  rows.push([
    '원가 합계(검증)',
    formatKpiExcelValue('sales', profitKpi.totalCost ?? 0),
    '위 「총 원가」와 동일 — 원가율 = 총 원가 ÷ 매출 × 100',
  ])
}

/**
 * @param {object} opts
 */
function buildKpiSheetAoA({
  totalKpi,
  costKpiAll,
  returnKpi,
  returnCount,
  manualAdByChannel = [],
  saleRecords = [],
  manualFilterCtx = {},
  dayOverDayComputed = null,
  hiddenKpiKeys = [],
  hideCostVerificationRow = false,
  channelLabel = '',
}) {
  const rows = []
  const manualExcelOpts = {
    period: manualFilterCtx.period || 'daily',
    filterCtx: manualFilterCtx,
  }
  if (manualAdByChannel.some((g) => g.entries?.length)) {
    rows.push(...buildManualAdExcelBlocksByChannel(manualAdByChannel, manualExcelOpts))
  }

  const splitRows = buildKpiSplitRowsForChannel(
    channelLabel,
    saleRecords,
    manualAdByChannel,
    manualFilterCtx,
  )
  if (channelLabel === '통합') {
    appendCombinedSegmentKpiTables(rows, saleRecords, manualAdByChannel, manualFilterCtx, hiddenKpiKeys)
  } else {
    appendPlatformProfitKpiTable(rows, splitRows, hiddenKpiKeys)
    appendPlatformAdKpiTable(rows, splitRows, hiddenKpiKeys)
  }

  if (dayOverDayComputed?.length) {
    rows.push(...buildDayOverDayExcelRows(dayOverDayComputed))
  }

  rows.push(['■ KPI 산출 기준 (합계 행 = 아래 표 「합계」 열)'])
  rows.push(['지표', '값', '산출 기준'])
  const profitKpi =
    splitRows.find((r) => r.label === '합계')?.profit ??
    deriveEsserProfitKpis(totalKpi, {
      estimateCostFromMargin: shouldEstimateKpiCostFromMargin('', manualFilterCtx),
      productKpi: summarizeEsserKpis(saleRecords.filter((r) => !isEsserSheetTotalRecord(r))),
    })
  const visibleKpiCards = filterKpiCards(ESSER_KPI_CARDS, hiddenKpiKeys)
  for (const card of visibleKpiCards) {
    const raw = profitKpi[card.key] ?? totalKpi[card.key] ?? 0
    rows.push([card.label, kpiExportValue(card.key, raw), card.hint])
  }
  appendCostVerificationRow(rows, profitKpi, hideCostVerificationRow)
  if (returnCount > 0 && returnKpi) {
    rows.push(
      [],
      ['■ 반품·취소 (별도)'],
      ['반품 건수', returnCount, '매출 KPI 미포함'],
      ['반품 매출(절대값)', formatKpiExcelValue('sales', returnKpi.sales), '반품 행 매출 절대값 합'],
      ['반품 수량(절대값)', formatKpiExcelValue('salesQty', returnKpi.salesQty), '반품 행 수량 절대값 합'],
    )
  }
  return rows
}

function prepareExportRecords(records) {
  return (records || []).map(normalizeEsserDetailFields)
}

/** 빅셀/에쎄르 원본에 가까운 전체 컬럼 */
const FULL_DETAIL_COLUMNS = [
  { key: 'date', label: '날짜' },
  { key: 'platform', label: '플랫폼' },
  { key: 'salesMethod', label: '판매방식' },
  { key: 'storeName', label: '스토어명' },
  { key: 'brand', label: '브랜드' },
  { key: 'productId', label: '노출상품ID' },
  { key: 'optionId', label: '옵션ID' },
  { key: 'productCode', label: '자체상품코드' },
  { key: 'productName', label: '상품명' },
  { key: 'option', label: '옵션명' },
  { key: 'salePrice', label: '판매가' },
  { key: 'unitCost', label: '원가' },
  { key: 'salesQty', label: '판매수량' },
  { key: 'totalCost', label: '판매수량 원가' },
  { key: 'grossSales', label: '할인전매출' },
  { key: 'sales', label: '매출' },
  { key: 'netProfit', label: '순이익금' },
  { key: 'marginRate', label: '순이익금 비율' },
  { key: 'adQty', label: '광고 판매수량' },
  { key: 'adQtyRate', label: '광고 판매수량 비율' },
  { key: 'organicQty', label: '자연 판매수량' },
  { key: 'organicQtyRate', label: '자연 판매수량 비율' },
  { key: 'adSpend', label: '광고집행비' },
  { key: 'adSpendRate', label: '광고집행비 비율' },
  { key: 'adSales', label: '광고매출' },
  { key: 'adSalesRate', label: '광고매출 비율' },
  { key: 'adConversionRate', label: '광고판매전환율' },
  { key: 'adRoas', label: '광고 ROAS' },
  { key: 'adProfit', label: '광고집행 이익금' },
  { key: 'adNetProfit', label: '광고집행 순이익금' },
  { key: 'adNetProfitRate', label: '광고집행 순이익율' },
  { key: 'sourceFileName', label: '원본파일명' },
]

const KOREAN_ESSER_KEYS = Object.entries(COUPANG_ESSER_COLUMN_MAP).map(([label, key]) => ({
  key,
  label,
}))

const KPI_PERCENT_KEYS = new Set([
  'netProfitRate',
  'costRate',
  'roas',
  'salesRoas',
  'organicSalesRate',
  'adSpendRate',
  'adSalesRate',
  'adQtyRate',
  'organicQtyRate',
  'marginRate',
  'net_profit_rate',
])

/** 엑셀 KPI·표 공통 — %·ROAS는 퍼센트 포인트(237.5=237.5%). 서식은 excelWorkbookStyle에서 % 변환 */
function kpiExportValue(key, value) {
  if (value == null) return '—'
  if (KPI_PERCENT_KEYS.has(key)) return roundMetric(key, value)
  return formatKpiExcelValue(key, value)
}

function roundMetric(key, value) {
  const n = Number(value) || 0
  if (KPI_PERCENT_KEYS.has(key)) return Number(n.toFixed(2))
  if (key === 'salesQty') return Math.round(n)
  return Math.round(n)
}

/** KPI 엑셀: 금액=숫자+원서식, %지표=Excel %용 소수(915.5% → 9.155) */
export function formatKpiExcelValue(key, value) {
  const n = Number(value) || 0
  if (KPI_PERCENT_KEYS.has(key)) {
    return Number((n / 100).toFixed(6))
  }
  if (key === 'aov') return Math.round(n)
  if (key === 'salesQty') return Math.round(n)
  return Math.round(n)
}

function periodRowLabel(bucket, labelOverride) {
  const direct = labelOverride ?? bucket.label ?? ''
  if (direct !== '') return direct
  if (bucket.sortTime) {
    const d = new Date(bucket.sortTime)
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  return ''
}

function bucketToRow(bucket, labelOverride) {
  const b = finalizeEsserBucket(bucket)
  return [
    periodRowLabel(bucket, labelOverride),
    roundMetric('sales', b.sales),
    Math.round(b.totalCost || 0),
    roundMetric('salesQty', b.salesQty),
    roundMetric('netProfit', b.netProfit),
    roundMetric('netProfitRate', b.netProfitRate),
    roundMetric('adSpend', b.adSpend),
    roundMetric('adSales', b.adSales),
    roundMetric('roas', b.roas),
    roundMetric('salesRoas', b.salesRoas),
    roundMetric('organicSales', b.organicSales),
    roundMetric('organicSalesRate', b.organicSalesRate),
  ]
}

function bucketToPowerPriceRow(bucket, labelOverride) {
  return bucketToRow(bucket, labelOverride)
}

function kpiToPowerPriceRow(label, kpi, costKpi = null) {
  return kpiToRow(label, kpi, costKpi)
}

function kpiToRow(label, kpi, costKpi = null) {
  const totalCost = costKpi?.totalCost ?? kpi.totalCost ?? 0
  return [
    label,
    roundMetric('sales', kpi.sales),
    Math.round(totalCost),
    roundMetric('salesQty', kpi.salesQty),
    roundMetric('netProfit', kpi.netProfit),
    roundMetric('netProfitRate', kpi.netProfitRate),
    roundMetric('adSpend', kpi.adSpend),
    roundMetric('adSales', kpi.adSales),
    roundMetric('roas', kpi.roas),
    roundMetric('salesRoas', kpi.salesRoas),
    roundMetric('organicSales', kpi.organicSales),
    roundMetric('organicSalesRate', kpi.organicSalesRate),
  ]
}

function exportPercentValue(val) {
  const s = String(val).trim()
  if (!s) return ''
  const n = parseAmount(s.replace('%', ''))
  if (!Number.isFinite(n)) return s
  if (s.includes('%')) return n / 100
  if (Math.abs(n) > 1) return n / 100
  return n
}

function exportCellValue(row, key) {
  const val = resolveDetailField(row, key)
  if (val === '' || val == null) return ''
  if (PERCENT_KEYS.has(key)) return exportPercentValue(val)
  if (!AMOUNT_KEYS.has(key)) return val
  const n = parseAmount(val)
  if (Number.isFinite(n)) return n
  return String(val)
}

function buildTableRows(columns, records) {
  const header = columns.map((c) => c.label)
  const body = records.map((row) => {
    const normalized = normalizeEsserDetailFields(row)
    return columns.map((c) => exportCellValue(normalized, c.key))
  })
  return { header, body }
}

function buildProductTotalRow(columns, records, label = '【소계】') {
  const normalized = records.map(normalizeEsserDetailFields)
  const kpi = summarizeEsserKpis(normalized)
  const cost = summarizeKpis(normalized)
  return columns.map((col, i) => {
    if (i === 0) return label
    if (['storeName', 'productName', 'option', 'platform', 'salesMethod'].includes(col.key)) {
      return ''
    }
    switch (col.key) {
      case 'salesQty':
        return roundMetric('salesQty', kpi.salesQty)
      case 'salePrice':
        return ''
      case 'grossSales': {
        let sum = 0
        for (const r of normalized) sum += parseAmount(resolveDetailField(r, 'grossSales'))
        return sum > 0 ? Math.round(sum) : ''
      }
      case 'sales':
        return roundMetric('sales', kpi.sales)
      case 'unitCost':
        return ''
      case 'totalCost':
        return Math.round(cost.totalCost)
      case 'netProfit':
        return roundMetric('netProfit', kpi.netProfit)
      case 'adSpend':
        return roundMetric('adSpend', kpi.adSpend)
      default:
        return ''
    }
  })
}

function appendTotalRow(rows, totalKpi, label = '【합계】', records = null, costKpiOverride = null) {
  const costKpi = costKpiOverride ?? (records?.length ? summarizeKpis(records) : null)
  return [...rows, [], kpiToRow(label, totalKpi, costKpi)]
}

function sumField(list, key) {
  let sum = 0
  let any = false
  for (const r of list) {
    if (key === 'adSpend') {
      const n = resolveRowAdSpend(r)
      if (!n) continue
      any = true
      sum += n
      continue
    }
    const raw = resolveDetailField(r, key)
    if (raw === '' || raw == null) continue
    any = true
    sum += parseAmount(raw)
  }
  return any ? sum : null
}

function summarizeEsserBuckets(buckets) {
  const acc = {
    sales: 0,
    salesQty: 0,
    netProfit: 0,
    totalCost: 0,
    adSpend: 0,
    adSales: 0,
  }
  for (const bucket of buckets) {
    const b = finalizeEsserBucket(bucket)
    acc.sales += b.sales
    acc.salesQty += b.salesQty
    acc.netProfit += b.netProfit
    acc.totalCost += b.totalCost
    acc.adSpend += b.adSpend
    acc.adSales += b.adSales
  }
  return finalizeEsserBucket(acc)
}

function detailTotalCell(list, col, kpi, cost) {
  if (col.key === 'date') return null
  if (DETAIL_TOTAL_SKIP_KEYS.has(col.key)) return ''

  if (col.key === 'totalCost') {
    const fromCost = Math.round(cost.totalCost)
    if (fromCost) return fromCost
    const s = sumField(list, 'totalCost')
    return s != null ? Math.round(s) : ''
  }

  if (col.key === 'marginRate') {
    const salesSum = sumField(list, 'sales')
    const profit = sumField(list, 'netProfit')
    if (salesSum == null || salesSum === 0) return ''
    const p = profit != null ? profit : kpi.netProfit
    return Number((p / Math.abs(salesSum)).toFixed(6))
  }

  if (col.key === 'adRoas') {
    const spend = sumField(list, 'adSpend')
    const adSales = sumField(list, 'adSales')
    if (spend == null || spend === 0 || adSales == null) return ''
    return (adSales / spend) * 100
  }

  if (PERCENT_KEYS.has(col.key)) {
    return ''
  }

  if (AMOUNT_KEYS.has(col.key)) {
    const s = sumField(list, col.key)
    if (s == null) return ''
    if (col.key === 'salesQty' || col.key === 'quantity' || col.key === 'adQty' || col.key === 'organicQty') {
      return Math.round(s)
    }
    return Math.round(s)
  }

  return ''
}

function appendDetailTotalRow(rows, records, label = '【합계】') {
  const list = prepareExportRecords(records)
  const kpi = summarizeEsserKpis(list)
  const cost = summarizeKpis(list)
  const totalRow = FULL_DETAIL_COLUMNS.map((col) => {
    if (col.key === 'date') return label
    return detailTotalCell(list, col, kpi, cost)
  })
  return [...rows, [], totalRow]
}

function dateRangeText(records) {
  const dates = records
    .map((r) => parseSalesDate(getRecordDate(r)))
    .filter(Boolean)
    .sort((a, b) => a.date - b.date)
  if (!dates.length) return '기간 미상'
  const f = dates[0]
  const l = dates[dates.length - 1]
  if (f.year === l.year && f.month === l.month && f.day === l.day) {
    return `${f.year}년 ${f.month}월 ${f.day}일`
  }
  return `${f.year}.${f.month}.${f.day} ~ ${l.year}.${l.month}.${l.day}`
}

function sortProductRows(records) {
  return [...records].sort((a, b) => {
    const da = getRecordDate(a) || ''
    const db = getRecordDate(b) || ''
    if (da !== db) return db.localeCompare(da)
    return parseAmount(b.sales ?? b.actualPayment) - parseAmount(a.sales ?? a.actualPayment)
  })
}

function buildProductTableBlock(records) {
  if (!records.length) return [['(해당 없음)']]
  const sorted = sortProductRows(records)
  const { header, body } = buildTableRows(SUMMARY_PRODUCT_COLUMNS, sorted)
  const totalRow = buildProductTotalRow(SUMMARY_PRODUCT_COLUMNS, sorted)
  return [header, ...body, [], totalRow]
}

function buildSummaryProductSection(records) {
  const list = prepareExportRecords(records)
  const { sales, returns } = partitionSalesAndReturns(list)
  const productSales = sales.filter((r) => !isEsserSheetTotalRecord(r))
  const rows = []
  rows.push([`판매 ${productSales.length}건`])
  rows.push(...buildProductTableBlock(productSales))
  if (returns.length) {
    rows.push([])
    rows.push([
      '※ 반품',
      `${returns.length}건`,
      '⑨반품 시트·화면 맨 아래 반품 탭에서만 조회 (매출 KPI 제외)',
    ])
  }
  return rows
}

function buildSummaryReportSheet({
  kpi,
  returnKpi,
  returnCount,
  filters,
  records,
  manualAdByChannel = [],
  manualFilterCtx = {},
  dayOverDayComputed = null,
  hiddenKpiKeys = [],
  reportTitle = REPORT_TITLE,
  brandLabel = '',
  hideCostVerificationRow = false,
  channelLabel = '',
}) {
  const list = prepareExportRecords(records)
  const costKpi = summarizeKpis(list)
  const rows = []
  rows.push([reportTitle])
  if (brandLabel) rows.push(['브랜드', brandLabel])
  rows.push(['플랫폼', filters.platform || '전체'])
  rows.push(['판매방식', filters.salesMethod || '전체 취합 (로켓+판매자)'])
  rows.push(['리포트 형식', `${EXPORT_FORMAT_VERSION} (색상·KPI·원가)`])
  rows.push(['생성 시각', new Date().toLocaleString('ko-KR')])
  rows.push(['데이터 기간', dateRangeText(list)])
  rows.push(['판매 데이터 건수', `${list.length}건`])
  if (returnCount > 0) {
    rows.push(['반품·취소 건수', `${returnCount}건`, '매출 KPI·일별 추이에서 제외'])
  }
  rows.push([])

  const manualExcelOpts = {
    period: manualFilterCtx.period || 'daily',
    filterCtx: manualFilterCtx,
  }
  if (manualAdByChannel.some((g) => g.entries?.length)) {
    rows.push(...buildManualAdExcelBlocksByChannel(manualAdByChannel, manualExcelOpts))
  }

  if (dayOverDayComputed?.length) {
    rows.push(...buildDayOverDayExcelRows(dayOverDayComputed))
  }

  rows.push(['■ 핵심 KPI · 판매만 (반품 제외)'])
  const splitRows = buildKpiSplitRowsForChannel(channelLabel, list, manualAdByChannel, manualFilterCtx)
  appendPlatformProfitKpiTable(rows, splitRows, hiddenKpiKeys)
  appendPlatformAdKpiTable(rows, splitRows, hiddenKpiKeys)
  rows.push(['지표', '값', '산출 기준 (합계·필터 적용)'])
  const profitKpi =
    splitRows.find((r) => r.label === '합계')?.profit ??
    deriveEsserProfitKpis(kpi, {
      estimateCostFromMargin: shouldEstimateKpiCostFromMargin('', manualFilterCtx),
      productKpi: summarizeEsserKpis(list.filter((r) => !isEsserSheetTotalRecord(r))),
    })
  const visibleKpiCards = filterKpiCards(ESSER_KPI_CARDS, hiddenKpiKeys)
  for (const card of visibleKpiCards) {
    const raw = profitKpi[card.key] ?? kpi[card.key] ?? 0
    rows.push([card.label, kpiExportValue(card.key, raw), card.hint])
  }
  appendCostVerificationRow(rows, profitKpi, hideCostVerificationRow)
  if (returnCount > 0 && returnKpi) {
    rows.push([])
    rows.push(['■ 반품·취소 집계 (별도, 매출 KPI 미포함)'])
    rows.push(['지표', '값', '산출 기준'])
    rows.push(['반품 건수', returnCount, '마이너스 매출·수량 행'])
    rows.push([
      '반품 매출(절대값)',
      formatKpiExcelValue('sales', returnKpi.sales),
      '반품 행 매출 절대값 합',
    ])
    rows.push([
      '반품 수량(절대값)',
      formatKpiExcelValue('salesQty', returnKpi.salesQty),
      '반품 행 수량 절대값 합',
    ])
    rows.push([
      '반품 순이익(절대값)',
      formatKpiExcelValue('netProfit', returnKpi.netProfit),
      '반품 행 순이익 절대값 합',
    ])
  }
  rows.push([])

  rows.push(['■ 판매방식별 요약'])
  rows.push(...buildSalesMethodSheet(list))
  rows.push([])

  rows.push(['■ 일별 요약'])
  const daily = aggregateEsserByDay(list)
  rows.push(PERIOD_HEADERS)
  const dailyTop = daily.slice(-14)
  for (const d of dailyTop) rows.push(bucketToRow(d))
  if (daily.length) {
    rows.push(kpiToRow('【일별 표시 합계】', summarizeEsserKpis(list), costKpi))
  }
  rows.push([])

  rows.push(['※ 시트 안내', '요약=KPI·일별 | ⑧상세=전체컬럼 | ⑪빅셀=한글헤더 | ⑩순위·⑦스토어=집계'])
  return rows
}

function buildPowerPriceSalesMethodSheet(records) {
  const headers = [
    '판매방식',
    '매출',
    '원가',
    '판매수량',
    '순이익금',
    '순이익률(%)',
    '광고비',
    '상품행수',
    '매출비중(%)',
  ]
  const map = new Map()
  for (const row of records) {
    const label = salesMethodGroupLabel(row) || '미분류'
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(row)
  }
  const body = [...map.entries()]
    .sort((a, b) => summarizeEsserKpis(b[1]).sales - summarizeEsserKpis(a[1]).sales)
    .map(([label, group]) => {
      const k = summarizeEsserKpis(group)
      const c = summarizeKpis(group)
      const totalSales = summarizeEsserKpis(records).sales
      const share = totalSales > 0 ? ((k.sales / totalSales) * 100).toFixed(1) : '0'
      return [
        label,
        roundMetric('sales', k.sales),
        Math.round(c.totalCost),
        roundMetric('salesQty', k.salesQty),
        roundMetric('netProfit', k.netProfit),
        roundMetric('netProfitRate', k.netProfitRate),
        roundMetric('adSpend', k.adSpend),
        group.length,
        Number(share),
      ]
    })
  const total = summarizeEsserKpis(records)
  const costAll = summarizeKpis(records)
  const totalRow = [
    '【합계】',
    roundMetric('sales', total.sales),
    Math.round(costAll.totalCost),
    roundMetric('salesQty', total.salesQty),
    roundMetric('netProfit', total.netProfit),
    roundMetric('netProfitRate', total.netProfitRate),
    roundMetric('adSpend', total.adSpend),
    records.length,
    100,
  ]
  return [headers, ...body, [], totalRow]
}

function buildSalesMethodSheet(records) {
  const headers = [
    '판매방식',
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
    '상품행수',
    '매출비중(%)',
  ]
  const map = new Map()
  for (const row of records) {
    const label = salesMethodGroupLabel(row) || '미분류'
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(row)
  }
  const body = [...map.entries()]
    .sort((a, b) => summarizeEsserKpis(b[1]).sales - summarizeEsserKpis(a[1]).sales)
    .map(([label, group]) => {
      const k = summarizeEsserKpis(group)
      const c = summarizeKpis(group)
      const totalCost = resolveGroupTotalCost(label, group, k, c.totalCost)
      const totalSales = summarizeEsserKpis(records).sales
      const share = totalSales > 0 ? ((k.sales / totalSales) * 100).toFixed(1) : '0'
      return [
        label,
        roundMetric('sales', k.sales),
        Math.round(totalCost),
        roundMetric('salesQty', k.salesQty),
        roundMetric('netProfit', k.netProfit),
        roundMetric('netProfitRate', k.netProfitRate),
        roundMetric('adSpend', k.adSpend),
        roundMetric('adSales', k.adSales),
        roundMetric('roas', k.roas),
        roundMetric('salesRoas', k.salesRoas),
        roundMetric('organicSales', k.organicSales),
        roundMetric('organicSalesRate', k.organicSalesRate),
        group.length,
        Number(share),
      ]
    })
  const total = summarizeEsserKpis(records)
  let salesMethodTotalCost = 0
  for (const [label, group] of map.entries()) {
    const k = summarizeEsserKpis(group)
    salesMethodTotalCost += resolveGroupTotalCost(label, group, k, summarizeKpis(group).totalCost)
  }
  const totalRow = [
    '【합계】',
    roundMetric('sales', total.sales),
    Math.round(salesMethodTotalCost),
    roundMetric('salesQty', total.salesQty),
    roundMetric('netProfit', total.netProfit),
    roundMetric('netProfitRate', total.netProfitRate),
    roundMetric('adSpend', total.adSpend),
    roundMetric('adSales', total.adSales),
    roundMetric('roas', total.roas),
    roundMetric('salesRoas', total.salesRoas),
    roundMetric('organicSales', total.organicSales),
    roundMetric('organicSalesRate', total.organicSalesRate),
    records.length,
    100,
  ]
  return [headers, ...body, [], totalRow]
}

function buildPeriodSheet(buckets, totalKpi, sectionTitle, costKpi = null) {
  const title = sectionTitle ? (sectionTitle.startsWith('■') ? sectionTitle : `■ ${sectionTitle}`) : ''
  const rows = title ? [[title], PERIOD_HEADERS] : [PERIOD_HEADERS]
  for (const b of buckets) rows.push(bucketToRow(b))
  return appendTotalRow(rows, totalKpi, '【합계】', null, costKpi)
}

function buildPowerPricePeriodSheet(buckets, totalKpi, sectionTitle, costKpi = null) {
  const title = sectionTitle ? (sectionTitle.startsWith('■') ? sectionTitle : `■ ${sectionTitle}`) : ''
  const rows = title ? [[title], POWER_PRICE_PERIOD_HEADERS] : [POWER_PRICE_PERIOD_HEADERS]
  for (const b of buckets) rows.push(bucketToPowerPriceRow(b))
  const cost = costKpi ?? null
  return [...rows, [], kpiToPowerPriceRow('【합계】', totalKpi, cost)]
}

function buildPeriodSection(sectionTitle, buckets) {
  const rows = [[`■ ${sectionTitle}`], PERIOD_HEADERS]
  for (const b of buckets) rows.push(bucketToRow(b))
  if (buckets.length) {
    const sectionKpi = summarizeEsserBuckets(buckets)
    const sectionCost = {
      totalCost: buckets.reduce(
        (s, b) => s + Math.round(finalizeEsserBucket(b).totalCost || 0),
        0,
      ),
    }
    rows.push([], kpiToRow(`【${sectionTitle} 합계】`, sectionKpi, sectionCost))
  }
  return rows
}

function buildCombinedPeriodSheet(records, filterYear) {
  const daily = aggregateEsserByDay(records)
  const weekly = aggregateEsserByWeek(records, filterYear)
  const monthly = aggregateEsserByMonth(records, filterYear)
  return [
    ...buildPeriodSection('일별 추이', daily),
    [],
    ...buildPeriodSection('주별 추이', weekly),
    [],
    ...buildPeriodSection('월별 추이', monthly),
  ]
}

function buildStoreSheet(records) {
  const headers = [...PERIOD_HEADERS.slice(0, 1), '스토어명', ...PERIOD_HEADERS.slice(1), '상품행수']
  const map = new Map()
  for (const row of records) {
    const store = storeLabelFromRow(row)
    if (!map.has(store)) map.set(store, [])
    map.get(store).push(row)
  }
  const body = [...map.entries()]
    .sort((a, b) => summarizeEsserKpis(b[1]).sales - summarizeEsserKpis(a[1]).sales)
    .map(([store, group]) => {
      const k = summarizeEsserKpis(group)
      const c = summarizeKpis(group)
      return [dateRangeText(group), store, ...kpiToRow('', k, c).slice(1), group.length]
    })
  const total = summarizeEsserKpis(records)
  const costAll = summarizeKpis(records)
  const totalRow = [
    dateRangeText(records),
    '【전체 합계】',
    ...kpiToRow('', total, costAll).slice(1),
    records.length,
  ]
  return [headers, ...body, [], totalRow]
}

function buildProductRankSheet(records, limit = 200) {
  const sorted = [...records].sort(
    (a, b) => parseAmount(b.sales ?? b.actualPayment) - parseAmount(a.sales ?? a.actualPayment),
  )
  const top = sorted.slice(0, limit)
  const { header, body } = buildTableRows(FULL_DETAIL_COLUMNS, top)
  return appendDetailTotalRow([header, ...body], records, '【전체 합계】')
}

const BIGCELL_KEY_TO_FIELD = {
  store_name: 'storeName',
  product_id: 'productId',
  option_id: 'optionId',
  product_code: 'productCode',
  product_name: 'productName',
  option_name: 'option',
  sale_price: 'salePrice',
  cost_price: 'unitCost',
  sales_qty: 'salesQty',
  sales_cost: 'totalCost',
  gross_sales: 'grossSales',
  sales: 'sales',
  net_profit: 'netProfit',
  net_profit_rate: 'marginRate',
  ad_qty: 'adQty',
  ad_qty_rate: 'adQtyRate',
  organic_qty: 'organicQty',
  organic_qty_rate: 'organicQtyRate',
  ad_spend: 'adSpend',
  ad_spend_rate: 'adSpendRate',
  ad_sales: 'adSales',
  ad_sales_rate: 'adSalesRate',
  ad_conversion_rate: 'adConversionRate',
  ad_conversion_rate_alt: 'adConversionRate',
  ad_roas: 'adRoas',
  ad_profit: 'adProfit',
  ad_net_profit: 'adNetProfit',
  ad_net_profit_rate: 'adNetProfitRate',
  ad_net_profit_rate_alt: 'adNetProfitRate',
}

function exportBigcellCell(row, colKey) {
  const norm = normalizeEsserDetailFields(row)
  if (colKey === 'date') return norm.date ?? ''
  if (colKey === 'salesMethod') return getSalesMethod(norm) || norm.salesMethod || ''
  const field = BIGCELL_KEY_TO_FIELD[colKey] || colKey
  return exportCellValue(norm, field)
}

function buildBigcellFormatSheet(records) {
  const list = prepareExportRecords(records)
  const meta = [
    { key: 'date', label: '날짜' },
    { key: 'salesMethod', label: '판매방식' },
  ]
  const columns = [...meta, ...KOREAN_ESSER_KEYS]
  const header = columns.map((c) => c.label)
  const body = list.map((row) => columns.map((c) => exportBigcellCell(row, c.key)))
  return [header, ...body]
}

function ymdToCompact(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}${m[2]}${m[3]}` : ''
}

function buildExportDateSuffix(filters = {}, records = []) {
  const from = ymdToCompact(filters.dateFrom)
  const to = ymdToCompact(filters.dateTo)
  if (from && to) return from === to ? from : `${from}_${to}`
  if (to) return to
  if (from) return from

  const dates = records
    .map((r) => parseSalesDate(getRecordDate(r)))
    .filter(Boolean)
    .sort((a, b) => a.date - b.date)
  if (dates.length) {
    const pad = (n) => String(n).padStart(2, '0')
    const first = `${dates[0].year}${pad(dates[0].month)}${pad(dates[0].day)}`
    const last = dates[dates.length - 1]
    const lastKey = `${last.year}${pad(last.month)}${pad(last.day)}`
    return first === lastKey ? first : `${first}_${lastKey}`
  }
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function sanitizeExportStem(label) {
  return String(label || '매출').replace(/[\\/:*?"<>|]/g, '').trim() || '매출'
}

/** 예: 베스트하임20260601.xlsx · 사본느리20260501_20260601.xlsx */
export function buildChannelExportFileName(channelLabel, filters = {}, records = []) {
  const stem = sanitizeExportStem(channelLabel)
  const date = buildExportDateSuffix(filters, records)
  return `${stem}${date}.xlsx`
}

/**
 * 대시보드·시각화 → 풀 리포트 엑셀 (다중 시트, 서식 적용)
 * @returns {{ wb: import('exceljs').Workbook, fileName: string, sheetCount: number, rowCount: number, integratedSummary: boolean }}
 */
export function buildDashboardWorkbook({
  records,
  platformSplitRecords = [],
  dayOverDayRecords = [],
  filters = {},
  channelLabel = '매출',
  uploads = [],
  selectedUploadIds = [],
  manualAdByChannel = [],
  manualAdEntries = [],
  specialSale = null,
  specialSaleByMonth = null,
  manualExpense = null,
  combinedComments = null,
  hiddenKpiKeys = [],
  isCombined = false,
  profitLossTemplate = null,
  summarySheetOnly = false,
  /** 통합 월별 전월대비 — 화면과 동일 세그먼트 SoT */
  serverPlatformKpiRows = [],
  serverPrevMonthPlatformKpiRows = [],
}) {
  if (!records?.length) {
    throw new Error('다운로드할 데이터가 없습니다.')
  }

  const list = prepareExportRecords(records)
  const { sales: saleRecords, returns: returnRecords } = partitionSalesAndReturns(list)
  const productSaleRecords = saleRecords.filter((r) => !isEsserSheetTotalRecord(r))

  const filterYear = filters.year || ''
  const manualFilterCtx = {
    dateFrom: filters.dateFrom || '',
    dateTo: filters.dateTo || '',
    platform: filters.platform || '',
    salesMethod: filters.salesMethod || '',
    year: filters.year || '',
    month: filters.month || '',
    period: filters.period || 'daily',
    specialSale: isCombined ? specialSale : null,
    specialSaleByMonth: isCombined ? specialSaleByMonth : null,
    manualExpense: isCombined ? manualExpense : null,
  }
  const channelGroups =
    manualAdByChannel.length > 0
      ? manualAdByChannel
      : [{ label: '베스트하임', entries: manualAdEntries }]
  const allManualAdEntries = channelGroups.flatMap((g) => g.entries || [])
  const dodRefRaw = platformSplitRecords?.length ? platformSplitRecords : records
  const dodRefList = prepareExportRecords(dodRefRaw)
  const { sales: dodRefSaleRecords } = partitionSalesAndReturns(dodRefList)
  const dodRefProductRecords = dodRefSaleRecords.filter((r) => !isEsserSheetTotalRecord(r))

  const dodLookupRaw = dayOverDayRecords?.length
    ? dayOverDayRecords
    : dodRefRaw
  const dodLookupList = prepareExportRecords(dodLookupRaw)
  const { sales: dodLookupSaleRecords } = partitionSalesAndReturns(dodLookupList)
  const dodLookupProductRecords = dodLookupSaleRecords.filter((r) => !isEsserSheetTotalRecord(r))

  const isPowerPriceExport = channelLabel === '파워프라이스'
  const isCombinedExport = isCombined || channelLabel === '통합'

  // 통합 SoT = 세그먼트 KPI 합계 (특판·PP 유무와 무관하게 동일) — 전월대비보다 먼저 계산
  const combinedSplitRows =
    isCombinedExport && !isPowerPriceExport
      ? buildKpiSplitRowsForChannel('통합', saleRecords, channelGroups, manualFilterCtx)
      : null

  const comparisonMode = resolveSalesComparisonMode(manualFilterCtx)
  // 엑셀 내 매출·수익(combinedSplitRows)과 동일 SoT — 서버 세그먼트는 화면용, export는 시트 일치 우선
  const segmentMomRows =
    combinedSplitRows ||
    (serverPlatformKpiRows?.length ? serverPlatformKpiRows : null)
  const prevMomRows =
    serverPrevMonthPlatformKpiRows?.length
      ? serverPrevMonthPlatformKpiRows
      : []
  const prevBrandSalesFallback =
    isCombinedExport && comparisonMode === 'month' && dodLookupProductRecords.length
      ? brandPrevSalesMapFromLookupRecords(dodLookupProductRecords, {
          manualFilterCtx,
          specialSaleByMonth: specialSaleByMonth || null,
        })
      : null
  const dayOverDayComputed =
    isCombinedExport && comparisonMode === 'month' && segmentMomRows?.length
      ? buildCombinedBrandMonthOverMonthFromSegmentRows(segmentMomRows, prevMomRows, {
          manualFilterCtx: {
            ...manualFilterCtx,
            specialSale: isCombinedExport ? specialSale : null,
          },
          specialSaleByMonth: specialSaleByMonth || null,
          specialSaleLabels: collectSpecialSaleLabelsFromRows(segmentMomRows, specialSale),
          prevBrandSalesFallback,
        })
      : isCombinedExport
        ? computeCombinedBrandDayOverDaySales(dodRefProductRecords, {
            manualFilterCtx,
            lookupRows: dodLookupProductRecords,
            referenceDateKey:
              resolveReferenceDateKey(dodRefProductRecords, manualFilterCtx) || undefined,
            specialSaleByMonth: specialSaleByMonth || null,
          })
        : computeDayOverDaySales(dodRefProductRecords, {
            manualAdEntries: allManualAdEntries,
            manualFilterCtx,
            lookupRows: dodLookupProductRecords,
            referenceDateKey:
              resolveReferenceDateKey(dodRefProductRecords, manualFilterCtx) || undefined,
            specialSaleByMonth: specialSaleByMonth || null,
          })
  const dayOverDayAoa = summarySheetOnly
    ? []
    : buildDayOverDayExcelRows(
        dayOverDayComputed,
        '',
        isCombinedExport
          ? {
              sectionTitle:
                dayOverDayComputed[0]?.comparisonMode === 'month'
                  ? '■ 전월 대비 매출 (베스트하임 · 에쎄르 · 파워프라이스 · 기타 판매처 · 특판 · 합계)'
                  : dayOverDayComputed[0]?.comparisonMode === 'week'
                    ? '■ 전주 대비 매출 (베스트하임 · 에쎄르 · 파워프라이스 · 기타 판매처 · 특판 · 합계)'
                    : '■ 전일 대비 매출 (베스트하임 · 에쎄르 · 파워프라이스 · 기타 판매처 · 특판 · 합계)',
              comparisonMode: dayOverDayComputed[0]?.comparisonMode,
            }
          : { comparisonMode: dayOverDayComputed[0]?.comparisonMode },
      )

  const kpiSaleRecords = isPowerPriceExport ? productSaleRecords : saleRecords
  const combinedSegmentTotal = combinedSplitRows?.find((r) => r.label === '합계')
  const totalKpi = isPowerPriceExport
    ? summarizePowerPriceKpis(kpiSaleRecords, allManualAdEntries, manualFilterCtx)
    : combinedSegmentTotal
      ? finalizeEsserBucket({
          sales: combinedSegmentTotal.profit?.sales ?? 0,
          salesQty: combinedSegmentTotal.profit?.salesQty ?? 0,
          totalCost: combinedSegmentTotal.profit?.totalCost ?? 0,
          netProfit: combinedSegmentTotal.profit?.netProfit ?? 0,
          adSpend: combinedSegmentTotal.ad?.adSpend ?? 0,
          adSales: combinedSegmentTotal.ad?.adSales ?? 0,
        })
      : isCombinedExport
        ? summarizeCombinedKpis(kpiSaleRecords, channelGroups, manualFilterCtx)
        : summarizeEsserKpisWithManual(saleRecords, allManualAdEntries, manualFilterCtx)
  const returnKpi = summarizeReturnKpis(returnRecords)
  const costKpiAll = summarizeKpis(kpiSaleRecords)
  const integratedCostKpi =
    isCombinedExport && !isPowerPriceExport
      ? { totalCost: totalKpi.totalCost ?? costKpiAll.totalCost }
      : costKpiAll

  /** 월별 export — ③~⑫·KPI 시트 생략 (NAS 메모리) */
  let daily
  let weekly
  let monthly
  if (!summarySheetOnly) {
    daily = isPowerPriceExport
      ? aggregateEsserByDayWithManualSpendOnly(kpiSaleRecords, allManualAdEntries, manualFilterCtx)
      : isCombinedExport
        ? aggregateCombinedByDayWithManual(kpiSaleRecords, channelGroups, manualFilterCtx)
        : aggregateEsserByDayWithManual(saleRecords, allManualAdEntries, manualFilterCtx)
    weekly = aggregateEsserByWeekWithManual(
      kpiSaleRecords,
      allManualAdEntries,
      manualFilterCtx,
      filterYear,
      isPowerPriceExport,
    )
    monthly = aggregateEsserByMonthWithManual(
      kpiSaleRecords,
      allManualAdEntries,
      manualFilterCtx,
      filterYear,
      isPowerPriceExport,
    )
  }

  const wb = createBrandedWorkbook()

  const profitLossTpl = summarySheetOnly ? null : (profitLossTemplate ?? null)
  if (profitLossTpl) {
    try {
      const plSheets = buildProfitLossReportSheets(profitLossTpl, {
        saleRecords,
        channelGroups,
        manualFilterCtx,
        filters,
      })
      for (const sheet of plSheets) {
        const sheetTitle = sheet.name.length > 28 ? '⓪손익계산서' : `⓪${sheet.name}`
        addStyledSheet(wb, sheetTitle.slice(0, 31), sheet.rows, { autoFilter: false })
      }
    } catch (e) {
      console.warn('손익계산 템플릿 시트 생략:', e)
    }
  }

  const detailColWidths = colWidthsFromHeaders(FULL_DETAIL_COLUMNS.map((c) => c.label))
  const periodColWidths = isPowerPriceExport
    ? [18, 16, 16, 10, 14, 12, 14]
    : [18, 16, 16, 10, 14, 12, 14, 14, 12, 12, 14]
  const buildPeriod = isPowerPriceExport ? buildPowerPricePeriodSheet : buildPeriodSheet

  const summarySheetRows = isCombinedExport
    ? buildIntegratedProfitLossSummaryRows({
        saleRecords,
        channelGroups,
        manualFilterCtx,
        filters,
        totalKpi,
        costKpi: integratedCostKpi,
        dayOverDayComputed,
        combinedComments,
        splitRows: combinedSplitRows,
      })
    : buildSummaryReportSheet({
        kpi: totalKpi,
        returnKpi,
        returnCount: returnRecords.length,
        filters,
        records: saleRecords,
        manualAdByChannel: channelGroups,
        manualFilterCtx,
        dayOverDayComputed,
        hiddenKpiKeys,
        reportTitle: REPORT_TITLE,
        brandLabel: '',
        hideCostVerificationRow: false,
        channelLabel,
      })

  addStyledSheet(wb, '①요약리포트', summarySheetRows, {
    autoFilter: false,
    compactNumbers: isCombinedExport,
    fontSize: isCombinedExport ? 12 : 11,
    headerFontSize: isCombinedExport ? 12 : 11,
    colWidths: isCombinedExport
      ? colWidthsForIntegratedSummary(summarySheetRows)
      : undefined,
    exactColWidths: isCombinedExport,
    minColWidth: isCombinedExport ? 6 : 10,
  })

  if (summarySheetOnly) {
    const fileName = buildChannelExportFileName(channelLabel, filters, records)
    return {
      wb,
      fileName,
      sheetCount: wb.worksheets.length,
      rowCount: records.length,
      integratedSummary: isCombinedExport,
    }
  }

  if (channelLabel === '통합' && hasCombinedSourceLabels(list)) {
    const brandSheets = buildCombinedBrandSummarySheets({
      saleRecords,
      returnRecords,
      filters,
      manualFilterCtx,
      channelGroups,
      dayOverDayLookupProductRecords: dodLookupProductRecords,
      dodRefProductRecords,
    })
    for (const sheet of brandSheets) {
      addStyledSheet(wb, sheet.name.slice(0, 31), sheet.rows, { autoFilter: false })
    }
  }

  addStyledSheet(
    wb,
    (dayOverDayComputed[0]?.comparisonMode === 'month'
      ? '②전월대비'
      : dayOverDayComputed[0]?.comparisonMode === 'week'
        ? '②전주대비'
        : '②전일대비'),
    dayOverDayAoa,
    {
      freezeHeader: true,
      colWidths:
        dayOverDayComputed[0]?.comparisonMode === 'month'
          ? [14, 16, 16, 14, 12, 10]
          : [14, 16, 16, 12, 10],
    },
  )

  // 통합 엑셀: 판매방식별 시트 제외 (①요약리포트·세그먼트·스토어 SoT 통일)
  if (!isCombinedExport) {
    const salesMethodRows = isPowerPriceExport
      ? buildPowerPriceSalesMethodSheet(kpiSaleRecords)
      : buildSalesMethodSheet(saleRecords)
    addStyledSheet(wb, '②판매방식별', salesMethodRows, {
      freezeHeader: true,
      colWidths: colWidthsFromHeaders(salesMethodRows[0] || []),
    })
  }

  addStyledSheet(wb, '③일별', buildPeriod(daily, totalKpi, '일별 매출 추이', costKpiAll), {
    freezeHeader: true,
    colWidths: periodColWidths,
  })
  addStyledSheet(wb, '④주별', buildPeriod(weekly, totalKpi, '주별 매출 추이', costKpiAll), {
    freezeHeader: true,
    colWidths: periodColWidths,
  })
  addStyledSheet(wb, '⑤월별', buildPeriod(monthly, totalKpi, '월별 매출 추이', costKpiAll), {
    freezeHeader: true,
    colWidths: periodColWidths,
  })
  addStyledSheet(wb, '⑥기간통합', buildCombinedPeriodSheet(saleRecords, filterYear), {
    autoFilter: false,
    colWidths: periodColWidths,
  })

  const storeColWidths = [20, 18, ...periodColWidths.slice(1), 10]
  addStyledSheet(wb, '⑦스토어별', buildStoreSheet(saleRecords), {
    freezeHeader: true,
    colWidths: storeColWidths,
  })

  if (productSaleRecords.length) {
    const { header, body } = buildTableRows(FULL_DETAIL_COLUMNS, productSaleRecords)
    addStyledSheet(
      wb,
      DETAIL_SHEET_NAME,
      appendDetailTotalRow([header, ...body], saleRecords, '【판매 합계】'),
      { freezeHeader: true, colWidths: detailColWidths },
    )
  }

  {
    const returnAoa = returnRecords.length
      ? (() => {
          const { header, body } = buildTableRows(FULL_DETAIL_COLUMNS, returnRecords)
          return appendDetailTotalRow([header, ...body], returnRecords, '【반품 합계】')
        })()
      : [['반품 내역 없음']]
    addStyledSheet(wb, '⑨반품', returnAoa, {
      freezeHeader: returnRecords.length > 0,
      colWidths: detailColWidths,
    })
  }

  if (productSaleRecords.length) {
    addStyledSheet(wb, '⑩상품순위', buildProductRankSheet(productSaleRecords), {
      freezeHeader: true,
      colWidths: detailColWidths,
    })
    const bigcellSale = buildBigcellFormatSheet(productSaleRecords)
    addStyledSheet(wb, '⑪빅셀_판매', bigcellSale, {
      freezeHeader: true,
      colWidths: colWidthsFromHeaders(bigcellSale[0] || []),
    })
  }

  if (returnRecords.length) {
    const bigcellRet = buildBigcellFormatSheet(returnRecords)
    addStyledSheet(wb, '⑫빅셀_반품', bigcellRet, {
      freezeHeader: true,
      colWidths: colWidthsFromHeaders(bigcellRet[0] || []),
    })
  }

  addStyledSheet(
    wb,
    'KPI',
    buildKpiSheetAoA({
      totalKpi,
      costKpiAll,
      returnKpi,
      returnCount: returnRecords.length,
      manualAdByChannel: channelGroups,
      saleRecords,
      manualFilterCtx,
      dayOverDayComputed,
      hiddenKpiKeys,
      hideCostVerificationRow: isCombinedExport,
      channelLabel,
    }),
    { freezeHeader: true },
  )

  const fileName = buildChannelExportFileName(channelLabel, filters, records)

  return {
    wb,
    fileName,
    sheetCount: wb.worksheets.length,
    rowCount: records.length,
    integratedSummary: isCombinedExport,
  }
}

export async function downloadDashboardExcel(options) {
  const result = buildDashboardWorkbook(options)
  await downloadExcelWorkbook(result.wb, result.fileName)
  return {
    sheetCount: result.sheetCount,
    rowCount: result.rowCount,
    integratedSummary: result.integratedSummary,
  }
}

/**
 * 현재 데이터 탭(표)과 동일한 단일 시트 워크북 (서버 export 공용)
 * 행·컬럼·값·서식은 downloadTableExcel 과 동일해야 함.
 */
export function buildTableWorkbook({
  rows,
  columns,
  sheetName = '데이터',
  channelLabel = '매출',
  filters = {},
}) {
  if (!rows?.length) throw new Error('다운로드할 데이터가 없습니다.')
  const tMap = performance.now()
  const header = columns.map((c) => c.label)
  const body = rows.map((row) => {
    const norm = normalizeEsserDetailFields(row)
    return columns.map((c) => exportCellValue(norm, c.key))
  })
  const mapMs = Math.round(performance.now() - tMap)
  const tSheet = performance.now()
  const wb = createBrandedWorkbook()
  addStyledSheet(wb, sheetName.slice(0, 31), [header, ...body], {
    freezeHeader: true,
    colWidths: colWidthsFromHeaders(header),
  })
  const fileName = buildChannelExportFileName(channelLabel, filters, rows)
  buildTableWorkbook.lastTimings = {
    cellMap: mapMs,
    addStyledSheet: Math.round(performance.now() - tSheet),
  }
  return { wb, fileName, rowCount: rows.length, sheetCount: 1 }
}

/** 현재 데이터 탭(표)만 단일 시트 */
export async function downloadTableExcel(options) {
  const { wb, fileName } = buildTableWorkbook(options)
  await downloadExcelWorkbook(wb, fileName)
}
