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
    totalCost: 0,
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

/**
 * 같은 이름(라벨) 지출은 한 행으로 합산
 * @param {{ entries?: unknown[] } | null | undefined} data
 */
export function buildManualExpenseKpiRows(data) {
  /** @type {Map<string, { name: string, amount: number }>} */
  const byLabel = new Map()
  for (const entry of getManualExpenseEntries(data)) {
    if (!hasManualExpenseEntryInput(entry)) continue
    const label = manualExpenseEntryLabel(entry)
    const acc = byLabel.get(label) || { name: label, amount: 0 }
    acc.amount += parseAmount(entry.amount) || 0
    byLabel.set(label, acc)
  }
  return [...byLabel.values()]
    .map((acc) => buildManualExpenseKpiRowForEntry({ name: acc.name, amount: String(acc.amount) }))
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
 * @param {unknown} raw
 * @param {string} [monthKey]
 * @param {{ dateFrom?: string, dateTo?: string }} [opts]
 */
export function pickManualExpenseSettingForMonth(raw, monthKey = '', opts = {}) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const from = String(opts.dateFrom || '').trim()
  const to = String(opts.dateTo || '').trim()
  const partialRange =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    !isFullCalendarMonthRange(from, to)
  const weekRange = partialRange ? { from, to } : null

  /** @type {ReturnType<typeof normalizeManualExpenseEntry>[]} */
  let entries = []

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
    if (!partialRange && bucket && typeof bucket === 'object') {
      entries = getManualExpenseEntries(
        Array.isArray(bucket) ? { entries: bucket } : bucket,
      ).map(normalizeManualExpenseEntry)
    }
    const mkForWeeks = pickKey || paddedWanted
    if (mkForWeeks) {
      entries = [...entries, ...collectManualExpenseWeekEntriesFromRaw(o.weeks, mkForWeeks, weekRange)]
    }
    return { entries }
  }

  if (Array.isArray(o.entries)) {
    if (!partialRange) {
      entries = o.entries.map((e) =>
        normalizeManualExpenseEntry(/** @type {Record<string, unknown>} */ (e)),
      )
    }
    const mk = padMonthKey(monthKey)
    if (mk) entries = [...entries, ...collectManualExpenseWeekEntriesFromRaw(o.weeks, mk, weekRange)]
    return { entries }
  }

  const mkOnly = padMonthKey(monthKey)
  if (mkOnly && o.weeks) {
    return { entries: collectManualExpenseWeekEntriesFromRaw(o.weeks, mkOnly, weekRange) }
  }
  return { entries: [] }
}

function isFullCalendarMonthRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false
  if (from.slice(0, 7) !== to.slice(0, 7)) return false
  const y = Number(from.slice(0, 4))
  const m = Number(from.slice(5, 7))
  const last = new Date(y, m, 0).getDate()
  return from.endsWith('-01') && to === `${from.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

/** @param {unknown} weeksRaw @param {string} monthKey @param {{ from: string, to: string } | null} [range] */
function collectManualExpenseWeekEntriesFromRaw(weeksRaw, monthKey, range = null) {
  if (!weeksRaw || typeof weeksRaw !== 'object') return []
  const mk = padMonthKey(monthKey)
  if (!mk) return []
  const weeks = /** @type {Record<string, unknown>} */ (weeksRaw)
  const keys = Object.keys(weeks)
    .filter((wk) => wk.startsWith(`${mk}-W`) && /^\d{4}-\d{2}-W[1-6]$/.test(wk))
    .sort()
  /** @type {ReturnType<typeof normalizeManualExpenseEntry>[]} */
  const out = []
  for (const wk of keys) {
    const bucket = weeks[wk]
    if (!bucket || typeof bucket !== 'object') continue
    if (range) {
      const b = /** @type {Record<string, unknown>} */ (bucket)
      const wf = String(b.from || '').trim()
      const wt = String(b.to || '').trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(wf) && /^\d{4}-\d{2}-\d{2}$/.test(wt)) {
        if (wt < range.from || wf > range.to) continue
      }
    }
    out.push(
      ...getManualExpenseEntries(Array.isArray(bucket) ? { entries: bucket } : bucket).map(
        normalizeManualExpenseEntry,
      ),
    )
  }
  return out
}

const FRI_THU_WEEK_KEY_RE = /^\d{4}-\d{2}-W[1-6]$/

/**
 * app_settings manual_expense raw → 해당 금~목 주차 { entries }
 * @param {unknown} raw
 * @param {string} [weekKey]
 */
export function pickManualExpenseSettingForWeek(raw, weekKey = '') {
  const wk = String(weekKey || '').trim()
  if (!FRI_THU_WEEK_KEY_RE.test(wk)) return null
  if (!raw || typeof raw !== 'object') return { entries: [] }
  const o = /** @type {Record<string, unknown>} */ (raw)
  const weeks =
    o.weeks && typeof o.weeks === 'object'
      ? /** @type {Record<string, unknown>} */ (o.weeks)
      : {}
  const bucket = weeks[wk]
  if (!bucket || typeof bucket !== 'object') return { entries: [] }
  const entries = getManualExpenseEntries(
    Array.isArray(bucket) ? { entries: bucket } : bucket,
  ).map(normalizeManualExpenseEntry)
  return { entries }
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
  } else {
    const mk = padMonthKey(monthKey)
    if (mk && Array.isArray(ov.entries)) {
      dbMonths[mk] = { entries: ov.entries }
    }
  }

  const dbWeeks =
    db.weeks && typeof db.weeks === 'object'
      ? { .../** @type {Record<string, unknown>} */ (db.weeks) }
      : {}
  const ovWeeks =
    ov.weeks && typeof ov.weeks === 'object'
      ? /** @type {Record<string, unknown>} */ (ov.weeks)
      : null
  if (ovWeeks) {
    for (const [wk, bucket] of Object.entries(ovWeeks)) {
      if (FRI_THU_WEEK_KEY_RE.test(wk)) dbWeeks[wk] = bucket
    }
  }

  return { version: 2, months: dbMonths, weeks: dbWeeks }
}
