import { formatChartValue } from '../constants/chartMetrics.js'
import { parseAmount, firstAmount, getIsoWeekInfo } from './salesAggregation.js'
import { storeLabelFromRow } from './storeLabel.js'
import {
  parseSalesDate,
  parseMonthDayLabel,
  parseFilenameCompactDates,
  WEEKDAY_LABELS,
} from './dateParse.js'
import { getRecordDate, resolveRecordDateForAggregation } from './recordFilters.js'
import { getSalesMethod, SMARTSTORE_SALES_METHODS, baseSalesMethodFromGroupLabel, salesMethodGroupLabel } from './salesMethodDetect.js'
import { resolveRecordPlatform } from './platformDetect.js'
import { isReturnRecord } from './transactionType.js'
import { applyOwnMallCardFeeToNetProfit } from '../config/ownMall.js'

export { storeLabelFromRow } from './storeLabel.js'

export function resolveRowAdSpend(row) {
  return Math.abs(parseAmount(row.adSpend ?? row.ad_spend))
}

export function isEsserSheetTotalRecord(row) {
  return row?.isEsserSheetTotal === true
}

/** esser 상세 행 — 매출·수량·마진·원가 필드 별칭 통합 (빈 문자열 폴백) */
export function resolveEsserSales(row) {
  return firstAmount(row, 'sales', 'actualPayment', 'revenue', 'settlementPrice', 'grossSales')
}

export function resolveEsserSalesQty(row) {
  return firstAmount(row, 'salesQty', 'quantity')
}

export function resolveEsserNetProfit(row) {
  return firstAmount(row, 'netProfit', 'margin')
}

export function resolveEsserTotalCost(row) {
  const direct = firstAmount(row, 'totalCost', 'sales_cost')
  if (direct) return direct
  const salesQty = resolveEsserSalesQty(row)
  const unit = firstAmount(row, 'unitCost', 'cost_price')
  if (unit && salesQty) return unit * salesQty
  return 0
}

export function esserRowValues(row) {
  const sales = resolveEsserSales(row)
  const salesQty = resolveEsserSalesQty(row)
  let netProfit = resolveEsserNetProfit(row)
  const totalCost = resolveEsserTotalCost(row)
  const adSpend = resolveRowAdSpend(row)
  const adSales = firstAmount(row, 'adSales', 'ad_sales')

  netProfit = applyOwnMallCardFeeToNetProfit(row, sales, totalCost, netProfit)

  return {
    sales,
    salesQty,
    netProfit,
    totalCost,
    adSpend,
    adSales,
    organicSales: Math.max(0, sales - adSales),
  }
}

function emptyBucket() {
  return { sales: 0, salesQty: 0, netProfit: 0, totalCost: 0, adSpend: 0, adSales: 0 }
}

function inferRowYear(row) {
  const hint = row?.dateRangeHint || row?.periodLabel || row?.businessDate || ''
  const fromHint = parseSalesDate(hint)
  if (fromHint) return fromHint.year
  const fileDates = parseFilenameCompactDates(row?.sourceFileName || '')
  if (fileDates.length) return parseInt(fileDates[0].slice(0, 4), 10)
  return new Date().getFullYear()
}

function dayDisplayLabel(raw, p) {
  const s = String(raw || '').trim()
  if (/^\d{1,2}[.\-/]\d{1,2}$/.test(s)) return s.replace(/-/g, '.')
  if (p) return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  return s
}

/** @returns {{ key: string, label: string, sortTime: number } | null} */
function dayBucketMetaFromRow(row) {
  const raw = String(resolveRecordDateForAggregation(row) || '').trim()
  if (!raw) return null
  const year = inferRowYear(row)
  const p = parseSalesDate(raw) || parseMonthDayLabel(raw, year)
  if (p) {
    return {
      key: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
      label: dayDisplayLabel(raw, p),
      sortTime: p.date.getTime(),
    }
  }
  if (/^\d{1,2}[.\-/]\d{1,2}$/.test(raw)) {
    const label = raw.replace(/-/g, '.')
    return { key: label, label, sortTime: 0 }
  }
  return null
}

function dayKeyFromRow(row) {
  return dayBucketMetaFromRow(row)?.key ?? null
}

