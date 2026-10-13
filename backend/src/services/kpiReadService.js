import { getPool } from '../db/pool.js'
import { getSetting } from '../repositories/settingsRepository.js'
import {
  parseKpiQuery,
  buildKpiWhere,
} from '../repositories/kpiRepository.js'
import {
  queryDailyKpiSql,
  querySheetAdTotalsSql,
  queryPlatformKpiSql,
  querySegmentKpiSql,
  queryDailyByPlatformSql,
  queryMaxAggDateSql,
} from '../repositories/kpiSqlAggregate.js'
import { addDaysToYmd } from '../utils/esserKpiAggregate.js'
import { aggregateCombinedSegmentKpiFromRecords } from '../utils/combinedSegmentKpi.js'
import {
  filterCtxFromKpiFilters,
  mergeSummaryWithManual,
  mergeDailyItemsWithManual,
  mergePlatformWithManual,
  mergeCompareYesterdayWithManual,
} from '../utils/manualAdKpiMerge.js'
import { loadManualAdEntriesForScope, loadManualAdChannelGroups } from './manualAdLoadService.js'
import { findExternalAdChannelByScope } from '../../../src/config/externalAdChannels.js'
import {
  applyRecordFilters,
  applyKpiDetailFilters,
} from '../../../src/utils/recordFilters.js'
import { enrichExportRecords } from '../../../src/utils/combinedExportRecords.js'
import { resolveOwnMallStoreForKpi } from '../../../src/utils/ownMallRecords.js'
import { pickSpecialSaleSettingForMonth } from '../../../src/utils/specialSaleKpi.js'
import { pickManualExpenseSettingForMonth } from '../../../src/utils/manualExpenseKpi.js'
import {
  isCombinedScope,
  isMonthlyScope,
  specialSaleScopeFor,
} from '../../../src/config/dataChannels.js'
import {
  combinedIncludesPowerPrice,
} from '../../../src/config/combinedChannel.js'
import { POWER_PRICE_SCOPE } from '../../../src/config/powerPrice.js'
import { OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND } from '../../../src/config/ownMallManual.js'
import { COUPANG_1P_ROCKET_SCOPE } from '../../../src/config/coupang1pRocket.js'

import { COMBINED_SEGMENT_DEFS } from '../../../src/utils/combinedKpiSegments.js'
import { isManualAdKpiLabel } from '../../../src/utils/platformKpiSplit.js'
import { isClosedMallKpiLabel } from '../../../src/config/closedMall.js'

export { parseKpiQuery }

function round2(n) {
  return Number(Number(n).toFixed(2))
}

function num(v) {
  return Number(v || 0)
}

function addSegmentApiItems(a, b) {
  const sales = num(a.salesTotal) + num(b.salesTotal)
  const qty = num(a.quantityTotal) + num(b.quantityTotal)
  const netProfit = num(a.netProfitTotal) + num(b.netProfitTotal)
  const cost = num(a.costTotal) + num(b.costTotal)
  const adSpend = num(a.adSpendTotal) + num(b.adSpendTotal)
  const adSales = num(a.adSalesTotal) + num(b.adSalesTotal)
  return {
    ...a,
    ...b,
    platform: a.platform || b.platform,
    segment: a.segment || b.segment || a.platform,
    segmentKey:
      a.segmentKey === 'special_sale' || b.segmentKey === 'special_sale'
        ? 'special_sale'
        : a.segmentKey || b.segmentKey,
    estimateCostFromMargin: a.estimateCostFromMargin || b.estimateCostFromMargin,
    isManualAdRow: a.isManualAdRow || b.isManualAdRow,
    salesTotal: sales,
    quantityTotal: qty,
    recordCount: num(a.recordCount) + num(b.recordCount),
    netProfitTotal: netProfit,
    adSpendTotal: adSpend,
    adSalesTotal: adSales,
    costTotal: cost,
    marginRate: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    averageOrderValue: qty > 0 ? round2(sales / qty) : 0,
    netProfitAfterManualAd: netProfit,
    marginRateAfterManualAd: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    manualAdSpendTotal: num(a.manualAdSpendTotal) + num(b.manualAdSpendTotal),
  }
}

