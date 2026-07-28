import { resolveRecordPlatform } from './platformDetect.js'

import {

  summarizeEsserKpis,

  deriveEsserProfitKpis,

  finalizeEsserBucket,

  isEsserSheetTotalRecord,

} from './esserMetrics.js'

import { summarizeManualAdKpiOnly, summarizeEsserKpisWithManual, groupManualAdEntriesBySource } from './manualAdSpend.js'
import { isPowerPriceRecord } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord } from '../config/coupang1pRocket.js'
import {
  COMBINED_SEGMENT_DEFS,
  COMBINED_SEGMENT_LABELS,
  recordsForCombinedSegment,
  closedMallKpiLabelsFromRecords,
  recordsForCombinedSegmentLabel,
} from './combinedKpiSegments.js'
import {
  formatClosedMallKpiLabel,
  isClosedMallRecord,
  resolveClosedMallSeller,
  resolveClosedMallBrand,
  OTHER_SELLERS_BRAND_LABEL,
} from '../config/closedMall.js'
import { resolveCombinedBrandRollupLabel } from './recordSourceLabel.js'
import {
  MANUAL_AD_SOURCE_DEFS,
  MANUAL_AD_KPI_LABELS,
  EXTERNAL_AD_KPI_LABEL,
  NAVER_DISPLAY_AD_KPI_LABEL,
  AD_KPI_LABEL,
  GOOGLE_TRAFFIC_KPI_LABEL,
  isManualAdKpiLabel,
} from '../config/manualAdSpend.js'
import { buildSpecialSaleKpiRows, isSpecialSaleRowLabel } from './specialSaleKpi.js'

export {
  EXTERNAL_AD_KPI_LABEL,
  NAVER_DISPLAY_AD_KPI_LABEL,
  AD_KPI_LABEL,
  GOOGLE_TRAFFIC_KPI_LABEL,
  MANUAL_AD_KPI_LABELS,
  isManualAdKpiLabel,
} from '../config/manualAdSpend.js'

export const PLATFORM_KPI_SPLIT_LABELS = [
  '쿠팡',
  '스마트스토어',
  '자사몰',
  ...MANUAL_AD_KPI_LABELS,
  '합계',
]



/** 파워프라이스 — 스마트스토어 단일 행 */

export const POWER_PRICE_KPI_SPLIT_LABELS = ['스마트스토어']

/** 쿠팡 1P 로켓 — 쿠팡 단일 행 */

export const COUPANG_1P_ROCKET_KPI_SPLIT_LABELS = ['쿠팡']

export const COMBINED_BRAND_KPI_LABELS = [
  '베스트하임',
  '사본느리',
  OTHER_SELLERS_BRAND_LABEL,
]

/** 통합 일별 — 세그먼트·외부광고·합계 */

export const COMBINED_KPI_SPLIT_LABELS = [
  ...COMBINED_SEGMENT_LABELS,
  ...MANUAL_AD_KPI_LABELS,
  '합계',
]



/** 외부 광고 행 — 매출·수익 표에서 해당 없음 */

export const EXTERNAL_AD_PROFIT_NA_KEYS = new Set([

  'sales',

  'netProfitRate',

  'totalCost',

  'costRate',

  'aov',

])



/** 외부 광고 행 — 광고·판매량 표에서 해당 없음 */

export const EXTERNAL_AD_AD_NA_KEYS = new Set([

  'salesQty',

  'organicSales',

  'organicSalesRate',

  'salesRoas',

])



function buildPlatformRow(label, subset, options = {}) {

  const productRows = subset.filter((r) => !isEsserSheetTotalRecord(r))

  const productKpi = summarizeEsserKpis(productRows)

  const kpi = summarizeEsserKpis(subset)

  return {

    label,

    profit: deriveEsserProfitKpis(kpi, {

      estimateCostFromMargin: options.estimateCostFromMargin,

      productKpi,

    }),

    ad: kpi,

    rowCount: productRows.length,

  }

}



function buildExternalAdRow(manualAdEntries, manualFilterCtx, label = EXTERNAL_AD_KPI_LABEL) {

  const kpi = summarizeManualAdKpiOnly(manualAdEntries, manualFilterCtx)

  const profit = deriveEsserProfitKpis({

    sales: 0,

    salesQty: 0,

    totalCost: 0,

    netProfit: kpi.netProfit,

  })

  return {

    label,

    profit: {

      ...profit,

      sales: null,

      netProfitRate: null,

      totalCost: null,

      costRate: null,

      aov: null,

      netProfit: kpi.netProfit,

    },

    ad: {

      ...kpi,

      salesQty: null,

      organicSales: null,

      organicSalesRate: null,

      salesRoas: null,

    },

    rowCount: 0,

  }

}



