import { parseAmount } from './parseAmount.js'
import { parseSalesDate, parseMonthDayLabel, toDayKey } from './dateParse.js'
import { getIsoWeekInfo } from './salesAggregation.js'
import {
  finalizeEsserBucket,
  summarizeEsserKpis,
  aggregateEsserByDay,
  aggregateEsserByWeek,
  aggregateEsserByMonth,
  aggregateEsserBySalesMethod,
  aggregateEsserByStore,
} from './esserMetrics.js'
import { isPowerPriceRecord } from '../config/powerPrice.js'
import {
  MANUAL_AD_SOURCE_DEFS,
  normalizeManualAdSource,
} from '../config/manualAdSpend.js'

/** @typedef {import('../config/manualAdSpend.js').ManualAdEntry} ManualAdEntry */

/**
 * KPI·합계 반영 여부 — 일자가 조회 기간 안에 있을 때만 true
 * @param {ManualAdEntry} entry
 * @param {{ dateFrom?: string, dateTo?: string, year?: string, month?: string }} filterCtx
 */
function entryHasManualAdAmount(entry) {
  return parseAmount(entry?.adSpend) > 0 || parseAmount(entry?.adSales) > 0
}

/** 수동 광고 일자 → YYYY-MM-DD (일별 집계·표시용) */
export function resolveManualAdEntryYmd(entry, filterCtx = {}) {
  const raw = String(entry?.date || '').trim()
  if (!raw) return ''
  const year = inferYearFromFilterCtx(filterCtx)
  const p = parseSalesDate(raw) || parseMonthDayLabel(raw, year)
  if (!p) return ''
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function manualAdEntryInView(entry, filterCtx) {
  const ymd = resolveManualAdEntryYmd(entry, filterCtx)
  if (!ymd) {
    return entryHasManualAdAmount(entry) && manualAdHasDateFilter(filterCtx)
  }

  if (filterCtx?.year && ymd.slice(0, 4) !== String(filterCtx.year)) return false
  if (filterCtx?.month && parseInt(ymd.slice(5, 7), 10) !== Number(filterCtx.month)) return false
  if (filterCtx?.dateFrom && ymd < filterCtx.dateFrom) return false
  if (filterCtx?.dateTo && ymd > filterCtx.dateTo) return false
  return true
}

/** 엑셀 외부 광고 표 — 일자(또는 월)가 있는 행만, 조회 기간 안 */
export function manualAdEntryForExcelExport(entry, filterCtx) {
  const ymd = resolveManualAdEntryYmd(entry, filterCtx)
  if (!ymd) return false
  return manualAdEntryInView(entry, filterCtx)
}

/** ①요약리포트 외부 광고 표 — 조회 기간·일자별만 (기간 합산·일자 미입력 행 제외) */
export function manualAdEntryForIntegratedReport(entry, filterCtx) {
  return manualAdEntryForExcelExport(entry, filterCtx)
}

/**
 * 엑셀 외부 광고 — 일자별 합산 (동일 일자 여러 행 → 1행)
 * @param {ManualAdEntry[]} entries
 * @returns {Array<[string, { adSpend: number, adSales: number }]>}
 */
export function summarizeManualAdExportByDay(entries, filterCtx = {}) {
  /** @type {Map<string, { adSpend: number, adSales: number }>} */
  const map = new Map()
  for (const e of entries || []) {
    if (!manualAdEntryForExcelExport(e, filterCtx)) continue
    const ymd = resolveManualAdEntryYmd(e, filterCtx)
    if (!ymd) continue
    const { adSpend, adSales } = entryValues(e)
    if (!adSpend && !adSales) continue
    const prev = map.get(ymd) || { adSpend: 0, adSales: 0 }
    map.set(ymd, {
      adSpend: prev.adSpend + adSpend,
      adSales: prev.adSales + adSales,
    })
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

/**
 * @param {ManualAdEntry} entry
 * @param {object} filterCtx
 */
export function manualAdEntryDisplayDate(entry, filterCtx) {
  const ymd = resolveManualAdEntryYmd(entry, filterCtx)
  if (ymd) {
    if (filterCtx?.period === 'monthly') return ymd.slice(0, 7)
    return ymd
  }
  const from = filterCtx?.dateFrom || ''
  const to = filterCtx?.dateTo || ''
  if (from && to) return from === to ? from : `${from} ~ ${to}`
  if (from) return from
  if (to) return to
  if (filterCtx?.year && filterCtx?.month) {
    return `${filterCtx.year}-${String(filterCtx.month).padStart(2, '0')}`
  }
  if (filterCtx?.year) return String(filterCtx.year)
  return ''
}

/** @param {object} filterCtx */
export function manualAdHasDateFilter(filterCtx) {
  return !!(
    filterCtx?.dateFrom ||
    filterCtx?.dateTo ||
    filterCtx?.year ||
    filterCtx?.month
  )
}

/**
 * 입력 패널 표시 — 기간 밖 일자는 숨기고, 날짜 미입력 행은 편집용으로 유지
 * @param {ManualAdEntry} entry
 * @param {object} filterCtx
 */
export function manualAdEntryVisibleInPanel(entry, filterCtx) {
  if (!entry?.date) return true
  return manualAdEntryInView(entry, filterCtx)
}

/** @param {ManualAdEntry} entry @param {object} filterCtx */
function entryInView(entry, filterCtx) {
  return manualAdEntryInView(entry, filterCtx)
}

/** @param {import('../config/manualAdSpend.js').ManualAdEntry[]} entries */
export function groupManualAdEntriesBySource(entries) {
  /** @type {Record<string, ManualAdEntry[]>} */
  const grouped = Object.fromEntries(MANUAL_AD_SOURCE_DEFS.map((d) => [d.value, []]))
  for (const entry of entries || []) {
    const key = normalizeManualAdSource(entry?.source)
    grouped[key].push(entry)
  }
  return grouped
}

/** @param {import('../config/manualAdSpend.js').ManualAdEntry[]} entries */
export function splitManualAdEntriesBySource(entries) {
  const bySource = groupManualAdEntriesBySource(entries)
  return {
    bySource,
    manual: bySource.meta,
    naver: bySource.gfa,
    meta: bySource.meta,
    gfa: bySource.gfa,
    ad: bySource.ad,
    google_traffic: bySource.google_traffic,
  }
}

/** @param {ManualAdEntry} entry */
function entryValues(entry) {
  return {
    adSpend: Math.abs(parseAmount(entry.adSpend)),
    adSales: Math.abs(parseAmount(entry.adSales)),
  }
}

/**
 * @param {ManualAdEntry[]} entries
 * @param {object} filterCtx
 */
export function manualAdByDayLabel(entries, filterCtx) {
  /** @type {Map<string, { adSpend: number, adSales: number }>} */
  const map = new Map()
  if (!entries?.length) return map

  for (const entry of entries) {
    if (!entryInView(entry, filterCtx)) continue
    const ymd = resolveManualAdEntryYmd(entry, filterCtx)
    if (!ymd) continue
    const { adSpend, adSales } = entryValues(entry)
    if (!adSpend && !adSales) continue
    const prev = map.get(ymd) || { adSpend: 0, adSales: 0 }
    map.set(ymd, {
      adSpend: prev.adSpend + adSpend,
      adSales: prev.adSales + adSales,
    })
  }
  return map
}

/**
 * @param {ManualAdEntry[]} entries
 * @param {object} filterCtx
 */
export function totalManualAdSpend(entries, filterCtx) {
  if (!entries?.length) return 0
  let total = 0
  for (const entry of entries) {
    if (!entryInView(entry, filterCtx)) continue
    total += entryValues(entry).adSpend
  }
  return total
}

/**
 * @param {ManualAdEntry[]} entries
 * @param {object} filterCtx
 */
export function totalManualAdSales(entries, filterCtx) {
  if (!entries?.length) return 0
  let total = 0
  for (const entry of entries) {
    if (!entryInView(entry, filterCtx)) continue
    total += entryValues(entry).adSales
  }
  return total
}

/** 외부·타 채널 수동 광고만 — 상품 매출 없음, 마진은 광고비 차감 */
export function summarizeManualAdKpiOnly(entries, filterCtx) {
  const adSpend = totalManualAdSpend(entries, filterCtx)
  const adSales = totalManualAdSales(entries, filterCtx)
  if (!adSpend && !adSales) {
    return finalizeEsserBucket({
      sales: 0,
      salesQty: 0,
      netProfit: 0,
      totalCost: 0,
      adSpend: 0,
      adSales: 0,
    })
  }
  return finalizeEsserBucket({
    sales: 0,
    salesQty: 0,
    netProfit: -adSpend,
    totalCost: 0,
    adSpend,
    adSales,
  })
}

/**
 * @param {object} bucket
 * @param {{ adSpend?: number, adSales?: number }} extra
 */
function applyManualToBucket(bucket, extra) {
  if (!extra?.adSpend && !extra?.adSales) return bucket
  const b = finalizeEsserBucket(bucket)
  const merged = finalizeEsserBucket({
    ...b,
    adSpend: (b.adSpend || 0) + (extra.adSpend || 0),
    adSales: (b.adSales || 0) + (extra.adSales || 0),
    netProfit: (b.netProfit || 0) - (extra.adSpend || 0),
  })
  return { ...merged, label: bucket.label, sortTime: bucket.sortTime }
}

function bucketManualDelta(withManual, base) {
  return {
    adSpend: (withManual.adSpend || 0) - (base?.adSpend || 0),
    adSales: (withManual.adSales || 0) - (base?.adSales || 0),
  }
}

function emptyDayBucket(label, sortTime) {
  const raw = String(label || '').trim()
  const display = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : toDayKey(raw) || raw
  return {
    label: display,
    sortTime,
    ...finalizeEsserBucket({
      sales: 0,
      salesQty: 0,
      netProfit: 0,
      totalCost: 0,
      adSpend: 0,
      adSales: 0,
    }),
  }
}

/**
 * @param {object[]} rows
 * @param {ManualAdEntry[]} manualEntries
 * @param {object} filterCtx
 */
function inferYearFromFilterCtx(filterCtx) {
  if (filterCtx?.dateFrom) {
    const p = parseSalesDate(filterCtx.dateFrom)
    if (p) return p.year
  }
  if (filterCtx?.year) return Number(filterCtx.year)
  return new Date().getFullYear()
}

function pickDayDisplayLabel(a, b) {
  const la = String(a?.label || '').trim()
  const lb = String(b?.label || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(la)) return la
  if (/^\d{4}-\d{2}-\d{2}$/.test(lb)) return lb
  if (/^\d{1,2}\.\d{1,2}$/.test(la)) return la
  if (/^\d{1,2}\.\d{1,2}$/.test(lb)) return lb
  return la || lb
}

function dayKeyFromLabel(label, defaultYear) {
  return toDayKey(label, defaultYear)
}

function parseDayKeyAsDate(dk, defaultYear) {
  return parseSalesDate(dk) || parseMonthDayLabel(dk, defaultYear)
}

function manualAdByCanonicalDay(entries, filterCtx) {
  const year = inferYearFromFilterCtx(filterCtx)
  const byLabel = manualAdByDayLabel(entries, filterCtx)
  /** @type {Map<string, { adSpend: number, adSales: number }>} */
  const map = new Map()
  for (const [label, extra] of byLabel) {
    const dk = dayKeyFromLabel(label, year)
    if (!dk) continue
    const prev = map.get(dk) || { adSpend: 0, adSales: 0 }
    map.set(dk, {
      adSpend: prev.adSpend + (extra.adSpend || 0),
      adSales: prev.adSales + (extra.adSales || 0),
    })
  }
  return map
}

function dayBucketsByCanonicalKey(dayRows, defaultYear) {
  const map = new Map()
  for (const d of dayRows || []) {
    const dk = dayKeyFromLabel(d.label, defaultYear)
    if (!dk) continue
    const raw = String(d.label || '').trim()
    let label = /^\d{1,2}[.\-/]\d{1,2}$/.test(raw) ? raw.replace(/-/g, '.') : raw || dk
    if (!label && dk) {
      const p = parseDayKeyAsDate(dk, defaultYear)
      if (p) {
        label = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
      } else {
        label = dk
      }
    }
    const norm = { ...d, label }
    const prev = map.get(dk)
    map.set(dk, prev ? mergeDayBuckets(prev, norm) : norm)
  }
  return map
}

export function aggregateEsserByDayWithManual(rows, manualEntries, filterCtx) {
  const year = inferYearFromFilterCtx(filterCtx)
  const baseMap = dayBucketsByCanonicalKey(aggregateEsserByDay(rows), year)
  const manualByDay = manualAdByCanonicalDay(manualEntries, filterCtx)

  for (const [dk] of manualByDay) {
    if (baseMap.has(dk)) continue
    const p = parseDayKeyAsDate(dk, year)
    if (!p) continue
    baseMap.set(dk, emptyDayBucket(dk, p.date.getTime()))
  }

  return [...baseMap.values()]
    .sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0))
    .map((d) => {
      const dk = dayKeyFromLabel(d.label, year) || d.label
      const extra = manualByDay.get(dk) || manualByDay.get(d.label) || {}
      return applyManualToBucket(d, extra)
    })
}

function mergeDayBuckets(a, b) {
  const merged = finalizeEsserBucket({
    sales: (a.sales || 0) + (b.sales || 0),
    salesQty: (a.salesQty || 0) + (b.salesQty || 0),
    totalCost: (a.totalCost || 0) + (b.totalCost || 0),
    netProfit: (a.netProfit || 0) + (b.netProfit || 0),
    adSpend: (a.adSpend || 0) + (b.adSpend || 0),
    adSales: (a.adSales || 0) + (b.adSales || 0),
  })
  const label = pickDayDisplayLabel(a, b)
  const sortTime = Math.max(a.sortTime || 0, b.sortTime || 0) || a.sortTime || b.sortTime
  return { ...a, ...merged, label, sortTime }
}

/**
 * 통합 일별 — 베스트하임·사본느리(광고매출 포함) + 파워프라이스(광고비만) 일별 합산
 * @param {object[]} rows
 * @param {Array<{ label: string, entries?: ManualAdEntry[] }>} manualAdByChannel
 * @param {object} filterCtx
 */
export function aggregateCombinedByDayWithManual(rows, manualAdByChannel, filterCtx) {
  const bhSbn = (rows || []).filter((r) => !isPowerPriceRecord(r))
  const pp = (rows || []).filter((r) => isPowerPriceRecord(r))
  const bhSbnManual = (manualAdByChannel || [])
    .filter((g) => g.label !== '파워프라이스')
    .flatMap((g) => g.entries || [])
  const ppManual = (manualAdByChannel || []).find((g) => g.label === '파워프라이스')?.entries || []

  const year = inferYearFromFilterCtx(filterCtx)
  const map = new Map()
  for (const d of aggregateEsserByDayWithManual(bhSbn, bhSbnManual, filterCtx)) {
    const dk = dayKeyFromLabel(d.label, year)
    if (!dk) continue
    const prev = map.get(dk)
    map.set(dk, prev ? mergeDayBuckets(prev, d) : d)
  }
  for (const d of aggregateEsserByDayWithManualSpendOnly(pp, ppManual, filterCtx)) {
    const dk = dayKeyFromLabel(d.label, year)
    if (!dk) continue
    const prev = map.get(dk)
    map.set(dk, prev ? mergeDayBuckets(prev, d) : d)
  }
  return [...map.values()].sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0))
}