function toSegmentApiItem(row) {
  const sales = num(row.salesTotal)
  const netProfit = num(row.netProfitTotal)
  return {
    platform: row.platform || row.segment,
    segment: row.segment || row.platform,
    segmentKey: row.segmentKey || null,
    estimateCostFromMargin: row.estimateCostFromMargin === true,
    isManualAdRow: row.isManualAdRow === true,
    salesTotal: sales,
    quantityTotal: num(row.quantityTotal),
    recordCount: num(row.recordCount),
    netProfitTotal: netProfit,
    adSpendTotal: num(row.adSpendTotal),
    adSalesTotal: num(row.adSalesTotal),
    costTotal: num(row.costTotal),
    marginRate: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    averageOrderValue: num(row.quantityTotal) > 0 ? round2(sales / num(row.quantityTotal)) : 0,
    netProfitAfterManualAd: netProfit,
    marginRateAfterManualAd: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    manualAdSpendTotal: num(row.manualAdSpendTotal),
  }
}

function mergeSqlAndSettingsSegments(sqlItems, settingsResult) {
  const map = new Map()
  for (const item of sqlItems || []) {
    const api = toSegmentApiItem(item)
    if (!api.platform) continue
    map.set(api.platform, api)
  }
  for (const item of settingsResult?.items || []) {
    const key = item.platform || item.segment
    if (!key) continue
    const prev = map.get(key)
    map.set(key, prev ? addSegmentApiItems(prev, item) : item)
  }

  const ordered = []
  for (const def of COMBINED_SEGMENT_DEFS) {
    const row = map.get(def.label)
    if (!row) continue
    if (
      row.salesTotal ||
      row.quantityTotal ||
      row.recordCount ||
      row.adSpendTotal ||
      row.netProfitTotal
    ) {
      ordered.push(row)
    }
    map.delete(def.label)
  }

  const closedLabels = [...map.keys()].filter((k) => isClosedMallKpiLabel(k)).sort((a, b) => a.localeCompare(b, 'ko'))
  for (const key of closedLabels) {
    ordered.push(map.get(key))
    map.delete(key)
  }

  const rest = [...map.keys()].filter((k) => !isManualAdKpiLabel(k)).sort((a, b) => a.localeCompare(b, 'ko'))
  for (const key of rest) {
    ordered.push(map.get(key))
    map.delete(key)
  }
  for (const key of [...map.keys()]) {
    ordered.push(map.get(key))
  }

  const totalSrc = settingsResult?.totalRow
  const total = ordered.reduce((acc, item) => addSegmentApiItems(acc, item), toSegmentApiItem({
    platform: '합계',
    segment: '합계',
    salesTotal: 0,
    quantityTotal: 0,
    recordCount: 0,
    netProfitTotal: 0,
    adSpendTotal: 0,
    adSalesTotal: 0,
    costTotal: 0,
  }))
  if (totalSrc && !sqlItems?.length) {
    return { items: ordered, totalRow: totalSrc }
  }
  return { items: ordered, totalRow: { ...total, platform: '합계', segment: '합계' } }
}

function mapFiltersResponse(filters) {
  return {
    from: filters.from,
    to: filters.to,
    platform: filters.platform || null,
    salesMethod: filters.salesMethod || null,
    storeName: filters.storeName || null,
    uploadKind: filters.uploadKind || null,
    uploadFormat: filters.uploadFormat || null,
    scope: filters.scope || null,
    includeManualAds: filters.includeManualAds !== false,
  }
}

async function maybeLoadManualAds(filters) {
  if (!filters.includeManualAds) return []
  return loadManualAdEntriesForScope(filters.scope)
}

async function applyManualMerge(base, filters, merger) {
  const manualEntries = await maybeLoadManualAds(filters)
  if (!manualEntries.length) {
    if (typeof base === 'object' && base !== null && !Array.isArray(base)) {
      return {
        ...base,
        manualAdSpendTotal: 0,
        netProfitAfterManualAd: base.netProfitTotal ?? 0,
        marginRateAfterManualAd: base.marginRate ?? 0,
      }
    }
    return base
  }
  const filterCtx = filterCtxFromKpiFilters(filters)
  const brandLabel = findExternalAdChannelByScope(filters.scope)?.label || ''
  return merger(base, manualEntries, filterCtx, { brandLabel })
}

