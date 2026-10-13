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

/**
 * 같은 이름(라벨) 특판 entries를 하나로 합산 — 월별에 주차 입력이 여러 번 들어와도 행 중복·누락 없음
 * @param {{ entries?: unknown[] } | null | undefined} data
 * @returns {Array<{ name: string, sales: string, margin: string }>}
 */
export function mergeSpecialSaleEntriesByLabel(data) {
  /** @type {Map<string, { name: string, sales: number, margin: number }>} */
  const byLabel = new Map()
  for (const entry of getSpecialSaleEntries(data)) {
    if (!hasSpecialSaleEntryInput(entry)) continue
    const label = specialSaleEntryLabel(entry)
    const acc = byLabel.get(label) || { name: label, sales: 0, margin: 0 }
    acc.sales += parseAmount(entry.sales) || 0
    acc.margin += parseAmount(entry.margin) || 0
    byLabel.set(label, acc)
  }
  return [...byLabel.values()].map((acc) => ({
    name: acc.name,
    sales: String(acc.sales),
    margin: String(acc.margin),
  }))
}

/** @param {{ entries?: unknown[] } | null | undefined} data */
export function buildSpecialSaleKpiRows(data) {
  return mergeSpecialSaleEntriesByLabel(data)
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
 * opts.dateFrom/dateTo가 달 전체가 아니면 월 버킷 제외, 겹치는 주차만 포함.
 * @param {unknown} raw
 * @param {string} [monthKey]
 * @param {{ dateFrom?: string, dateTo?: string }} [opts]
 * @returns {{ entries: ReturnType<typeof normalizeSpecialSaleEntry>[] } | null}
 */
export function pickSpecialSaleSettingForMonth(raw, monthKey = '', opts = {}) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const from = String(opts.dateFrom || '').trim()
  const to = String(opts.dateTo || '').trim()
  const partialRange =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    !isFullCalendarMonthRange(from, to)
  const weekRange = partialRange ? { from, to } : null

  /** @type {ReturnType<typeof normalizeSpecialSaleEntry>[]} */
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
      entries = getSpecialSaleEntries(Array.isArray(bucket) ? { entries: bucket } : bucket).map(
        normalizeSpecialSaleEntry,
      )
    }
    const mkForWeeks = pickKey || paddedWanted
    if (mkForWeeks) {
      entries = [...entries, ...collectWeekEntriesFromRaw(o.weeks, mkForWeeks, weekRange)]
    }
    return { entries }
  }

  if (Array.isArray(o.entries) && o.entries.length) {
    if (!partialRange) {
      entries = o.entries.map((e) =>
        normalizeSpecialSaleEntry(/** @type {Record<string, unknown>} */ (e)),
      )
    }
    const mk = padMonthKey(monthKey)
    if (mk) entries = [...entries, ...collectWeekEntriesFromRaw(o.weeks, mk, weekRange)]
    return { entries }
  }
  if (!partialRange && (o.totalSales || o.margin || o.marginRate)) {
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
  const mk = padMonthKey(monthKey)
  if (mk && o.weeks) {
    return { entries: collectWeekEntriesFromRaw(o.weeks, mk, weekRange) }
  }
  return null
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
function collectWeekEntriesFromRaw(weeksRaw, monthKey, range = null) {
  if (!weeksRaw || typeof weeksRaw !== 'object') return []
  const mk = padMonthKey(monthKey)
  if (!mk) return []
  const weeks = /** @type {Record<string, unknown>} */ (weeksRaw)
  const keys = Object.keys(weeks)
    .filter((wk) => wk.startsWith(`${mk}-W`) && /^\d{4}-\d{2}-W[1-6]$/.test(wk))
    .sort()
  /** @type {ReturnType<typeof normalizeSpecialSaleEntry>[]} */
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
      ...getSpecialSaleEntries(Array.isArray(bucket) ? { entries: bucket } : bucket).map(
        normalizeSpecialSaleEntry,
      ),
    )
  }
  return out
}

const FRI_THU_WEEK_KEY_RE = /^\d{4}-\d{2}-W[1-6]$/

/**
 * app_settings special_sale raw → 해당 금~목 주차 { entries }
 * @param {unknown} raw
 * @param {string} [weekKey] YYYY-MM-Wn
 */
export function pickSpecialSaleSettingForWeek(raw, weekKey = '') {
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
  const entries = getSpecialSaleEntries(Array.isArray(bucket) ? { entries: bucket } : bucket).map(
    normalizeSpecialSaleEntry,
  )
  return { entries }
}

function ingestSpecialSaleWeeks(target, raw) {
  if (!raw || typeof raw !== 'object') return
  const o = /** @type {Record<string, unknown>} */ (raw)
  if (!o.weeks || typeof o.weeks !== 'object') return
  for (const [wk, bucket] of Object.entries(/** @type {Record<string, unknown>} */ (o.weeks))) {
    if (!FRI_THU_WEEK_KEY_RE.test(wk)) continue
    if (!bucket || typeof bucket !== 'object') continue
    const b = /** @type {Record<string, unknown>} */ (bucket)
    const entries = getSpecialSaleEntries(Array.isArray(bucket) ? { entries: bucket } : bucket).map(
      normalizeSpecialSaleEntry,
    )
    target[wk] = {
      from: typeof b.from === 'string' ? b.from : '',
      to: typeof b.to === 'string' ? b.to : '',
      entries,
    }
  }
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
  /** @type {Record<string, { from?: string, to?: string, entries: ReturnType<typeof normalizeSpecialSaleEntry>[] }>} */
  const weeks = {}
  ingestSpecialSaleWeeks(weeks, dbRaw)
  ingestSpecialSaleWeeks(weeks, overrideRaw)
  return { version: 2, months, weeks }
}
