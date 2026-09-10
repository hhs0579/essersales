import { ref, computed, unref, watch } from 'vue'
import {
  RECORD_TYPES,
  resolveDetailColumns,
  sanitizeDetailColumns,
  resolveSummaryColumns,
  isEsserDetailRow,
  SERVER_PAGED_TABLE_TABS,
} from '../constants/salesColumns'
import { WEEKDAY_LABELS } from '../utils/dateParse.js'
import {
  applyRecordFilters,
  collectYears,
  excludeEsserSheetTotalsForPeriodKpi,
  filtersForDayOverDayLookup,
  hasActivePeriodFilter,
} from '../utils/recordFilters.js'
import { buildDailySummaryFromDetails, buildSummaryTabFromDetails } from '../utils/salesAggregation.js'
import { esserBucketsToDailyTabRows, isEsserSheetTotalRecord } from '../utils/esserMetrics.js'
import {
  aggregateEsserByDayWithManual,
  aggregateEsserByDayWithManualSpendOnly,
  aggregateEsserByMonthWithManual,
  aggregateCombinedByDayWithManual,
} from '../utils/manualAdSpend.js'
import { sortRecordsForTab } from '../utils/recordSort.js'
import {
  saveSalesReportUpload,
  fetchSalesRecords,
  fetchSalesRecordsPage,
  fetchRecordsByUploadIds,
  fetchUploads,
  updateSalesRecord,
  deleteSalesRecord,
  deleteUploadAndRecords,
  fetchKpiSummary,
  fetchKpiDaily,
  fetchKpiByPlatform,
  fetchKpiBySegment,
  fetchKpiCompareYesterday,
} from '../services/salesApi.js'
import { pgDownloadTableExport } from '../services/apiClient.js'
import { downloadMergedSalesReport, mergedFileName, dateRangeLabel } from '../utils/salesReportExporter.js'
import { FEATURES } from '../config/features.js'
import {
  allDataScopes,
  getChannel,
  getChannelByScope,
  getDashboardChannels,
  getMode,
  uploadKindsForScope,
  uploadKindsForChannel,
  getModeByUploadKind,
  usesEsserDashboard,
  isChannelUploadKind,
  LEGACY_BESTHEIM_UPLOAD_KINDS,
  DEPRECATED_PERIOD_UPLOAD_KINDS,
  MONTHLY_UPLOAD_KINDS,
  isMonthlyScope,
  dailyScopeForMonthly,
  isCombinedScope,
  isManualOnlyChannel,
  isCombinedCommentsChannel,
} from '../config/dataChannels.js'
import {
  EXTERNAL_AD_CHANNELS,
  resolveExternalAdScope,
  findExternalAdChannelByScope,
} from '../config/externalAdChannels.js'
import { INTEGRATED_REPORT_LAYOUT_VER } from '../utils/profitLossReportExporter.js'
import { UI_BUILD_ID } from '../constants/appVersion.js'
import { getSpecialSaleSnapshot, getSpecialSaleMonthlyMap, getSpecialSaleReactiveStore, getSpecialSaleSettingPayload } from '../composables/useSpecialSale.js'
import {
  getManualExpenseSnapshot,
  getManualExpenseSettingPayload,
} from '../composables/useManualExpense.js'
import {
  addMonthsToMonthKey,
  buildSpecialSaleMonthlyTotals,
  resolveReferenceMonthKey,
} from '../utils/dayOverDaySales.js'
import { getManualAdSnapshot, hydrateManualAdForScope } from '../composables/useManualAdSpend.js'
import { getPowerPriceDetailRecords, powerPriceDetailRecords } from '../composables/usePowerPrice.js'
import { coupang1pRocketDetailRecords } from '../composables/useCoupang1pRocket.js'
import { ownMallManualDetailRecords } from '../composables/useOwnMallManual.js'
import { hydrateAppSettings } from '../composables/hydrateAppSettings.js'
import { getProfitLossTemplateSnapshot } from '../composables/useProfitLossTemplate.js'
import { POWER_PRICE_SCOPE } from '../config/powerPrice.js'
import { COUPANG_1P_ROCKET_SCOPE } from '../config/coupang1pRocket.js'
import { normalizeEsserDetailFields } from '../utils/formatDisplay.js'
import { recordMatchesScopeCore } from '../utils/scopeFilter.js'
import {
  detectSalesMethodFromFileName,
  getSalesMethod,
} from '../utils/salesMethodDetect.js'
import {
  resolveRecordPlatform,
  resolveUploadPlatform,
  normalizePlatformLabel,
} from '../utils/platformDetect.js'
import { isReturnRecord, partitionSalesAndReturns } from '../utils/transactionType.js'
import { applyDataCorrections } from '../utils/dataCorrections.js'
import { defaultReportDateRange } from '../utils/reportDateRange.js'
import {
  COMBINED_HIDDEN_KPI_KEYS,
  combinedIncludesPowerPrice,
  combinedManualAdScopes,
} from '../config/combinedChannel.js'
import {
  POWER_PRICE_HIDDEN_KPI_KEYS,
  POWER_PRICE_DATA_SOURCE_LABEL,
  isPowerPriceRecord,
} from '../config/powerPrice.js'
import {
  COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS,
  isCoupang1pRocketRecord,
} from '../config/coupang1pRocket.js'
import { isServerKpi, isLazyDetailLoad } from '../services/kpiSource.js'
import {
  shouldMergeOwnMallManualKpi,
  mergeOwnMallManualIntoServerPlatformRows,
  mergeOwnMallIntoServerKpiBucket,
  mergeOwnMallManualIntoDailyBuckets,
  buildOwnMallPlatformRow,
  mergeOwnMallIntoCombinedSegmentRows,
  mergeSpecialSaleIntoCombinedSegmentRows,
  mergeManualExpenseIntoCombinedSegmentRows,
  buildOwnMallKpiFilterCtx,
} from '../services/adapters/ownMallKpiMerge.js'
import {
  shouldMergePowerPriceKpi,
  buildPowerPriceKpiRow,
  mergePowerPriceIntoServerKpiBucket,
} from '../services/adapters/powerPriceKpiMerge.js'
import {
  shouldMergeCoupang1pKpi,
  buildCoupang1pPlatformRow,
  mergeCoupang1pIntoServerKpiBucket,
  mergeCoupang1pIntoDailyBuckets,
  mergeCoupang1pIntoServerPlatformRows,
  mergeCoupang1pIntoCombinedSegmentRows,
  filterCoupang1pRecordsByBrand,
} from '../services/adapters/coupang1pKpiMerge.js'
import {
  reshapeBestheimKpiRowsToCombined구분,
  esserBucketFromPlatformKpiRow,
} from '../utils/platformKpiSplit.js'
import { isPgExportMode, pgDownloadIntegratedExport, triggerBlobDownload } from '../services/exportApi.js'
import {
  buildKpiQueryFromFilters,
  adaptServerKpiToEsserBucket,
  adaptServerDailyToChartBuckets,
} from '../services/adapters/kpiAdapter.js'
import {
  adaptServerPlatformKpiRows,
  adaptServerSegmentKpiRows,
  adaptServerDayOverDayRows,
  buildFallbackPlatformRowsFromSummary,
} from '../services/adapters/platformKpiAdapter.js'
import { createTtlCache } from '../utils/ttlCache.js'

/** @typedef {import('../config/dataChannels.js').DataChannel['modes'][0]['scope'] | 'sales_report'} DataScope */

const KPI_CACHE_TTL_MS = 45000
const serverKpiResultCache = createTtlCache(KPI_CACHE_TTL_MS)
/** @type {Map<string, number>} */
const kpiRequestSequenceByScope = new Map()
/** @type {Map<string, AbortController>} */
const kpiAbortByScope = new Map()
/** @type {Map<string, string>} */
const kpiLastCacheKeyByScope = new Map()

function buildServerKpiCacheKey(scope, query) {
  const parts = [
    'kpi',
    scope || '',
    query.from || '',
    query.to || '',
    query.date || '',
    query.month || '',
    query.platform || '',
    query.sales_method || '',
    query.store_name || '',
    query.include_manual_ads || '',
  ]
  return parts.join(':')
}

function invalidateServerKpiCaches(scope) {
  if (scope) {
    serverKpiResultCache.invalidate((key) => key.startsWith(`kpi:${scope}:`))
    return
  }
  serverKpiResultCache.invalidate()
}

const initialized = ref(false)
const detailCacheLoaded = ref(false)
const detailCacheLoading = ref(false)
const detailCacheError = ref('')
const detailCacheLoadedAt = ref(null)
/** detail 캐시 버전 — 업로드 성공 시 증가 */
let detailCacheVersion = 0
/** @type {Promise<void> | null} */
let detailCachePromise = null
/** 현재 로드된 detail 캐시 버전 */
let detailCacheLoadedVersion = -1
const dailyCacheLoaded = ref(false)
const channelCacheLoaded = ref(false)
const productCacheLoaded = ref(false)
const productOptionCacheLoaded = ref(false)
const TABLE_PAGE_LIMIT = 100

const detailRecords = ref([])
const dailyRecords = ref([])
const channelRecords = ref([])
const productRecords = ref([])
const productOptionRecords = ref([])
const uploads = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')
const editOpen = ref(false)
const editingRecord = ref(null)

function createDefaultFilters() {
  const { dateFrom, dateTo } = defaultReportDateRange()
  return {
    year: '',
    month: '',
    dayOfWeek: '',
    dateFrom,
    dateTo,
    date: '',
    platform: '',
    salesMethod: '',
    channel: '',
    brand: '',
    productName: '',
    option: '',
  }
}

