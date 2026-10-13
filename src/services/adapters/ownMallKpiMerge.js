import { isCombinedScope, isMonthlyScope } from '../../config/dataChannels.js'
import { deriveEsserProfitKpis, finalizeEsserBucket, aggregateEsserByDay } from '../../utils/esserMetrics.js'
import {
  applyRecordFilters,
  excludeEsserSheetTotalsForPeriodKpi,
} from '../../utils/recordFilters.js'
import {
  buildPlatformKpiSplitRows,
  buildMergedTotalRow,
  buildCombinedKpiSplitRows,
  buildCombinedSegmentsTotalRow,
  isManualAdKpiLabel,
} from '../../utils/platformKpiSplit.js'
import { buildSpecialSaleKpiRows } from '../../utils/specialSaleKpi.js'
import {
  buildManualExpenseKpiRows,
  isManualExpenseSegmentKind,
} from '../../utils/manualExpenseKpi.js'
import { COMBINED_SEGMENT_DEFS } from '../../utils/combinedKpiSegments.js'

const OWN_MALL_COMBINED_SEGMENT_LABEL = '사본느리(자사몰)'

export function shouldMergeOwnMallManualKpi(scope) {
  return scope === 'company_b' || scope === 'company_b_monthly' || isCombinedScope(scope)
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * 월별 scope — 연·월이 있으면 기본은 1~말일.
 * 사용자가 dateFrom/dateTo로 기간을 줄였으면 그 기간을 그대로 씀.
 * @param {string} scope
 * @param {object} filters
 */
export function buildOwnMallKpiFilterCtx(scope, filters = {}) {
  const base = { ...filters, platform: '' }
  if (!isMonthlyScope(scope)) return base

  const y = String(filters.year || '').trim()
  const mo = String(filters.month || '').trim()
  const from = String(filters.dateFrom || '').trim()
  const to = String(filters.dateTo || '').trim()
  const hasRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)

  if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(mo)) {
    const month = Number(mo)
    const padMo = String(month).padStart(2, '0')
    const last = lastDayOfMonth(Number(y), month)
    const monthStart = `${y}-${padMo}-01`
    const monthEnd = `${y}-${padMo}-${String(last).padStart(2, '0')}`
    return {
      ...base,
      year: y,
      month: String(month),
      dateFrom: hasRange ? from : monthStart,
      dateTo: hasRange ? to : monthEnd,
      dayOfWeek: '',
      period: 'monthly',
    }
  }

  if (hasRange) {
    const yy = to.slice(0, 4)
    const mm = String(Number(to.slice(5, 7)))
    return {
      ...base,
      year: yy,
      month: mm,
      dateFrom: from,
      dateTo: to,
      dayOfWeek: '',
      period: 'monthly',
    }
  }

  const fallbackTo = String(filters.dateTo || filters.dateFrom || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(fallbackTo)) {
    const yy = fallbackTo.slice(0, 4)
    const mm = String(Number(fallbackTo.slice(5, 7)))
    const month = Number(mm)
    const padMo = String(month).padStart(2, '0')
    const last = lastDayOfMonth(Number(yy), month)
    return {
      ...base,
      year: yy,
      month: mm,
      dateFrom: `${yy}-${padMo}-01`,
      dateTo: `${yy}-${padMo}-${String(last).padStart(2, '0')}`,
      dayOfWeek: '',
      period: 'monthly',
    }
  }

  return { ...base, period: 'monthly' }
}

function filterOwnMallRecordsForKpi(records, filterCtx = {}) {
  const f = {
    year: '',
    month: '',
    dayOfWeek: '',
    date: '',
    channel: '',
    brand: '',
    productName: '',
    ...filterCtx,
    platform: '',
  }
  return excludeEsserSheetTotalsForPeriodKpi(
    applyRecordFilters(records || [], 'detail', f),
    f,
  )
}

/** 사본느리 자사몰 직접입력 → 플랫폼 split 자사몰 행 */
export function buildOwnMallPlatformRow(ownMallRecords, filterCtx = {}) {
  const filtered = filterOwnMallRecordsForKpi(ownMallRecords, filterCtx)
  if (!filtered.length) return null
  const rows = buildPlatformKpiSplitRows(filtered, [], filterCtx)
  return rows.find((r) => r.label === '자사몰') || null
}

function segmentRowHasActivity(row) {
  if (!row) return false
  const p = row.profit || {}
  const a = row.ad || {}
  return (
    (p.sales || 0) !== 0 ||
    (p.salesQty || 0) !== 0 ||
    (p.netProfit || 0) !== 0 ||
    (a.adSpend || 0) !== 0 ||
    (a.adSales || 0) !== 0 ||
    (row.rowCount || 0) > 0
  )
}

