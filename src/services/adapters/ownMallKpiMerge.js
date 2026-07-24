import { isCombinedScope } from '../../config/dataChannels.js'
import { deriveEsserProfitKpis, finalizeEsserBucket, aggregateEsserByDay } from '../../utils/esserMetrics.js'
import {
  applyRecordFilters,
  excludeEsserSheetTotalsForPeriodKpi,
} from '../../utils/recordFilters.js'
import {
  buildPlatformKpiSplitRows,
  buildMergedTotalRow,
  isManualAdKpiLabel,
} from '../../utils/platformKpiSplit.js'

export function shouldMergeOwnMallManualKpi(scope) {
  return scope === 'company_b' || scope === 'company_b_monthly' || isCombinedScope(scope)
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

/**
 * Server by-platform KPI + own_mall_manual (app_settings)
 * @param {ReturnType<import('./platformKpiAdapter.js').adaptServerPlatformKpiRows>} serverRows
 */
export function mergeOwnMallManualIntoServerPlatformRows(serverRows, ownMallRecords, filterCtx = {}) {
  if (!serverRows?.length) return serverRows
  const ownMallRow = buildOwnMallPlatformRow(ownMallRecords, filterCtx)
  if (!ownMallRow) return serverRows

  const manualAdRows = serverRows.filter((r) => isManualAdKpiLabel(r.label))
  const coupang = serverRows.find((r) => r.label === '쿠팡') || {
    label: '쿠팡',
    profit: {},
    ad: {},
    rowCount: 0,
  }
  const smart = serverRows.find((r) => r.label === '스마트스토어') || {
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