function createScopeSlice() {
  return {
    activeTab: ref('detail'),
    filters: ref(createDefaultFilters()),
    chartMetric: ref('revenue'),
    selectedUploadIds: ref([]),
    records: ref([]),
    tablePageRecords: ref([]),
    tablePagination: ref({ page: 1, limit: TABLE_PAGE_LIMIT, total: 0, totalPages: 0 }),
    tableSaleTotal: ref(0),
    tableReturnTotal: ref(0),
    tableLoading: ref(false),
    serverKpiBucket: ref(null),
    serverDailyChartBuckets: ref([]),
    serverPlatformKpiRows: ref([]),
    /** 통합 월별 전월대비 — 전월 by-segment (특판 merge 후) */
    serverPrevMonthPlatformKpiRows: ref([]),
    serverDayOverDayRows: ref([]),
    serverKpiLoaded: ref(false),
  }
}

const scopeSlices = Object.fromEntries(allDataScopes().map((scope) => [scope, createScopeSlice()]))

export function uploadSalesMethod(u) {
  if (u.salesMethod) return u.salesMethod
  const fromFile = detectSalesMethodFromFileName(u.fileName)
  if (!fromFile) return ''
  const platform = resolveUploadPlatform(u.fileName, u.platform)
  return getSalesMethod({ platform, salesMethod: fromFile, sourceFileName: u.fileName })
}

/** 일별 업로드에 잘못 올린 자사몰(기본_양식) — KPI·표에서 제외 */
function isMisroutedOwnMallDailyUpload(row) {
  const upload = uploads.value.find((u) => u.id === row.uploadId)
  const kind = upload?.uploadKind || row.uploadKind
  if (kind !== 'sales_daily_b') return false
  if (upload?.platform === '자사몰') return true
  const fileName = upload?.fileName || row.sourceFileName || ''
  if (/^기본[_\s-]?양식/i.test(String(fileName))) return true
  if (resolveRecordPlatform(row) === '자사몰') return true
  return false
}

export function recordMatchesScope(row, scope) {
  const upload = uploads.value.find((u) => u.id === row.uploadId)
  return recordMatchesScopeCore(row, scope, {
    uploadKind: upload?.uploadKind,
    isMisroutedOwnMall: isMisroutedOwnMallDailyUpload,
  })
}

export function filterByScope(list, scope) {
  return (list || []).filter((r) => recordMatchesScope(r, scope))
}

function dataSourceLabelForRow(row) {
  if (isPowerPriceRecord(row)) return POWER_PRICE_DATA_SOURCE_LABEL
  if (isCoupang1pRocketRecord(row)) {
    const tagged = String(row.dataSourceLabel || '').trim()
    if (tagged) return tagged
    if (row.coupang1pBrandKey === 'esser' || row.brand === '에쎄르') return '사본느리'
    return '베스트하임'
  }
  if (recordMatchesScope(row, 'platform') || recordMatchesScope(row, 'platform_monthly')) {
    return '베스트하임'
  }
  if (recordMatchesScope(row, 'company_b') || recordMatchesScope(row, 'company_b_monthly')) {
    return '사본느리'
  }
  return ''
}

function mergePowerPriceForCombined(list, scope) {
  if (!combinedIncludesPowerPrice(scope)) return list
  const ppRows = powerPriceDetailRecords.value.map((r) => ({
    ...r,
    dataSourceLabel: POWER_PRICE_DATA_SOURCE_LABEL,
  }))
  return [...list, ...ppRows]
}

/** 쿠팡 1P 로켓 발주 — 베스트하임(platform)·사본느리(company_b)·통합 KPI 반영 */
function mergeCoupang1pRocketForScope(list, scope) {
  const all = coupang1pRocketDetailRecords.value
  if (!all.length) return list
  if (isCombinedScope(scope)) return [...list, ...all]
  if (scope === 'platform' || scope === 'platform_monthly') {
    const rows = filterCoupang1pRecordsByBrand(all, 'bestheim')
    if (!rows.length) return list
    return [...list, ...rows]
  }
  if (scope === 'company_b' || scope === 'company_b_monthly') {
    const rows = filterCoupang1pRecordsByBrand(all, 'esser')
    if (!rows.length) return list
    return [...list, ...rows]
  }
  return list
}

/** 사본느리 자사몰 직접입력 — company_b·통합 KPI 반영 */
function mergeOwnMallManualForScope(list, scope) {
  if (scope !== 'company_b' && scope !== 'company_b_monthly' && !isCombinedScope(scope)) {
    return list
  }
  const rows = ownMallManualDetailRecords.value
  if (!rows.length) return list
  return [...list, ...rows]
}

function tagCombinedSourceLabels(list) {
  return list.map((r) =>
    r.dataSourceLabel ? r : { ...r, dataSourceLabel: dataSourceLabelForRow(r) },
  )
}

function combinedManualAdChannelGroups(scope) {
  // 월별 통합도 일별 데이터 기반이므로 광고는 항상 일별 scope에서 조회 (일별=월별 동일)
  return EXTERNAL_AD_CHANNELS.filter((ch) =>
    combinedIncludesPowerPrice(scope) ? true : ch.dailyScope !== 'power_price',
  ).map((ch) => ({
    label: ch.label,
    entries: getManualAdSnapshot(resolveExternalAdScope(ch, 'daily')),
  }))
}

function applyUploadScope(list, selectedIds) {
  const ids = unref(selectedIds)
  if (!ids?.length) return list
  const set = new Set(ids)
  return list.filter((r) => set.has(r.uploadId))
}

function getSlice(scope) {
  return scopeSlices[scope]
}

function uploadsByKind(scope) {
  if (isCombinedScope(scope)) {
    return uploads.value.filter((u) =>
      recordMatchesScope(
        { uploadKind: u.uploadKind, uploadId: u.id, uploadFormat: '' },
        scope,
      ),
    )
  }
  const set = new Set(uploadKindsForScope(scope))
  return uploads.value.filter((u) => set.has(u.uploadKind))
}

function uploadsForChannel(channelId) {
  const kinds = new Set(uploadKindsForChannel(channelId))
  const bKinds = new Set(uploadKindsForChannel('channel_b'))
  const isBestheim = channelId === 'channel_a'
  return uploads.value.filter((u) => {
    if (isBestheim) {
      if (bKinds.has(u.uploadKind)) return false
      if (kinds.has(u.uploadKind)) return true
      if (DEPRECATED_PERIOD_UPLOAD_KINDS.has(u.uploadKind)) return true
      if (LEGACY_BESTHEIM_UPLOAD_KINDS.has(u.uploadKind || 'sales_report')) return true
      return false
    }
    return kinds.has(u.uploadKind)
  })
}

function detailsForSummaryAggregation(scope, slice) {
  let details
  if (scope === POWER_PRICE_SCOPE) {
    details = powerPriceDetailRecords.value
  } else if (scope === COUPANG_1P_ROCKET_SCOPE) {
    details = coupang1pRocketDetailRecords.value
  } else {
    details = applyUploadScope(filterByScope(detailRecords.value, scope), slice.selectedUploadIds)
    if (isCombinedScope(scope)) {
      details = mergePowerPriceForCombined(details, scope)
    }
    details = mergeOwnMallManualForScope(details, scope)
    details = mergeCoupang1pRocketForScope(details, scope)
    if (isCombinedScope(scope)) {
      details = tagCombinedSourceLabels(details)
    }
    details = applyDataCorrections(details, scope, slice.filters.value)
  }
  const salesOnly = details.filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r))
  const sheetTotals = details.filter((r) => isEsserSheetTotalRecord(r))
  const f = slice.filters.value
  const hasFilter =
    f.year ||
    f.month ||
    f.dayOfWeek !== '' ||
    f.dateFrom ||
    f.dateTo ||
    f.platform ||
    f.salesMethod
  if (!hasFilter) return [...salesOnly, ...sheetTotals]
  const filteredSales = applyRecordFilters(salesOnly, 'detail', {
    year: f.year,
    month: f.month,
    dayOfWeek: f.dayOfWeek,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    platform: f.platform,
    salesMethod: f.salesMethod,
    date: '',
    channel: '',
    brand: '',
    productName: '',
    option: '',
  })
  const filteredTotals = applyRecordFilters(sheetTotals, 'detail', {
    year: f.year,
    month: f.month,
    dayOfWeek: f.dayOfWeek,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    platform: f.platform,
    salesMethod: f.salesMethod,
    date: '',
    channel: '',
    brand: '',
    productName: '',
    option: '',
  })
  if (hasActivePeriodFilter(f)) return filteredSales
  return [...filteredSales, ...filteredTotals]
}