/** @param {Array<{ label: string, entries?: import('../config/manualAdSpend.js').ManualAdEntry[] }>} channelGroups */

function collectManualAdEntries(channelGroups) {

  if (!channelGroups?.length) return []

  return channelGroups.flatMap((g) => g.entries || [])

}



/**
 * 합계 — 상품(쿠팡+스마트스토어+자사몰+특판 판매처들) + 수동 광고
 * @param {object} coupang
 * @param {object} smart
 * @param {object|null} ownMall
 * @param {object[]} [extraAdRows]
 * @param {object|object[]|null} [closedMallOrRows] 단일 행 또는 판매처별 행 배열
 */
export function buildMergedTotalRow(coupang, smart, ownMall, extraAdRows = [], closedMallOrRows = null) {
  const closedRows = Array.isArray(closedMallOrRows)
    ? closedMallOrRows
    : closedMallOrRows
      ? [closedMallOrRows]
      : []
  const productRows = [coupang, smart, ownMall, ...closedRows].filter(Boolean)

  let extraAdSpend = 0
  let extraAdSales = 0
  let extraNetProfit = 0
  for (const row of extraAdRows || []) {
    extraAdSpend += row?.ad?.adSpend || 0
    extraAdSales += row?.ad?.adSales || 0
    extraNetProfit += row?.profit?.netProfit || 0
  }

  let sales = 0
  let salesQty = 0
  let totalCost = 0
  let netProfit = extraNetProfit
  let adSpend = extraAdSpend
  let adSales = extraAdSales
  let rowCount = 0

  for (const row of productRows) {
    sales += row?.profit?.sales || 0
    salesQty += row?.profit?.salesQty || 0
    totalCost += row?.profit?.totalCost || 0
    netProfit += row?.profit?.netProfit || 0
    adSpend += row?.ad?.adSpend || 0
    adSales += row?.ad?.adSales || 0
    rowCount += row?.rowCount || 0
  }

  const profit = deriveEsserProfitKpis({
    sales,
    salesQty,
    totalCost,
    netProfit,
  })

  const ad = finalizeEsserBucket({
    sales,
    salesQty,
    totalCost,
    netProfit,
    adSpend,
    adSales,
  })

  return {
    label: '합계',
    profit,
    ad,
    rowCount,
  }
}

/** 특판 폐쇄몰 → 판매처별 `브랜드(판매처)` KPI 행 */
export function buildClosedMallPlatformRows(sourceRecords) {
  const closed = (sourceRecords || []).filter((r) => isClosedMallRecord(r))
  if (!closed.length) return []

  const byLabel = new Map()
  for (const row of closed) {
    const brand = resolveClosedMallBrand(row) || '베스트하임'
    const seller = resolveClosedMallSeller(row) || '특판'
    const label = formatClosedMallKpiLabel(brand, seller)
    if (!byLabel.has(label)) byLabel.set(label, [])
    byLabel.get(label).push(row)
  }

  const labels = [...byLabel.keys()].sort((a, b) => a.localeCompare(b, 'ko'))
  return labels.map((label) => buildPlatformRow(label, byLabel.get(label)))
}

/** 기타 판매처 탭 — 판매처 행 + 합계 */
export function buildOtherSellersKpiSplitRows(sourceRecords) {
  const closedMallRows = buildClosedMallPlatformRows(sourceRecords)
  if (!closedMallRows.length) return []
  const total = buildMergedTotalRow(null, null, null, [], closedMallRows)
  return [...closedMallRows, total]
}



/**

 * 일별 대시보드 — 쿠팡 / 스마트스토어 / 자사몰 / 외부 광고 / 합계 KPI 행

 * @param {object[]} sourceRecords

 * @param {Array<{ label: string, entries: import('../config/manualAdSpend.js').ManualAdEntry[] }>} manualAdByChannel

 * @param {object} manualFilterCtx

 */

