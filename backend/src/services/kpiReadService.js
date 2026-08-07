import { getPool } from '../db/pool.js'
import {
  parseKpiQuery,
  buildKpiWhere,
  KPI_PRODUCT_ROW_SQL,
} from '../repositories/kpiRepository.js'
import {
  aggregateDailyKpiFromRows,
  aggregatePlatformKpiFromRows,
  compareYesterdayFromRows,
  sumSheetAdMetricsFromDetailRows,
  addDaysToYmd,
} from '../utils/esserKpiAggregate.js'
import { filterByScope } from '../utils/scopeFilter.js'
import { adaptPgRecordFromRow } from '../utils/pgRecordAdapter.js'
import {
  filterCtxFromKpiFilters,
  mergeSummaryWithManual,
  mergeDailyItemsWithManual,
  mergePlatformWithManual,
  mergeCompareYesterdayWithManual,
} from '../utils/manualAdKpiMerge.js'
import { loadManualAdEntriesForScope } from './manualAdLoadService.js'

export { parseKpiQuery }

function scopeFilterPgRows(rows, scope) {
  if (!scope) return rows
  return rows.filter((row) =>
    filterByScope([adaptPgRecordFromRow({ ...row, record_type: 'detail' })], scope).length > 0,
  )
}

async function loadProductRows(filters, { skipDateInSql = false } = {}) {
  const pool = getPool()
  const sqlFilters = skipDateInSql ? { ...filters, from: null, to: null } : filters
  const productWhere = buildKpiWhere(sqlFilters, { productRowsOnly: true })
  const res = await pool.query(
    `SELECT
       platform, channel, sales_method, store_name, upload_kind, upload_id,
       order_date, business_date, period_from, period_to,
       sales, sales_qty, net_profit, ad_spend, transaction_type, data
     FROM sales_records ${productWhere.where}`,
    productWhere.params,
  )
  return scopeFilterPgRows(res.rows, filters.scope || '')
}

/** platform split / compare — detail 전체 (반품·합계 행 포함, JS에서 Esser 규칙 적용) */
async function loadDetailRows(filters, { skipDateInSql = false } = {}) {
  const pool = getPool()
  const sqlFilters = skipDateInSql ? { ...filters, from: null, to: null } : filters
  const baseWhere = buildKpiWhere(sqlFilters)
  const where = baseWhere.where
    ? `${baseWhere.where} AND record_type = 'detail'`
    : `WHERE record_type = 'detail'`
  const res = await pool.query(
    `SELECT
       platform, channel, sales_method, store_name, upload_kind, upload_id, upload_format,
       order_date, business_date, period_from, period_to,
       sales, sales_qty, net_profit, ad_spend, transaction_type, data
     FROM sales_records ${where}`,
    baseWhere.params,
  )
  return scopeFilterPgRows(res.rows, filters.scope || '')
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
  return merger(base, manualEntries, filterCtx)
}

function round2(n) {
  return Number(Number(n).toFixed(2))
}

/**
 * 엑셀 합계 행 광고비 — 상품 행과 별도 집계 (업로드 연동 합계 행 포함)
 */
async function sumSheetAdSpend(pool, filters) {
  const { where, params } = buildKpiWhere(filters, { productRowsOnly: false })
  const sheetWhere = where
    ? `${where} AND record_type = 'detail'`
    : `WHERE record_type = 'detail'`
  const res = await pool.query(
    `SELECT upload_id, upload_kind, upload_format, platform, channel, order_date, business_date,
            period_from, period_to, ad_spend, transaction_type, data, record_type
     FROM sales_records ${sheetWhere}`,
    params,
  )
  const scoped = scopeFilterPgRows(res.rows, filters.scope || '')
  return sumSheetAdMetricsFromDetailRows(scoped, { from: filters.from, to: filters.to })
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
  // Phase 3: kpi_date 기간을 SQL에 푸시다운 (인덱스 활용)
  const rows = await loadProductRows(filters, { skipDateInSql: false })
  const items = aggregateDailyKpiFromRows(rows, {
    from: filters.from,
    to: filters.to,
  })

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
  const rows = await loadDetailRows(filters, { skipDateInSql: false })
  const { items, total, allItems } = aggregatePlatformKpiFromRows(rows, {
    from: filters.from,
    to: filters.to,
  })

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
  const ref = resolveCompareRefFromFilters(filters)
  let rows
  if (ref) {
    const prev = addDaysToYmd(ref, -1)
    // ref·prev 2일 윈도우만 SQL 로드 (period overlap은 buildKpiWhere OR 유지)
    rows = await loadDetailRows(
      { ...filters, from: prev || ref, to: ref },
      { skipDateInSql: false },
    )
  } else {
    rows = await loadDetailRows(filters, { skipDateInSql: true })
  }
  const result = compareYesterdayFromRows(rows, {
    date: filters.date,
    from: filters.from,
    to: filters.to,
    platform: filters.platform,
  })

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