function normalizeLoadedDetailRow(row, uploadById) {
  const upload = uploadById.get(row.uploadId)
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

async function loadDetailCache() {
  // 통합 세그먼트 KPI는 data JSONB 필드(원가·특판·시트총합 등)가 필요.
  // lean은 필드를 빼 이전화면과 숫자가 달라지므로 full 유지.
  const fetched = await fetchSalesRecords('detail', { includeData: 'full' })
  const uploadById = new Map(uploads.value.map((u) => [u.id, u]))
  detailRecords.value = fetched.map((row) => normalizeLoadedDetailRow(row, uploadById))
}

async function loadDailyCache() {
  try {
    dailyRecords.value = await fetchSalesRecords('daily')
  } catch {
    dailyRecords.value = []
  }
}

async function loadChannelCache() {
  try {
    channelRecords.value = await fetchSalesRecords('channel')
  } catch {
    channelRecords.value = []
  }
}

async function loadProductCache() {
  try {
    productRecords.value = await fetchSalesRecords('product')
  } catch {
    productRecords.value = []
  }
}

async function loadProductOptionCache() {
  try {
    productOptionRecords.value = await fetchSalesRecords('productOption')
  } catch {
    productOptionRecords.value = []
  }
}

function buildTableListQuery(scope, slice, { page, tab } = {}) {
  const f = slice.filters.value
  const activeTab = tab || slice.activeTab.value
  const recordType =
    activeTab === 'returns' || activeTab === 'detail' || SERVER_PAGED_TABLE_TABS.has(activeTab)
      ? 'detail'
      : activeTab
  const pageNo = Number(page) || slice.tablePagination.value.page || 1
  const q = {
    page: pageNo,
    limit: TABLE_PAGE_LIMIT,
    scope,
    includeData: 'full',
    view: 'table',
    tab: activeTab,
    sort:
      activeTab === 'detail' || activeTab === 'returns' || activeTab === 'daily'
        ? 'order_date'
        : 'sales',
    order:
      activeTab === 'detail' || activeTab === 'returns' || activeTab === 'daily'
        ? 'asc'
        : 'desc',
    start_date: f.dateFrom || '',
    end_date: f.dateTo || '',
    platform: f.platform || '',
    sales_method: f.salesMethod || '',
    brand: f.brand || '',
    channel: f.channel || '',
    product_name: f.productName || '',
    option: f.option || '',
    date: f.date || '',
    year: f.year || '',
    month: f.month || '',
    day_of_week:
      f.dayOfWeek !== '' && f.dayOfWeek != null ? String(f.dayOfWeek) : '',
  }
  if (activeTab === 'detail') q.row_kind = 'sale'
  if (activeTab === 'returns') q.row_kind = 'return'
  const ids = slice.selectedUploadIds.value
  if (ids.length) q.upload_ids = ids.join(',')
  return { recordType, q, activeTab }
}

function mergeManualsIntoTablePage(pageItems, scope, tab, filters) {
  let extra = []
  extra = mergeCoupang1pRocketForScope(extra, scope)
  extra = mergeOwnMallManualForScope(extra, scope)
  extra = mergePowerPriceForCombined(extra, scope)
  extra = applyRecordFilters(extra, tab === 'returns' ? 'returns' : 'detail', {
    year: filters.year,
    month: filters.month,
    dayOfWeek: filters.dayOfWeek,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    date: filters.date,
    platform: filters.platform,
    salesMethod: filters.salesMethod,
    channel: filters.channel,
    brand: filters.brand,
    productName: filters.productName,
    option: filters.option,
  })
  extra =
    tab === 'returns'
      ? extra.filter((r) => isReturnRecord(r))
      : extra.filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r))
  if (!extra.length) return pageItems
  return sortRecordsForTab([...extra, ...pageItems], tab)
}

function clientPaginate(list, page, limit) {
  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1)
  const p = Math.min(Math.max(1, page), totalPages)
  const start = (p - 1) * limit
  return {
    items: list.slice(start, start + limit),
    pagination: { page: p, limit, total, totalPages },
  }
}

async function loadTablePageForScope(scope, { page, silent = false } = {}) {
  const slice = getSlice(scope)
  const { recordType, q, activeTab } = buildTableListQuery(scope, slice, { page })
  if (!silent) slice.tableLoading.value = true
  try {
    if (scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE) {
      const local =
        scope === POWER_PRICE_SCOPE
          ? powerPriceDetailRecords.value
          : coupang1pRocketDetailRecords.value
      const filtered = applyRecordFilters(local, activeTab, slice.filters.value).filter((r) =>
        activeTab === 'returns'
          ? isReturnRecord(r)
          : !isReturnRecord(r) && !isEsserSheetTotalRecord(r),
      )
      const sorted = sortRecordsForTab(filtered, activeTab)
      const paged = clientPaginate(sorted, q.page, TABLE_PAGE_LIMIT)
      slice.tablePageRecords.value = paged.items
      slice.tablePagination.value = paged.pagination
      slice.records.value = paged.items
      if (activeTab === 'returns') slice.tableReturnTotal.value = paged.pagination.total
      else slice.tableSaleTotal.value = paged.pagination.total
      return
    }

    const res = await fetchSalesRecordsPage(recordType, q)
    const uploadById = new Map(uploads.value.map((u) => [u.id, u]))
    const items = (res.items || []).map((row) =>
      activeTab === 'detail' || activeTab === 'returns'
        ? normalizeLoadedDetailRow(row, uploadById)
        : row,
    )
    slice.tablePageRecords.value = items
    slice.tablePagination.value = res.pagination || {
      page: q.page,
      limit: TABLE_PAGE_LIMIT,
      total: res.total || items.length,
      totalPages: 1,
    }
    slice.records.value = items
    if (activeTab === 'returns') {
      slice.tableReturnTotal.value = res.pagination?.total || 0
    } else if (activeTab === 'detail') {
      slice.tableSaleTotal.value = res.pagination?.total || 0
      slice.tableReturnTotal.value = res.pagination?.returnTotal || 0
    }
  } catch (e) {
    slice.tablePageRecords.value = []
    slice.records.value = []
    if (!silent) error.value = `판매내역 불러오기 실패: ${e.message}`
    throw e
  } finally {
    if (!silent) slice.tableLoading.value = false
  }
}

async function loadRecordsForScope(scope, { silent = false } = {}) {
  const slice = getSlice(scope)
  const tab = slice.activeTab.value

  if (SERVER_PAGED_TABLE_TABS.has(tab)) {
    await loadTablePageForScope(scope, { silent })
    return
  }

  if (!silent) {
    loading.value = true
    error.value = ''
  }
  try {
    await ensureTabAggregateCache(tab)
    const source =
      tab === 'daily'
        ? dailyRecords.value
        : tab === 'channel'
          ? channelRecords.value
          : tab === 'product'
            ? productRecords.value
            : productOptionRecords.value
    slice.records.value = applyUploadScope(
      filterByScope(source, scope),
      slice.selectedUploadIds,
    )
  } catch (e) {
    if (!silent) error.value = `데이터 불러오기 실패: ${e.message}`
    slice.records.value = []
  } finally {
    if (!silent) loading.value = false
  }
}

async function loadUploads() {
  try {
    const list = await fetchUploads()
    uploads.value = list.map((u) => ({
      ...u,
      platform: resolveUploadPlatform(u.fileName, u.platform) || u.platform,
    }))
  } catch (e) {
    uploads.value = []
    error.value = `업로드 목록 불러오기 실패: ${e.message}`
    throw e
  }
}

/**
 * @param {{ forceRefresh?: boolean }} [opts]
 */
async function ensureDetailCache(opts = {}) {
  const forceRefresh = Boolean(opts.forceRefresh)
  if (forceRefresh) {
    invalidateDetailCache()
  }

  if (
    detailCacheLoaded.value &&
    detailCacheLoadedVersion === detailCacheVersion
  ) {
    return
  }

  if (detailCachePromise) {
    try {
      await detailCachePromise
    } catch {
      /* 이전 실패 무시 후 필요 시 재시도 */
    }
    if (detailCacheLoaded.value && detailCacheLoadedVersion === detailCacheVersion) {
      return
    }
  }

  const loadVersion = detailCacheVersion
  detailCacheLoading.value = true
  detailCacheError.value = ''
  detailCachePromise = (async () => {
    try {
      await loadDetailCache()
      // 로드 중 invalidate되면 완료해도 캐시로 채택하지 않음
      if (loadVersion !== detailCacheVersion) return
      detailCacheLoaded.value = true
      detailCacheLoadedVersion = loadVersion
      detailCacheLoadedAt.value = new Date().toISOString()
    } catch (e) {
      if (loadVersion === detailCacheVersion) {
        detailCacheLoaded.value = false
        detailCacheError.value = e?.message || '상세 데이터 로드 실패'
        error.value = `상세 데이터 로드 실패: ${detailCacheError.value}`
      }
      throw e
    } finally {
      detailCacheLoading.value = false
      detailCachePromise = null
    }
  })()
  return detailCachePromise
}

/** 업로드 성공 후에만 호출 — 기존 데이터는 다음 필요 시 1회 재로드 */
function invalidateDetailCache() {
  detailCacheVersion += 1
  detailCacheLoaded.value = false
  detailCacheLoadedAt.value = null
  detailCacheError.value = ''
  // 진행 중 Promise는 그대로 두되, 완료 후 loadedVersion 불일치로 다음 ensure가 재로드
}

async function retryDetailCache() {
  return ensureDetailCache({ forceRefresh: true })
}

async function ensureTabAggregateCache(tab) {
  if (tab === 'daily' && !dailyCacheLoaded.value) {
    await loadDailyCache()
    dailyCacheLoaded.value = true
    return
  }
  if (tab === 'channel' && !channelCacheLoaded.value) {
    await loadChannelCache()
    channelCacheLoaded.value = true
    return
  }
  if (tab === 'product' && !productCacheLoaded.value) {
    await loadProductCache()
    productCacheLoaded.value = true
    return
  }
  if (tab === 'productOption' && !productOptionCacheLoaded.value) {
    await loadProductOptionCache()
    productOptionCacheLoaded.value = true
  }
}

