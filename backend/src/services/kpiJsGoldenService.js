/**
 * 2단계 골든 마스터 — 성능 개선 전 Node JS 집계 (load rows → esserKpiAggregate).
 * 운영 KPI 핸들러는 SQL을 쓰고, 이 모듈은 검증 전용이다.
 */
import { getPool } from '../db/pool.js'
import { getSetting } from '../repositories/settingsRepository.js'
import { parseKpiQuery, buildKpiWhere } from '../repositories/kpiRepository.js'
import {
  aggregateDailyKpiFromRows,
  aggregatePlatformKpiFromRows,
  compareYesterdayFromRows,
  sumSheetAdMetricsFromDetailRows,
  addDaysToYmd,
} from '../utils/esserKpiAggregate.js'
import { aggregateCombinedSegmentKpiFromRecords } from '../utils/combinedSegmentKpi.js'
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
import {
  applyRecordFilters,
  applyKpiDetailFilters,
} from '../../../src/utils/recordFilters.js'
import { enrichExportRecords } from '../../../src/utils/combinedExportRecords.js'
import { isCombinedScope, isMonthlyScope, specialSaleScopeFor } from '../../../src/config/dataChannels.js'
import { pickSpecialSaleSettingForMonth } from '../../../src/utils/specialSaleKpi.js'
import { combinedIncludesPowerPrice } from '../../../src/config/combinedChannel.js'
import { POWER_PRICE_SCOPE } from '../../../src/config/powerPrice.js'
import { OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND } from '../../../src/config/ownMallManual.js'
import { COUPANG_1P_ROCKET_SCOPE } from '../../../src/config/coupang1pRocket.js'

export { parseKpiQuery }