/** 파워프라이스 — KPI는 광고비만 반영, 일별 표에는 전환매출액 표시 */
export function aggregateEsserByDayWithManualSpendOnly(rows, manualEntries, filterCtx) {
  const year = inferYearFromFilterCtx(filterCtx)
  const baseMap = dayBucketsByCanonicalKey(aggregateEsserByDay(rows), year)
  const manualByDay = manualAdByCanonicalDay(manualEntries, filterCtx)

  for (const [dk] of manualByDay) {
    if (baseMap.has(dk)) continue
    const p = parseDayKeyAsDate(dk, year)
    if (!p) continue
    baseMap.set(dk, emptyDayBucket(dk, p.date.getTime()))
  }

  return [...baseMap.values()]
    .sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0))
    .map((d) => {
      const dk = dayKeyFromLabel(d.label, year) || d.label
      const extra = manualByDay.get(dk) || manualByDay.get(d.label) || {}
      return applyManualToBucket(d, {
        adSpend: extra.adSpend || 0,
        adSales: extra.adSales || 0,
      })
    })
}

/**
 * @param {object[]} rows
 * @param {ManualAdEntry[]} manualEntries
 * @param {object} filterCtx
 * @param {string} filterYear
 */
export function aggregateEsserByWeekWithManual(rows, manualEntries, filterCtx, filterYear, spendOnly = false) {
  const aggregateDay = spendOnly ? aggregateEsserByDayWithManualSpendOnly : aggregateEsserByDayWithManual
  const dailyWith = aggregateDay(rows, manualEntries, filterCtx)
  const dailyBase = aggregateEsserByDay(rows)
  const extraByDay = new Map()
  for (const d of dailyWith) {
    const base = dailyBase.find((x) => x.label === d.label)
    extraByDay.set(d.label, bucketManualDelta(d, base))
  }

  const weekly = aggregateEsserByWeek(rows, filterYear)
  const weekKeySet = new Set(weekly.map((w) => w.label.split(' ')[0]))

  for (const [label, extra] of extraByDay) {
    if (!extra.adSpend && !extra.adSales) continue
    const p = parseSalesDate(label)
    if (!p) continue
    const w = getIsoWeekInfo(p.date)
    if (filterYear && String(w.weekYear) !== String(filterYear)) continue
    if (weekKeySet.has(w.key)) continue
    weekKeySet.add(w.key)
    weekly.push({
      label: `${w.key} (${w.monday.getMonth() + 1}/${w.monday.getDate()}~${w.sunday.getMonth() + 1}/${w.sunday.getDate()})`,
      sortTime: w.sortTime,
      ...emptyDayBucket(w.key, w.sortTime),
    })
  }

  return weekly
    .sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0))
    .map((w) => {
      const weekKey = w.label.split(' ')[0]
      const extra = { adSpend: 0, adSales: 0 }
      for (const [label, dayExtra] of extraByDay) {
        const p = parseSalesDate(label)
        if (!p) continue
        if (getIsoWeekInfo(p.date).key !== weekKey) continue
        extra.adSpend += dayExtra.adSpend
        extra.adSales += dayExtra.adSales
      }
      return applyManualToBucket(w, extra)
    })
}