async function refreshAll() {
  await hydrateAppSettings({ forceRefresh: true })
  invalidateDetailCache()
  invalidateServerKpiCaches()
  dailyCacheLoaded.value = false
  channelCacheLoaded.value = false
  productCacheLoaded.value = false
  productOptionCacheLoaded.value = false
  await Promise.all([
    loadDailyCache(),
    loadChannelCache(),
    loadProductCache(),
    loadProductOptionCache(),
  ])
  dailyCacheLoaded.value = true
  channelCacheLoaded.value = true
  productCacheLoaded.value = true
  productOptionCacheLoaded.value = true
  await reloadOpenTablePages()
}

async function reloadOpenTablePages() {
  await Promise.all(
    allDataScopes().map((s) => {
      const sl = getSlice(s)
      if (!sl.tablePageRecords.value.length && !(sl.tablePagination.value.total > 0)) {
        return Promise.resolve()
      }
      return loadTablePageForScope(s, { silent: true }).catch(() => {})
    }),
  )
}

/** @type {Promise<void> | null} */
let coreLoadPromise = null

async function ensureCoreLoaded() {
  if (initialized.value) return
  if (coreLoadPromise) return coreLoadPromise
  coreLoadPromise = (async () => {
    try {
      await loadUploads()
    } catch {
      /* error already set */
    }
    try {
      await hydrateAppSettings()
    } catch {
      /* offline */
    }
    initialized.value = true
  })()
  try {
    await coreLoadPromise
  } finally {
    if (initialized.value) coreLoadPromise = null
  }
}

function sliceHasWarmServerKpi(scope) {
  const slice = getSlice(scope)
  if (!slice.serverKpiLoaded.value) return false
  return (
    slice.serverKpiBucket.value != null ||
    (slice.serverPlatformKpiRows.value?.length || 0) > 0 ||
    (slice.serverDailyChartBuckets.value?.length || 0) > 0
  )
}

function getServerKpiCacheBundle(scope) {
  const slice = getSlice(scope)
  const query = buildKpiQueryFromFilters(slice.filters.value, scope)
  const cacheKey = buildServerKpiCacheKey(scope, query)
  return { cacheKey, bundle: serverKpiResultCache.get(cacheKey) }
}

/** 대시보드 탭 KPI prefetch 대상 (직접입력·코멘트 제외) */
function listPrefetchableKpiScopes() {
  const scopes = []
  for (const ch of getDashboardChannels()) {
    if (!ch || isCombinedCommentsChannel(ch.id) || isManualOnlyChannel(ch.id)) continue
    for (const mode of ch.modes || []) {
      if (mode.id !== 'daily' && mode.id !== 'monthly') continue
      if (mode.scope) scopes.push(mode.scope)
    }
  }
  return [...new Set(scopes)]
}

const PREFETCH_CONCURRENCY = 1
let prefetchRunning = false

/**
 * 현재 탭 KPI 이후 idle에 다른 scope KPI를 미리 채워 탭 전환 대기 제거
 * @param {string} primaryScope
 */
function schedulePrefetchDashboardKpis(primaryScope) {
  if (!isServerKpi()) return
  const run = () => {
    void runPrefetchDashboardKpis(primaryScope)
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2500 })
  } else {
    setTimeout(run, 600)
  }
}

async function runPrefetchDashboardKpis(primaryScope) {
  if (prefetchRunning) return
  prefetchRunning = true
  try {
    const queue = listPrefetchableKpiScopes().filter((scope) => {
      if (scope === primaryScope) return false
      if (scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE) return false
      // 통합 by-segment는 설정 로드가 무거워 부팅 502를 유발 — 탭 진입 시 로드
      if (isCombinedScope(scope)) return false
      const { bundle } = getServerKpiCacheBundle(scope)
      if (bundle) return false
      if (sliceHasWarmServerKpi(scope)) return false
      return true
    })
    if (!queue.length) return

    let cursor = 0
    async function worker() {
      while (cursor < queue.length) {
        const scope = queue[cursor]
        cursor += 1
        try {
          await loadServerKpiForScope(scope)
        } catch {
          /* prefetch 실패는 탭 진입 시 재시도 */
        }
      }
    }
    const workers = Array.from(
      { length: Math.min(PREFETCH_CONCURRENCY, queue.length) },
      () => worker(),
    )
    await Promise.all(workers)
  } finally {
    prefetchRunning = false
  }
}

/** @type {Map<string, { summary: unknown, daily: unknown, byPlatform: unknown, bySegment?: unknown, bySegmentPrev?: unknown, compareYesterday: unknown }>} */
const rawServerKpiBundleByScope = new Map()

/** 월별 KPI 쿼리를 N개월 이동 (from/to/month) */
function shiftMonthlyKpiQuery(query, deltaMonths) {
  const q = { ...query }
  let mk = String(q.month || '').trim()
  if (!/^\d{4}-\d{2}$/.test(mk)) {
    const to = String(q.to || '').trim()
    const from = String(q.from || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) mk = to.slice(0, 7)
    else if (/^\d{4}-\d{2}-\d{2}$/.test(from)) mk = from.slice(0, 7)
  }
  if (!/^\d{4}-\d{2}$/.test(mk)) return null
  const shifted = addMonthsToMonthKey(mk, deltaMonths)
  if (!shifted) return null
  const [y, m] = shifted.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  q.month = shifted
  q.from = `${shifted}-01`
  q.to = `${shifted}-${String(lastDay).padStart(2, '0')}`
  return q
}

function monthKeyFromFilters(filters = {}) {
  const y = String(filters.year || '').trim()
  const mo = String(filters.month || '').trim()
  if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(mo)) {
    return `${y}-${String(Number(mo)).padStart(2, '0')}`
  }
  const to = String(filters.dateTo || filters.dateFrom || '').trim()
  return /^\d{4}-\d{2}/.test(to) ? to.slice(0, 7) : ''
}

function filtersForMonthKey(baseFilters = {}, monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return { ...baseFilters }
  const [y, m] = monthKey.split('-')
  const lastDay = new Date(Number(y), Number(m), 0).getDate()
  return {
    ...baseFilters,
    year: y,
    month: String(Number(m)),
    dateFrom: `${monthKey}-01`,
    dateTo: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
    platform: '',
    salesMethod: '',
  }
}

function applyRawServerKpiToSlice(scope, bundle) {
  const slice = getSlice(scope)
  const { summary, daily, byPlatform, bySegment, bySegmentPrev, compareYesterday } = bundle
  slice.serverKpiBucket.value = summary ? adaptServerKpiToEsserBucket(summary) : null
  slice.serverDailyChartBuckets.value = daily?.items
    ? adaptServerDailyToChartBuckets(daily.items)
    : []
  if (isCombinedScope(scope) && bySegment) {
    slice.serverPlatformKpiRows.value = adaptServerSegmentKpiRows(bySegment)
  } else {
    slice.serverPlatformKpiRows.value = byPlatform ? adaptServerPlatformKpiRows(byPlatform) : []
    if (!slice.serverPlatformKpiRows.value.length && summary) {
      slice.serverPlatformKpiRows.value = buildFallbackPlatformRowsFromSummary(summary)
    }
  }
  slice.serverPrevMonthPlatformKpiRows.value =
    isCombinedScope(scope) && bySegmentPrev
      ? adaptServerSegmentKpiRows(bySegmentPrev)
      : []
  slice.serverDayOverDayRows.value = compareYesterday
    ? adaptServerDayOverDayRows(compareYesterday)
    : []
}

