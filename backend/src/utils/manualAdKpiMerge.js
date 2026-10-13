/**
 * 수기 광고비 KPI merge — 클라이언트 manualAdSpend.js 핵심 규칙 포팅
 */

const MANUAL_AD_SOURCE_DEFS = [
  { value: 'meta', kpiLabel: 'Meta' },
  { value: 'gfa', kpiLabel: 'GFA' },
  { value: 'ad', kpiLabel: 'AD' },
  { value: 'google_traffic', kpiLabel: '구글 트래픽' },
]

function formatExternalAdKpiLabel(brandLabel, platformKpiLabel) {
  const brand = String(brandLabel || '').trim()
  const platform = String(platformKpiLabel || '').trim()
  if (!platform) return brand
  if (!brand || brand === '통합' || brand === '외부 광고') return platform
  return `${brand}-${platform}`
}

// 월별도 일별 데이터 기반이므로 광고는 항상 일별 scope에서 조회 (일별=월별 동일)
const COMBINED_SCOPES = {
  combined_daily: ['platform', 'company_b', 'power_price', 'other_sellers'],
  combined_monthly: ['platform', 'company_b', 'power_price', 'other_sellers'],
}

const MONTHLY_TO_DAILY_SCOPE = {
  platform_monthly: 'platform',
  company_b_monthly: 'company_b',
}

