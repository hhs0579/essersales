import { parseAmount, formatManualAdAmount } from './parseAmount.js'
import { deriveEsserProfitKpis, finalizeEsserBucket } from './esserMetrics.js'
import { MANUAL_EXPENSE_LABEL } from '../config/manualExpense.js'
import { padMonthKey } from './specialSaleKpi.js'

/**
 * @param {{ name?: string } | null | undefined} entry
 */
export function manualExpenseEntryLabel(entry) {
  const name = String(entry?.name || '').trim()
  return name || MANUAL_EXPENSE_LABEL
}

/**
 * @param {{ entries?: unknown[] } | null | undefined} data
 * @returns {Array<{ id: string, name: string, amount: string }>}
 */
export function getManualExpenseEntries(data) {
  if (!data || typeof data !== 'object') return []
  const o = /** @type {Record<string, unknown>} */ (data)
  if (!Array.isArray(o.entries)) return []
  return o.entries
    .filter((e) => e && typeof e === 'object')
    .map((e) => normalizeManualExpenseEntry(/** @type {Record<string, unknown>} */ (e)))
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeManualExpenseEntry(raw) {
  return {
    id:
      typeof raw.id === 'string' && raw.id
        ? raw.id
        : `me_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    amount: formatManualAdAmount(raw.amount ?? raw.sales ?? raw.expense),
  }
}

/** @param {{ amount?: string } | null | undefined} entry */
export function hasManualExpenseEntryInput(entry) {
  return parseAmount(entry?.amount) > 0
}

/** @param {{ entries?: unknown[] } | null | undefined} data */
export function hasManualExpenseInput(data) {
  return getManualExpenseEntries(data).some((entry) => hasManualExpenseEntryInput(entry))
}

/** @param {{ amount?: string } | null | undefined} entry */
export function summarizeManualExpenseEntry(entry) {
  const amount = parseAmount(entry?.amount) || 0
  return finalizeEsserBucket({
    sales: 0,
    salesQty: 0,
    totalCost: amount,
    netProfit: -amount,
    adSpend: 0,
    adSales: 0,
  })
}

/** @param {{ amount?: string, name?: string } | null | undefined} entry */
export function buildManualExpenseKpiRowForEntry(entry) {
  if (!hasManualExpenseEntryInput(entry)) return null

  const merged = summarizeManualExpenseEntry(entry)
  const profit = deriveEsserProfitKpis(merged)
  const ad = {
    ...merged,
    adSales: null,
    organicSales: null,
    organicSalesRate: null,
    roas: null,
    salesRoas: null,
  }

  return {
    label: manualExpenseEntryLabel(entry),
    profit,
    ad,
    rowCount: '',
    kind: 'manual_expense',
    segmentKey: 'manual_expense',
  }
}

/** @param {{ entries?: unknown[] } | null | undefined} data */
export function buildManualExpenseKpiRows(data) {
  return getManualExpenseEntries(data)
    .map((entry) => buildManualExpenseKpiRowForEntry(entry))
    .filter(Boolean)
}

/**
 * @param {{ entries?: unknown[] } | null | undefined} expense
 * @returns {Set<string>}
 */
export function getManualExpenseDisplayLabels(expense) {
  const labels = new Set()
  for (const entry of getManualExpenseEntries(expense)) {
    if (!hasManualExpenseEntryInput(entry)) continue
    labels.add(manualExpenseEntryLabel(entry))
  }
  return labels
}

/** @param {string} label @param {{ entries?: unknown[] } | null | undefined} [expense] */
export function isManualExpenseRowLabel(label, expense) {
  if (expense) return getManualExpenseDisplayLabels(expense).has(label)
  return label === MANUAL_EXPENSE_LABEL
}

/** @param {{ kind?: string, segmentKey?: string } | null | undefined} row */
export function isManualExpenseSegmentKind(row) {
  return row?.kind === 'manual_expense' || row?.segmentKey === 'manual_expense'
}

/**
 * app_settings manual_expense raw → 해당 월 { entries }
 * @param {unknown} raw
 * @param {string} [monthKey]
 */
export function pickManualExpenseSettingForMonth(raw, monthKey = '') {
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
    const entries = getManualExpenseEntries(
      Array.isArray(bucket) ? { entries: bucket } : bucket,
    ).map(normalizeManualExpenseEntry)
    return { entries }
  }

  if (Array.isArray(o.entries)) {
    return { entries: o.entries.map((e) => normalizeManualExpenseEntry(/** @type {Record<string, unknown>} */ (e))) }
  }
  return { entries: [] }
}

/**
 * 클라가 당월만 보내도 전월 months 유지
 * @param {unknown} dbRaw
 * @param {unknown} overrideRaw
 * @param {string} [monthKey]
 */
export function mergeManualExpenseSettingRaw(dbRaw, overrideRaw, monthKey = '') {
  const db = dbRaw && typeof dbRaw === 'object' ? /** @type {Record<string, unknown>} */ (dbRaw) : null
  const ov =
    overrideRaw && typeof overrideRaw === 'object'
      ? /** @type {Record<string, unknown>} */ (overrideRaw)
      : null
  if (!ov) return db
  if (!db) return ov

  const dbMonths =
    db.months && typeof db.months === 'object'
      ? { .../** @type {Record<string, unknown>} */ (db.months) }
      : {}
  const ovMonths =
    ov.months && typeof ov.months === 'object'
      ? /** @type {Record<string, unknown>} */ (ov.months)
      : null

  if (ovMonths) {
    for (const [mk, bucket] of Object.entries(ovMonths)) {
      const pk = padMonthKey(mk) || mk
      if (pk) dbMonths[pk] = bucket
    }
    return { months: dbMonths }
  }

  const mk = padMonthKey(monthKey)
  if (mk && Array.isArray(ov.entries)) {
    dbMonths[mk] = { entries: ov.entries }
    return { months: dbMonths }
  }
  return ov
}