function applyDirectInputKpiMergesToSlice(scope) {
  const slice = getSlice(scope)

  if (shouldMergeOwnMallManualKpi(scope)) {
    const filterCtx = buildOwnMallKpiFilterCtx(scope, slice.filters.value)
    const ownMallRecords = ownMallManualDetailRecords.value
    const ownMallRow = buildOwnMallPlatformRow(ownMallRecords, filterCtx)

    if (ownMallRow && !isCombinedScope(scope)) {
      slice.serverPlatformKpiRows.value = mergeOwnMallManualIntoServerPlatformRows(
        slice.serverPlatformKpiRows.value,
        ownMallRecords,
        filterCtx,
      )
    }
    if (ownMallRow) {
      slice.serverKpiBucket.value = mergeOwnMallIntoServerKpiBucket(
        slice.serverKpiBucket.value,
        ownMallRow,
      )
      slice.serverDailyChartBuckets.value = mergeOwnMallManualIntoDailyBuckets(
        slice.serverDailyChartBuckets.value,
        ownMallRecords,
        filterCtx,
      )
    }
    if (isCombinedScope(scope)) {
      slice.serverPlatformKpiRows.value = mergeOwnMallIntoCombinedSegmentRows(
        slice.serverPlatformKpiRows.value,
        ownMallRecords,
        filterCtx,
      )
    }
  }

  if (shouldMergePowerPriceKpi(scope)) {
    const filterCtx = {
      ...slice.filters.value,
      platform: '',
    }
    const ppRow = buildPowerPriceKpiRow(
      powerPriceDetailRecords.value,
      combinedManualAdChannelGroups(scope),
      filterCtx,
    )
    if (ppRow) {
      slice.serverKpiBucket.value = mergePowerPriceIntoServerKpiBucket(
        slice.serverKpiBucket.value,
        ppRow,
      )
    }
  }

  if (shouldMergeCoupang1pKpi(scope)) {
    const filterCtx = {
      ...slice.filters.value,
      platform: '',
      salesMethod: '',
    }
    const c1pRecords = coupang1pRocketDetailRecords.value
    const bestheimC1p = filterCoupang1pRecordsByBrand(c1pRecords, 'bestheim')
    const esserC1p = filterCoupang1pRecordsByBrand(c1pRecords, 'esser')
    const bestheimRow = buildCoupang1pPlatformRow(bestheimC1p, filterCtx)
    const esserRow = buildCoupang1pPlatformRow(esserC1p, filterCtx)

    if (scope === 'platform' || scope === 'platform_monthly') {
      slice.serverPlatformKpiRows.value = mergeCoupang1pIntoServerPlatformRows(
        slice.serverPlatformKpiRows.value,
        bestheimC1p,
        filterCtx,
      )
      const total = slice.serverPlatformKpiRows.value.find((r) => r.label === '합계')
      // 빈 합계로 서버 summary를 덮지 않음 (reshape/merge 회귀)
      if (total && (Number(total.profit?.sales) || Number(total.rowCount))) {
        slice.serverKpiBucket.value = esserBucketFromPlatformKpiRow(total)
      }
    }

    if (
      (scope === 'company_b' || scope === 'company_b_monthly') &&
      esserRow &&
      !isCombinedScope(scope)
    ) {
      slice.serverPlatformKpiRows.value = mergeCoupang1pIntoServerPlatformRows(
        slice.serverPlatformKpiRows.value,
        esserC1p,
        filterCtx,
      )
    }

    if (bestheimRow) {
      if (isCombinedScope(scope)) {
        slice.serverKpiBucket.value = mergeCoupang1pIntoServerKpiBucket(
          slice.serverKpiBucket.value,
          bestheimRow,
        )
      }
    }

    if (esserRow && isCombinedScope(scope)) {
      slice.serverKpiBucket.value = mergeCoupang1pIntoServerKpiBucket(
        slice.serverKpiBucket.value,
        esserRow,
      )
    }

    if (esserRow && (scope === 'company_b' || scope === 'company_b_monthly')) {
      slice.serverKpiBucket.value = mergeCoupang1pIntoServerKpiBucket(
        slice.serverKpiBucket.value,
        esserRow,
      )
    }

    const dailyC1p =
      scope === 'company_b' || scope === 'company_b_monthly' ? esserC1p : c1pRecords

    if (isCombinedScope(scope)) {
      slice.serverPlatformKpiRows.value = mergeCoupang1pIntoCombinedSegmentRows(
        slice.serverPlatformKpiRows.value,
        c1pRecords,
        filterCtx,
      )
    }

    if (dailyC1p.length) {
      slice.serverDailyChartBuckets.value = mergeCoupang1pIntoDailyBuckets(
        slice.serverDailyChartBuckets.value,
        dailyC1p,
        filterCtx,
      )
    }
  }

  // 통합 월별 특판·수기 지출 — 서버 month 키 불일치·자사몰 merge 누락 대비 클라 보강
  if (isCombinedScope(scope) && isMonthlyScope(scope)) {
    const monthKey = monthKeyFromFilters(slice.filters.value)
    const specialSale = getSpecialSaleSnapshot(scope, monthKey)
    slice.serverPlatformKpiRows.value = mergeSpecialSaleIntoCombinedSegmentRows(
      slice.serverPlatformKpiRows.value,
      specialSale,
    )
    slice.serverPlatformKpiRows.value = mergeManualExpenseIntoCombinedSegmentRows(
      slice.serverPlatformKpiRows.value,
      getManualExpenseSnapshot(scope, monthKey),
    )

    // 전월 by-segment — 자사몰·1P·특판·지출을 전월 기준으로 merge
    if (monthKey) {
      const prevMk = addMonthsToMonthKey(monthKey, -1)
      let prevRows = slice.serverPrevMonthPlatformKpiRows.value || []
      const prevFilters = filtersForMonthKey(slice.filters.value, prevMk)
      if (prevRows.length) {
        if (shouldMergeOwnMallManualKpi(scope)) {
          prevRows = mergeOwnMallIntoCombinedSegmentRows(
            prevRows,
            ownMallManualDetailRecords.value,
            buildOwnMallKpiFilterCtx(scope, prevFilters),
          )
        }
        if (shouldMergeCoupang1pKpi(scope)) {
          prevRows = mergeCoupang1pIntoCombinedSegmentRows(
            prevRows,
            coupang1pRocketDetailRecords.value,
            { ...prevFilters, platform: '', salesMethod: '' },
          )
        }
      }
      prevRows = mergeSpecialSaleIntoCombinedSegmentRows(
        prevRows,
        getSpecialSaleSnapshot(scope, prevMk, { allowLegacy: false }),
      )
      prevRows = mergeManualExpenseIntoCombinedSegmentRows(
        prevRows,
        getManualExpenseSnapshot(scope, prevMk, { allowLegacy: false }),
      )
      slice.serverPrevMonthPlatformKpiRows.value = prevRows
    }
  }
}

function reapplyDirectInputKpiMergesForScope(scope) {
  const bundle = rawServerKpiBundleByScope.get(scope)
  if (!bundle) return
  const slice = getSlice(scope)
  if (!slice.serverKpiLoaded.value) return
  applyRawServerKpiToSlice(scope, bundle)
  applyDirectInputKpiMergesToSlice(scope)
}

/**
 * 서버 KPI 응답을 slice에 반영 (+ 수기 merge)
 * @param {string} scope
 * @param {{ summary: unknown, daily: unknown, byPlatform: unknown, bySegment?: unknown, compareYesterday: unknown }} bundle
 */
function applyServerKpiBundleToSlice(scope, bundle) {
  rawServerKpiBundleByScope.set(scope, bundle)
  applyRawServerKpiToSlice(scope, bundle)
  try {
    applyDirectInputKpiMergesToSlice(scope)
  } catch {
    /* 직접입력 merge 실패해도 서버 KPI는 유지 */
  }
  getSlice(scope).serverKpiLoaded.value = true
}

/**
 * PG + server KPI — TTL 캐시 · single-flight · Abort · request sequence
 * @param {string} scope
 * @param {{ forceRefresh?: boolean }} [opts]
 */
async function loadServerKpiForScope(scope, opts = {}) {
  const slice = getSlice(scope)
  const query = buildKpiQueryFromFilters(slice.filters.value, scope)
  const cacheKey = buildServerKpiCacheKey(scope, query)
  const requestSequence = (kpiRequestSequenceByScope.get(scope) || 0) + 1
  kpiRequestSequenceByScope.set(scope, requestSequence)

  const prevKey = kpiLastCacheKeyByScope.get(scope)
  // 조회 조건이 바뀔 때만 이전 요청 취소 (동일 key single-flight는 유지)
  if (prevKey && prevKey !== cacheKey) {
    const prevAbort = kpiAbortByScope.get(scope)
    if (prevAbort) prevAbort.abort()
  }
  kpiLastCacheKeyByScope.set(scope, cacheKey)

  let abortController = kpiAbortByScope.get(scope)
  if (!abortController || abortController.signal.aborted || prevKey !== cacheKey) {
    abortController = new AbortController()
    kpiAbortByScope.set(scope, abortController)
  }
  const { signal } = abortController

  const isCurrent = () =>
    requestSequence === kpiRequestSequenceByScope.get(scope) &&
    kpiLastCacheKeyByScope.get(scope) === cacheKey

  try {
    if (opts.forceRefresh) {
      // inflight 삭제 금지 — 진행 중 fetch를 끊고 빈 캐시로 남는 회귀 방지
      serverKpiResultCache.invalidateResult(cacheKey)
    }

    const bundle = await serverKpiResultCache.getOrLoad(cacheKey, async () => {
      const combined = isCombinedScope(scope)
      const summary = await fetchKpiSummary(query, { signal })
      let daily = { items: [] }
      try {
        daily = await fetchKpiDaily(query, { signal })
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        daily = { items: [] }
      }
      let byPlatform = null
      let bySegment = null
      let bySegmentPrev = null
      let compareYesterday = null
      if (!combined) {
        try {
          byPlatform = await fetchKpiByPlatform(query, { signal })
        } catch (err) {
          if (err?.name === 'AbortError') throw err
          byPlatform = null
        }
      } else {
        try {
          bySegment = await fetchKpiBySegment(query, { signal })
        } catch (err) {
          if (err?.name === 'AbortError') throw err
          bySegment = null
        }
        // 통합 월별 전월대비 — 전월 세그먼트(특판 포함) 병행 조회
        if (isMonthlyScope(scope)) {
          const prevQuery = shiftMonthlyKpiQuery(query, -1)
          if (prevQuery) {
            try {
              bySegmentPrev = await fetchKpiBySegment(prevQuery, { signal })
            } catch (err) {
              if (err?.name === 'AbortError') throw err
              bySegmentPrev = null
            }
          }
        }
      }
      try {
        compareYesterday = await fetchKpiCompareYesterday(query, { signal })
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        compareYesterday = null
      }
      return { summary, daily, byPlatform, bySegment, bySegmentPrev, compareYesterday }
    })

    // 최신 요청만 반영. 동일 조건의 캐시는 남아 후속 요청/ensure가 재적용 가능
    if (!isCurrent()) return
    applyServerKpiBundleToSlice(scope, bundle)
  } catch (e) {
    if (e?.name === 'AbortError' || signal.aborted) {
      // 조건이 바뀌어 취소된 경우 — 최신 요청이 이어서 처리
      if (isCurrent()) {
        const cached = serverKpiResultCache.get(cacheKey)
        if (cached) applyServerKpiBundleToSlice(scope, cached)
      }
      return
    }
    if (!isCurrent()) return

    const stale = serverKpiResultCache.get(cacheKey)
    if (stale) {
      applyServerKpiBundleToSlice(scope, stale)
      return
    }

    // 이미 화면에 붙은 KPI를 실패 처리로 지우지 않음
    if (slice.serverKpiBucket.value != null || slice.serverPlatformKpiRows.value.length) {
      slice.serverKpiLoaded.value = true
      error.value = `KPI API 불러오기 실패: ${e.message}`
      return
    }

    slice.serverKpiBucket.value = null
    slice.serverDailyChartBuckets.value = []
    slice.serverPlatformKpiRows.value = []
    slice.serverPrevMonthPlatformKpiRows.value = []
    slice.serverDayOverDayRows.value = []
    slice.serverKpiLoaded.value = true
    error.value = `KPI API 불러오기 실패: ${e.message}`
    throw e
  }
}

