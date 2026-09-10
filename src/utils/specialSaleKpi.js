import { parseAmount, formatManualAdAmount, formatSignedManualAdAmount } from './parseAmount.js'
import { deriveEsserProfitKpis, finalizeEsserBucket } from './esserMetrics.js'
import { SPECIAL_SALE_LABEL } from '../config/specialSale.js'

/** YYYY-MM — `2026-8` 같이 한 자리 월도 허용 */
export function padMonthKey(monthKey) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{1,2})$/)
  if (!m) return ''
  const month = Number(m[2])
  if (month < 1 || month > 12) return ''
  return `${m[1]}-${String(month).padStart(2, '0')}`
}

/**
 * @param {{ name?: string, sales?: string, margin?: string } | null | undefined} entry
 */
export function specialSaleEntryLabel(entry) {
  const name = String(entry?.name || '').trim()
  return name || SPECIAL_SALE_LABEL
}

/**
 * @param {{ entries?: unknown[] } | { totalSales?: string, margin?: string, marginRate?: string } | null | undefined} data
 * @returns {Array<{ id: string, name: string, sales: string, margin: string }>}
 */
export function getSpecialSaleEntries(data) {
  if (!data || typeof data !== 'object') return []
  const o = /** @type {Record<string, unknown>} */ (data)
  if (Array.isArray(o.entries)) {
    return o.entries
      .filter((e) => e && typeof e === 'object')
      .map((e) => normalizeSpecialSaleEntry(/** @type {Record<string, unknown>} */ (e)))
  }
  if (o.totalSales || o.margin || o.marginRate) {
    return [
      normalizeSpecialSaleEntry({
        name: SPECIAL_SALE_LABEL,
        sales: o.totalSales,
        margin: o.margin,
      }),
    ]
  }
  return []
}