function buildManualAdKpiRows(manualEntries, manualFilterCtx) {
  const bySource = groupManualAdEntriesBySource(manualEntries)
  const rows = []
  for (const def of MANUAL_AD_SOURCE_DEFS) {
    const entries = bySource[def.value] || []
    if (!entries.length) continue
    const row = buildExternalAdRow(entries, manualFilterCtx, def.kpiLabel)
    if ((row.ad?.adSpend || 0) > 0 || (row.ad?.adSales || 0) > 0) rows.push(row)
  }
  return rows
}



export function buildPlatformKpiSplitRows(sourceRecords, manualAdByChannel, manualFilterCtx) {

  const source = sourceRecords || []

  const manualEntries = collectManualAdEntries(manualAdByChannel)

  const manualAdRows = buildManualAdKpiRows(manualEntries, manualFilterCtx)



  const coupangSubset = source.filter((r) => resolveRecordPlatform(r) === '쿠팡')

  const smartSubset = source.filter((r) => resolveRecordPlatform(r) === '스마트스토어')

  const ownMallSubset = source.filter((r) => resolveRecordPlatform(r) === '자사몰')

  const coupang = buildPlatformRow('쿠팡', coupangSubset)

  const smart = buildPlatformRow('스마트스토어', smartSubset, { estimateCostFromMargin: true })

  const ownMall = buildPlatformRow('자사몰', ownMallSubset)

  const rows = [coupang, smart, ownMall, ...manualAdRows]

  const total = buildMergedTotalRow(coupang, smart, ownMall, manualAdRows, null)

  rows.push(total)

  return rows

}



function mergePowerPriceIntoTotalRow(baseTotal, ppRow) {

  const bP = baseTotal.profit

  const bA = baseTotal.ad

  const pP = ppRow.profit

  const pA = ppRow.ad



  const sales = (bP.sales || 0) + (pP.sales || 0)

  const salesQty = (bP.salesQty || 0) + (pP.salesQty || 0)

  const totalCost = (bP.totalCost || 0) + (pP.totalCost || 0)

  const netProfit = (bP.netProfit || 0) + (pP.netProfit || 0)



  const profit = deriveEsserProfitKpis({ sales, salesQty, totalCost, netProfit })



  const ad = finalizeEsserBucket({

    sales,

    salesQty,

    totalCost,

    netProfit,

    adSpend: (bA.adSpend || 0) + (pA.adSpend || 0),

    adSales: (bA.adSales || 0) + (pA.adSales || 0),

  })



  return {

    label: '합계',

    profit,

    ad,

    rowCount: (baseTotal.rowCount || 0) + (ppRow.rowCount || 0),

  }

}



function buildPowerPriceBrandRow(ppRows, ppManual, manualFilterCtx) {

  const productRows = ppRows.filter((r) => !isEsserSheetTotalRecord(r))

  const merged = summarizePowerPriceKpis(productRows, ppManual, manualFilterCtx)

  const profit = deriveEsserProfitKpis({

    sales: merged.sales,

    salesQty: merged.salesQty,

    totalCost: merged.totalCost,

    netProfit: merged.netProfit,

  })

  return {

    label: '파워프라이스',

    profit,

    ad: merged,

    rowCount: productRows.length,

  }

}



function manualEntriesForBrandLabel(manualAdByChannel, brandLabel) {
  return (manualAdByChannel || [])
    .filter((g) => g.label === brandLabel)
    .flatMap((g) => g.entries || [])
}

function recordsForBrandLabel(records, brandLabel) {
  return (records || []).filter((r) => resolveCombinedBrandRollupLabel(r) === brandLabel)
}

/** 통합 — 브랜드(베스트하임·사본느리) KPI 집계 */
export function summarizeBrandKpis(brandLabel, records, manualAdByChannel, manualFilterCtx) {
  const subset = recordsForBrandLabel(records, brandLabel)
  const manual = manualEntriesForBrandLabel(manualAdByChannel, brandLabel)
  if (!subset.length && !manual.length) return null
  return summarizeEsserKpisWithManual(subset, manual, manualFilterCtx)
}

function buildCombinedBrandKpiRow(brandLabel, allRecords, manualAdByChannel, manualFilterCtx) {
  const subset = recordsForBrandLabel(allRecords, brandLabel)
  const manual = manualEntriesForBrandLabel(manualAdByChannel, brandLabel)
  if (!subset.length && !manual.length) return null

  const productRows = subset.filter((r) => !isEsserSheetTotalRecord(r))
  const kpi = summarizeEsserKpisWithManual(subset, manual, manualFilterCtx)
  const profit = deriveEsserProfitKpis(kpi)

  return {
    label: brandLabel,
    profit,
    ad: finalizeEsserBucket(kpi),
    rowCount: productRows.length,
  }
}