/**
 * 예전: 표 펼침 전 전량 detail 캐시 prefetch.
 * 1단계: 표는 서버 페이지네이션이므로 전량 로드하지 않는다.
 */
function loadDetailInBackground(_scope) {
  return
}

/** 대시보드 — KPI API 우선. detail은 lazy가 아니면 BG 로드(표용) */
async function ensureDashboardReady(scope) {
  await ensureCoreLoaded()
  if (isServerKpi() && scope !== POWER_PRICE_SCOPE && scope !== COUPANG_1P_ROCKET_SCOPE) {
    error.value = ''
    const { bundle: cachedBundle } = getServerKpiCacheBundle(scope)

    // TTL 캐시 히트 — loading 없이 즉시 표시
    if (cachedBundle) {
      applyServerKpiBundleToSlice(scope, cachedBundle)
      if (!isLazyDetailLoad()) loadDetailInBackground(scope)
      schedulePrefetchDashboardKpis(scope)
      return
    }

    // 슬라이스에 이전 방문 KPI가 있으면 즉시 표시 + 백그라운드 재검증
    if (sliceHasWarmServerKpi(scope)) {
      if (!isLazyDetailLoad()) loadDetailInBackground(scope)
      void loadServerKpiForScope(scope).catch(() => {
        /* error set in loader */
      })
      schedulePrefetchDashboardKpis(scope)
      return
    }

    // 첫 방문(콜드) — 네트워크 대기
    loading.value = true
    try {
      await loadServerKpiForScope(scope)
      // watch 등으로 시퀀스가 밀려 apply가 스킵된 경우 최신 요청을 한 번 더 대기
      if (!getSlice(scope).serverKpiLoaded.value) {
        await loadServerKpiForScope(scope)
      }
      if (!getSlice(scope).serverKpiLoaded.value) {
        const { bundle } = getServerKpiCacheBundle(scope)
        if (bundle) applyServerKpiBundleToSlice(scope, bundle)
      }
      if (!isLazyDetailLoad()) {
        loadDetailInBackground(scope)
      }
    } catch {
      const { bundle } = getServerKpiCacheBundle(scope)
      if (bundle) applyServerKpiBundleToSlice(scope, bundle)
    } finally {
      loading.value = false
    }
    schedulePrefetchDashboardKpis(scope)
    return
  }
  if (scope !== POWER_PRICE_SCOPE && scope !== COUPANG_1P_ROCKET_SCOPE) {
    await ensureDetailCache()
  }
  await loadRecordsForScope(scope)
}

async function ensureLoaded() {
  await ensureCoreLoaded()
}

async function refreshAfterUpload(scopes = ['platform']) {
  await loadUploads()
  const scopeList = Array.isArray(scopes) ? scopes : [scopes]
  for (const s of scopeList) invalidateServerKpiCaches(s)
  invalidateDetailCache()
  if (isServerKpi()) {
    await Promise.all(scopeList.map((s) => loadServerKpiForScope(s, { forceRefresh: true })))
    await Promise.all(
      scopeList.map((s) => loadTablePageForScope(s, { page: 1, silent: true }).catch(() => {})),
    )
  } else {
    await refreshAll()
  }
}

async function onSalesReportFilesSelected(fileList) {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    let total = 0
    const { readSalesReportFile } = await import('../utils/salesReportParser.js')
    for (const file of fileList) {
      const { fileName, parsed } = await readSalesReportFile(file)
      const { count } = await saveSalesReportUpload({ file, fileName, parsed })
      total += count
    }
    success.value = `${fileList.length}개 파일, 총 ${total}건을 DB에 저장했습니다.`
    await refreshAfterUpload(['sales_report', 'platform'])
  } catch (e) {
    error.value = `업로드 실패: ${e.message}`
  } finally {
    saving.value = false
  }
}

async function onDataChannelUploaded(scope) {
  saving.value = true
  error.value = ''
  try {
    await refreshAfterUpload(scope)
    const ch = getChannelByScope(scope)
    const count = uploadsByKind(scope).length
    const label = ch ? `${ch.tabLabel} · ${ch.reportTitle}` : '데이터'
    success.value = `${label} 저장 완료 (업로드 ${count}건)`
  } catch (e) {
    error.value = `목록 새로고침 실패: ${e.message}`
  } finally {
    saving.value = false
  }
}

async function onPlatformUploaded() {
  await onDataChannelUploaded('platform')
}

function openEdit(row) {
  editingRecord.value = { ...row }
  editOpen.value = true
}

async function onSaveEdit({ id, fields }) {
  saving.value = true
  error.value = ''
  try {
    await updateSalesRecord(id, fields)
    editOpen.value = false
    success.value = '수정되었습니다.'
    await refreshAll()
  } catch (e) {
    error.value = `수정 실패: ${e.message}`
  } finally {
    saving.value = false
  }
}

async function onDelete(row) {
  if (!confirm('이 행을 삭제할까요?')) return
  saving.value = true
  error.value = ''
  try {
    await deleteSalesRecord(row.id)
    success.value = '삭제되었습니다.'
    await loadUploads()
    await refreshAll()
  } catch (e) {
    error.value = `삭제 실패: ${e.message}`
  } finally {
    saving.value = false
  }
}

async function onDeleteUpload(upload) {
  if (!confirm(`「${upload.fileName}」 업로드(${upload.totalCount}건)를 모두 삭제할까요?`)) return
  saving.value = true
  error.value = ''
  try {
    await deleteUploadAndRecords(upload.id)
    for (const scope of Object.keys(scopeSlices)) {
      const slice = getSlice(scope)
      slice.selectedUploadIds.value = slice.selectedUploadIds.value.filter((id) => id !== upload.id)
    }
    success.value = '업로드 배치가 삭제되었습니다.'
    await loadUploads()
    await refreshAll()
  } catch (e) {
    error.value = `배치 삭제 실패: ${e.message}`
  } finally {
    saving.value = false
  }
}

function clearMessages() {
  error.value = ''
  success.value = ''
}