/** @param {string} fromYmd @param {string} toYmd @returns {string[]} */
export function listYmdDaysInclusive(fromYmd, toYmd) {
  const a = parseSalesDate(fromYmd)
  const b = parseSalesDate(toYmd || fromYmd)
  if (!a || !b) return []
  const out = []
  const cur = new Date(a.date)
  const end = new Date(b.date)
  cur.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  while (cur.getTime() <= end.getTime()) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
    )
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function splitRowMetricField(val, parts) {
  const total = parseAmount(val)
  if (!total || parts <= 0) return val === '' || val == null ? '' : '0'
  return String(Math.round(total / parts))
}

function isPeriodUploadRow(row) {
  if (!row) return false
  if (row.uploadFormat === 'coupang_esser_period') return true
  const from = String(row.periodFrom || '').trim()
  const to = String(row.periodTo || '').trim()
  if (!from || !to || from === to) return false
  return String(row.date || '').includes('~')
}

/**
 * 기간(주간) 업로드 행 — 통합 ①요약 일별 표에서 일자별로 펼침 (매출·광고 균등 분배)
 * @param {object[]} rows
 */
export function expandPeriodUploadRowsForDaily(rows) {
  const out = []
  for (const row of rows || []) {
    if (isReturnRecord(row)) {
      out.push(row)
      continue
    }
    const from = String(row.periodFrom || '').trim()
    const to = String(row.periodTo || from).trim()
    if (!isPeriodUploadRow(row) || !from || !to || from === to) {
      out.push(row)
      continue
    }
    const days = listYmdDaysInclusive(from, to)
    if (days.length <= 1) {
      out.push(row)
      continue
    }
    const n = days.length
    for (const ymd of days) {
      const v = esserRowValues(row)
      out.push({
        ...row,
        date: ymd,
        sales: splitRowMetricField(row.sales, n),
        salesQty: splitRowMetricField(row.salesQty ?? row.quantity, n),
        quantity: splitRowMetricField(row.quantity ?? row.salesQty, n),
        netProfit: splitRowMetricField(row.netProfit ?? row.margin, n),
        margin: splitRowMetricField(row.margin ?? row.netProfit, n),
        totalCost: splitRowMetricField(row.totalCost, n),
        adSpend: splitRowMetricField(v.adSpend, n),
        adSales: splitRowMetricField(v.adSales, n),
      })
    }
  }
  return out
}