/**
 * 엑셀 합계 행 광고비 — SQL 집계
 */
async function sumSheetAdSpend(_pool, filters) {
  return querySheetAdTotalsSql(filters)
}

export async function getKpiSummary(query) {
  const filters = parseKpiQuery(query)
  const pool = getPool()

  const allWhere = buildKpiWhere(filters)
  const productWhere = buildKpiWhere(filters, { productRowsOnly: true })

  const [allRes, productRes, sheetAd] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS record_count,
         COALESCE(SUM(sales), 0)::numeric AS sales_total,
         COALESCE(SUM(sales_qty), 0)::numeric AS quantity_total,
         COUNT(DISTINCT upload_id)::int AS upload_count
       FROM sales_records ${allWhere.where}`,
      allWhere.params,
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS product_row_count,
         COALESCE(SUM(sales), 0)::numeric AS sales_total,
         COALESCE(SUM(sales_qty), 0)::numeric AS quantity_total,
         COALESCE(SUM(net_profit), 0)::numeric AS net_profit_total,
         COALESCE(SUM(ad_spend), 0)::numeric AS row_ad_spend_total,
         COALESCE(SUM(
           CASE WHEN net_profit IS NOT NULL AND sales IS NOT NULL
             THEN GREATEST(sales - net_profit, 0) ELSE 0 END
         ), 0)::numeric AS cost_total
       FROM sales_records ${productWhere.where}`,
      productWhere.params,
    ),
    sumSheetAdSpend(pool, filters),
  ])

  const all = allRes.rows[0]
  const product = productRes.rows[0]
  const salesTotal = Number(product.sales_total)
  const quantityTotal = Number(product.quantity_total)
  const netProfitTotal = Number(product.net_profit_total)
  const adSpendTotal = Number(product.row_ad_spend_total) + sheetAd.adSpend
  const costTotal = Number(product.cost_total)
  const marginRate = salesTotal > 0 ? round2((netProfitTotal / salesTotal) * 100) : 0
  const averageOrderValue = quantityTotal > 0 ? round2(salesTotal / quantityTotal) : 0

  const base = {
    salesTotal,
    quantityTotal,
    recordCount: all.record_count,
    uploadCount: all.upload_count,
    productRowCount: product.product_row_count,
    netProfitTotal,
    adSpendTotal,
    adSalesTotal: sheetAd.adSales,
    costTotal,
    marginRate,
    averageOrderValue,
    filters: mapFiltersResponse(filters),
  }

  return applyManualMerge(base, filters, mergeSummaryWithManual)
}

export async function getKpiDaily(query) {
  const filters = parseKpiQuery(query)
  const items = await queryDailyKpiSql(filters)

  const mergedItems = await applyManualMerge(
    items,
    filters,
    (list, manualEntries, filterCtx) => mergeDailyItemsWithManual(list, manualEntries, filterCtx),
  )

  return {
    items: mergedItems,
    total: mergedItems.length,
    filters: mapFiltersResponse(filters),
  }
}

export async function getKpiByPlatform(query) {
  const filters = parseKpiQuery(query)
  const { items, total, allItems } = await queryPlatformKpiSql(filters)

  const base = {
    items,
    total: items.length,
    totalRow: total,
    unknown: allItems.find((i) => i.platform === '미지정') || null,
    filters: mapFiltersResponse(filters),
  }

  const merged = await applyManualMerge(base, filters, mergePlatformWithManual)
  return merged
}

async function getSettingData(scope, kind, opts = {}) {
  const row = await getSetting(scope, kind, opts)
  return row?.data ?? null
}

/** DB·클라이언트 스냅샷 → { entries } (월별 저장 구조 호환) */
function normalizeSpecialSaleSetting(raw, monthKey = '') {
  return pickSpecialSaleSettingForMonth(raw, monthKey)
}