/**
 * @param {object[]} rows
 * @param {ManualAdEntry[]} manualEntries
 * @param {object} filterCtx
 * @param {string} filterYear
 */
export function aggregateEsserByMonthWithManual(rows, manualEntries, filterCtx, filterYear, spendOnly = false) {
  const aggregateDay = spendOnly ? aggregateEsserByDayWithManualSpendOnly : aggregateEsserByDayWithManual
  const dailyWith = aggregateDay(rows, manualEntries, filterCtx)
  const dailyBase = aggregateEsserByDay(rows)
  /** @type {Map<number, { adSpend: number, adSales: number }>} */
  const extraByMonth = new Map()

  for (const d of dailyWith) {
    const base = dailyBase.find((x) => x.label === d.label)
    const delta = bucketManualDelta(d, base)
    if (!delta.adSpend && !delta.adSales) continue
    const p = parseSalesDate(d.label)
    if (!p) continue
    if (filterYear && String(p.year) !== String(filterYear)) continue
    const prev = extraByMonth.get(p.month) || { adSpend: 0, adSales: 0 }
    extraByMonth.set(p.month, {
      adSpend: prev.adSpend + delta.adSpend,
      adSales: prev.adSales + delta.adSales,
    })
  }

  const monthly = aggregateEsserByMonth(rows, filterYear)
  const monthSet = new Set(monthly.map((m) => m.month))

  for (const [month, extra] of extraByMonth) {
    if (monthSet.has(month)) continue
    monthSet.add(month)
    monthly.push({
      label: `${month}월`,
      month,
      sortTime: month,
      ...emptyDayBucket(`${month}월`, month),
    })
  }

  return monthly
    .sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0))
    .map((m) => applyManualToBucket(m, extraByMonth.get(m.month) || {}))
}