/** 일별 표·엑셀 기간 열 — YYYY-MM-DD */
export function formatDayBucketLabel(bucket, filterCtx = {}) {
  const sortTime = bucket?.sortTime
  if (Number.isFinite(sortTime) && sortTime > 0) {
    const d = new Date(sortTime)
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  const raw = String(bucket?.label || bucket?.key || '').trim()
  if (raw) {
    const year = filterCtx?.dateFrom
      ? parseInt(String(filterCtx.dateFrom).slice(0, 4), 10)
      : new Date().getFullYear()
    const p = parseSalesDate(raw) || parseMonthDayLabel(raw, year)
    if (p) {
      return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
    }
  }
  const from = filterCtx?.dateFrom || ''
  const to = filterCtx?.dateTo || ''
  if (from && to) return from === to ? from : `${from} ~ ${to}`
  if (from) return from
  if (to) return to
  return raw
}

function addProductMetricsToBucket(bucket, row) {
  const v = esserRowValues(row)
  bucket.sales += v.sales
  bucket.salesQty += v.salesQty
  bucket.netProfit += v.netProfit
  bucket.totalCost += v.totalCost
}

/** 엑셀 합계 행 — 광고비·광고매출만 (매출은 상품 행 합산, 로켓+판매자 이중 합산 방지) */
function addSheetAdOnlyToBucket(bucket, row) {
  const v = esserRowValues(row)
  bucket.adSpend += v.adSpend
  bucket.adSales += v.adSales
}

export function hasEsserSheetTotalRows(rows) {
  return (rows || []).some((r) => !isReturnRecord(r) && isEsserSheetTotalRecord(r))
}

/** 파일(upload)당 열 합계 행 1개 — 헤더 직하 우선 */
function dedupeSheetTotalMetrics(rows) {
  const sheetRows = (rows || []).filter((r) => !isReturnRecord(r) && isEsserSheetTotalRecord(r))
  /** @type {Map<string, { v: ReturnType<typeof esserRowValues>, kind: string }>} */
  const byUpload = new Map()
  for (const r of sheetRows) {
    const key = r.uploadId || r.sourceFileName || '__single__'
    const v = esserRowValues(r)
    const kind = r.sheetTotalKind || 'footer'
    const prev = byUpload.get(key)
    if (!prev) {
      byUpload.set(key, { v, kind })
      continue
    }
    if (prev.kind === 'header') continue
    if (kind === 'header') byUpload.set(key, { v, kind })
  }
  return [...byUpload.values()].map((x) => x.v)
}

function applyMetricsToBucket(bucket, metrics) {
  bucket.sales += metrics.sales
  bucket.salesQty += metrics.salesQty
  bucket.netProfit += metrics.netProfit
  bucket.totalCost += metrics.totalCost
  bucket.adSpend += metrics.adSpend
  bucket.adSales += metrics.adSales
}

/** @deprecated sumEsserAdFromRows — sumEsserSheetMetricsFromRows 사용 */
export function sumEsserAdFromRows(rows) {
  const m = sumEsserSheetMetricsFromRows(rows)
  return { adSpend: m?.adSpend || 0, adSales: m?.adSales || 0 }
}

/** 엑셀 합계 행 — 광고만 (파일당 1행, 로켓+판매자 합산) */
export function sumEsserSheetAdFromRows(rows) {
  const list = dedupeSheetTotalMetrics(rows)
  if (!list.length) return null
  const acc = emptyBucket()
  for (const v of list) {
    acc.adSpend += v.adSpend
    acc.adSales += v.adSales
  }
  return acc
}

/** @deprecated 매출·순이익에 쓰지 말 것 — sumEsserSheetAdFromRows */
export function sumEsserSheetMetricsFromRows(rows) {
  return sumEsserSheetAdFromRows(rows)
}

function sumEsserProductMetricsFromRows(rows) {
  const acc = emptyBucket()
  for (const r of rows || []) {
    if (isReturnRecord(r) || isEsserSheetTotalRecord(r)) continue
    applyMetricsToBucket(acc, esserRowValues(r))
  }
  return acc
}

function applyDayAdFallback(bucket, dayKey, rows) {
  if (bucket.adSpend > 0 || bucket.adSales > 0) return
  for (const r of rows) {
    if (isReturnRecord(r) || isEsserSheetTotalRecord(r)) continue
    if (dayKeyFromRow(r) !== dayKey) continue
    const v = esserRowValues(r)
    bucket.adSpend += v.adSpend
    bucket.adSales += v.adSales
  }
}

function addBucket(bucket, row) {
  if (isEsserSheetTotalRecord(row)) {
    addSheetAdOnlyToBucket(bucket, row)
    return
  }
  addProductMetricsToBucket(bucket, row)
}

function numericBucket(x) {
  return {
    sales: x.sales || 0,
    salesQty: x.salesQty || 0,
    netProfit: x.netProfit || 0,
    totalCost: x.totalCost || 0,
    adSpend: x.adSpend || 0,
    adSales: x.adSales || 0,
  }
}

export function finalizeEsserBucket(bucket) {
  const b = numericBucket(bucket)
  const organicSales = Math.max(0, b.sales - b.adSales)
  return {
    ...b,
    organicSales,
    organicSalesRate: b.sales > 0 ? (organicSales / b.sales) * 100 : 0,
    netProfitRate: b.sales > 0 ? (b.netProfit / b.sales) * 100 : 0,
    roas: b.adSpend > 0 ? (b.adSales / b.adSpend) * 100 : 0,
    salesRoas: b.adSpend > 0 ? (b.sales / b.adSpend) * 100 : 0,
  }
}

/** 대시보드 vs 일별 차트 숫자 일치 검증용 */
export function reconcileEsserTotals(rows) {
  const kpi = summarizeEsserKpis(rows)
  const daily = aggregateEsserByDay(rows)
  const dailySalesSum = daily.reduce((s, d) => s + (d.sales || 0), 0)
  const diff = Math.abs(kpi.sales - dailySalesSum)
  const productRowCount = (rows || []).filter(
    (r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r),
  ).length
  return {
    rowCount: productRowCount,
    kpi,
    dailyBucketCount: daily.length,
    dailySalesSum,
    salesMismatch: diff > 1,
    salesDiff: diff,
  }
}

export function summarizeEsserKpis(rows) {
  const bucket = sumEsserProductMetricsFromRows(rows)
  const sheetAd = sumEsserSheetAdFromRows(rows)
  if (sheetAd) {
    bucket.adSpend = sheetAd.adSpend
    bucket.adSales = sheetAd.adSales
  }
  return finalizeEsserBucket(bucket)
}

/** 반품·취소 건만 절대값으로 합산 (매출 KPI와 분리) */
export function summarizeReturnKpis(rows) {
  const bucket = emptyBucket()
  for (const row of rows) {
    if (!isReturnRecord(row)) continue
    const v = esserRowValues(row)
    bucket.sales += Math.abs(v.sales)
    bucket.salesQty += Math.abs(v.salesQty)
    bucket.netProfit += Math.abs(v.netProfit)
    bucket.totalCost += Math.abs(v.totalCost)
    bucket.adSpend += Math.abs(v.adSpend)
    bucket.adSales += Math.abs(v.adSales)
  }
  return finalizeEsserBucket(bucket)
}

export function chartValueFromBucket(bucket, metricKey) {
  const b = finalizeEsserBucket(bucket)
  switch (metricKey) {
    case 'sales':
      return b.sales
    case 'salesQty':
      return b.salesQty
    case 'netProfit':
      return b.netProfit
    case 'netProfitRate':
      return b.netProfitRate
    case 'adSpend':
      return b.adSpend
    case 'adSales':
      return b.adSales
    case 'roas':
      return b.roas
    case 'salesRoas':
      return b.salesRoas
    case 'organicSales':
      return b.organicSales
    case 'organicSalesRate':
      return b.organicSalesRate
    default:
      return b.sales
  }
}

/** 일별 대시보드 — 매출·마진·원가 (상품 행 합) */
export const ESSER_PROFIT_KPI_CARDS = [
  {
    key: 'sales',
    label: '매출',
    hint: '상품별 매출 합 (반품 제외). 로켓·판매자 합계 칸은 더하지 않음',
  },
  { key: 'netProfit', label: '마진', hint: '상품별 순이익(마진) 합' },
  { key: 'netProfitRate', label: '마진율', hint: '마진 ÷ 매출 × 100 (%)' },
  { key: 'totalCost', label: '총 원가', hint: '상품별 원가 합' },
  { key: 'costRate', label: '원가율', hint: '총 원가 ÷ 매출 × 100 (%)' },
  { key: 'aov', label: '객단가', hint: '매출 ÷ 판매 수량' },
]

/** 일별 대시보드 — 광고·수량 */
export const ESSER_AD_KPI_CARDS = [
  { key: 'salesQty', label: '판매 수량', hint: '상품별 판매수량 합' },
  {
    key: 'adSpend',
    label: '광고비',
    hint: '엑셀 광고집행비 합계 칸(로켓+판매자 각 1칸) + 외부 수동 광고비',
  },
  { key: 'adSales', label: '광고매출', hint: '엑셀 합계 칸의 광고매출(로켓+판매자)' },
  { key: 'roas', label: 'ROAS(광고)', hint: '광고매출 ÷ 광고비 × 100 (%)' },
  { key: 'salesRoas', label: 'ROAS(전체)', hint: '전체 매출 ÷ 광고비 × 100 (%)' },
  { key: 'organicSales', label: '자연매출', hint: '매출 − 광고매출 (광고 없이 판된 금액)' },
  {
    key: 'organicSalesRate',
    label: '자연매출 비율',
    hint: '자연매출 ÷ 매출 × 100 (%)',
  },
]

/** @deprecated ESSER_PROFIT_KPI_CARDS + ESSER_AD_KPI_CARDS 사용 */
export const ESSER_KPI_CARDS = [...ESSER_PROFIT_KPI_CARDS, ...ESSER_AD_KPI_CARDS]

/**
 * KPI 원가 역산용 마진 — 수동 광고 차감 전 productKpi 우선, 없으면 마진율
 * @param {object} kpi
 * @param {object} [productKpi]
 */
export function resolveKpiMarginForCostEstimate(kpi, productKpi) {
  const sales = kpi?.sales || productKpi?.sales || 0
  if (!(sales > 0)) return 0

  const src = productKpi || kpi
  let margin = src?.netProfit || 0
  if (!margin) {
    const rate =
      src?.netProfitRate ??
      (src?.sales > 0 && src?.netProfit ? (src.netProfit / src.sales) * 100 : 0)
    if (rate) margin = (sales * rate) / 100
  }
  return margin
}

/**
 * @param {object} [options]
 * @param {boolean} [options.estimateCostFromMargin] KPI 표시용 — 스마트스토어 매출−마진 임시 역산
 * @param {object} [options.productKpi] 수동 광고 반영 전 상품 KPI (마진 소스)
 */
export function deriveEsserProfitKpis(kpi, options = {}) {
  const base = kpi || {}
  const sales = base.sales || 0
  const salesQty = base.salesQty || 0
  let totalCost = base.totalCost || 0
  const netProfit = base.netProfit || 0
  const netProfitRate =
    base.netProfitRate ?? (sales > 0 ? (netProfit / sales) * 100 : 0)

  if (options.estimateCostFromMargin && sales > 0) {
    const margin = resolveKpiMarginForCostEstimate(base, options.productKpi)
    if (margin) {
      totalCost = Math.max(0, sales - margin)
    }
  }

  return {
    ...base,
    sales,
    salesQty,
    totalCost,
    netProfit,
    netProfitRate,
    costRate: sales > 0 ? (totalCost / sales) * 100 : 0,
    aov: salesQty > 0 ? sales / salesQty : 0,
  }
}

/** 스마트스토어 판매방식(일반배송·N배송) — KPI·집계표 원가 역산 대상 */
export function shouldEstimateSalesMethodCostFromMargin(label) {
  return SMARTSTORE_SALES_METHODS.includes(baseSalesMethodFromGroupLabel(label))
}

/**
 * 그룹 집계 원가 — 스마트스토어 판매방식은 매출−마진 임시 역산 (대시보드 KPI와 동일)
 * @param {string} label
 * @param {object[]} group
 * @param {object} kpi summarizeEsserKpis(group)
 * @param {number} [rawTotalCost] summarizeKpis(group).totalCost
 */
export function resolveGroupTotalCost(label, group, kpi, rawTotalCost = 0) {
  if (!shouldEstimateSalesMethodCostFromMargin(label)) {
    return rawTotalCost || 0
  }
  const productRows = (group || []).filter((r) => !isEsserSheetTotalRecord(r))
  const productKpi = summarizeEsserKpis(productRows)
  return deriveEsserProfitKpis(
    { ...(kpi || {}), totalCost: rawTotalCost || 0 },
    { estimateCostFromMargin: true, productKpi },
  ).totalCost
}

/**
 * 합계 행 — 총원가·원가율을 쿠팡 + 스마트스토어 KPI 합으로 맞춤
 * @param {Array<{ label: string, profit?: object }>} rows
 */
export function mergeCombinedPlatformTotalCost(rows) {
  if (!rows?.length) return rows
  const coupang = rows.find((r) => r.label === '쿠팡')
  const smart = rows.find((r) => r.label === '스마트스토어')
  const total = rows.find((r) => r.label === '합계')
  if (!coupang?.profit || !smart?.profit || !total?.profit) return rows

  const mergedCost = (coupang.profit.totalCost || 0) + (smart.profit.totalCost || 0)
  const sales = total.profit.sales || 0
  total.profit = {
    ...total.profit,
    totalCost: mergedCost,
    costRate: sales > 0 ? (mergedCost / sales) * 100 : 0,
  }
  return rows
}

export function getEsserProfitKpiValue(kpi, key, options = {}) {
  const d = deriveEsserProfitKpis(kpi, options)
  return d[key] ?? 0
}

export function formatEsserProfitKpi(metricKey, value) {
  if (value == null) return '—'
  if (metricKey === 'costRate') return formatChartValue('costRate', value)
  if (metricKey === 'aov') return `${formatChartValue('aov', value)}원`
  if (metricKey === 'marginRate') return formatEsserValue('netProfitRate', value)
  return formatEsserValue(metricKey, value)
}

export const ESSER_CHART_METRICS = [
  { key: 'sales', label: '매출', color: 'rgba(37, 99, 235, 0.75)' },
  { key: 'netProfit', label: '순이익금', color: 'rgba(16, 185, 129, 0.75)' },
  { key: 'salesQty', label: '판매수량', color: 'rgba(99, 102, 241, 0.75)' },
  { key: 'adSpend', label: '광고비', color: 'rgba(239, 68, 68, 0.75)' },
  { key: 'adSales', label: '광고매출', color: 'rgba(245, 158, 11, 0.75)' },
  { key: 'organicSales', label: '자연매출', color: 'rgba(14, 116, 144, 0.75)' },
  { key: 'roas', label: 'ROAS (%)', color: 'rgba(168, 85, 247, 0.75)' },
]

export function formatEsserValue(metricKey, value) {
  if (value == null) return '—'
  const n = Number(value) || 0
  if (
    metricKey === 'netProfitRate' ||
    metricKey === 'roas' ||
    metricKey === 'salesRoas' ||
    metricKey === 'organicSalesRate'
  ) {
    return `${n.toFixed(1)}%`
  }
  if (metricKey === 'salesQty') {
    return `${Math.round(n).toLocaleString('ko-KR')}건`
  }
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

/** 일별 버킷 → 「일별 집계」 탭 행 */
export function esserBucketsToDailyTabRows(buckets) {
  return buckets.map((b, i) => ({
    id: `daily-esser-${i}`,
    recordType: 'daily',
    date: b.label,
    sortTime: b.sortTime,
    revenue: String(Math.round(b.sales)),
    sales: String(Math.round(b.sales)),
    margin: String(Math.round(b.netProfit)),
    netProfit: String(Math.round(b.netProfit)),
    totalCost: String(Math.round(b.totalCost)),
    salesQty: String(Math.round(b.salesQty)),
    quantity: String(Math.round(b.salesQty)),
    marginRate: b.sales > 0 ? `${b.netProfitRate.toFixed(2)}%` : '',
    adSpend: String(Math.round(b.adSpend)),
    adSales: String(Math.round(b.adSales)),
    organicSales: String(Math.round(b.organicSales)),
    organicSalesRate: b.sales > 0 ? `${b.organicSalesRate.toFixed(1)}%` : '',
    roas: b.adSpend > 0 ? `${b.roas.toFixed(1)}%` : '',
    salesRoas: b.adSpend > 0 ? `${b.salesRoas.toFixed(1)}%` : '',
    sourceFileName: '상세거래 집계',
  }))
}

/** @deprecated esserBucketsToDailyTabRows + aggregateEsserByDayWithManual 사용 */
export function buildEsserDailyTabRows(details) {
  return esserBucketsToDailyTabRows(aggregateEsserByDay(details))
}

export function aggregateEsserByDay(rows) {
  const map = new Map()
  /** @type {Map<string, { adSpend: number, adSales: number, kind: string }>} */
  const sheetAdByDayUpload = new Map()

  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const meta = dayBucketMetaFromRow(row)
    if (!meta) continue
    const { key, label, sortTime } = meta
    if (!map.has(key)) {
      map.set(key, { label, sortTime, ...emptyBucket() })
    }
    if (isEsserSheetTotalRecord(row)) {
      const uk = `${key}\0${row.uploadId || row.sourceFileName || '__single__'}`
      const v = esserRowValues(row)
      const kind = row.sheetTotalKind || 'footer'
      const prev = sheetAdByDayUpload.get(uk)
      if (!prev) {
        sheetAdByDayUpload.set(uk, { adSpend: v.adSpend, adSales: v.adSales, kind })
      } else if (prev.kind !== 'header' && kind === 'header') {
        sheetAdByDayUpload.set(uk, { adSpend: v.adSpend, adSales: v.adSales, kind })
      }
    } else {
      addProductMetricsToBucket(map.get(key), row)
    }
  }

  for (const [uk, ad] of sheetAdByDayUpload) {
    const dayKey = uk.split('\0')[0]
    const bucket = map.get(dayKey)
    if (!bucket) continue
    bucket.adSpend += ad.adSpend
    bucket.adSales += ad.adSales
  }

  for (const [key, bucket] of map) {
    applyDayAdFallback(bucket, key, rows)
  }
  return [...map.values()]
    .sort((a, b) => a.sortTime - b.sortTime)
    .map((x) => ({
      ...finalizeEsserBucket(x),
      label: x.label,
      sortTime: x.sortTime,
    }))
}

export function aggregateEsserByWeek(rows, filterYear) {
  const map = new Map()
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    const w = getIsoWeekInfo(p.date)
    if (filterYear && String(w.weekYear) !== String(filterYear)) continue
    if (!map.has(w.key)) {
      map.set(w.key, {
        label: `${w.key} (${w.monday.getMonth() + 1}/${w.monday.getDate()}~${w.sunday.getMonth() + 1}/${w.sunday.getDate()})`,
        sortTime: w.sortTime,
        ...emptyBucket(),
      })
    }
    addBucket(map.get(w.key), row)
  }
  return [...map.values()]
    .sort((a, b) => a.sortTime - b.sortTime)
    .map((x) => ({ ...finalizeEsserBucket(x), label: x.label, sortTime: x.sortTime }))
}