function buildCombinedBrandKpiRows(allRecords, manualAdByChannel, manualFilterCtx) {
  return COMBINED_BRAND_KPI_LABELS.map((label) =>
    buildCombinedBrandKpiRow(label, allRecords, manualAdByChannel, manualFilterCtx),
  ).filter(Boolean)
}



function buildCombinedSegmentsTotalRow(segmentRows, manualAdRows = []) {
  let sales = 0
  let salesQty = 0
  let totalCost = 0
  let netProfit = 0
  let adSpend = 0
  let adSales = 0
  let rowCount = 0

  for (const row of [...(segmentRows || []), ...(manualAdRows || [])]) {
    const p = row.profit || {}
    const a = row.ad || {}
    sales += p.sales || 0
    salesQty += p.salesQty || 0
    totalCost += p.totalCost || 0
    netProfit += p.netProfit || 0
    adSpend += a.adSpend || 0
    adSales += a.adSales || 0
    rowCount += row.rowCount || 0
  }

  const profit = deriveEsserProfitKpis({ sales, salesQty, totalCost, netProfit })
  const ad = finalizeEsserBucket({ sales, salesQty, totalCost, netProfit, adSpend, adSales })

  return { label: '합계', profit, ad, rowCount }
}

/**
 * 통합 일별 — 브랜드·채널 세그먼트 + 외부 광고 + 합계
 * @param {object[]} allRecords — 파워프라이스·쿠팡 1P 로켓 포함 전체
 */
export function buildCombinedKpiSplitRows(
  allRecords,
  _platformRecords,
  manualAdByChannel,
  manualFilterCtx,
) {
  const source = allRecords || []
  const bhSbnGroups = (manualAdByChannel || []).filter((g) => g.label !== '파워프라이스')
  const ppManual = (manualAdByChannel || []).find((g) => g.label === '파워프라이스')?.entries || []
  const bhSbnManual = collectManualAdEntries(bhSbnGroups)
  const manualAdRows = buildManualAdKpiRows(bhSbnManual, manualFilterCtx)

  const segmentRows = []

  for (const def of COMBINED_SEGMENT_DEFS) {
    if (def.key === 'power_price') {
      const ppRows = source.filter((r) => isPowerPriceRecord(r))
      if (ppRows.length || ppManual.length) {
        segmentRows.push(buildPowerPriceBrandRow(ppRows, ppManual, manualFilterCtx))
      }
      continue
    }

    const subset = recordsForCombinedSegment(source, def.key)
    if (subset.length) {
      const estimateCostFromMargin = def.key === 'bh_ss' || def.key === 'sbn_ss'
      segmentRows.push(buildPlatformRow(def.label, subset, { estimateCostFromMargin }))
    }

    // 베스트하임(스스) 다음에 특판 판매처별 행
    if (def.key === 'bh_ss') {
      for (const label of closedMallKpiLabelsFromRecords(source)) {
        const closedSubset = recordsForCombinedSegmentLabel(source, label)
        if (!closedSubset.length) continue
        segmentRows.push(buildPlatformRow(label, closedSubset))
      }
    }
  }

  segmentRows.push(...buildSpecialSaleKpiRows(manualFilterCtx?.specialSale))

  const total = buildCombinedSegmentsTotalRow(segmentRows, manualAdRows)
  return [...segmentRows, ...manualAdRows, total]
}



/**

 * 통합 — 브랜드별 KPI 합산 (파워프라이스는 광고비만 반영)

 * @param {object[]} records

 * @param {Array<{ label: string, entries?: import('../config/manualAdSpend.js').ManualAdEntry[] }>} manualAdByChannel

 * @param {object} manualFilterCtx

 */