function applyManualShareToBreakdown(base, metricKey, totalExtraSpend, totalExtraSales) {
  if (!totalExtraSpend && !totalExtraSales) return base

  if (metricKey === 'roas') {
    const adSpendItems = base.length ? base : []
    const totalBaseSpend =
      adSpendItems.reduce((s, x) => s + (x.value || 0), 0) || totalExtraSpend || 1
    return adSpendItems.map((item) => {
      const share = (item.value || 0) / totalBaseSpend
      const adSalesItem = base.find((x) => x.label === item.label)
      const adSales = (adSalesItem?.value || 0) + totalExtraSales * share
      const adSpend = (item.value || 0) + totalExtraSpend * share
      return {
        label: item.label,
        value: adSpend > 0 ? (adSales / adSpend) * 100 : 0,
      }
    })
  }

  if (metricKey === 'adSpend') {
    const totalBase = base.reduce((s, x) => s + (x.value || 0), 0) || 1
    return base.map((item) => ({
      ...item,
      value: item.value + totalExtraSpend * ((item.value || 0) / totalBase),
    }))
  }

  if (metricKey === 'adSales') {
    const totalBase = base.reduce((s, x) => s + (x.value || 0), 0) || 1
    return base.map((item) => ({
      ...item,
      value: item.value + totalExtraSales * ((item.value || 0) / totalBase),
    }))
  }

  if (metricKey === 'netProfit') {
    const totalBase = base.reduce((s, x) => s + Math.abs(x.value || 0), 0) || 1
    return base.map((item) => ({
      ...item,
      value: item.value - totalExtraSpend * (Math.abs(item.value || 0) / totalBase),
    }))
  }

  if (metricKey === 'organicSales') {
    const totalBase = base.reduce((s, x) => s + (x.value || 0), 0) || 1
    return base.map((item) => ({
      ...item,
      value: item.value - totalExtraSales * ((item.value || 0) / totalBase),
    }))
  }

  return base
}

