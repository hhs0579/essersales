import { parseSalesDate } from './dateParse.js'
import { getSalesMethod } from './salesMethodDetect.js'
import { resolveRecordPlatform, normalizePlatformLabel } from './platformDetect.js'
import { isEsserDetailSummaryRecord } from './coupangEsserParser.js'
import { isEsserSheetTotalRecord } from './esserMetrics.js'
import { isClosedMallRecord } from '../config/closedMall.js'

/** Firestore에 contextDate만 있는 구 데이터 호환 */
export function normalizeRecord(row) {
  if (!row) return row
  if (!row.date && row.contextDate) {
    return { ...row, date: row.contextDate }
  }
  return row
}

export function getRecordDate(row) {
  const r = normalizeRecord(row)
  return r.date || r.contextDate || ''
}

/** 일별 집계용 — date 없을 때 businessDate·periodFrom 등 폴백 */
export function resolveRecordDateForAggregation(row) {
  const r = normalizeRecord(row)
  const direct = String(r.date || r.contextDate || '').trim()
  if (direct) return direct
  const bd = String(r.businessDate || '').trim()
  if (bd && !bd.includes('~')) return bd
  const from = String(r.periodFrom || '').trim()
  const to = String(r.periodTo || '').trim()
  if (from && (!to || from === to)) return from
  return ''
}

/** 판매처/상품 집계표는 행마다 날짜가 없을 수 있음 → 날짜 없으면 기간 필터에서 제외하지 않음 */
const SUMMARY_TABS = new Set(['channel', 'product', 'productOption'])

function ymdToTime(ymd, endOfDay = false) {
  if (!ymd) return null
  const parts = String(ymd).split('-').map((x) => parseInt(x, 10))
  if (parts.length < 3 || !parts[0]) return null
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  if (endOfDay) date.setHours(23, 59, 59, 999)
  else date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function normalizeDateYmd(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'string') {
    const s = val.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    const p = parseSalesDate(s)
    return p ? formatYmd(p.year, p.month, p.day) : ''
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return formatYmd(val.getFullYear(), val.getMonth() + 1, val.getDate())
  }
  const p = parseSalesDate(String(val))
  return p ? formatYmd(p.year, p.month, p.day) : ''
}

/** KPI summary·export 기간 필터와 동일 — order_date 우선 */
function resolveKpiCompatYmd(row) {
  const r = normalizeRecord(row)
  const order = normalizeDateYmd(r.orderDate || r.order_date)
  if (order) return order
  const bd = normalizeDateYmd(r.businessDate || r.business_date)
  if (bd) return bd
  if (r.periodFrom) {
    const pf = normalizeDateYmd(r.periodFrom)
    const pt = normalizeDateYmd(r.periodTo || r.periodFrom)
    if (pf && (!r.periodTo || pf === pt)) return pf
  }
  const direct = String(r.date || r.contextDate || '').trim()
  if (direct) return normalizeDateYmd(direct)
  return ''
}

function getRecordYmdBounds(row) {
  const r = normalizeRecord(row)
  // 특판: 행 order_date만 — 업로드 period(8/1~8/31)로 일별 필터에 월 전체가 걸리는 것 방지
  if (isClosedMallRecord(r)) {
    const ymd = resolveKpiCompatYmd(r)
    if (!ymd) return null
    return { from: ymd, to: ymd }
  }
  if (r.periodFrom && r.periodTo) {
    return { from: r.periodFrom, to: r.periodTo }
  }
  const ymd = resolveKpiCompatYmd(r)
  if (!ymd) return null
  return { from: ymd, to: ymd }
}

/** 연·월·요일·날짜범위 등 기간 조건이 켜져 있는지 */
export function hasActivePeriodFilter(filters = {}) {
  if (filters.dateFrom || filters.dateTo) return true
  if (filters.year) return true
  if (filters.month) return true
  if (filters.dayOfWeek !== '' && filters.dayOfWeek != null) return true
  return false
}

/**
 * 기간 필터 KPI — 상품 행은 날짜 필터, 엑셀 합계 행은
 * (1) 날짜가 기간과 겹치거나 (2) 같은 업로드에 기간 내 상품 행이 있으면 광고 집계용 유지
 */
export function excludeEsserSheetTotalsForPeriodKpi(records, filters) {
  return applyKpiDetailFilters(records, filters)
}

/**
 * KPI·대시보드 상세 — 상품 행 기간 필터 + 업로드 연동 엑셀 합계(광고) 행 유지
 * @param {object[]} records
 * @param {object} filters
 */
export function applyKpiDetailFilters(records, filters = {}) {
  const normalized = (records || [])
    .map(normalizeRecord)
    .filter((r) => !isEsserDetailSummaryRecord(r))

  const productRows = normalized.filter((r) => !isEsserSheetTotalRecord(r))
  const sheetRows = normalized.filter((r) => isEsserSheetTotalRecord(r))
  const filteredProducts = applyRecordFilters(productRows, 'detail', filters)

  if (!hasActivePeriodFilter(filters)) {
    return [...filteredProducts, ...sheetRows]
  }

  const uploadKeys = new Set()
  for (const r of filteredProducts) {
    const key = r.uploadId || r.sourceFileName || ''
    if (key) uploadKeys.add(key)
  }

  const keptSheets = sheetRows.filter((r) => {
    if (matchDateRangeFilter(r, filters.dateFrom, filters.dateTo)) return true
    const key = r.uploadId || r.sourceFileName || ''
    return Boolean(key && uploadKeys.has(key))
  })

  return [...filteredProducts, ...keptSheets]
}