function resolveSegmentMonthKey(filters = {}) {
  const to = String(filters.to || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to.slice(0, 7)
  const from = String(filters.from || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return from.slice(0, 7)
  return ''
}

/**
 * 통합 브랜드·채널 세그먼트 KPI (클라 buildCombinedKpiSplitRows와 동일 규칙)
 */
export async function getKpiBySegment(query) {
  const filters = parseKpiQuery(query)
  const scope = filters.scope || ''

  if (!isCombinedScope(scope)) {
    return {
      items: [],
      total: 0,
      totalRow: null,
      manualAdItems: [],
      filters: mapFiltersResponse(filters),
    }
  }

  const [sqlItems, powerPriceStore, ownMallLean, coupang1pStore] = await Promise.all([
    querySegmentKpiSql(filters),
    combinedIncludesPowerPrice(scope)
      ? getSettingData(POWER_PRICE_SCOPE, 'power_price')
      : Promise.resolve(null),
    // 기본은 base64 제외 — sales 배열이 있으면 충분
    getSettingData(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND, { omitSources: true }),
    getSettingData(COUPANG_1P_ROCKET_SCOPE, 'coupang_1p_rocket'),
  ])

  let ownMallStoreRaw = ownMallLean
  const salesLen = Array.isArray(ownMallLean?.sales) ? ownMallLean.sales.length : 0
  const sourceMetaLen = Array.isArray(ownMallLean?.salesSourceFiles)
    ? ownMallLean.salesSourceFiles.length
    : 0
  // sales 비고 원본 메타만 있으면 한 번만 full 로드해 엑셀 복원 (사본느리 자사몰 누락 방지)
  if (!salesLen && sourceMetaLen > 0) {
    ownMallStoreRaw = await getSettingData(
      OWN_MALL_MANUAL_SCOPE,
      OWN_MALL_MANUAL_SETTING_KIND,
    )
  }
  const ownMallStore = await resolveOwnMallStoreForKpi(ownMallStoreRaw)

  let settingsRecords = enrichExportRecords([], scope, {
    powerPriceStore,
    ownMallStore,
    coupang1pStore,
  })

  const monthly = isMonthlyScope(scope)
  const refYmd = String(filters.to || filters.from || '').trim()
  // 월별 — dateFrom/dateTo(해당 월 전체)만 사용. to 기준 year/month 이중 필터는
  // bootstrap 직후 7일 range + month=9 같은 불일치로 자사몰 등 직접입력이 빠짐.
  const filterYear = !monthly && /^\d{4}-\d{2}-\d{2}$/.test(refYmd) ? refYmd.slice(0, 4) : ''
  const filterMonth =
    !monthly && /^\d{4}-\d{2}-\d{2}$/.test(refYmd) ? String(Number(refYmd.slice(5, 7))) : ''
  const filterObj = {
    dateFrom: filters.from || '',
    dateTo: filters.to || '',
    platform: filters.platform || '',
    salesMethod: filters.salesMethod || '',
    year: filterYear,
    month: filterMonth,
    dayOfWeek: '',
    period: monthly ? 'monthly' : 'daily',
    date: '',
    channel: '',
    brand: '',
    productName: '',
    option: '',
  }
  const chartFilters = { ...filterObj, platform: '', salesMethod: '' }
  settingsRecords = applyKpiDetailFilters(
    applyRecordFilters(settingsRecords, 'detail', chartFilters),
    chartFilters,
  )

  const specialSaleRaw = isMonthlyScope(scope)
    ? await getSettingData(specialSaleScopeFor(scope), 'special_sale')
    : null
  const reportMonth = String(query.month || '').trim()
  const monthKey = /^\d{4}-\d{2}$/.test(reportMonth)
    ? reportMonth
    : resolveSegmentMonthKey(filters)
  const specialSale = isMonthlyScope(scope)
    ? normalizeSpecialSaleSetting(specialSaleRaw, monthKey)
    : null
  const manualExpense = isMonthlyScope(scope)
    ? pickManualExpenseSettingForMonth(
        await getSettingData(specialSaleScopeFor(scope), 'manual_expense'),
        monthKey,
      )
    : null

  // 수기 광고를 buildCombined에 넣어 클라와 동일하게 브랜드×플랫폼 행·합계 광고비 반영
  // (별도 mergePlatformWithManual 시 이중계상 방지를 위해 여기서 종료)
  const channelGroups = filters.includeManualAds
    ? await loadManualAdChannelGroups(filters.scope)
    : []

  const { items, totalRow } = mergeSqlAndSettingsSegments(
    sqlItems,
    aggregateCombinedSegmentKpiFromRecords(
      settingsRecords,
      {
        ...chartFilters,
        specialSale,
        manualExpense,
      },
      channelGroups,
    ),
  )

  return {
    items,
    total: items.length,
    totalRow,
    manualAdItems: [],
    manualAdSpendTotal: Number(totalRow?.adSpendTotal ?? 0),
    filters: mapFiltersResponse(filters),
  }
}

/** compare-yesterday용 ref 날짜 — 쿼리에 명시된 경우만 (없으면 전량 로드 후 resolve) */
function resolveCompareRefFromFilters(filters) {
  const date = String(filters.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const to = String(filters.to || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to
  const from = String(filters.from || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && !to) return from
  return ''
}

export async function getKpiCompareYesterday(query) {
  const filters = parseKpiQuery(query)
  let ref = resolveCompareRefFromFilters(filters)
  if (!ref) {
    ref = await queryMaxAggDateSql({ ...filters, from: null, to: null })
  }
  const prev = ref ? addDaysToYmd(ref, -1) : ''
  const windowFilters = ref
    ? { ...filters, from: prev || ref, to: ref }
    : filters
  const dailyPlat = await queryDailyByPlatformSql(windowFilters)

  const marketplace = new Set(['쿠팡', '스마트스토어', '자사몰'])
  const hasMarketplace = dailyPlat.some((r) => marketplace.has(r.platform))
  const closedLabels = [...new Set(
    dailyPlat.map((r) => r.platform).filter((p) => isClosedMallKpiLabel(p)),
  )].sort((a, b) => a.localeCompare(b, 'ko'))

  let labels
  if (filters.platform) {
    labels = [filters.platform === '합계' ? '합계' : filters.platform]
  } else if (!hasMarketplace && closedLabels.length) {
    labels = [...closedLabels, '합계']
  } else {
    labels = ['쿠팡', '스마트스토어', '합계']
  }

  const pick = (platform, date) => {
    const rows = dailyPlat.filter((r) => r.date === date && (platform === '합계' || r.platform === platform))
    return {
      sales: rows.reduce((s, r) => s + num(r.salesTotal), 0),
      qty: rows.reduce((s, r) => s + num(r.quantityTotal), 0),
    }
  }

  const calcDiffRate = (current, previous) => {
    if (previous > 0) return round2(((current - previous) / previous) * 100)
    if (current > 0) return 100
    return 0
  }

  const items = labels.map((label) => {
    const current = pick(label, ref)
    const previous = pick(label, prev)
    const salesDiff = current.sales - previous.sales
    return {
      label,
      current: {
        date: ref || null,
        salesTotal: Math.round(current.sales),
        quantityTotal: Math.round(current.qty),
        recordCount: null,
      },
      previous: {
        date: prev || null,
        salesTotal: Math.round(previous.sales),
        quantityTotal: Math.round(previous.qty),
        recordCount: null,
      },
      diff: {
        salesDiff: Math.round(salesDiff),
        salesDiffRate: calcDiffRate(current.sales, previous.sales),
        quantityDiff: Math.round(current.qty - previous.qty),
        quantityDiffRate: calcDiffRate(current.qty, previous.qty),
      },
    }
  })

  const totalItem = items.find((i) => i.label === '합계') || items[0] || null
  const result = {
    items,
    current: totalItem?.current ?? null,
    previous: totalItem?.previous ?? null,
    diff: totalItem?.diff ?? null,
  }

  const merged = await applyManualMerge(result, filters, mergeCompareYesterdayWithManual)

  return {
    ...merged,
    filters: {
      ...mapFiltersResponse(filters),
      date: filters.date,
      compareFrom: filters.compareFrom,
      compareTo: filters.compareTo,
    },
  }
}
