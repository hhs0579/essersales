/**
 * 성능 개선 전 Vue 판매내역 표·엑셀과 동일한 행 도출.
 * SQL 사전필터가 아니라 applyRecordFilters / 반품 판정 / 정렬을 정답으로 사용한다.
 */
import { applyRecordFilters } from './recordFilters.js'
import { sortRecordsForTab } from './recordSort.js'
import { isReturnRecord } from './transactionType.js'
import { isEsserSheetTotalRecord } from './esserMetrics.js'
import { normalizeEsserDetailFields } from './formatDisplay.js'
import { applyDataCorrections } from './dataCorrections.js'
import { recordMatchesScopeCore } from './scopeFilter.js'
import { getSalesMethod } from './salesMethodDetect.js'
import {
  resolveRecordPlatform,
  normalizePlatformLabel,
} from './platformDetect.js'
import { isCombinedScope } from '../config/dataChannels.js'
import { POWER_PRICE_DATA_SOURCE_LABEL, isPowerPriceRecord } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord } from '../config/coupang1pRocket.js'
import { isOwnMallManualRecord } from '../config/ownMallManual.js'
import { isClosedMallRecord } from '../config/closedMall.js'

export const TABLE_SOURCE_MANUAL = '수기작성'
export const TABLE_SOURCE_OTHER_SELLERS = '기타 판매처'

export function tableSourceLabel(row, uploads = []) {
  if (!row) return ''
  if (isCoupang1pRocketRecord(row) || isOwnMallManualRecord(row)) return TABLE_SOURCE_MANUAL
  if (isClosedMallRecord(row) || recordMatchesScopeLegacy(row, 'other_sellers', uploads)) {
    return TABLE_SOURCE_OTHER_SELLERS
  }
  return String(row.dataSourceLabel || '').trim()
}

function assignTableSourceLabels(list, uploads = []) {
  return (list || []).map((row) => {
    if (isPowerPriceRecord(row) && row.dataSourceLabel) return row
    const label = tableSourceLabel(row, uploads)
    if (!label || row.dataSourceLabel === label) return row
    return { ...row, dataSourceLabel: label }
  })
}

export function includesOtherSellersInTable(scope) {
  return scope === 'platform' || scope === 'platform_monthly'
}

export function filterObjFromQuery(query = {}) {
  return {
    dateFrom: String(query.start_date || query.from || '').trim(),
    dateTo: String(query.end_date || query.to || '').trim(),
    platform: String(query.platform || '').trim(),
    salesMethod: String(query.sales_method || '').trim(),
    year: String(query.year || '').trim(),
    month: String(query.month || '').trim(),
    dayOfWeek: String(query.day_of_week ?? query.dayOfWeek ?? '').trim(),
    date: String(query.date || '').trim(),
    channel: String(query.channel || '').trim(),
    brand: String(query.brand || query.store_name || '').trim(),
    productName: String(query.product_name || '').trim(),
    option: String(query.option || query.option_name || '').trim(),
  }
}

function isMisroutedOwnMallDailyUpload(row, uploads = []) {
  const upload = uploads.find((u) => u.id === row.uploadId)
  const kind = upload?.uploadKind || row.uploadKind
  if (kind !== 'sales_daily_b') return false
  if (upload?.platform === '자사몰') return true
  const fileName = upload?.fileName || row.sourceFileName || ''
  if (/^기본[_\s-]?양식/i.test(String(fileName))) return true
  if (resolveRecordPlatform(row) === '자사몰') return true
  return false
}

export function recordMatchesScopeLegacy(row, scope, uploads = []) {
  return recordMatchesScopeCore(row, scope, {
    uploadKind: uploads.find((u) => u.id === row.uploadId)?.uploadKind,
    isMisroutedOwnMall: (r) => isMisroutedOwnMallDailyUpload(r, uploads),
  })
}

export function filterByScopeLegacy(list, scope, uploads = []) {
  return (list || []).filter((r) => recordMatchesScopeLegacy(r, scope, uploads))
}

function filterByScopeForTable(list, scope, uploads = []) {
  return (list || []).filter((r) => {
    if (recordMatchesScopeLegacy(r, scope, uploads)) return true
    if (includesOtherSellersInTable(scope) && recordMatchesScopeLegacy(r, 'other_sellers', uploads)) {
      return true
    }
    return false
  })
}

