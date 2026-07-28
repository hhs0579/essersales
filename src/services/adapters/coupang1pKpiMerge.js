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

export function shouldMergeCoupang1pKpi(scope) {
  return scope === 'platform' || scope === 'platform_monthly' || isCombinedScope(scope)
}

function filterCoupang1pRecordsForKpi(records, filterCtx = {}) {
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
    salesMethod: '',
  }
  return excludeEsserSheetTotalsForPeriodKpi(
    applyRecordFilters(records || [], 'detail', f),
    f,
  )
}

function mergePlatformSplitRow(base, addon) {
  if (!addon) return base
  if (!base) return addon
  const p1 = base.profit || {}
  const p2 = addon.profit || {}
  const a1 = base.ad || {}
  const a2 = addon.ad || {}
  const profit = deriveEsserProfitKpis({
    sales: (p1.sales || 0) + (p2.sales || 0),
    salesQty: (p1.salesQty || 0) + (p2.salesQty || 0),
    totalCost: (p1.totalCost || 0) + (p2.totalCost || 0),
    netProfit: (p1.netProfit || 0) + (p2.netProfit || 0),
  })
  const ad = finalizeEsserBucket({
    ...profit,
    adSpend: (a1.adSpend || 0) + (a2.adSpend || 0),
    adSales: (a1.adSales || 0) + (a2.adSales || 0),
  })
  return {
    label: base.label,
    profit,
    ad,
    rowCount: (base.rowCount || 0) + (addon.rowCount || 0),
  }
}

/** 쿠팡 1P 로켓 발주 → 베스트하임 쿠팡 플랫폼 행 */
export function buildCoupang1pPlatformRow(c1pRecords, filterCtx = {}) {
  const filtered = filterCoupang1pRecordsForKpi(c1pRecords, filterCtx)
  if (!filtered.length) return null
  const rows = buildPlatformKpiSplitRows(filtered, [], filterCtx)
  return rows.find((r) => r.label === '쿠팡') || null
}

/**
 * Server by-platform KPI + coupang_1p_rocket (app_settings)
 * @param {ReturnType<import('./platformKpiAdapter.js').adaptServerPlatformKpiRows>} serverRows
 */
export function mergeCoupang1pIntoServerPlatformRows(serverRows, c1pRecords, filterCtx = {}) {
  if (!serverRows?.length) return serverRows
  const c1pRow = buildCoupang1pPlatformRow(c1pRecords, filterCtx)
  if (!c1pRow) return serverRows

  const manualAdRows = serverRows.filter((r) => isManualAdKpiLabel(r.label))
  const coupang = mergePlatformSplitRow(
    serverRows.find((r) => r.label === '쿠팡') || {
      label: '쿠팡',
      profit: {},
      ad: {},
      rowCount: 0,
    },
    c1pRow,
  )
  const smart = serverRows.find((r) => r.label === '스마트스토어') || {
    label: '스마트스토어',
    profit: {},
    ad: {},
    rowCount: 0,
  }
  const ownMall = serverRows.find((r) => r.label === '자사몰')
  // 특판 폐쇄몰은 기타 판매처 탭 전용 — 베스트하임 서버 행에 남지 않도록 제외
  const total = buildMergedTotalRow(coupang, smart, ownMall, manualAdRows, null)

  const marketplace = [coupang, smart, ownMall].filter(Boolean)
  return [...marketplace, ...manualAdRows, total]
}

/** Server KPI summary bucket + 쿠팡 1P */
export function mergeCoupang1pIntoServerKpiBucket(bucket, c1pRow) {
  if (!bucket || !c1pRow) return bucket
  const p = c1pRow.profit || {}
  const a = c1pRow.ad || {}
  if (!(p.sales || 0) && !(p.netProfit || 0) && !c1pRow.rowCount) return bucket

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

/** Server daily chart + 쿠팡 1P 일별 */
export function mergeCoupang1pIntoDailyBuckets(buckets, c1pRecords, filterCtx = {}) {
  const filtered = filterCoupang1pRecordsForKpi(c1pRecords, filterCtx)
  if (!filtered.length) return buckets || []

  const c1pDaily = aggregateEsserByDay(filtered)
  if (!c1pDaily.length) return buckets || []

  const map = new Map()
  for (const b of buckets || []) {
    const key = String(b.date || b.label || '').slice(0, 10)
    if (!key) continue
    map.set(key, { ...b })
  }

  for (const d of c1pDaily) {
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