/** 수기 특판 매출 합 (원) */
export function salesTotalFromSpecialSale(specialSale) {
  let total = 0
  for (const e of getSpecialSaleEntries(specialSale)) {
    const n = Number(String(e?.sales ?? '').replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n)) total += n
  }
  return total
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeSpecialSaleEntry(raw) {
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `ss_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    sales: formatManualAdAmount(raw.sales),
    margin: formatSignedManualAdAmount(raw.margin),
  }
}

/**
 * 저장·KPI 직전 — 콤마·원 단위 입력을 숫자 문자열로 정규화
 * @param {{ entries?: unknown[] } | null | undefined} sale
 */
export function normalizeSpecialSaleForStorage(sale) {
  if (!sale || typeof sale !== 'object') return
  const entries = getSpecialSaleEntries(sale)
  sale.entries = entries.map((entry) => normalizeSpecialSaleEntry(entry))
  delete /** @type {Record<string, unknown>} */ (sale).totalSales
  delete /** @type {Record<string, unknown>} */ (sale).margin
  delete /** @type {Record<string, unknown>} */ (sale).marginRate
}

/** @param {{ sales?: string, margin?: string } | null | undefined} entry */
export function hasSpecialSaleEntryInput(entry) {
  return parseAmount(entry?.sales) > 0
}

/** @param {{ entries?: unknown[] } | null | undefined} data */
export function hasSpecialSaleInput(data) {
  return getSpecialSaleEntries(data).some((entry) => hasSpecialSaleEntryInput(entry))
}

/**
 * @param {{ sales?: string, margin?: string } | null | undefined} entry
 */
export function computeSpecialSaleMarginRate(entry) {
  const sales = parseAmount(entry?.sales)
  const margin = parseAmount(entry?.margin)
  if (!sales || margin == null || margin === 0) return null
  if (!Number.isFinite(margin)) return null
  return (margin / sales) * 100
}

/** @param {{ sales?: string, margin?: string } | null | undefined} entry */
export function summarizeSpecialSaleEntry(entry) {
  const sales = parseAmount(entry?.sales)
  const margin = parseAmount(entry?.margin)
  const netProfitRate =
    sales > 0 && margin != null && margin !== 0 ? (margin / sales) * 100 : 0

  return finalizeEsserBucket({
    sales,
    salesQty: 0,
    totalCost: sales - margin,
    netProfit: margin,
    netProfitRate,
    adSpend: 0,
    adSales: 0,
  })
}

/** @param {{ entries?: unknown[] } | null | undefined} data */
export function summarizeSpecialSaleKpi(data) {
  const entries = getSpecialSaleEntries(data).filter((entry) => hasSpecialSaleEntryInput(entry))
  if (!entries.length) {
    return finalizeEsserBucket({
      sales: 0,
      salesQty: 0,
      totalCost: 0,
      netProfit: 0,
      adSpend: 0,
      adSales: 0,
    })
  }

  let sales = 0
  let totalCost = 0
  let netProfit = 0

  for (const entry of entries) {
    const k = summarizeSpecialSaleEntry(entry)
    sales += k.sales || 0
    totalCost += k.totalCost || 0
    netProfit += k.netProfit || 0
  }

  return finalizeEsserBucket({
    sales,
    salesQty: 0,
    totalCost,
    netProfit,
    adSpend: 0,
    adSales: 0,
  })
}

/** @param {{ sales?: string, margin?: string, name?: string } | null | undefined} entry */
export function buildSpecialSaleKpiRowForEntry(entry) {
  if (!hasSpecialSaleEntryInput(entry)) return null

  const merged = summarizeSpecialSaleEntry(entry)
  const profit = deriveEsserProfitKpis(merged)
  const ad = {
    ...merged,
    adSales: null,
    organicSales: null,
    organicSalesRate: null,
    roas: null,
    salesRoas: null,
  }

  return { label: specialSaleEntryLabel(entry), profit, ad, rowCount: '', kind: 'special_sale' }
}

/** @param {{ entries?: unknown[] } | null | undefined} data */
export function buildSpecialSaleKpiRows(data) {
  return getSpecialSaleEntries(data)
    .map((entry) => buildSpecialSaleKpiRowForEntry(entry))
    .filter(Boolean)
}

/**
 * @param {{ entries?: unknown[] } | null | undefined} specialSale
 * @returns {Set<string>}
 */
export function getSpecialSaleDisplayLabels(specialSale) {
  const labels = new Set()
  for (const entry of getSpecialSaleEntries(specialSale)) {
    if (!hasSpecialSaleEntryInput(entry)) continue
    labels.add(specialSaleEntryLabel(entry))
  }
  return labels
}

/** @param {string} label @param {{ entries?: unknown[] } | null | undefined} [specialSale] */
export function isSpecialSaleRowLabel(label, specialSale) {
  if (specialSale) return getSpecialSaleDisplayLabels(specialSale).has(label)
  return label === SPECIAL_SALE_LABEL
}

/**
 * 월별 특판 맵에 등장하는 KPI 행 라벨 (커스텀 이름 포함)
 * @param {Record<string, unknown[]> | Map<string, unknown[]> | null | undefined} monthlyMap
 * @returns {Set<string>}
 */
export function collectSpecialSaleRowLabelsFromMonthlyMap(monthlyMap) {
  const labels = new Set()
  if (!monthlyMap) return labels
  const values =
    monthlyMap instanceof Map ? monthlyMap.values() : Object.values(monthlyMap)
  for (const entries of values) {
    for (const label of getSpecialSaleDisplayLabels({ entries })) {
      labels.add(label)
    }
  }
  return labels
}

/**
 * app_settings special_sale raw → 해당 월 { entries }
 * 월 키가 비면 months 중 최신 월. 지정 월이 없으면 빈 entries.
 * @param {unknown} raw
 * @param {string} [monthKey]
 * @returns {{ entries: ReturnType<typeof normalizeSpecialSaleEntry>[] } | null}
 */
export function pickSpecialSaleSettingForMonth(raw, monthKey = '') {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)

  if (o.months && typeof o.months === 'object') {
    const months = /** @type {Record<string, unknown>} */ (o.months)
    const paddedWanted = padMonthKey(monthKey)
    /** @type {Record<string, unknown>} */
    const byPadded = {}
    for (const [k, bucket] of Object.entries(months)) {
      const pk = padMonthKey(k)
      if (pk) byPadded[pk] = bucket
    }
    const pickKey = paddedWanted || Object.keys(byPadded).sort().pop() || ''
    const bucket = pickKey ? byPadded[pickKey] : null
    if (!bucket || typeof bucket !== 'object') return { entries: [] }
    const entries = getSpecialSaleEntries(Array.isArray(bucket) ? { entries: bucket } : bucket).map(
      normalizeSpecialSaleEntry,
    )
    return { entries }
  }

  if (Array.isArray(o.entries) && o.entries.length) {
    return { entries: o.entries.map((e) => normalizeSpecialSaleEntry(/** @type {Record<string, unknown>} */ (e))) }
  }
  if (o.totalSales || o.margin || o.marginRate) {
    return {
      entries: [
        normalizeSpecialSaleEntry({
          name: SPECIAL_SALE_LABEL,
          sales: o.totalSales,
          margin: o.margin,
        }),
      ],
    }
  }
  return null
}

function ingestSpecialSaleMonths(target, raw, monthKey = '') {
  if (!raw || typeof raw !== 'object') return
  const o = /** @type {Record<string, unknown>} */ (raw)
  if (o.months && typeof o.months === 'object') {
    for (const [k, bucket] of Object.entries(/** @type {Record<string, unknown>} */ (o.months))) {
      const pk = padMonthKey(k)
      if (!pk) continue
      const entries = getSpecialSaleEntries(Array.isArray(bucket) ? { entries: bucket } : bucket).map(
        normalizeSpecialSaleEntry,
      )
      if (entries.some((e) => e.name || e.sales || e.margin)) {
        target[pk] = { entries }
      }
    }
    return
  }
  const mk = padMonthKey(monthKey)
  const entries = getSpecialSaleEntries(o).map(normalizeSpecialSaleEntry)
  if (mk && entries.some((e) => e.name || e.sales || e.margin)) {
    target[mk] = { entries }
  }
}

/**
 * DB 특판 + 클라 스냅샷 병합.
 * 클라가 당월 { entries }만 보내도 전월 months 버킷을 지우지 않음.
 * @param {unknown} dbRaw
 * @param {unknown} overrideRaw
 * @param {string} [monthKey]
 */
export function mergeSpecialSaleSettingRaw(dbRaw, overrideRaw, monthKey = '') {
  if (!overrideRaw) return dbRaw ?? null
  if (!dbRaw) return overrideRaw
  /** @type {Record<string, { entries: ReturnType<typeof normalizeSpecialSaleEntry>[] }>} */
  const months = {}
  ingestSpecialSaleMonths(months, dbRaw, monthKey)
  ingestSpecialSaleMonths(months, overrideRaw, monthKey)
  return { months }
}