function round2(n) {
  return Number(Number(n).toFixed(2))
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

function scopeFilterPgRows(rows, scope) {
  if (!scope) return rows
  return rows.filter(
    (row) =>
      filterByScope([adaptPgRecordFromRow({ ...row, record_type: 'detail' })], scope).length > 0,
  )
}

export async function loadProductRowsJs(filters, { skipDateInSql = false } = {}) {
  const pool = getPool()
  const sqlFilters = skipDateInSql ? { ...filters, from: null, to: null } : filters
  const productWhere = buildKpiWhere(sqlFilters, { productRowsOnly: true })
  const t0 = performance.now()
  const res = await pool.query(
    `SELECT
       id, record_type, kpi_date, product_name,
       platform, channel, sales_method, store_name, upload_kind, upload_id,
       order_date, business_date, period_from, period_to,
       sales, sales_qty, net_profit, ad_spend, transaction_type, data
     FROM sales_records ${productWhere.where}`,
    productWhere.params,
  )
  const dbMs = performance.now() - t0
  const rows = scopeFilterPgRows(res.rows, filters.scope || '')
  return { rows, dbMs, rawCount: res.rows.length, scopedCount: rows.length }
}

export async function loadDetailRowsJs(filters, { skipDateInSql = false } = {}) {
  const pool = getPool()
  const sqlFilters = skipDateInSql ? { ...filters, from: null, to: null } : filters
  const baseWhere = buildKpiWhere(sqlFilters)
  const where = baseWhere.where
    ? `${baseWhere.where} AND record_type = 'detail'`
    : `WHERE record_type = 'detail'`
  const t0 = performance.now()
  const res = await pool.query(
    `SELECT
       id, record_type, kpi_date, product_name,
       platform, channel, sales_method, store_name, upload_kind, upload_id, upload_format,
       order_date, business_date, period_from, period_to,
       sales, sales_qty, net_profit, ad_spend, transaction_type, data
     FROM sales_records ${where}`,
    baseWhere.params,
  )
  const dbMs = performance.now() - t0
  const rows = scopeFilterPgRows(res.rows, filters.scope || '')
  return { rows, dbMs, rawCount: res.rows.length, scopedCount: rows.length }
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

async function getSettingData(scope, kind) {
  const row = await getSetting(scope, kind)
  return row?.data ?? null
}

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

function resolveCompareRefFromFilters(filters) {
  const date = String(filters.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const to = String(filters.to || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to
  const from = String(filters.from || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && !to) return from
  return ''
}

export async function getKpiSummaryJs(query) {
  const filters = parseKpiQuery(query)
  const pool = getPool()
  const allWhere = buildKpiWhere(filters)
  const productWhere = buildKpiWhere(filters, { productRowsOnly: true })
  const t0 = performance.now()
  const [allRes, productRes, detail] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS record_count,
              COALESCE(SUM(sales), 0)::numeric AS sales_total,
              COALESCE(SUM(sales_qty), 0)::numeric AS quantity_total,
              COUNT(DISTINCT upload_id)::int AS upload_count
       FROM sales_records ${allWhere.where}`,
      allWhere.params,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS product_row_count,
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
    loadDetailRowsJs(filters),
  ])
  const sheetAd = sumSheetAdMetricsFromDetailRows(detail.rows, {
    from: filters.from,
    to: filters.to,
  })
  const product = productRes.rows[0]
  const all = allRes.rows[0]
  const salesTotal = Number(product.sales_total)
  const quantityTotal = Number(product.quantity_total)
  const netProfitTotal = Number(product.net_profit_total)
  const adSpendTotal = Number(product.row_ad_spend_total) + sheetAd.adSpend
  const costTotal = Number(product.cost_total)
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
    marginRate: salesTotal > 0 ? round2((netProfitTotal / salesTotal) * 100) : 0,
    averageOrderValue: quantityTotal > 0 ? round2(salesTotal / quantityTotal) : 0,
    filters: mapFiltersResponse(filters),
  }
  const result = await applyManualMerge(base, filters, mergeSummaryWithManual)
  return {
    result,
    perf: {
      dbMs: Math.round(performance.now() - t0),
      records: detail.scopedCount,
    },
  }
}

export async function getKpiDailyJs(query) {
  const filters = parseKpiQuery(query)
  const t0 = performance.now()
  const loaded = await loadProductRowsJs(filters, { skipDateInSql: false })
  const t1 = performance.now()
  const items = aggregateDailyKpiFromRows(loaded.rows, {
    from: filters.from,
    to: filters.to,
  })
  const jsMs = performance.now() - t1
  const mergedItems = await applyManualMerge(
    items,
    filters,
    (list, manualEntries, filterCtx) => mergeDailyItemsWithManual(list, manualEntries, filterCtx),
  )
  return {
    result: {
      items: mergedItems,
      total: mergedItems.length,
      filters: mapFiltersResponse(filters),
    },
    perf: {
      dbMs: Math.round(loaded.dbMs),
      jsMs: Math.round(jsMs),
      totalMs: Math.round(performance.now() - t0),
      records: loaded.scopedCount,
      rawRecords: loaded.rawCount,
    },
  }
}

export async function getKpiByPlatformJs(query) {
  const filters = parseKpiQuery(query)
  const t0 = performance.now()
  const loaded = await loadDetailRowsJs(filters, { skipDateInSql: false })
  const t1 = performance.now()
  const { items, total, allItems } = aggregatePlatformKpiFromRows(loaded.rows, {
    from: filters.from,
    to: filters.to,
  })
  const jsMs = performance.now() - t1
  const base = {
    items,
    total: items.length,
    totalRow: total,
    unknown: allItems.find((i) => i.platform === '미지정') || null,
    filters: mapFiltersResponse(filters),
  }
  const merged = await applyManualMerge(base, filters, mergePlatformWithManual)
  return {
    result: merged,
    perf: {
      dbMs: Math.round(loaded.dbMs),
      jsMs: Math.round(jsMs),
      totalMs: Math.round(performance.now() - t0),
      records: loaded.scopedCount,
      rawRecords: loaded.rawCount,
    },
  }
}

export async function getKpiBySegmentJs(query) {
  const filters = parseKpiQuery(query)
  const scope = filters.scope || ''
  const t0 = performance.now()
  if (!isCombinedScope(scope)) {
    return {
      result: {
        items: [],
        total: 0,
        totalRow: null,
        manualAdItems: [],
        filters: mapFiltersResponse(filters),
      },
      perf: { dbMs: 0, jsMs: 0, totalMs: 0, records: 0 },
    }
  }

  const loaded = await loadDetailRowsJs(filters, { skipDateInSql: false })
  let records = loaded.rows
    .map((row) => adaptPgRecordFromRow({ ...row, record_type: 'detail' }))
    .filter(Boolean)

  let powerPriceStore = null
  if (combinedIncludesPowerPrice(scope)) {
    powerPriceStore = await getSettingData(POWER_PRICE_SCOPE, 'power_price')
  }
  const ownMallStore = await getSettingData(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND)
  const coupang1pStore = await getSettingData(COUPANG_1P_ROCKET_SCOPE, 'coupang_1p_rocket')

  records = enrichExportRecords(records, scope, {
    powerPriceStore,
    ownMallStore,
    coupang1pStore,
  })

  const chartFilters = {
    dateFrom: filters.from || '',
    dateTo: filters.to || '',
    platform: '',
    salesMethod: '',
    year: '',
    month: '',
    dayOfWeek: '',
    period: 'daily',
    date: '',
    channel: '',
    brand: '',
    productName: '',
    option: '',
  }
  records = applyKpiDetailFilters(applyRecordFilters(records, 'detail', chartFilters), chartFilters)

  const specialSale = isMonthlyScope(scope)
    ? normalizeSpecialSaleSetting(
        await getSettingData(specialSaleScopeFor(scope), 'special_sale'),
        resolveSegmentMonthKey(filters),
      )
    : null
  const manualEntries = await maybeLoadManualAds(filters)
  const channelGroups = manualEntries.length ? [{ label: '통합', entries: manualEntries }] : []
  const t1 = performance.now()
  const { items, totalRow } = aggregateCombinedSegmentKpiFromRecords(
    records,
    { ...chartFilters, specialSale },
    channelGroups,
  )
  return {
    result: {
      items,
      total: items.length,
      totalRow,
      manualAdItems: [],
      manualAdSpendTotal: Number(totalRow?.adSpendTotal ?? 0),
      filters: mapFiltersResponse(filters),
    },
    perf: {
      dbMs: Math.round(loaded.dbMs),
      jsMs: Math.round(performance.now() - t1),
      totalMs: Math.round(performance.now() - t0),
      records: loaded.scopedCount,
      rawRecords: loaded.rawCount,
    },
  }
}

export async function getKpiCompareYesterdayJs(query) {
  const filters = parseKpiQuery(query)
  const t0 = performance.now()
  const ref = resolveCompareRefFromFilters(filters)
  let loaded
  if (ref) {
    const prev = addDaysToYmd(ref, -1)
    loaded = await loadDetailRowsJs(
      { ...filters, from: prev || ref, to: ref },
      { skipDateInSql: false },
    )
  } else {
    loaded = await loadDetailRowsJs(filters, { skipDateInSql: true })
  }
  const t1 = performance.now()
  const result = compareYesterdayFromRows(loaded.rows, {
    date: filters.date,
    from: filters.from,
    to: filters.to,
    platform: filters.platform,
  })
  const merged = await applyManualMerge(result, filters, mergeCompareYesterdayWithManual)
  return {
    result: {
      ...merged,
      filters: {
        ...mapFiltersResponse(filters),
        date: filters.date,
        compareFrom: filters.compareFrom,
        compareTo: filters.compareTo,
      },
    },
    perf: {
      dbMs: Math.round(loaded.dbMs),
      jsMs: Math.round(performance.now() - t1),
      totalMs: Math.round(performance.now() - t0),
      records: loaded.scopedCount,
      rawRecords: loaded.rawCount,
    },
  }
}