export function summarizeCombinedKpis(records, manualAdByChannel, manualFilterCtx) {

  const bhSbn = (records || []).filter((r) => !isPowerPriceRecord(r))

  const pp = (records || []).filter((r) => isPowerPriceRecord(r))

  const bhSbnManual = (manualAdByChannel || [])

    .filter((g) => g.label !== '파워프라이스')

    .flatMap((g) => g.entries || [])

  const ppManual = (manualAdByChannel || []).find((g) => g.label === '파워프라이스')?.entries || []



  const bhSbnKpi = summarizeEsserKpisWithManual(bhSbn, bhSbnManual, manualFilterCtx)

  const ppKpi = summarizePowerPriceKpis(

    pp.filter((r) => !isEsserSheetTotalRecord(r)),

    ppManual,

    manualFilterCtx,

  )



  const base = finalizeEsserBucket({

    sales: (bhSbnKpi.sales || 0) + (ppKpi.sales || 0),

    salesQty: (bhSbnKpi.salesQty || 0) + (ppKpi.salesQty || 0),

    totalCost: (bhSbnKpi.totalCost || 0) + (ppKpi.totalCost || 0),

    netProfit: (bhSbnKpi.netProfit || 0) + (ppKpi.netProfit || 0),

    adSpend: (bhSbnKpi.adSpend || 0) + (ppKpi.adSpend || 0),

    adSales: (bhSbnKpi.adSales || 0) + (ppKpi.adSales || 0),

  })

  const specialSaleRows = buildSpecialSaleKpiRows(manualFilterCtx?.specialSale)
  if (!specialSaleRows.length) return base

  let ssSales = 0
  let ssSalesQty = 0
  let ssTotalCost = 0
  let ssNetProfit = 0
  for (const row of specialSaleRows) {
    const ss = row.profit || {}
    ssSales += ss.sales || 0
    ssSalesQty += ss.salesQty || 0
    ssTotalCost += ss.totalCost || 0
    ssNetProfit += ss.netProfit || 0
  }
  return finalizeEsserBucket({
    sales: (base.sales || 0) + ssSales,
    salesQty: (base.salesQty || 0) + ssSalesQty,
    totalCost: (base.totalCost || 0) + ssTotalCost,
    netProfit: (base.netProfit || 0) + ssNetProfit,
    adSpend: base.adSpend || 0,
    adSales: base.adSales || 0,
  })

}



/**

 * 파워프라이스 — 판매 KPI + 수동 광고비·전환매출 합산

 * @param {object[]} records

 * @param {import('../config/manualAdSpend.js').ManualAdEntry[]} manualEntries

 * @param {object} manualFilterCtx

 */

export function summarizePowerPriceKpis(records, manualEntries, manualFilterCtx) {

  const productRows = (records || []).filter((r) => !isEsserSheetTotalRecord(r))

  const productKpi = summarizeEsserKpis(productRows)

  const manualKpi = summarizeManualAdKpiOnly(manualEntries, manualFilterCtx)

  return finalizeEsserBucket({

    sales: productKpi.sales || 0,

    salesQty: productKpi.salesQty || 0,

    totalCost: productKpi.totalCost || 0,

    netProfit: (productKpi.netProfit || 0) + (manualKpi.netProfit || 0),

    adSpend: manualKpi.adSpend || 0,

    adSales: manualKpi.adSales || 0,

  })

}



/**

 * 파워프라이스 — 스마트스토어 1행 (판매 직접입력 + 수동 광고·자연매출·객단가·ROAS)

 * @param {object[]} sourceRecords

 * @param {Array<{ label: string, entries: import('../config/manualAdSpend.js').ManualAdEntry[] }>} manualAdByChannel

 * @param {object} manualFilterCtx

 */

export function buildPowerPriceKpiSplitRows(sourceRecords, manualAdByChannel, manualFilterCtx) {

  const source = sourceRecords || []

  const manualEntries = collectManualAdEntries(manualAdByChannel)

  const productRows = source.filter((r) => !isEsserSheetTotalRecord(r))

  const merged = summarizePowerPriceKpis(productRows, manualEntries, manualFilterCtx)



  const profit = deriveEsserProfitKpis({

    sales: merged.sales,

    salesQty: merged.salesQty,

    totalCost: merged.totalCost,

    netProfit: merged.netProfit,

  })



  const ad = merged



  return [{ label: '스마트스토어', profit, ad, rowCount: productRows.length }]

}



/**

 * 쿠팡 1P 로켓 — 발주 KPI (광고 없음)

 * @param {object[]} records

 */

export function summarizeCoupang1pRocketKpis(records) {

  const productRows = (records || []).filter((r) => !isEsserSheetTotalRecord(r))

  return finalizeEsserBucket(summarizeEsserKpis(productRows))

}



/**

 * 쿠팡 1P 로켓 — 쿠팡 1행 (발주 직접입력)

 * @param {object[]} sourceRecords

 */