/** Vue loadDetailCache / normalizeLoadedDetailRow 와 동일 */
export function normalizeLegacyDetailRow(row, upload) {
  const normalized = normalizeEsserDetailFields(row)
  const platform = normalizePlatformLabel(
    resolveRecordPlatform(normalized, upload?.platform),
  )
  const delivery =
    normalized.deliveryMethod ||
    normalized.delivery_method ||
    normalized['배송구분'] ||
    ''
  const salesMethod = getSalesMethod({
    ...normalized,
    platform,
    deliveryMethod: delivery,
    sourceFileName: normalized.sourceFileName || upload?.fileName,
  })
  const {
    channelKind: _ck,
    channel_kind: _ck2,
    배송구분: _bg,
    importUnitCost: _iuc,
    import_unit_cost: _iuc2,
    ...rest
  } = normalized
  return { ...rest, platform, channel: platform, salesMethod, deliveryMethod: delivery }
}

function dataSourceLabelForRow(row, uploads = []) {
  if (isPowerPriceRecord(row)) return POWER_PRICE_DATA_SOURCE_LABEL
  if (isCoupang1pRocketRecord(row)) {
    const tagged = String(row.dataSourceLabel || '').trim()
    if (tagged === '사본느리' || row.coupang1pBrandKey === 'esser') return '사본느리'
    return '베스트하임'
  }
  if (
    recordMatchesScopeLegacy(row, 'platform', uploads) ||
    recordMatchesScopeLegacy(row, 'platform_monthly', uploads)
  ) {
    return '베스트하임'
  }
  if (
    recordMatchesScopeLegacy(row, 'company_b', uploads) ||
    recordMatchesScopeLegacy(row, 'company_b_monthly', uploads)
  ) {
    return '사본느리'
  }
  return ''
}

function tagCombinedSourceLabels(list, uploads = []) {
  return list.map((r) =>
    r.dataSourceLabel ? r : { ...r, dataSourceLabel: dataSourceLabelForRow(r, uploads) },
  )
}

/**
 * @param {object} opts
 * @param {object[]} opts.pgRecords  adaptPgRecordList 결과
 * @param {object[]} [opts.uploads]
 * @param {object[]} [opts.manualRecords] enrichExportRecords 가 붙인 수기 행
 * @param {string} opts.scope
 * @param {'detail'|'returns'|string} opts.tab
 * @param {object} opts.filters applyRecordFilters 형식
 */
export function buildLegacyTableRows({
  pgRecords = [],
  uploads = [],
  manualRecords = [],
  scope,
  tab = 'detail',
  filters = {},
}) {
  const uploadById = new Map((uploads || []).map((u) => [u.id, u]))
  let list = (pgRecords || []).map((row) =>
    normalizeLegacyDetailRow(row, uploadById.get(row.uploadId)),
  )
  list = filterByScopeForTable(list, scope, uploads)
  list = [...list, ...(manualRecords || [])]
  list = assignTableSourceLabels(list, uploads)
  if (isCombinedScope(scope)) {
    list = tagCombinedSourceLabels(list, uploads)
  }
  list = applyDataCorrections(list, scope, filters)

  const split =
    tab === 'returns'
      ? list.filter((r) => isReturnRecord(r))
      : list.filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r))

  const tFilter = performance.now()
  const filtered = applyRecordFilters(
    split,
    tab === 'returns' ? 'returns' : tab,
    filters,
  )
  const tSort = performance.now()
  const sorted = sortRecordsForTab(filtered, tab === 'returns' ? 'returns' : tab)
  buildLegacyTableRows.lastTimings = {
    applyRecordFilters: Math.round(tSort - tFilter),
    sortRecordsForTab: Math.round(performance.now() - tSort),
  }
  return sorted
}

export function paginateLegacyTableRows(rows, page = 1, limit = 100) {
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil((total || 0) / (limit || 1)))
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages)
  const start = (p - 1) * limit
  return {
    items: rows.slice(start, start + limit),
    pagination: { page: p, limit, total, totalPages },
  }
}

export function collectReturnRows({
  pgRecords = [],
  uploads = [],
  manualRecords = [],
  scope,
  filters = {},
}) {
  return buildLegacyTableRows({
    pgRecords,
    uploads,
    manualRecords,
    scope,
    tab: 'returns',
    filters,
  })
}