/**
 * @param {object[]} rows
 * @param {ManualAdEntry[]} manualEntries
 * @param {object} filterCtx
 * @param {string} metricKey
 */
export function aggregateEsserBySalesMethodWithManual(rows, manualEntries, filterCtx, metricKey) {
  const base = aggregateEsserBySalesMethod(rows, metricKey)
  const totalExtraSpend = totalManualAdSpend(manualEntries, filterCtx)
  const totalExtraSales = totalManualAdSales(manualEntries, filterCtx)
  if (!totalExtraSpend && !totalExtraSales) return base

  if (metricKey === 'roas') {
    const adSpendBase = aggregateEsserBySalesMethod(rows, 'adSpend')
    const adSalesBase = aggregateEsserBySalesMethod(rows, 'adSales')
    const merged = adSpendBase.map((item) => ({
      label: item.label,
      value: item.value,
      adSales: adSalesBase.find((x) => x.label === item.label)?.value || 0,
    }))
    const totalBaseSpend = merged.reduce((s, x) => s + (x.value || 0), 0) || totalExtraSpend || 1
    return merged.map((item) => {
      const share = (item.value || 0) / totalBaseSpend
      const adSpend = item.value + totalExtraSpend * share
      const adSales = item.adSales + totalExtraSales * share
      return { label: item.label, value: adSpend > 0 ? (adSales / adSpend) * 100 : 0 }
    })
  }

  return applyManualShareToBreakdown(base, metricKey, totalExtraSpend, totalExtraSales)
}