/**
 * 통합 by-segment — 사본느리(자사몰) 직접입력 보강
 * @param {ReturnType<import('./platformKpiAdapter.js').adaptServerSegmentKpiRows>} serverRows
 */
export function mergeOwnMallIntoCombinedSegmentRows(serverRows, ownMallRecords, filterCtx = {}) {
  const filtered = filterOwnMallRecordsForKpi(ownMallRecords, filterCtx)
  const map = new Map((serverRows || []).map((r) => [r.label, r]))

  if (filtered.length) {
    const split = buildCombinedKpiSplitRows(filtered, filtered, [], filterCtx)
    const addon = split.find((r) => r.label === OWN_MALL_COMBINED_SEGMENT_LABEL)
    if (addon && segmentRowHasActivity(addon)) {
      // 자사몰은 DB가 아닌 app_settings 직접입력이 단일 소스
      map.set(OWN_MALL_COMBINED_SEGMENT_LABEL, addon)
    }
  }

  const manualAdRows = (serverRows || []).filter((r) => isManualAdKpiLabel(r.label))
  const segmentRows = []
  const fixedLabels = new Set(COMBINED_SEGMENT_DEFS.map((d) => d.label))

  for (const def of COMBINED_SEGMENT_DEFS) {
    const row = map.get(def.label)
    if (!segmentRowHasActivity(row)) continue
    segmentRows.push(row)
  }

  // 고정 세그먼트 외 동적 행 유지 (특판 수기·특판 폐쇄몰 판매처 등)
  // 예전: 폐쇄몰만 남겨 특판 수기 행이 KPI에서 사라짐
  for (const row of serverRows || []) {
    const label = row.label
    if (!label || label === '합계' || isManualAdKpiLabel(label)) continue
    if (fixedLabels.has(label)) continue
    const merged = map.get(label) || row
    if (!segmentRowHasActivity(merged)) continue
    if (segmentRows.some((r) => r.label === label)) continue
    segmentRows.push(merged)
  }

  const total = buildCombinedSegmentsTotalRow(segmentRows, manualAdRows)
  return [...segmentRows, ...manualAdRows, total]
}

/**
 * 통합 월별 — 특판 수기 행을 클라 스냅샷으로 보강 (서버 month 키 불일치 대비)
 * @param {ReturnType<import('./platformKpiAdapter.js').adaptServerSegmentKpiRows>} serverRows
 * @param {{ entries?: unknown[] } | null | undefined} specialSale
 */
export function mergeSpecialSaleIntoCombinedSegmentRows(serverRows, specialSale) {
  const ssRows = buildSpecialSaleKpiRows(specialSale).filter(segmentRowHasActivity)
  if (!ssRows.length) return serverRows || []

  const rows = serverRows || []
  const map = new Map(rows.map((r) => [r.label, r]))
  const ssLabels = new Set(ssRows.map((r) => r.label))

  for (const row of ssRows) {
    map.set(row.label, row)
  }

  const manualAdRows = rows.filter((r) => isManualAdKpiLabel(r.label))
  const segmentRows = []
  const fixedLabels = new Set(COMBINED_SEGMENT_DEFS.map((d) => d.label))

  for (const def of COMBINED_SEGMENT_DEFS) {
    const row = map.get(def.label)
    if (!segmentRowHasActivity(row)) continue
    segmentRows.push(row)
  }

  for (const row of rows) {
    const label = row.label
    if (!label || label === '합계' || isManualAdKpiLabel(label)) continue
    if (fixedLabels.has(label) || ssLabels.has(label)) continue
    const merged = map.get(label) || row
    if (!segmentRowHasActivity(merged)) continue
    if (segmentRows.some((r) => r.label === label)) continue
    segmentRows.push(merged)
  }

  for (const row of ssRows) {
    if (segmentRows.some((r) => r.label === row.label)) continue
    segmentRows.push(row)
  }

  const total = buildCombinedSegmentsTotalRow(segmentRows, manualAdRows)
  return [...segmentRows, ...manualAdRows, total]
}

/**
 * @param {object[]} serverRows
 * @param {{ entries?: unknown[] } | null | undefined} manualExpense
 */