export function aggregateEsserByMonth(rows, filterYear) {
  const map = new Map()
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    if (filterYear && String(p.year) !== String(filterYear)) continue
    if (!map.has(p.month)) {
      map.set(p.month, { label: `${p.month}월`, month: p.month, sortTime: p.month, ...emptyBucket() })
    }
    addBucket(map.get(p.month), row)
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, x]) => {
      const b = finalizeEsserBucket(x)
      return { ...b, label: x.label, sortTime: x.sortTime }
    })
}

export function aggregateEsserByYear(rows) {
  const map = new Map()
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    const key = String(p.year)
    if (!map.has(key)) {
      map.set(key, { label: `${key}년`, sortTime: p.year, ...emptyBucket() })
    }
    addBucket(map.get(key), row)
  }
  return [...map.values()]
    .sort((a, b) => a.sortTime - b.sortTime)
    .map((x) => ({ ...finalizeEsserBucket(x), label: x.label, sortTime: x.sortTime }))
}

export function aggregateEsserByWeekday(rows) {
  const map = new Map()
  for (let d = 0; d < 7; d++) {
    map.set(d, { label: WEEKDAY_LABELS[d], dayOfWeek: d, sortTime: d, ...emptyBucket() })
  }
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    addBucket(map.get(p.dayOfWeek), row)
  }
  return [...map.values()].map((x) => ({
    ...finalizeEsserBucket(x),
    label: x.label,
    sortTime: x.sortTime,
  }))
}