function parseAmount(val) {
  if (val == null || val === '') return 0
  const n = Number(String(val).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function round2(n) {
  return Number(Number(n).toFixed(2))
}

function parseSalesDate(str) {
  if (str == null || str === '') return null
  const s = String(str).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
  const dotted = s.match(/(\d{4})\s*[.\-/년．]\s*(\d{1,2})\s*[.\-/월．]?\s*(\d{1,2})/)
  if (dotted) {
    return {
      year: Number(dotted[1]),
      month: parseInt(dotted[2], 10),
      day: parseInt(dotted[3], 10),
    }
  }
  const md = s.match(/^(\d{1,2})[.\-/](\d{1,2})$/)
  if (md) return { year: null, month: parseInt(md[1], 10), day: parseInt(md[2], 10) }
  return null
}

function normalizeManualAdSource(source) {
  const s = String(source || 'meta').toLowerCase()
  if (s === 'manual' || s === 'meta') return 'meta'
  if (s === 'naver' || s === 'gfa') return 'gfa'
  if (s === 'ad') return 'ad'
  if (s === 'google_traffic' || s === 'google') return 'google_traffic'
  return 'meta'
}

export function resolveManualAdScopes(scope) {
  if (!scope) return ['platform']
  if (COMBINED_SCOPES[scope]) return COMBINED_SCOPES[scope]
  return [MONTHLY_TO_DAILY_SCOPE[scope] || scope]
}

function inferYearFromFilterCtx(filterCtx) {
  if (filterCtx?.from) {
    const p = parseSalesDate(filterCtx.from)
    if (p?.year) return p.year
  }
  return new Date().getFullYear()
}

export function resolveManualAdEntryYmd(entry, filterCtx = {}) {
  const raw = String(entry?.date || '').trim()
  if (!raw) return ''
  const year = inferYearFromFilterCtx(filterCtx)
  const p = parseSalesDate(raw)
  if (p?.year) {
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  }
  if (p?.month) {
    return `${year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  }
  return ''
}

export function manualAdEntryInView(entry, filterCtx = {}) {
  const ymd = resolveManualAdEntryYmd(entry, filterCtx)
  // 날짜 미입력·파싱 실패 행은 KPI 집계에서 제외
  if (!ymd) return false
  if (filterCtx.from && ymd < filterCtx.from) return false
  if (filterCtx.to && ymd > filterCtx.to) return false
  return true
}

function entryValues(entry) {
  return {
    adSpend: Math.abs(parseAmount(entry.adSpend)),
    adSales: Math.abs(parseAmount(entry.adSales)),
  }
}

export function totalManualAdSpend(entries, filterCtx = {}) {
  let total = 0
  for (const entry of entries || []) {
    if (!manualAdEntryInView(entry, filterCtx)) continue
    total += entryValues(entry).adSpend
  }
  return total
}

export function totalManualAdSales(entries, filterCtx = {}) {
  let total = 0
  for (const entry of entries || []) {
    if (!manualAdEntryInView(entry, filterCtx)) continue
    total += entryValues(entry).adSales
  }
  return total
}

function manualAdByDay(entries, filterCtx) {
  const map = new Map()
  for (const entry of entries || []) {
    if (!manualAdEntryInView(entry, filterCtx)) continue
    const ymd = resolveManualAdEntryYmd(entry, filterCtx)
    if (!ymd) continue
    const { adSpend, adSales } = entryValues(entry)
    if (!adSpend && !adSales) continue
    const prev = map.get(ymd) || { adSpend: 0, adSales: 0 }
    map.set(ymd, { adSpend: prev.adSpend + adSpend, adSales: prev.adSales + adSales })
  }
  return map
}

function groupManualAdEntriesBySource(entries) {
  const grouped = Object.fromEntries(MANUAL_AD_SOURCE_DEFS.map((d) => [d.value, []]))
  for (const entry of entries || []) {
    grouped[normalizeManualAdSource(entry?.source)].push(entry)
  }
  return grouped
}

export function filterCtxFromKpiFilters(filters) {
  return {
    from: filters.from || '',
    to: filters.to || '',
    dateFrom: filters.from || '',
    dateTo: filters.to || '',
  }
}

function applyManualFields(base, manualSpend, manualSales = 0) {
  const netProfitAfterManualAd = (base.netProfitTotal ?? 0) - manualSpend
  const salesTotal = base.salesTotal ?? 0
  const adSpendTotal = (base.adSpendTotal ?? 0) + manualSpend
  return {
    ...base,
    manualAdSpendTotal: round2(manualSpend),
    manualAdSalesTotal: round2(manualSales),
    adSpendTotal: round2(adSpendTotal),
    adSalesTotal: round2((base.adSalesTotal ?? 0) + manualSales),
    netProfitAfterManualAd: round2(netProfitAfterManualAd),
    marginRateAfterManualAd:
      salesTotal > 0 ? round2((netProfitAfterManualAd / salesTotal) * 100) : 0,
  }
}

export function mergeSummaryWithManual(summary, manualEntries, filterCtx) {
  const manualSpend = totalManualAdSpend(manualEntries, filterCtx)
  const manualSales = totalManualAdSales(manualEntries, filterCtx)
  if (!manualSpend && !manualSales) {
    return {
      ...summary,
      manualAdSpendTotal: 0,
      manualAdSalesTotal: 0,
      netProfitAfterManualAd: summary.netProfitTotal ?? 0,
      marginRateAfterManualAd: summary.marginRate ?? 0,
    }
  }
  return applyManualFields(summary, manualSpend, manualSales)
}

export function mergeDailyItemsWithManual(items, manualEntries, filterCtx) {
  const manualByDay = manualAdByDay(manualEntries, filterCtx)
  const map = new Map((items || []).map((item) => [item.date, { ...item }]))

  for (const [date, extra] of manualByDay) {
    const row = map.get(date) || {
      date,
      salesTotal: 0,
      quantityTotal: 0,
      recordCount: 0,
      netProfitTotal: 0,
      adSpendTotal: 0,
    }
    const merged = applyManualFields(row, extra.adSpend, extra.adSales)
    map.set(date, merged)
  }

  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

function buildManualAdPlatformItem(label, entries, filterCtx) {
  const spend = totalManualAdSpend(entries, filterCtx)
  const sales = totalManualAdSales(entries, filterCtx)
  if (!spend && !sales) return null
  return {
    platform: label,
    salesTotal: 0,
    quantityTotal: 0,
    recordCount: 0,
    netProfitTotal: -spend,
    adSpendTotal: spend,
    costTotal: 0,
    marginRate: 0,
    averageOrderValue: 0,
    manualAdSpendTotal: spend,
    manualAdSalesTotal: sales,
    netProfitAfterManualAd: -spend,
    marginRateAfterManualAd: 0,
    isManualAdRow: true,
  }
}

export function mergePlatformWithManual(result, manualEntries, filterCtx, opts = {}) {
  const brandLabel = opts.brandLabel || ''
  const bySource = groupManualAdEntriesBySource(manualEntries)
  const manualItems = MANUAL_AD_SOURCE_DEFS.map((def) =>
    buildManualAdPlatformItem(
      formatExternalAdKpiLabel(brandLabel, def.kpiLabel),
      bySource[def.value],
      filterCtx,
    ),
  ).filter(Boolean)

  const manualSpend = totalManualAdSpend(manualEntries, filterCtx)
  const manualSales = totalManualAdSales(manualEntries, filterCtx)

  const totalRow = applyManualFields(result.totalRow || result.total || {}, manualSpend, manualSales)

  return {
    ...result,
    items: result.items,
    manualAdItems: manualItems,
    totalRow,
    manualAdSpendTotal: manualSpend,
  }
}

export function mergeCompareYesterdayWithManual(result, manualEntries, filterCtx) {
  const manualByDay = manualAdByDay(manualEntries, filterCtx)
  const attachManual = (block) => {
    if (!block?.date) return block
    const extra = manualByDay.get(block.date) || { adSpend: 0, adSales: 0 }
    return {
      ...block,
      manualAdSpendTotal: extra.adSpend,
      adSpendTotal: (block.adSpendTotal ?? 0) + extra.adSpend,
    }
  }

  const items = (result.items || []).map((item) => ({
    ...item,
    current: attachManual(item.current),
    previous: attachManual(item.previous),
  }))

  return {
    ...result,
    items,
    current: attachManual(result.current),
    previous: attachManual(result.previous),
    manualAdSpendTotal: totalManualAdSpend(manualEntries, filterCtx),
  }
}