export function mergeManualExpenseIntoCombinedSegmentRows(serverRows, manualExpense) {
  const expenseRows = buildManualExpenseKpiRows(manualExpense).filter(segmentRowHasActivity)
  if (!expenseRows.length) return serverRows || []

  const rows = serverRows || []
  const map = new Map(rows.map((r) => [r.label, r]))
  const expenseLabels = new Set(expenseRows.map((r) => r.label))

  for (const row of expenseRows) {
    map.set(row.label, row)
  }

  const manualAdRows = rows.filter((r) => isManualAdKpiLabel(r.label))
  const segmentRows = []
  const fixedLabels = new Set(COMBINED_SEGMENT_DEFS.map((d) => d.label))

  for (const def of COMBINED_SEGMENT_DEFS) {
    const row = map.get(def.label)
    if (!segmentRowHasActivity(row)) continue
    segmentRows.push(row)
  }

  for (const row of rows) {
    const label = row.label
    if (!label || label === '합계' || isManualAdKpiLabel(label)) continue
    if (fixedLabels.has(label) || expenseLabels.has(label)) continue
    if (isManualExpenseSegmentKind(row)) continue
    const merged = map.get(label) || row
    if (!segmentRowHasActivity(merged)) continue
    if (segmentRows.some((r) => r.label === label)) continue
    segmentRows.push(merged)
  }

  for (const row of expenseRows) {
    if (segmentRows.some((r) => r.label === row.label)) continue
    segmentRows.push(row)
  }

  const total = buildCombinedSegmentsTotalRow(segmentRows, manualAdRows)
  return [...segmentRows, ...manualAdRows, total]
}

/**
 * Server by-platform KPI + own_mall_manual (app_settings)
 * @param {ReturnType<import('./platformKpiAdapter.js').adaptServerPlatformKpiRows>} serverRows
 */
export function mergeOwnMallManualIntoServerPlatformRows(serverRows, ownMallRecords, filterCtx = {}) {
  const ownMallRow = buildOwnMallPlatformRow(ownMallRecords, filterCtx)
  if (!ownMallRow) return serverRows || []

  const rows = serverRows || []

  const manualAdRows = rows.filter((r) => isManualAdKpiLabel(r.label))
  const coupang = rows.find((r) => r.label === '쿠팡') || {
    label: '쿠팡',
    profit: {},
    ad: {},
    rowCount: 0,
  }
  const smart = rows.find((r) => r.label === '스마트스토어') || {
    label: '스마트스토어',
    profit: {},
    ad: {},
    rowCount: 0,
  }
  const total = buildMergedTotalRow(coupang, smart, ownMallRow, manualAdRows)

  const marketplace = [coupang, smart, ownMallRow].filter(Boolean)
  return [...marketplace, ...manualAdRows, total]
}

/** Server KPI summary bucket + 자사몰 행 */
export function mergeOwnMallIntoServerKpiBucket(bucket, ownMallRow) {
  if (!bucket || !ownMallRow) return bucket
  const p = ownMallRow.profit || {}
  const a = ownMallRow.ad || {}
  if (!(p.sales || 0) && !(p.netProfit || 0) && !ownMallRow.rowCount) return bucket

  const base = finalizeEsserBucket({
    sales: (bucket.sales || 0) + (p.sales || 0),
    salesQty: (bucket.salesQty || 0) + (p.salesQty || 0),
    netProfit: (bucket.netProfit || 0) + (p.netProfit || 0),
    totalCost: (bucket.totalCost || 0) + (p.totalCost || 0),
    adSpend: (bucket.adSpend || 0) + (a.adSpend || 0),
    adSales: (bucket.adSales || 0) + (a.adSales || 0),
  })
  return deriveEsserProfitKpis(base, { productKpi: base })
}

/** Server daily chart + 자사몰 일별 */
export function mergeOwnMallManualIntoDailyBuckets(buckets, ownMallRecords, filterCtx = {}) {
  const filtered = filterOwnMallRecordsForKpi(ownMallRecords, filterCtx)
  if (!filtered.length) return buckets || []

  const ownDaily = aggregateEsserByDay(filtered)
  if (!ownDaily.length) return buckets || []

  const map = new Map()
  for (const b of buckets || []) {
    const key = String(b.date || b.label || '').slice(0, 10)
    if (!key) continue
    map.set(key, { ...b })
  }

  for (const d of ownDaily) {
    const key = String(d.label || '').slice(0, 10)
    if (!key) continue
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        ...d,
        date: key,
        label: key,
        sortTime: d.sortTime || new Date(key).getTime(),
      })
      continue
    }
    const merged = finalizeEsserBucket({
      sales: (prev.sales || 0) + (d.sales || 0),
      salesQty: (prev.salesQty || 0) + (d.salesQty || 0),
      netProfit: (prev.netProfit || 0) + (d.netProfit || 0),
      totalCost: (prev.totalCost || 0) + (d.totalCost || 0),
      adSpend: (prev.adSpend || 0) + (d.adSpend || 0),
      adSales: (prev.adSales || 0) + (d.adSales || 0),
    })
    map.set(key, {
      ...merged,
      date: key,
      label: key,
      sortTime: prev.sortTime || d.sortTime || new Date(key).getTime(),
    })
  }

  return [...map.values()].sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0))
}