export function aggregateEsserByChannel(rows, metricKey) {
  const map = new Map()
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const label = resolveRecordPlatform(row)
    if (!map.has(label)) map.set(label, { label, ...emptyBucket() })
    addBucket(map.get(label), row)
  }
  return [...map.values()]
    .map((x) => ({
      label: x.label,
      value: chartValueFromBucket(finalizeEsserBucket(x), metricKey),
    }))
    .sort((a, b) => b.value - a.value)
}

export function aggregateEsserByProductOption(rows, metricKey) {
  const map = new Map()
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const name = String(row.productName || '').trim()
    if (!name) continue
    const opt = row.option ? ` / ${row.option}` : ''
    const label = `${name}${opt}`
    if (!map.has(label)) map.set(label, { label, ...emptyBucket() })
    addBucket(map.get(label), row)
  }
  return [...map.values()]
    .map((x) => ({
      label: x.label,
      value: chartValueFromBucket(finalizeEsserBucket(x), metricKey),
    }))
    .sort((a, b) => b.value - a.value)
}

export function aggregateEsserBySalesMethod(rows, metricKey) {
  const map = new Map()
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const label = salesMethodGroupLabel(row) || '미분류'
    if (!map.has(label)) map.set(label, { label, ...emptyBucket() })
    addBucket(map.get(label), row)
  }
  return [...map.values()]
    .map((x) => ({
      label: x.label,
      value: chartValueFromBucket(finalizeEsserBucket(x), metricKey),
    }))
    .sort((a, b) => b.value - a.value)
}

/** 스토어명(brand / storeName)별 집계 */
export function aggregateEsserByStore(rows, metricKey) {
  const map = new Map()
  for (const row of rows) {
    if (isReturnRecord(row)) continue
    const label = storeLabelFromRow(row)
    if (!map.has(label)) map.set(label, { label, ...emptyBucket() })
    addBucket(map.get(label), row)
  }
  return [...map.values()]
    .map((x) => ({
      label: x.label,
      value: chartValueFromBucket(finalizeEsserBucket(x), metricKey),
    }))
    .sort((a, b) => b.value - a.value)
}