/**
 * @param {object[]} rows
 * @param {ManualAdEntry[]} manualEntries
 * @param {object} filterCtx
 * @param {string} metricKey
 */
export function aggregateEsserByStoreWithManual(rows, manualEntries, filterCtx, metricKey) {
  const base = aggregateEsserByStore(rows, metricKey)
  const totalExtraSpend = totalManualAdSpend(manualEntries, filterCtx)
  const totalExtraSales = totalManualAdSales(manualEntries, filterCtx)
  if (!totalExtraSpend && !totalExtraSales) return base

  if (metricKey === 'roas') {
    const adSpendBase = aggregateEsserByStore(rows, 'adSpend')
    const adSalesBase = aggregateEsserByStore(rows, 'adSales')
    const totalBaseSpend = adSpendBase.reduce((s, x) => s + (x.value || 0), 0) || totalExtraSpend || 1
    return adSpendBase.map((item) => {
      const share = (item.value || 0) / totalBaseSpend
      const adSpend = item.value + totalExtraSpend * share
      const adSales =
        (adSalesBase.find((x) => x.label === item.label)?.value || 0) + totalExtraSales * share
      return { label: item.label, value: adSpend > 0 ? (adSales / adSpend) * 100 : 0 }
    })
  }

  return applyManualShareToBreakdown(base, metricKey, totalExtraSpend, totalExtraSales)
}

