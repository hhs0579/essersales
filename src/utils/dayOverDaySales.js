import { parseSalesDate } from './dateParse.js'
import { getRecordDate } from './recordFilters.js'
import { resolveRecordPlatform } from './platformDetect.js'
import { isReturnRecord } from './transactionType.js'
import { isEsserSheetTotalRecord, resolveEsserSales } from './esserMetrics.js'
import { aggregateEsserByDayWithManual } from './manualAdSpend.js'
import { formatEsserValue } from './esserMetrics.js'
import {
  DAY_OVER_DAY_BRAND_LABELS,
  resolveCombinedBrandRollupLabel,
  withRecordSourceLabel,
} from './recordSourceLabel.js'
import {
  COMBINED_DAY_OVER_DAY_LABELS,
  combinedDayOverDayLabelsForRecords,
  closedMallKpiLabelsFromRecords,
  recordsForCombinedSegmentLabel,
} from './combinedKpiSegments.js'
import { isClosedMallKpiLabel, isClosedMallRecord, OTHER_SELLERS_BRAND_LABEL } from '../config/closedMall.js'

export { DAY_OVER_DAY_BRAND_LABELS } from './recordSourceLabel.js'
export { COMBINED_DAY_OVER_DAY_LABELS } from './combinedKpiSegments.js'

/** 통합 ①요약리포트·전일대비 — 브랜드 + 기타 판매처 + 합계 */
export const COMBINED_BRAND_DAY_OVER_DAY_LABELS = [
  '베스트하임',
  '사본느리',
  '파워프라이스',
  OTHER_SELLERS_BRAND_LABEL,
  '합계',
]

/** 일별 단일 채널 대시보드 — 쿠팡 / 스마트스토어 / 합계 */
export const DAY_OVER_DAY_PLATFORM_LABELS = ['쿠팡', '스마트스토어', '합계']

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function ymdFromParts(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** @param {string} ymd YYYY-MM-DD */
export function addDaysToYmd(ymd, deltaDays) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return ''
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  dt.setDate(dt.getDate() + deltaDays)
  return ymdFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

/** YYYY-MM-DD → YYYY-MM (월 key) */
export function monthKeyFromYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{1,2})/)
  if (!m) return ''
  return `${m[1]}-${pad2(m[2])}`
}

