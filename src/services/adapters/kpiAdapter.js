import { deriveEsserProfitKpis, finalizeEsserBucket } from '../../utils/esserMetrics.js'

/** PostgreSQL KPI summary → 화면/비교용 공통 형식 */
export function adaptPgKpiSummary(res) {
  if (!res) {
    return {
      salesTotal: 0,
      quantityTotal: 0,
      recordCount: 0,
      uploadCount: 0,
      netProfitTotal: 0,
      adSpendTotal: 0,
      costTotal: 0,
      marginRate: 0,
      averageOrderValue: 0,
    }
  }
  return {
    salesTotal: Number(res.salesTotal ?? 0),
    quantityTotal: Number(res.quantityTotal ?? 0),
    recordCount: Number(res.recordCount ?? 0),
    uploadCount: Number(res.uploadCount ?? 0),
    productRowCount: Number(res.productRowCount ?? 0),
    netProfitTotal: Number(res.netProfitTotal ?? 0),
    adSpendTotal: Number(res.adSpendTotal ?? 0),
    adSalesTotal: Number(res.adSalesTotal ?? 0),
    costTotal: Number(res.costTotal ?? 0),
    marginRate: Number(res.marginRate ?? 0),
    averageOrderValue: Number(res.averageOrderValue ?? 0),
    manualAdSpendTotal: Number(res.manualAdSpendTotal ?? 0),
    manualAdSalesTotal: Number(res.manualAdSalesTotal ?? 0),
    netProfitAfterManualAd: Number(
      res.netProfitAfterManualAd ?? res.netProfitTotal ?? 0,
    ),
    marginRateAfterManualAd: Number(
      res.marginRateAfterManualAd ?? res.marginRate ?? 0,
    ),
    filters: res.filters ?? null,
  }
}

/** PostgreSQL KPI daily → API 공통 형식 */
export function adaptPgKpiDaily(res) {
  if (!res) return { items: [], total: 0, filters: null }
  return {
    items: (res.items || []).map((item) => ({
      date: item.date || '',
      salesTotal: Number(item.salesTotal ?? 0),
      quantityTotal: Number(item.quantityTotal ?? 0),
      recordCount: Number(item.recordCount ?? 0),
      netProfitTotal: Number(item.netProfitTotal ?? 0),
      adSpendTotal: Number(item.adSpendTotal ?? 0),
      manualAdSpendTotal: Number(item.manualAdSpendTotal ?? 0),
    })),
    total: Number(res.total ?? res.items?.length ?? 0),
    filters: res.filters ?? null,
  }
}

/**
 * Server KPI summary → SalesPeriodDashboard kpiSummary bucket
 * @param {ReturnType<typeof adaptPgKpiSummary>} summary
 */
export function adaptServerKpiToEsserBucket(summary) {
  const netProfit =
    summary.netProfitAfterManualAd != null
      ? summary.netProfitAfterManualAd
      : summary.netProfitTotal
  const base = finalizeEsserBucket({
    sales: summary.salesTotal,
    salesQty: summary.quantityTotal,
    netProfit,
    totalCost: summary.costTotal,
    adSpend: summary.adSpendTotal,
    adSales: summary.adSalesTotal ?? 0,
  })
  return deriveEsserProfitKpis(base, {
    estimateCostFromMargin: false,
    productKpi: base,
  })
}

/**
 * Server KPI daily items → esser chart bucket rows (daily mode)
 * @param {ReturnType<typeof adaptPgKpiDaily>['items']} items
 */
export function adaptServerDailyToChartBuckets(items) {
  return (items || []).map((item) => {
    const netProfit =
      item.netProfitAfterManualAd != null ? item.netProfitAfterManualAd : item.netProfitTotal
    const bucket = finalizeEsserBucket({
      sales: item.salesTotal,
      salesQty: item.quantityTotal,
      netProfit,
      adSpend: item.adSpendTotal,
      adSales: item.manualAdSalesTotal ?? 0,
      totalCost: 0,
    })
    const sortTime = item.date ? new Date(item.date).getTime() : 0
    return {
      ...bucket,
      label: item.date || '-',
      date: item.date,
      sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
    }
  })
}

/** Vue filters → PG KPI query params */
export function buildKpiQueryFromFilters(filters = {}, scope = '') {
  const qs = {}
  if (filters.dateFrom) qs.from = filters.dateFrom
  if (filters.dateTo) qs.to = filters.dateTo
  if (filters.date) qs.date = filters.date
  if (filters.platform) qs.platform = filters.platform
  if (filters.salesMethod) qs.sales_method = filters.salesMethod
  if (filters.brand) qs.store_name = filters.brand
  if (scope) qs.scope = scope
  // 월별 특판 수기 등 — 조회 월을 명시 (dateTo만 쓰면 7일 range에서 월이 밀림)
  if (String(scope).includes('monthly')) {
    const y = String(filters.year || '').trim()
    const mo = String(filters.month || '').trim()
    if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(mo)) {
      qs.month = `${y}-${String(Number(mo)).padStart(2, '0')}`
    }
  }
  qs.include_manual_ads = 'true'
  return qs
}