/**
 * @param {object[]} rows
 * @param {ManualAdEntry[]} manualEntries
 * @param {object} filterCtx
 */
export function summarizeEsserKpisWithManual(rows, manualEntries, filterCtx) {
  const base = summarizeEsserKpis(rows)
  return applyManualToBucket(base, {
    adSpend: totalManualAdSpend(manualEntries, filterCtx),
    adSales: totalManualAdSales(manualEntries, filterCtx),
  })
}

/** @param {ManualAdEntry[]} entries @param {object} filterCtx */
export function manualAdSummaryText(entries, filterCtx) {
  const bySource = groupManualAdEntriesBySource(entries)
  const lines = []
  const unit = filterCtx?.period === 'monthly' ? '월' : '일'

  for (const def of MANUAL_AD_SOURCE_DEFS) {
    const list = bySource[def.value] || []
    const spend = totalManualAdSpend(list, filterCtx)
    const sales = totalManualAdSales(list, filterCtx)
    if (!spend && !sales) continue
    const count = list.filter(
      (e) => entryInView(e, filterCtx) && (parseAmount(e.adSpend) > 0 || parseAmount(e.adSales) > 0),
    ).length
    const parts = []
    if (spend) parts.push(`광고비 ${Math.round(spend).toLocaleString('ko-KR')}원`)
    if (sales) parts.push(`전환매출 ${Math.round(sales).toLocaleString('ko-KR')}원`)
    lines.push(`${def.kpiLabel} ${parts.join(' · ')} (${count}${unit})`)
  }

  return lines.join('  |  ')
}

/**
 * @param {Array<{ label: string, entries: ManualAdEntry[] }>} channelGroups
 * @param {object} filterCtx
 */
export function manualAdSummaryTextByChannel(channelGroups, filterCtx) {
  if (!channelGroups?.length) return ''
  const lines = []
  for (const { label, entries } of channelGroups) {
    const adSpend = totalManualAdSpend(entries || [], filterCtx)
    const adSales = totalManualAdSales(entries || [], filterCtx)
    if (!adSpend && !adSales) continue
    const parts = []
    if (adSpend) parts.push(`광고비 ${Math.round(adSpend).toLocaleString('ko-KR')}원`)
    if (adSales) parts.push(`전환매출 ${Math.round(adSales).toLocaleString('ko-KR')}원`)
    lines.push(`${label} ${parts.join(' · ')}`)
  }
  return lines.join('  |  ')
}