/** YYYY-MM-DD 범위 (캘린더) — 일별·기간(periodFrom/To) 겹침 */
export function matchDateRangeFilter(row, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true
  const bounds = getRecordYmdBounds(row)
  if (!bounds) return false
  const rowFromT = ymdToTime(bounds.from, false)
  const rowToT = ymdToTime(bounds.to, true)
  const fromT = ymdToTime(dateFrom, false)
  const toT = ymdToTime(dateTo, true)
  if (fromT != null && rowToT != null && rowToT < fromT) return false
  if (toT != null && rowFromT != null && rowFromT > toT) return false
  return true
}

export function formatYmd(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function collectDateBounds(rows) {
  let min = ''
  let max = ''
  for (const row of rows) {
    const bounds = getRecordYmdBounds(row)
    if (bounds) {
      if (!min || bounds.from < min) min = bounds.from
      if (!max || bounds.to > max) max = bounds.to
      continue
    }
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    const ymd = formatYmd(p.year, p.month, p.day)
    if (!min || ymd < min) min = ymd
    if (!max || ymd > max) max = ymd
  }
  return { min, max }
}

function monthOverlapsPeriod(month, year, fromYmd, toYmd) {
  const y = parseInt(year, 10)
  const m = parseInt(month, 10)
  if (!y || !m) return true
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0, 23, 59, 59, 999)
  const fromT = ymdToTime(fromYmd, false)
  const toT = ymdToTime(toYmd, true)
  if (fromT == null || toT == null) return false
  return start.getTime() <= toT && end.getTime() >= fromT
}

export function matchPeriodFilter(row, { year, month, dayOfWeek }, tab = 'detail') {
  const r = normalizeRecord(row)
  const bounds = getRecordYmdBounds(r)

  if (!isClosedMallRecord(r) && bounds && r.periodFrom && r.periodTo) {
    if (dayOfWeek !== '') return true
    if (year) {
      const y = parseInt(year, 10)
      const fromY = parseInt(String(bounds.from).slice(0, 4), 10)
      const toY = parseInt(String(bounds.to).slice(0, 4), 10)
      if (y < fromY || y > toY) return false
    }
    if (month && year) {
      if (!monthOverlapsPeriod(month, year, bounds.from, bounds.to)) return false
    }
    return true
  }

  const parsed = parseSalesDate(getRecordDate(row))

  if (!parsed) {
    if (SUMMARY_TABS.has(tab)) return true
    return !year && !month && dayOfWeek === ''
  }

  if (year && String(parsed.year) !== String(year)) return false
  if (month && String(parsed.month) !== String(month)) return false
  if (dayOfWeek !== '' && String(parsed.dayOfWeek) !== String(dayOfWeek)) return false
  return true
}

export function collectYears(rows) {
  const set = new Set()
  for (const row of rows) {
    const bounds = getRecordYmdBounds(row)
    if (bounds?.from) {
      const fromY = parseInt(String(bounds.from).slice(0, 4), 10)
      const toY = parseInt(String(bounds.to || bounds.from).slice(0, 4), 10)
      if (fromY) {
        for (let y = fromY; y <= (toY || fromY); y += 1) set.add(y)
      }
      continue
    }
    const p = parseSalesDate(getRecordDate(row))
    if (p) set.add(p.year)
  }
  return [...set].sort((a, b) => b - a)
}

function includesField(row, field, query) {
  if (!query) return true
  const val = row[field]
  if (val == null || val === '') return false
  return String(val).includes(query)
}

/** 전일·전주 대비 — 조회 기간은 manualFilterCtx로만, 행은 업로드 전체 기준 */
export function filtersForDayOverDayLookup(filters = {}) {
  return {
    ...filters,
    platform: '',
    salesMethod: '',
    dateFrom: '',
    dateTo: '',
    year: '',
    month: '',
    dayOfWeek: '',
    date: '',
    channel: '',
    brand: '',
    productName: '',
    option: '',
  }
}

export function applyRecordFilters(list, tab, filters) {
  let result = list.map(normalizeRecord).filter((r) => !isEsserDetailSummaryRecord(r))

  const hasDateRange = Boolean(filters.dateFrom || filters.dateTo)
  if (hasDateRange && !SUMMARY_TABS.has(tab)) {
    result = result.filter((r) => matchDateRangeFilter(r, filters.dateFrom, filters.dateTo))
  }

  const dayOfWeek =
    filters.dayOfWeek === '' || filters.dayOfWeek == null
      ? ''
      : String(filters.dayOfWeek)
  const hasPeriod = Boolean(filters.year || filters.month || dayOfWeek !== '')
  if (hasPeriod) {
    result = result.filter((r) =>
      matchPeriodFilter(
        r,
        {
          year: filters.year,
          month: filters.month,
          dayOfWeek,
        },
        tab,
      ),
    )
  }

  if (filters.platform) {
    const want = normalizePlatformLabel(filters.platform)
    result = result.filter((r) => resolveRecordPlatform(r) === want)
  }

  if (filters.salesMethod) {
    result = result.filter((r) => getSalesMethod(r) === filters.salesMethod)
  }

  switch (tab) {
    case 'detail':
    case 'returns':
      result = result.filter((r) => includesField(r, 'date', filters.date))
      result = result.filter((r) => includesField(r, 'channel', filters.channel))
      result = result.filter((r) => includesField(r, 'brand', filters.brand))
      result = result.filter((r) => includesField(r, 'productName', filters.productName))
      break
    case 'daily':
      result = result.filter((r) => includesField(r, 'date', filters.date))
      break
    case 'channel':
      result = result.filter((r) => includesField(r, 'channel', filters.channel))
      break
    case 'product':
      result = result.filter((r) => includesField(r, 'productName', filters.productName))
      break
    case 'productOption':
      result = result.filter((r) => includesField(r, 'productName', filters.productName))
      result = result.filter((r) => includesField(r, 'option', filters.option))
      break
    default:
      break
  }

  return result
}
