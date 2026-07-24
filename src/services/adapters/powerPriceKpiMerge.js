import { combinedIncludesPowerPrice } from '../../config/combinedChannel.js'
import { deriveEsserProfitKpis, finalizeEsserBucket } from '../../utils/esserMetrics.js'
import {
  applyRecordFilters,
  excludeEsserSheetTotalsForPeriodKpi,
} from '../../utils/recordFilters.js'
import { buildPowerPriceKpiSplitRows } from '../../utils/platformKpiSplit.js'

export function shouldMergePowerPriceKpi(scope) {
  return combinedIncludesPowerPrice(scope)
}

function filterPowerPriceRecordsForKpi(records, filterCtx = {}) {
  const f = {
    year: '',
    month: '',
    dayOfWeek: '',
    date: '',
    channel: '',
    brand: '',
    productName: '',
    option: '',
    ...filterCtx,
    platform: '',
    salesMethod: '',
  }
  return excludeEsserSheetTotalsForPeriodKpi(
    applyRecordFilters(records || [], 'detail', f),
    f,
  )
}

/** 파워프라이스 직접입력 → 통합 KPI 행 */
export function buildPowerPriceKpiRow(ppRecords, manualAdByChannel, filterCtx = {}) {
  const filtered = filterPowerPriceRecordsForKpi(ppRecords, filterCtx)
  const ppManual =
    (manualAdByChannel || []).find((g) => g.label === '파워프라이스')?.entries || []
  if (!filtered.length && !ppManual.length) return null
  const rows = buildPowerPriceKpiSplitRows(
    filtered.length ? filtered : ppRecords || [],
    manualAdByChannel,
    filterCtx,
  )
  return rows[0] || null
}

/** Server KPI summary bucket + 파워프라이스 행 */
export function mergePowerPriceIntoServerKpiBucket(bucket, ppRow) {
  if (!bucket || !ppRow) return bucket
  const p = ppRow.profit || {}
  const a = ppRow.ad || {}
  if (!(p.sales || 0) && !(p.netProfit || 0) && !ppRow.rowCount && !(a.adSpend || 0)) {
    return bucket
  }

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