/** @param {string} monthKey YYYY-MM @param {number} delta */
export function addMonthsToMonthKey(monthKey, delta) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{1,2})$/)
  if (!m) return ''
  const dt = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`
}

/** 일별 매출맵(YYYY-MM-DD) → 월별 매출맵(YYYY-MM) */
function toMonthlySalesMap(salesByDay) {
  const map = new Map()
  for (const [dayKey, val] of salesByDay) {
    const mk = monthKeyFromYmd(dayKey)
    if (!mk) continue
    map.set(mk, (map.get(mk) || 0) + (val || 0))
  }
  return map
}

/** 필터·데이터 기준월 (YYYY-MM) — 필터의 연/월 → 종료일 → 데이터 최신월 순 */
export function resolveReferenceMonthKey(rows, filterCtx = {}) {
  const y = String(filterCtx.year || '').trim()
  const mo = String(filterCtx.month || '').trim()
  if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(mo)) return `${y}-${pad2(mo)}`

  const to = String(filterCtx.dateTo || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return monthKeyFromYmd(to)
  const from = String(filterCtx.dateFrom || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return monthKeyFromYmd(from)

  let maxKey = ''
  for (const row of filterSaleProductRows(rows)) {
    const dk = dayKeyFromRow(row)
    if (!dk) continue
    const mk = monthKeyFromYmd(dk)
    if (!maxKey || mk > maxKey) maxKey = mk
  }
  return maxKey
}

/** 조회 기간 일수 (시작·종료 포함) */
export function periodDayCount(dateFrom, dateTo) {
  const from = String(dateFrom || '').trim()
  const to = String(dateTo || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return 0
  }
  let count = 0
  let cur = from
  while (cur <= to) {
    count += 1
    cur = addDaysToYmd(cur, 1)
  }
  return count
}

/** 기간 필터가 7일(일주일)인지 — 최근 7일 프리셋 등 */
export function isOneWeekPeriodFilter(filterCtx = {}) {
  return periodDayCount(filterCtx.dateFrom, filterCtx.dateTo) === 7
}

/** @returns {'day'|'week'|'month'} */
export function resolveSalesComparisonMode(filterCtx = {}) {
  if (filterCtx.period === 'monthly') return 'month'
  return isOneWeekPeriodFilter(filterCtx) ? 'week' : 'day'
}

/** @param {'day'|'week'|'month'} mode */
export function salesComparisonSectionTitle(mode = 'day') {
  if (mode === 'month') return '전월 대비 매출'
  return mode === 'week' ? '전주 대비 매출' : '전일 대비 매출'
}

function sumSalesInRange(salesByDay, fromYmd, toYmd) {
  if (!fromYmd || !toYmd || toYmd < fromYmd) return 0
  let sum = 0
  let cur = fromYmd
  while (cur <= toYmd) {
    sum += salesByDay.get(cur) ?? 0
    cur = addDaysToYmd(cur, 1)
  }
  return sum
}

function resolveComparisonPeriod(filterCtx = {}) {
  const from = String(filterCtx.dateFrom || '').trim()
  const to = String(filterCtx.dateTo || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from) {
    return { from, to }
  }
  return null
}

function dayKeyFromRow(row) {
  const p = parseSalesDate(getRecordDate(row))
  if (!p) return null
  return ymdFromParts(p.year, p.month, p.day)
}

/** 일별 버킷 → YYYY-MM-DD (라벨 우선 — sortTime 타임존 밀림 방지) */
function dayKeyFromBucket(bucket) {
  const p = parseSalesDate(bucket?.label)
  if (p) return ymdFromParts(p.year, p.month, p.day)
  if (bucket?.sortTime) {
    const dt = new Date(bucket.sortTime)
    if (!Number.isNaN(dt.getTime())) {
      return ymdFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
    }
  }
  return null
}

function filterSaleProductRows(rows) {
  return (rows || []).filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r))
}

function tagSourceLabels(rows) {
  return (rows || []).map(withRecordSourceLabel)
}

function platformSubset(rows, label) {
  const list = filterSaleProductRows(rows)
  if (label === '합계') return list
  if (isClosedMallKpiLabel(label)) {
    return filterSaleProductRows(recordsForCombinedSegmentLabel(rows, label))
  }
  return list.filter((r) => resolveRecordPlatform(r) === label)
}

/** 전일대비 라벨 — 기타 판매처(특판만) vs 베스트하임(마켓플레이스) */
function dayOverDayLabelsForRows(rows) {
  const products = filterSaleProductRows(rows)
  const closed = closedMallKpiLabelsFromRecords(rows)
  const onlyClosed = products.length > 0 && products.every((r) => isClosedMallRecord(r))
  if (onlyClosed) return [...closed, '합계']
  return ['쿠팡', '스마트스토어', '합계']
}

function brandSubset(rows, label) {
  const list = filterSaleProductRows(rows)
  if (label === '합계') return list
  return list.filter((r) => resolveCombinedBrandRollupLabel(r) === label)
}

function manualCtxForPlatform(baseCtx, label) {
  if (label === '합계') return { ...baseCtx, platform: '' }
  if (isClosedMallKpiLabel(label)) return { ...baseCtx, platform: '특판 폐쇄몰' }
  return { ...baseCtx, platform: label }
}

/** 필터·데이터 기준일 (YYYY-MM-DD) */
export function resolveReferenceDateKey(rows, filterCtx = {}) {
  const to = String(filterCtx.dateTo || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to

  const from = String(filterCtx.dateFrom || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && !to) return from

  let maxKey = ''
  for (const row of filterSaleProductRows(rows)) {
    const key = dayKeyFromRow(row)
    if (!key) continue
    if (!maxKey || key > maxKey) maxKey = key
  }
  return maxKey
}

function buildDailySalesMap(rows, manualEntries, manualFilterCtx, platformLabel) {
  const subset = platformSubset(rows, platformLabel)
  const ctx = manualCtxForPlatform(manualFilterCtx, platformLabel)
  const daily = aggregateEsserByDayWithManual(subset, manualEntries, ctx)
  const map = new Map()
  for (const bucket of daily) {
    const key = dayKeyFromBucket(bucket)
    if (!key) continue
    map.set(key, bucket.sales || 0)
  }
  return map
}

/** 브랜드별 일 매출 — 상품 행 합산 (플랫폼 필터 없음) */
function buildBrandDailySalesMap(rows, brandLabel) {
  const map = new Map()
  for (const row of brandSubset(rows, brandLabel)) {
    const key = dayKeyFromRow(row)
    if (!key) continue
    const sales = resolveEsserSales(row)
    if (!sales) continue
    map.set(key, (map.get(key) || 0) + sales)
  }
  return map
}

/** 세그먼트별 일 매출 */
function buildSegmentDailySalesMap(rows) {
  const map = new Map()
  for (const row of filterSaleProductRows(rows)) {
    const key = dayKeyFromRow(row)
    if (!key) continue
    const sales = resolveEsserSales(row)
    if (!sales) continue
    map.set(key, (map.get(key) || 0) + sales)
  }
  return map
}

function buildDayOverDayResult(label, salesByDay, ref, prev, options = {}) {
  const mode = options.comparisonMode || 'day'
  const periodFrom = options.periodFrom || ''
  const periodTo = options.periodTo || ref || ''

  let currentSales = 0
  let prevSales = 0
  let prevPeriodFrom = options.prevPeriodFrom || ''
  let prevPeriodTo = options.prevPeriodTo || ''
  let refMonth = ''
  let prevMonth = ''

  if (mode === 'month') {
    const monthMap = toMonthlySalesMap(salesByDay)
    refMonth = options.refMonth || (ref ? monthKeyFromYmd(ref) : '')
    prevMonth = options.prevMonth || (refMonth ? addMonthsToMonthKey(refMonth, -1) : '')
    currentSales = refMonth ? monthMap.get(refMonth) ?? 0 : 0
    prevSales = prevMonth ? monthMap.get(prevMonth) ?? 0 : 0
    // 월별 총 매출 = 일별 합 + 해당 월 특판 (합계 행에만 가산)
    const ss = options.specialSaleByMonth
    if (ss && label === '합계') {
      currentSales += (refMonth && ss.get(refMonth)) || 0
      prevSales += (prevMonth && ss.get(prevMonth)) || 0
    }
    ref = refMonth
    prev = prevMonth
  } else if (mode === 'week' && periodFrom && periodTo) {
    prevPeriodFrom = addDaysToYmd(periodFrom, -7)
    prevPeriodTo = addDaysToYmd(periodTo, -7)
    currentSales = sumSalesInRange(salesByDay, periodFrom, periodTo)
    prevSales = sumSalesInRange(salesByDay, prevPeriodFrom, prevPeriodTo)
    ref = periodTo
    prev = prevPeriodTo
  } else {
    currentSales = ref ? salesByDay.get(ref) ?? 0 : 0
    prevSales = prev ? salesByDay.get(prev) ?? 0 : 0
  }

  let changePct = null
  if (mode === 'month') {
    // 전월 매출이 0/없음이면 증감률 표시 불가 → N/A
    changePct = prevSales > 0 ? ((currentSales - prevSales) / prevSales) * 100 : null
  } else if (mode === 'week' ? periodFrom && periodTo : ref && prev) {
    if (prevSales > 0) {
      changePct = ((currentSales - prevSales) / prevSales) * 100
    } else if (currentSales > 0) {
      changePct = 100
    } else {
      changePct = 0
    }
  }

  return {
    platform: label,
    comparisonMode: mode,
    referenceDate: ref,
    prevDate: prev,
    periodFrom,
    periodTo,
    prevPeriodFrom,
    prevPeriodTo,
    refMonth,
    prevMonth,
    currentSales,
    prevSales,
    changeAmount: currentSales - prevSales,
    changePct,
    trend: formatComparisonTrendLabel(changePct, mode),
    changeLabel: formatDayOverDayPct(changePct),
    currentSalesLabel: formatEsserValue('sales', currentSales),
    prevSalesLabel: formatEsserValue('sales', prevSales),
  }
}

/**
 * @param {number|null} pct
 */
export function formatDayOverDayPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export function formatDayOverDayLabel(pct) {
  return formatComparisonTrendLabel(pct, 'day')
}

/** @param {number|null} pct @param {'day'|'week'|'month'} [mode='day'] */
export function formatComparisonTrendLabel(pct, mode = 'day') {
  if (pct == null || !Number.isFinite(pct)) {
    if (mode === 'month') return '전월 없음'
    return mode === 'week' ? '전주 없음' : '전일 없음'
  }
  if (pct > 0.05) return '상승'
  if (pct < -0.05) return '하락'
  return '동일'
}

/** @param {'day'|'week'|'month'} mode */
export function salesComparisonCurrentColumnLabel(mode = 'day') {
  if (mode === 'month') return '기준월 매출'
  return mode === 'week' ? '기간 매출' : '기준일 매출'
}

/** @param {'day'|'week'|'month'} mode @param {ReturnType<typeof buildDayOverDayResult>} [row] */
export function salesComparisonPrevColumnLabel(mode = 'day', row = null) {
  if (mode === 'month') {
    const prevMonth = row?.prevMonth || ''
    return prevMonth ? `전월(${prevMonth}) 매출` : '전월 매출'
  }
  if (mode === 'week' && row?.prevPeriodFrom && row?.prevPeriodTo) {
    return `전주(${row.prevPeriodFrom}~${row.prevPeriodTo}) 매출`
  }
  const prev = row?.prevDate || ''
  return prev ? `전일(${prev}) 매출` : mode === 'week' ? '전주 매출' : '전일 매출'
}

/** @param {'day'|'week'|'month'} mode */
export function salesComparisonChangeColumnLabel(mode = 'day') {
  if (mode === 'month') return '전월 대비'
  return mode === 'week' ? '전주 대비' : '전일 대비'
}

function resolveComparisonContext(manualFilterCtx, referenceDateKey, rows, extraOptions = {}) {
  const mode = resolveSalesComparisonMode(manualFilterCtx)

  if (mode === 'month') {
    const refMonth = resolveReferenceMonthKey(rows, manualFilterCtx)
    const prevMonth = refMonth ? addMonthsToMonthKey(refMonth, -1) : ''
    return {
      mode,
      ref: refMonth,
      prev: prevMonth,
      buildOptions: {
        comparisonMode: 'month',
        refMonth,
        prevMonth,
        specialSaleByMonth: extraOptions.specialSaleByMonth || null,
      },
    }
  }

  const period = mode === 'week' ? resolveComparisonPeriod(manualFilterCtx) : null
  const ref =
    referenceDateKey ||
    (period ? period.to : resolveReferenceDateKey(rows, manualFilterCtx)) ||
    ''
  const prev = mode === 'week' && period ? addDaysToYmd(period.to, -7) : ref ? addDaysToYmd(ref, -1) : ''
  return {
    mode,
    ref,
    prev,
    buildOptions:
      mode === 'week' && period
        ? {
            comparisonMode: 'week',
            periodFrom: period.from,
            periodTo: period.to,
            prevPeriodFrom: addDaysToYmd(period.from, -7),
            prevPeriodTo: addDaysToYmd(period.to, -7),
          }
        : { comparisonMode: 'day' },
  }
}

/** 특판 월별 매출 합계 맵 (YYYY-MM → 매출) — computeXxx options.specialSaleByMonth 용 */
export function buildSpecialSaleMonthlyTotals(monthlyEntries) {
  const map = new Map()
  if (!monthlyEntries || typeof monthlyEntries !== 'object') return map
  for (const [monthKey, entries] of Object.entries(monthlyEntries)) {
    let total = 0
    for (const e of entries || []) {
      const n = Number(String(e?.sales ?? '').replace(/[^0-9.-]/g, ''))
      if (Number.isFinite(n)) total += n
    }
    if (total) map.set(monthKey, total)
  }
  return map
}

/**
 * @param {object[]} rows
 * @param {object} [options]
 */
export function computeDayOverDaySales(rows, options = {}) {
  const {
    manualAdEntries = [],
    manualFilterCtx = {},
    referenceDateKey = null,
    lookupRows = null,
    specialSaleByMonth = null,
  } = options

  const salesRows = lookupRows?.length ? lookupRows : rows
  const ctx = resolveComparisonContext(manualFilterCtx, referenceDateKey, rows, {
    specialSaleByMonth,
  })

  return dayOverDayLabelsForRows(salesRows).map((platform) => {
    const salesByDay = buildDailySalesMap(
      salesRows,
      manualAdEntries,
      manualFilterCtx,
      platform,
    )
    return buildDayOverDayResult(platform, salesByDay, ctx.ref, ctx.prev, ctx.buildOptions)
  })
}

/**
 * 통합 — 베스트하임·사본느리·파워프라이스 (판매자/로켓/스스 등 세그먼트 합산)
 * @param {object[]} rows
 * @param {object} [options]
 */
export function computeCombinedBrandDayOverDaySales(rows, options = {}) {
  const {
    manualFilterCtx = {},
    referenceDateKey = null,
    lookupRows = null,
    specialSaleByMonth = null,
  } = options

  const salesRows = tagSourceLabels(lookupRows?.length ? lookupRows : rows)
  const ctx = resolveComparisonContext(manualFilterCtx, referenceDateKey, rows, {
    specialSaleByMonth,
  })

  return COMBINED_BRAND_DAY_OVER_DAY_LABELS.map((label) => {
    const salesByDay = buildBrandDailySalesMap(salesRows, label)
    return buildDayOverDayResult(label, salesByDay, ctx.ref, ctx.prev, ctx.buildOptions)
  })
}

/**
 * 통합 — 세그먼트별 전일·전주 대비 (쿠팡 1P 로켓 → 베스트하임(로켓))
 * @param {object[]} rows
 * @param {object} [options]
 */
export function computeCombinedSegmentDayOverDaySales(rows, options = {}) {
  const {
    manualFilterCtx = {},
    referenceDateKey = null,
    lookupRows = null,
  } = options

  const salesRows = tagSourceLabels(lookupRows?.length ? lookupRows : rows)
  const ctx = resolveComparisonContext(manualFilterCtx, referenceDateKey, rows)

  const labels = combinedDayOverDayLabelsForRecords(salesRows)
  return labels.map((label) => {
    const subset = recordsForCombinedSegmentLabel(salesRows, label)
    const salesByDay = buildSegmentDailySalesMap(subset)
    return buildDayOverDayResult(label, salesByDay, ctx.ref, ctx.prev, ctx.buildOptions)
  })
}

/**
 * @deprecated computeCombinedBrandDayOverDaySales 사용
 */
export function computeBrandDayOverDaySales(rows, options = {}) {
  return computeCombinedBrandDayOverDaySales(rows, options)
}

/** @param {ReturnType<typeof computeDayOverDaySales>} rows */
export function buildDayOverDayExcelRows(dayOverDayRows, referenceDate = '', opts = {}) {
  const mode = opts.comparisonMode || dayOverDayRows?.[0]?.comparisonMode || 'day'
  const first = dayOverDayRows?.[0]
  const refLabel =
    referenceDate ||
    (mode === 'month'
      ? first?.refMonth || ''
      : mode === 'week' && first?.periodFrom && first?.periodTo
        ? `${first.periodFrom}~${first.periodTo}`
        : first?.referenceDate || '')
  const prevLabel =
    mode === 'month'
      ? first?.prevMonth || ''
      : mode === 'week' && first?.prevPeriodFrom && first?.prevPeriodTo
        ? `${first.prevPeriodFrom}~${first.prevPeriodTo}`
        : first?.prevDate || ''
  const defaultSectionTitle =
    mode === 'month'
      ? '■ 전월 대비 매출 (쿠팡 / 스마트스토어 / 합계)'
      : mode === 'week'
        ? '■ 전주 대비 매출 (쿠팡 / 스마트스토어 / 합계)'
        : '■ 전일 대비 매출 (쿠팡 / 스마트스토어 / 합계)'
  const sectionTitle = opts.sectionTitle || defaultSectionTitle
  const header =
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
  const body = (dayOverDayRows || []).map((r) =>
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
  const periodMetaLeft = mode === 'month' ? '기준월' : mode === 'week' ? '조회 기간' : '기준일'
  const periodMetaRight = mode === 'month' ? '전월' : mode === 'week' ? '전주 동기간' : '전일'
  return [[sectionTitle], [periodMetaLeft, refLabel, periodMetaRight, prevLabel], header, ...body, []]
}