function createScopedApi(scope) {
  const slice = getSlice(scope)

  const scopedDetailRecords = computed(() => {
    if (scope === POWER_PRICE_SCOPE) {
      return powerPriceDetailRecords.value
    }
    if (scope === COUPANG_1P_ROCKET_SCOPE) {
      return coupang1pRocketDetailRecords.value
    }
    let list = applyUploadScope(filterByScope(detailRecords.value, scope), slice.selectedUploadIds)
    if (isCombinedScope(scope)) {
      list = mergePowerPriceForCombined(list, scope)
    }
    list = mergeOwnMallManualForScope(list, scope)
    list = mergeCoupang1pRocketForScope(list, scope)
    if (isCombinedScope(scope)) {
      list = tagCombinedSourceLabels(list)
    }
    return applyDataCorrections(list, scope, slice.filters.value)
  })

  const scopedSaleDetails = computed(() =>
    scopedDetailRecords.value.filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r)),
  )

  /** KPI·일별 — 상품 행 + 엑셀 하단 총합(광고만) */
  const scopedKpiDetailRecords = computed(() =>
    scopedDetailRecords.value.filter((r) => !isReturnRecord(r)),
  )

  const scopedReturnDetails = computed(() =>
    scopedDetailRecords.value.filter((r) => isReturnRecord(r)),
  )

  /** KPI·차트·대시보드 엑셀 — 판매 + 엑셀 총합(광고) (반품 제외) */
  const filteredDetailForCharts = computed(() => {
    const f =
      scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE
        ? { ...slice.filters.value, platform: '', salesMethod: '' }
        : isCombinedScope(scope)
          ? { ...slice.filters.value, platform: '', salesMethod: '' }
          : slice.filters.value
    return excludeEsserSheetTotalsForPeriodKpi(
      applyRecordFilters(scopedKpiDetailRecords.value, 'detail', f),
      f,
    )
  })

  /** 일별 대시보드 — 쿠팡/스마트스토어/합계 (플랫폼 필터 제외, 기간·판매방식만) */
  const dashboardPlatformSplitRecords = computed(() => {
    let records = scopedKpiDetailRecords.value
    if (combinedIncludesPowerPrice(scope)) {
      records = records.filter((r) => !isPowerPriceRecord(r))
    }
    const f = { ...slice.filters.value, platform: '' }
    return excludeEsserSheetTotalsForPeriodKpi(applyRecordFilters(records, 'detail', f), f)
  })

  /** 전일·전주 대비 — 날짜·연월·요일·플랫폼 필터 제외(전주 행이 기간 밖이면 0으로 나오는 문제 방지) */
  const dashboardDayOverDayRecords = computed(() =>
    applyRecordFilters(
      scopedKpiDetailRecords.value,
      'detail',
      filtersForDayOverDayLookup(slice.filters.value),
    ),
  )

  const dailyFromDetails = computed(() => {
    const details = detailsForSummaryAggregation(scope, slice)
    if (usesEsserDashboard(scope) || details.some(isEsserDetailRow)) {
      const f = slice.filters.value
      const manualCtx = {
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
        year: f.year,
        month: f.month,
        period: isMonthlyScope(scope) ? 'monthly' : 'daily',
      }
      if (isMonthlyScope(scope)) {
        const spendOnly =
          scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE
        // 광고는 일별 scope에서 조회 (일별=월별 동일 데이터)
        const monthlyManualAd = isCombinedScope(scope)
          ? combinedManualAdChannelGroups(scope).flatMap((g) => g.entries || [])
          : getManualAdSnapshot(dailyScopeForMonthly(scope))
        const buckets = aggregateEsserByMonthWithManual(
          details,
          monthlyManualAd,
          manualCtx,
          f.year,
          spendOnly,
        )
        return esserBucketsToDailyTabRows(buckets)
      }
      let buckets
      if (combinedIncludesPowerPrice(scope)) {
        buckets = aggregateCombinedByDayWithManual(
          details,
          combinedManualAdChannelGroups(scope),
          manualCtx,
        )
      } else {
        const aggregateDay =
          scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE
            ? aggregateEsserByDayWithManualSpendOnly
            : aggregateEsserByDayWithManual
        buckets = aggregateDay(details, getManualAdSnapshot(scope), manualCtx)
      }
      return esserBucketsToDailyTabRows(buckets)
    }
    return buildDailySummaryFromDetails(details)
  })

  const recordsForActiveTab = computed(() => {
    const tab = slice.activeTab.value
    if (SERVER_PAGED_TABLE_TABS.has(tab)) return slice.tablePageRecords.value
    return applyUploadScope(filterByScope(slice.records.value, scope), slice.selectedUploadIds)
  })

  const filteredRecords = computed(() => {
    const tab = slice.activeTab.value
    const base = recordsForActiveTab.value
    if (SERVER_PAGED_TABLE_TABS.has(tab)) return base
    if (tab === 'daily') {
      const dateQ = slice.filters.value.date
      if (!dateQ) return base
      return base.filter((r) => String(r.date || '').includes(dateQ))
    }
    return applyRecordFilters(base, tab, slice.filters.value)
  })

  const sortedFilteredRecords = computed(() => {
    const tab = slice.activeTab.value
    if (SERVER_PAGED_TABLE_TABS.has(tab)) return slice.tablePageRecords.value
    return sortRecordsForTab(filteredRecords.value, tab)
  })

  const availableYears = computed(() => {
    const base = [
      ...filterByScope(detailRecords.value, scope),
      ...filterByScope(dailyRecords.value, scope),
      ...filterByScope(slice.records.value, scope),
    ]
    if (combinedIncludesPowerPrice(scope)) {
      base.push(...powerPriceDetailRecords.value)
    }
    if (scope === 'platform' || isCombinedScope(scope)) {
      base.push(...coupang1pRocketDetailRecords.value)
    }
    if (scope === 'company_b' || scope === 'company_b_monthly' || isCombinedScope(scope)) {
      base.push(...ownMallManualDetailRecords.value)
    }
    return collectYears(base)
  })

  const monthOptions = computed(() =>
    Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` })),
  )

  const weekdayOptions = WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label: `${label}요일` }))

  const mergeSelectionLabel = computed(() => {
    if (!slice.selectedUploadIds.value.length) return ''
    return uploads.value
      .filter((u) => slice.selectedUploadIds.value.includes(u.id))
      .map((u) => u.fileName)
      .join(', ')
  })

  const isMergeActive = computed(() => slice.selectedUploadIds.value.length > 0)
  const usesServerKpiMode = computed(() => isServerKpi())

  const visualDailyRecords = computed(() => {
    if (usesServerKpiMode.value && slice.serverDailyChartBuckets.value.length) {
      return slice.serverDailyChartBuckets.value.map((b) => ({
        date: b.date || b.label,
        sales: String(Math.round(b.sales || 0)),
        salesQty: String(Math.round(b.salesQty || 0)),
        netProfit: String(Math.round(b.netProfit || 0)),
        adSpend: String(Math.round(b.adSpend || 0)),
      }))
    }
    return dailyFromDetails.value
  })
  const scopedUploads = computed(() => uploadsByKind(scope))

  async function ensureDetailForScope() {
    await loadTablePageForScope(scope, { silent: true })
  }

  async function switchTab(type) {
    slice.activeTab.value = type
    slice.tablePagination.value = {
      ...slice.tablePagination.value,
      page: 1,
    }
    await loadRecordsForScope(scope)
  }

  async function goTablePage(page) {
    const totalPages = slice.tablePagination.value.totalPages || 1
    const next = Math.min(Math.max(1, Number(page) || 1), totalPages)
    await loadTablePageForScope(scope, { page: next })
  }

  function clearUploadSelection() {
    slice.selectedUploadIds.value = []
  }

  function toggleUploadSelection(id) {
    const i = slice.selectedUploadIds.value.indexOf(id)
    if (i >= 0) {
      slice.selectedUploadIds.value = slice.selectedUploadIds.value.filter((x) => x !== id)
    } else {
      slice.selectedUploadIds.value = [...slice.selectedUploadIds.value, id]
    }
  }

  function selectUploadsForScope() {
    slice.selectedUploadIds.value = uploadsByKind(scope).map((u) => u.id)
  }

  function selectAllUploads() {
    slice.selectedUploadIds.value = scopedUploads.value.map((u) => u.id)
  }

  async function downloadDashboardExport() {
    const combined = isCombinedScope(scope)
    const canPgExport = isPgExportMode()

    error.value = ''
    saving.value = true
    try {
      const channel = getChannelByScope(scope)
      const adPeriod = isMonthlyScope(scope) ? 'monthly' : 'daily'
      const adChannel = findExternalAdChannelByScope(scope)

      // 서버 export는 DB에서 수기 광고·특판을 다시 읽음 — 클라 hydrate 생략(풀·요청 경합 완화)
      if (!canPgExport) {
        const manualScopes = combined
          ? combinedManualAdScopes(scope)
          : [resolveExternalAdScope(adChannel, 'daily') || dailyScopeForMonthly(scope)].filter(Boolean)
        await Promise.all(manualScopes.map((s) => hydrateManualAdForScope(s)))
      }

      // Phase 4: 통합 포함 — 서버 export 우선 (detail/ExcelJS 메인스레드 회피)
      if (canPgExport) {
        const f = slice.filters.value
        const overrides = {}
        if (combined && isMonthlyScope(scope)) {
          overrides.special_sale = getSpecialSaleSettingPayload(scope)
          overrides.manual_expense = getManualExpenseSettingPayload(scope)
        }
        try {
          const { blob, fileName } = await pgDownloadIntegratedExport(
            {
              scope,
              from: f.dateFrom,
              to: f.dateTo,
              year: f.year,
              month: f.month,
              platform: f.platform,
              sales_method: f.salesMethod,
              include_manual_ads: 'true',
            },
            overrides,
          )
          triggerBlobDownload(blob, fileName)
          success.value = combined
            ? `통합 손익계산 엑셀 완료 — 서버 export (양식 v${INTEGRATED_REPORT_LAYOUT_VER} · 빌드 ${UI_BUILD_ID})`
            : '매출 리포트 엑셀 다운로드 완료 (PG API)'
          return
        } catch (pgErr) {
          error.value = `엑셀 다운로드 실패: ${pgErr?.message || pgErr}`
          return
        }
      }

      if (!detailCacheLoaded.value || !filteredDetailForCharts.value.length) {
        error.value =
          '서버 엑셀을 사용할 수 없어 다운로드하지 않았습니다. 전량 데이터를 다시 불러오지 않습니다.'
        return
      }

      // ExcelJS fallback — 이미 로드된 캐시만 사용 (전량 재조회 없음)
      const rows = filteredDetailForCharts.value

      const scopeManualAd = getManualAdSnapshot(dailyScopeForMonthly(scope))
      const manualAdByChannel = combined
        ? combinedManualAdChannelGroups(scope)
        : [{ label: adChannel?.label || channel?.tabLabel || '외부 광고', entries: scopeManualAd }]
      const { downloadDashboardExcel } = await import('../utils/dashboardExporter.js')
      const exportFilterCtx = {
        ...slice.filters.value,
        period: adPeriod,
      }
      const monthKey = resolveReferenceMonthKey(rows, exportFilterCtx)
      const monthlyCombined = combined && isMonthlyScope(scope)
      const specialSaleMonthlyMap = monthlyCombined
        ? getSpecialSaleMonthlyMap(scope, monthKey)
        : null
      const specialSaleByMonth = monthlyCombined
        ? buildSpecialSaleMonthlyTotals(specialSaleMonthlyMap)
        : null
      const { sheetCount, rowCount, integratedSummary } = await downloadDashboardExcel({
        records: rows,
        platformSplitRecords: dashboardPlatformSplitRecords.value,
        dayOverDayRecords: dashboardDayOverDayRecords.value,
        filters: exportFilterCtx,
        channelLabel: channel?.tabLabel || '매출',
        isCombined: combined,
        uploads: uploads.value,
        selectedUploadIds: slice.selectedUploadIds.value,
        manualAdByChannel,
        manualAdEntries: scopeManualAd,
        specialSale: monthlyCombined ? getSpecialSaleSnapshot(scope, monthKey) : null,
        specialSaleByMonth,
        manualExpense: monthlyCombined ? getManualExpenseSnapshot(scope, monthKey) : null,
        combinedComments: null,
        profitLossTemplate: combined ? getProfitLossTemplateSnapshot() : null,
        hiddenKpiKeys: combined
          ? COMBINED_HIDDEN_KPI_KEYS
          : scope === POWER_PRICE_SCOPE
            ? POWER_PRICE_HIDDEN_KPI_KEYS
            : scope === COUPANG_1P_ROCKET_SCOPE
              ? COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS
              : [],
        summarySheetOnly: isMonthlyScope(scope),
        serverPlatformKpiRows: monthlyCombined ? slice.serverPlatformKpiRows.value || [] : [],
        serverPrevMonthPlatformKpiRows: monthlyCombined
          ? slice.serverPrevMonthPlatformKpiRows.value || []
          : [],
      })
      success.value = integratedSummary
        ? `통합 손익계산 엑셀 완료 — ①요약리포트 시트 확인 (양식 v${INTEGRATED_REPORT_LAYOUT_VER} · 빌드 ${UI_BUILD_ID})`
        : `매출 리포트 엑셀 다운로드 완료 (${rowCount}건 · 시트 ${sheetCount}개)`
    } catch (e) {
      error.value = `엑셀 다운로드 실패: ${e.message}`
    } finally {
      saving.value = false
    }
  }

  async function downloadCurrentTableExport() {
    const tab = slice.activeTab.value
    error.value = ''
    saving.value = true
    try {
      if (SERVER_PAGED_TABLE_TABS.has(tab)) {
        const { q } = buildTableListQuery(scope, slice, { page: 1, tab })
        const { blob, fileName, rowCount } = await pgDownloadTableExport({
          scope,
          tab,
          start_date: q.start_date,
          end_date: q.end_date,
          platform: q.platform,
          sales_method: q.sales_method,
          brand: q.brand,
          channel: q.channel,
          product_name: q.product_name,
          option: q.option,
          date: q.date,
          year: q.year,
          month: q.month,
          day_of_week: q.day_of_week,
          upload_ids: q.upload_ids,
          sort: q.sort,
          order: q.order,
        })
        triggerBlobDownload(blob, fileName)
        const countLabel = rowCount ? `${rowCount}건` : '전체'
        success.value = `${RECORD_TYPES[tab]?.label || '데이터'} ${countLabel} 엑셀 다운로드 완료`
        return
      }

      const rows = sortedFilteredRecords.value
      if (!rows.length) {
        error.value = '다운로드할 표 데이터가 없습니다.'
        return
      }
      const channel = getChannelByScope(scope)
      const { downloadTableExcel } = await import('../utils/dashboardExporter.js')
      await downloadTableExcel({
        rows,
        columns: resolveTableColumns(),
        sheetName: RECORD_TYPES[tab]?.label || tab,
        channelLabel: channel?.tabLabel || '매출',
        filters: { ...slice.filters.value },
      })
      success.value = `${RECORD_TYPES[tab]?.label || '데이터'} ${rows.length}건 엑셀 다운로드 완료`
    } catch (e) {
      error.value = `엑셀 다운로드 실패: ${e.message}`
    } finally {
      saving.value = false
    }
  }

  async function downloadMergedExcel() {
    if (slice.selectedUploadIds.value.length < 2) {
      error.value = '통합할 업로드를 2개 이상 선택하세요.'
      return
    }
    error.value = ''
    saving.value = true
    try {
      const fetched = await fetchRecordsByUploadIds(
        'detail',
        slice.selectedUploadIds.value,
      )
      const details = applyRecordFilters(fetched, 'detail', {
        year: '',
        month: '',
        dayOfWeek: '',
        date: '',
        channel: '',
        brand: '',
        productName: '',
        option: '',
      }).filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r))
      if (!details.length) {
        error.value = '통합할 판매 상세 데이터가 없습니다.'
        return
      }
      const selected = uploads.value.filter((u) =>
        slice.selectedUploadIds.value.includes(u.id),
      )
      downloadMergedSalesReport(details, mergedFileName(selected))
      success.value = `${selected.length}개 파일 통합 엑셀을 다운로드했습니다. (${dateRangeLabel(details) || '기간 미상'})`
    } catch (e) {
      error.value = `엑셀 다운로드 실패: ${e.message}`
    } finally {
      saving.value = false
    }
  }

  function clearFilters() {
    slice.filters.value = createDefaultFilters()
  }

  function resolveTableColumns() {
    const tab = slice.activeTab.value
    const details = SERVER_PAGED_TABLE_TABS.has(tab)
      ? slice.tablePageRecords.value
      : slice.records.value
    if (tab === 'detail' || tab === 'returns') {
      return sanitizeDetailColumns(resolveDetailColumns(details))
    }
    if (usesEsserDashboard(scope) || details.some(isEsserDetailRow)) {
      return resolveSummaryColumns(tab, details)
    }
    return sanitizeDetailColumns(RECORD_TYPES[tab]?.columns || [])
  }

  async function loadTablePage(opts = {}) {
    await loadTablePageForScope(scope, opts)
  }

  return {
    scope,
    RECORD_TYPES,
    activeTab: slice.activeTab,
    records: slice.records,
    detailRecords,
    uploads,
    scopedUploads,
    selectedUploadIds: slice.selectedUploadIds,
    loading,
    saving,
    error,
    success,
    filters: slice.filters,
    chartMetric: slice.chartMetric,
    editOpen,
    editingRecord,
    scopedDetailRecords,
    scopedSaleDetails,
    scopedReturnDetails,
    filteredDetailForCharts,
    dashboardPlatformSplitRecords,
    dashboardDayOverDayRecords,
    sortedFilteredRecords,
    recordsForActiveTab,
    tablePagination: slice.tablePagination,
    tableLoading: slice.tableLoading,
    tableSaleTotal: slice.tableSaleTotal,
    tableReturnTotal: slice.tableReturnTotal,
    availableYears,
    monthOptions,
    weekdayOptions,
    mergeSelectionLabel,
    isMergeActive,
    visualDailyRecords,
    serverKpiBucket: slice.serverKpiBucket,
    serverDailyChartBuckets: slice.serverDailyChartBuckets,
    serverPlatformKpiRows: slice.serverPlatformKpiRows,
    serverPrevMonthPlatformKpiRows: slice.serverPrevMonthPlatformKpiRows,
    serverDayOverDayRows: slice.serverDayOverDayRows,
    serverKpiLoaded: slice.serverKpiLoaded,
    usesServerKpiMode,
    reloadServerKpi: (opts = {}) => loadServerKpiForScope(scope, opts),
    uploadsByKind,
    uploadSalesMethod,
    ensureLoaded,
    ensureDashboardReady,
    schedulePrefetchDashboardKpis,
    ensureDetailCache,
    ensureDetailForScope,
    retryDetailCache,
    refreshAll,
    switchTab,
    goTablePage,
    loadTablePage,
    openEdit,
    onSaveEdit,
    onDelete,
    clearUploadSelection,
    toggleUploadSelection,
    selectAllUploads,
    selectUploadsForScope,
    downloadMergedExcel,
    downloadDashboardExport,
    downloadCurrentTableExport,
    onDeleteUpload,
    clearFilters,
    clearMessages,
    resolveTableColumns,
  }
}

const scopedApiCache = Object.fromEntries(allDataScopes().map((s) => [s, createScopedApi(s)]))

watch(
  ownMallManualDetailRecords,
  () => {
    for (const scope of allDataScopes()) {
      if (!shouldMergeOwnMallManualKpi(scope)) continue
      reapplyDirectInputKpiMergesForScope(scope)
    }
  },
  { deep: true },
)

watch(
  () => {
    const keys = ['combined_daily', 'combined_monthly']
    return keys
      .map((s) => {
        const store = getSpecialSaleReactiveStore(s)
        return `${JSON.stringify(store.months)}|${JSON.stringify(store.legacyEntries)}`
      })
      .join('||')
  },
  () => {
    for (const scope of allDataScopes()) {
      if (!isCombinedScope(scope) || !isMonthlyScope(scope)) continue
      reapplyDirectInputKpiMergesForScope(scope)
    }
  },
)

function getScopedApi(scope) {
  if (!scopedApiCache[scope]) scopedApiCache[scope] = createScopedApi(scope)
  return scopedApiCache[scope]
}

/**
 * @param {{ scope?: DataScope }} [options]
 */
export function useSalesData(options = {}) {
  const { scope } = options
  if (scope) return getScopedApi(scope)

  return {
    initialized,
    uploads,
    loading,
    saving,
    error,
    success,
    detailCacheLoaded,
    detailCacheLoading,
    detailCacheError,
    detailCacheLoadedAt,
    uploadsByKind,
    uploadsForChannel,
    uploadSalesMethod,
    ensureLoaded,
    ensureCoreLoaded,
    ensureDashboardReady,
    schedulePrefetchDashboardKpis,
    ensureDetailCache,
    retryDetailCache,
    reloadUploadList: loadUploads,
    refreshAll,
    onSalesReportFilesSelected,
    onDataChannelUploaded,
    onPlatformUploaded,
    onDeleteUpload,
    clearMessages,
    getScopedApi,
    getChannel,
    getMode,
    getModeByUploadKind,
  }
}
