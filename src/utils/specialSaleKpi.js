import { parseAmount, formatManualAdAmount, formatSignedManualAdAmount } from './parseAmount.js'
import { deriveEsserProfitKpis, finalizeEsserBucket } from './esserMetrics.js'
import { SPECIAL_SALE_LABEL } from '../config/specialSale.js'

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