export function buildCoupang1pRocketKpiSplitRows(sourceRecords) {

  const productRows = (sourceRecords || []).filter((r) => !isEsserSheetTotalRecord(r))

  const merged = summarizeCoupang1pRocketKpis(productRows)

  const profit = deriveEsserProfitKpis({

    sales: merged.sales,

    salesQty: merged.salesQty,

    totalCost: merged.totalCost,

    netProfit: merged.netProfit,

  })

  const ad = {

    ...merged,

    adSpend: 0,

    adSales: null,

    organicSales: null,

    organicSalesRate: null,

    roas: null,

    salesRoas: null,

  }

  return [{ label: '쿠팡', profit, ad, rowCount: productRows.length }]

}



/** KPI 표·엑셀 섹션 제목 */

export function kpiSplitSectionTitle(splitRows, section = 'profit', options = {}) {

  if (options.compact) return section === 'ad' ? '광고·판매량' : '매출·수익'

  const labels = (splitRows || []).map((r) => r.label).filter(Boolean)

  const suffix = labels.length ? labels.join(' / ') : PLATFORM_KPI_SPLIT_LABELS.join(' / ')

  if (section === 'ad') return `광고·판매량 (${suffix})`

  return `매출·수익 (${suffix})`

}



/** @param {string} channelLabel @param {object[]} sourceRecords @param {object} manualAdByChannel @param {object} manualFilterCtx */

export function buildKpiSplitRowsForChannel(

  channelLabel,

  sourceRecords,

  manualAdByChannel,

  manualFilterCtx,

) {

  if (channelLabel === '파워프라이스') {

    return buildPowerPriceKpiSplitRows(sourceRecords, manualAdByChannel, manualFilterCtx)

  }

  if (channelLabel === '쿠팡 1P 로켓') {

    return buildCoupang1pRocketKpiSplitRows(sourceRecords)

  }

  if (channelLabel === '통합') {

    const platformRecords = (sourceRecords || []).filter((r) => !isPowerPriceRecord(r))

    return buildCombinedKpiSplitRows(

      sourceRecords,

      platformRecords,

      manualAdByChannel,

      manualFilterCtx,

    )

  }

  if (channelLabel === '기타 판매처' || channelLabel === OTHER_SELLERS_BRAND_LABEL) {
    return buildOtherSellersKpiSplitRows(sourceRecords)
  }

  return buildPlatformKpiSplitRows(sourceRecords, manualAdByChannel, manualFilterCtx)

}



/**
 * 통합 광고·판매량 표 — 광고비 0원인 세그먼트 행 숨김 (합계는 유지)
 * @param {Array<{ label?: string, ad?: { adSpend?: number } }>} rows
 */
export function filterKpiRowsWithAdSpend(rows) {
  return (rows || []).filter((row) => {
    if (!row) return false
    if (row.label === '합계') return true
    return (Number(row.ad?.adSpend) || 0) > 0
  })
}

/** @param {string} rowLabel @param {'profit'|'ad'} section @param {string} key */

export function isExternalAdKpiNA(rowLabel, section, key) {

  if (!isManualAdKpiLabel(rowLabel)) return false

  if (section === 'profit') return EXTERNAL_AD_PROFIT_NA_KEYS.has(key)

  if (section === 'ad') return EXTERNAL_AD_AD_NA_KEYS.has(key)

  return false

}



/** 통합 KPI 표 — 파워프라이스 행 (전 지표 표시) */

export function isPowerPriceKpiNA(rowLabel, section, key) {

  return false

}



/** 쿠팡 1P 로켓 KPI 표 — 광고 없음 */

export function isCoupang1pRocketKpiNA(rowLabel, section, key) {

  if (rowLabel !== '쿠팡') return false

  if (section === 'profit') return key === 'aov'

  if (section === 'ad') {

    return ['adSpend', 'adSales', 'organicSales', 'organicSalesRate', 'salesRoas', 'roas'].includes(key)

  }

  return false

}



/** 통합 특판 행 — 광고·판매수량 없음 */
export function isSpecialSaleKpiNA(rowLabel, section, key, specialSale = null) {
  if (!isSpecialSaleRowLabel(rowLabel, specialSale)) return false
  if (section === 'profit') return key === 'aov'
  if (section === 'ad') {
    return ['adSales', 'organicSales', 'organicSalesRate', 'salesRoas', 'roas'].includes(key)
  }
  return false
}


