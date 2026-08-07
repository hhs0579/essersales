import { ref, computed, unref } from 'vue'
import {
  RECORD_TYPES,
  resolveDetailColumns,
  sanitizeDetailColumns,
  resolveSummaryColumns,
  isEsserDetailRow,
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
  fetchUploads,
  updateSalesRecord,
  deleteSalesRecord,
  deleteUploadAndRecords,
  fetchKpiSummary,
  fetchKpiDaily,
  fetchKpiByPlatform,
  fetchKpiCompareYesterday,
} from '../services/salesApi.js'
import { downloadMergedSalesReport, mergedFileName, dateRangeLabel } from '../utils/salesReportExporter.js'
import { FEATURES } from '../config/features.js'
import {
  allDataScopes,
  getChannel,
  getChannelByScope,
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
} from '../config/dataChannels.js'
import {
  EXTERNAL_AD_CHANNELS,
  resolveExternalAdScope,
  findExternalAdChannelByScope,
} from '../config/externalAdChannels.js'
import { INTEGRATED_REPORT_LAYOUT_VER } from '../utils/profitLossReportExporter.js'
import { UI_BUILD_ID } from '../constants/appVersion.js'
import { getSpecialSaleSnapshot, hydrateSpecialSaleForScope, getSpecialSaleMonthlyMap } from '../composables/useSpecialSale.js'
import {
  buildSpecialSaleMonthlyTotals,
  resolveReferenceMonthKey,
} from '../utils/dayOverDaySales.js'
import {
  getCombinedCommentsSnapshot,
  hydrateCombinedCommentsForScope,
} from '../composables/useCombinedComments.js'
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
} from '../services/adapters/ownMallKpiMerge.js'
import {
  shouldMergePowerPriceKpi,
  buildPowerPriceKpiRow,
  mergePowerPriceIntoServerKpiBucket,
} from '../services/adapters/powerPriceKpiMerge.js'
import {
  shouldMergeCoupang1pKpi,
  buildCoupang1pPlatformRow,
  mergeCoupang1pIntoServerPlatformRows,
  mergeCoupang1pIntoServerKpiBucket,
  mergeCoupang1pIntoDailyBuckets,
} from '../services/adapters/coupang1pKpiMerge.js'
import { isPgExportMode, pgDownloadIntegratedExport, triggerBlobDownload } from '../services/exportApi.js'
import {
  buildKpiQueryFromFilters,
  adaptServerKpiToEsserBucket,
  adaptServerDailyToChartBuckets,
} from '../services/adapters/kpiAdapter.js'
import {
  adaptServerPlatformKpiRows,
  adaptServerDayOverDayRows,
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
    serverKpiBucket: ref(null),
    serverDailyChartBuckets: ref([]),
    serverPlatformKpiRows: ref([]),
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
  if (isCoupang1pRocketRecord(row)) return '베스트하임'
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

/** 쿠팡 1P 로켓 발주 — 베스트하임·통합 쿠팡 KPI 반영 */
function mergeCoupang1pRocketForScope(list, scope) {
  if (scope !== 'platform' && scope !== 'platform_monthly' && !isCombinedScope(scope)) return list
  const rows = coupang1pRocketDetailRecords.value
  if (!rows.length) return list
  return [...list, ...rows]
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

async function loadDetailCache() {
  // 통합 세그먼트 KPI는 data JSONB 필드(원가·특판·시트총합 등)가 필요.
  // lean은 필드를 빼 이전화면과 숫자가 달라지므로 full 유지.
  const fetched = await fetchSalesRecords('detail', { includeData: 'full' })
  const uploadById = new Map(uploads.value.map((u) => [u.id, u]))
  detailRecords.value = fetched.map((row) => {
    const upload = uploadById.get(row.uploadId)
    const normalized = normalizeEsserDetailFields(row)
    const platform = normalizePlatformLabel(
      resolveRecordPlatform(normalized, upload?.platform),
    )
    let delivery =
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
  })
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

async function loadRecordsForScope(scope, { silent = false } = {}) {
  const slice = getSlice(scope)
  if (!silent) {
    loading.value = true
    error.value = ''
  }
  try {
    const tab = slice.activeTab.value

    // detail 탭·집계 탭 모두: 이미 있는 detail 캐시로 처리 (전량 /records 재호출 금지)
    if (tab === 'detail' || (scope !== 'sales_report' && detailCacheLoaded.value)) {
      if (!detailCacheLoaded.value || detailCacheLoadedVersion !== detailCacheVersion) {
        await ensureDetailCache()
      }
      const scopedDetails = applyUploadScope(
        filterByScope(detailRecords.value, scope),
        slice.selectedUploadIds,
      )
      if (tab === 'detail') {
        // 화면 상세 표는 scopedDetailRecords(computed)가 detailRecords를 씀
        slice.records.value = scopedDetails
      } else if (scopedDetails.length) {
        slice.records.value = buildSummaryTabFromDetails(tab, scopedDetails)
      } else {
        slice.records.value = []
      }
      return
    }

    const fetched = await fetchSalesRecords(tab)
    const scopedFetched = filterByScope(fetched, scope)
    slice.records.value = scopedFetched

    const scopedDetails = applyUploadScope(
      filterByScope(detailRecords.value, scope),
      slice.selectedUploadIds,
    )

    if (scope !== 'sales_report' && scopedDetails.length) {
      slice.records.value = buildSummaryTabFromDetails(tab, scopedDetails)
    } else if (!scopedFetched.length && scopedDetails.length) {
      slice.records.value = buildSummaryTabFromDetails(tab, scopedDetails)
    }
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
    ensureDetailCache({ forceRefresh: true }),
    loadDailyCache(),
    loadChannelCache(),
    loadProductCache(),
    loadProductOptionCache(),
  ])
  dailyCacheLoaded.value = true
  channelCacheLoaded.value = true
  productCacheLoaded.value = true
  productOptionCacheLoaded.value = true
  const scopes = allDataScopes().filter((s) => s !== 'sales_report' || FEATURES.salesReport)
  await Promise.all(scopes.map((s) => loadRecordsForScope(s)))
}

async function ensureCoreLoaded() {
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
}

/**
 * 서버 KPI 응답을 slice에 반영 (+ 수기 merge)
 * @param {string} scope
 * @param {{ summary: unknown, daily: unknown, byPlatform: unknown, compareYesterday: unknown }} bundle
 */
function applyServerKpiBundleToSlice(scope, bundle) {
  const slice = getSlice(scope)
  const { summary, daily, byPlatform, compareYesterday } = bundle
  slice.serverKpiBucket.value = summary ? adaptServerKpiToEsserBucket(summary) : null
  slice.serverDailyChartBuckets.value = daily?.items
    ? adaptServerDailyToChartBuckets(daily.items)
    : []
  slice.serverPlatformKpiRows.value = byPlatform ? adaptServerPlatformKpiRows(byPlatform) : []
  slice.serverDayOverDayRows.value = compareYesterday
    ? adaptServerDayOverDayRows(compareYesterday)
    : []

  if (shouldMergeOwnMallManualKpi(scope)) {
    const filterCtx = {
      ...slice.filters.value,
      platform: '',
    }
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
    const c1pRow = buildCoupang1pPlatformRow(c1pRecords, filterCtx)

    if (c1pRow && !isCombinedScope(scope)) {
      slice.serverPlatformKpiRows.value = mergeCoupang1pIntoServerPlatformRows(
        slice.serverPlatformKpiRows.value,
        c1pRecords,
        filterCtx,
      )
    }
    if (c1pRow) {
      slice.serverKpiBucket.value = mergeCoupang1pIntoServerKpiBucket(
        slice.serverKpiBucket.value,
        c1pRow,
      )
      slice.serverDailyChartBuckets.value = mergeCoupang1pIntoDailyBuckets(
        slice.serverDailyChartBuckets.value,
        c1pRecords,
        filterCtx,
      )
    }
  }

  slice.serverKpiLoaded.value = true
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

  try {
    if (opts.forceRefresh) {
      serverKpiResultCache.invalidate(cacheKey)
    }

    const bundle = await serverKpiResultCache.getOrLoad(cacheKey, async () => {
      const [summary, daily, byPlatform, compareYesterday] = await Promise.all([
        fetchKpiSummary(query, { signal }),
        fetchKpiDaily(query, { signal }),
        fetchKpiByPlatform(query, { signal }),
        fetchKpiCompareYesterday(query, { signal }),
      ])
      return { summary, daily, byPlatform, compareYesterday }
    })

    if (requestSequence !== kpiRequestSequenceByScope.get(scope)) return
    if (signal.aborted) return

    applyServerKpiBundleToSlice(scope, bundle)
  } catch (e) {
    if (e?.name === 'AbortError' || signal.aborted) return
    if (requestSequence !== kpiRequestSequenceByScope.get(scope)) return

    // 실패 시 캐시된 이전 값이 있으면 stale 유지
    const stale = serverKpiResultCache.get(cacheKey)
    if (stale) {
      applyServerKpiBundleToSlice(scope, stale)
      return
    }

    slice.serverKpiBucket.value = null
    slice.serverDailyChartBuckets.value = []
    slice.serverPlatformKpiRows.value = []
    slice.serverDayOverDayRows.value = []
    slice.serverKpiLoaded.value = false
    error.value = `KPI API 불러오기 실패: ${e.message}`
    throw e
  }
}

/**
 * detail 백그라운드 로드.
 * - 통합: 브랜드 세그먼트(베스트하임·사본느리·자사몰·파워 등) 표에 필요 → lazy여도 prefetch
 * - 기타/플랫폼: 서버 KPI만으로 충분 → lazy면 skip
 */
function loadDetailInBackground(scope) {
  if (scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE) return
  if (scope === 'other_sellers') return
  if (isLazyDetailLoad() && !isCombinedScope(scope)) return
  const cacheFresh =
    detailCacheLoaded.value && detailCacheLoadedVersion === detailCacheVersion
  if (cacheFresh || detailCacheLoading.value) return

  const run = () => {
    ensureDetailCache()
      .then(() => loadRecordsForScope(scope, { silent: true }))
      .catch(() => {
        /* detailCacheError set in composable */
      })
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2500 })
  } else {
    setTimeout(run, 400)
  }
}

/** 대시보드 — KPI API 우선. 통합만 세그먼트용 detail을 백그라운드 로드 */
async function ensureDashboardReady(scope) {
  await ensureCoreLoaded()
  if (
    isServerKpi() &&
    scope !== POWER_PRICE_SCOPE &&
    scope !== COUPANG_1P_ROCKET_SCOPE
  ) {
    loading.value = true
    error.value = ''
    try {
      await loadServerKpiForScope(scope)
      if (!isLazyDetailLoad() && isCombinedScope(scope)) {
        await ensureDetailCache()
        await loadRecordsForScope(scope, { silent: true })
      } else if (isCombinedScope(scope)) {
        // 상단 KPI는 서버로 먼저 표시 → detail은 BG로 세그먼트 표 채움
        loadDetailInBackground(scope)
      } else if (!isLazyDetailLoad()) {
        loadDetailInBackground(scope)
      }
      // other_sellers·platform lazy: detail prefetch 없음
    } catch {
      /* error set */
    } finally {
      loading.value = false
    }
    return
  }
  if (scope !== POWER_PRICE_SCOPE && scope !== COUPANG_1P_ROCKET_SCOPE) {
    await ensureDetailCache()
  }
  await loadRecordsForScope(scope)
}

async function ensureLoaded() {
  await ensureCoreLoaded()
  if (detailCacheLoaded.value) return
  try {
    await refreshAll()
  } catch (e) {
    error.value = `데이터 불러오기 실패: ${e.message}`
  }
}

async function refreshAfterUpload(scopes = ['platform']) {
  await loadUploads()
  const scopeList = Array.isArray(scopes) ? scopes : [scopes]
  for (const s of scopeList) invalidateServerKpiCaches(s)
  invalidateDetailCache()
  if (isServerKpi()) {
    await Promise.all(scopeList.map((s) => loadServerKpiForScope(s, { forceRefresh: true })))
    // KPI만 즉시 갱신. detail은 다음 펼침/엑셀 때 로드 (lazy 기본)
    if (!isLazyDetailLoad()) {
      if (
        scopeList.some((s) => isCombinedScope(s) || s === 'other_sellers') ||
        detailCacheLoading.value
      ) {
        await ensureDetailCache({ forceRefresh: true })
      }
    }
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
        const spendOnly = scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE
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
    if (tab === 'daily') return dailyFromDetails.value
    if (tab === 'detail') return scopedSaleDetails.value
    if (tab === 'returns') return scopedReturnDetails.value
    if (scope !== 'sales_report') {
      const details = detailsForSummaryAggregation(scope, slice)
      if (details.length) return buildSummaryTabFromDetails(tab, details)
    }
    const stored = applyUploadScope(filterByScope(slice.records.value, scope), slice.selectedUploadIds)
    if (stored.length) return stored
    const details = detailsForSummaryAggregation(scope, slice)
    if (details.length) return buildSummaryTabFromDetails(tab, details)
    return []
  })

  const filteredRecords = computed(() => {
    const base = recordsForActiveTab.value
    if (slice.activeTab.value === 'daily') {
      const dateQ = slice.filters.value.date
      if (!dateQ) return base
      return base.filter((r) => String(r.date || '').includes(dateQ))
    }
    return applyRecordFilters(base, slice.activeTab.value, slice.filters.value)
  })

  const sortedFilteredRecords = computed(() =>
    sortRecordsForTab(filteredRecords.value, slice.activeTab.value),
  )

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
    if (scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE) return
    await ensureDetailCache()
    await loadRecordsForScope(scope, { silent: true })
  }

  async function switchTab(type) {
    slice.activeTab.value = type
    if (scope !== POWER_PRICE_SCOPE && scope !== COUPANG_1P_ROCKET_SCOPE) {
      await ensureDetailCache()
      if (type !== 'detail' && type !== 'returns') {
        await ensureTabAggregateCache(type)
      }
    }
    await loadRecordsForScope(scope)
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
      const manualScopes = combined
        ? combinedManualAdScopes(scope)
        : [resolveExternalAdScope(adChannel, 'daily') || dailyScopeForMonthly(scope)].filter(Boolean)
      await Promise.all(manualScopes.map((s) => hydrateManualAdForScope(s)))

      if (combined) {
        await hydrateCombinedCommentsForScope(scope)
      }
      if (combined && isMonthlyScope(scope)) {
        await hydrateSpecialSaleForScope(scope)
      }

      // Phase 4: 통합 포함 — 서버 export 우선 (detail/ExcelJS 메인스레드 회피)
      if (canPgExport) {
        const f = slice.filters.value
        const overrides = {}
        if (combined) {
          overrides.combined_comments = getCombinedCommentsSnapshot(scope, {
            dateFrom: f.dateFrom || '',
            dateTo: f.dateTo || '',
          })
          if (isMonthlyScope(scope)) {
            const monthKey =
              resolveReferenceMonthKey([], { ...f, period: adPeriod }) ||
              (f.dateTo ? String(f.dateTo).slice(0, 7) : '')
            overrides.special_sale = getSpecialSaleSnapshot(scope, monthKey)
          }
        }
        try {
          const { blob, fileName } = await pgDownloadIntegratedExport(
            {
              scope,
              from: f.dateFrom,
              to: f.dateTo,
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
          // 서버 실패 시에만 클라 ExcelJS fallback
          console.warn('PG export 실패, 클라이언트 fallback:', pgErr?.message || pgErr)
        }
      }

      // ExcelJS fallback — detail 캐시 필요
      try {
        await ensureDetailForScope()
      } catch {
        /* fall through */
      }
      const rows = filteredDetailForCharts.value
      if (!rows.length) {
        error.value = '다운로드할 데이터가 없습니다. 필터·업로드 선택을 확인하세요.'
        return
      }

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
        combinedComments: combined
          ? getCombinedCommentsSnapshot(scope, {
              dateFrom: slice.filters.value.dateFrom || '',
              dateTo: slice.filters.value.dateTo || '',
            })
          : null,
        profitLossTemplate: combined ? getProfitLossTemplateSnapshot() : null,
        hiddenKpiKeys: combined
          ? COMBINED_HIDDEN_KPI_KEYS
          : scope === POWER_PRICE_SCOPE
            ? POWER_PRICE_HIDDEN_KPI_KEYS
            : scope === COUPANG_1P_ROCKET_SCOPE
              ? COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS
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
    const rows = sortedFilteredRecords.value
    const tab = slice.activeTab.value
    let cols = resolveTableColumns()
    if (tab === 'detail') {
      cols = resolveDetailColumns(scopedSaleDetails.value)
    } else if (tab === 'returns') {
      cols = resolveDetailColumns(scopedReturnDetails.value)
    } else if (usesEsserDashboard(scope) || scopedDetailRecords.value.some(isEsserDetailRow)) {
      cols = resolveSummaryColumns(tab, scopedDetailRecords.value)
    } else {
      cols = RECORD_TYPES[tab]?.columns || []
    }
    if (!rows.length) {
      error.value = '다운로드할 표 데이터가 없습니다.'
      return
    }
    error.value = ''
    saving.value = true
    try {
      const channel = getChannelByScope(scope)
      const { downloadTableExcel } = await import('../utils/dashboardExporter.js')
      await downloadTableExcel({
        rows,
        columns: cols,
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

  function downloadMergedExcel() {
    if (slice.selectedUploadIds.value.length < 2) {
      error.value = '통합할 업로드를 2개 이상 선택하세요.'
      return
    }
    const details = applyRecordFilters(scopedSaleDetails.value, 'detail', {
      year: '',
      month: '',
      dayOfWeek: '',
      date: '',
      channel: '',
      brand: '',
      productName: '',
      option: '',
    })
    if (!details.length) {
      error.value = '통합할 판매 상세 데이터가 없습니다.'
      return
    }
    const selected = uploads.value.filter((u) => slice.selectedUploadIds.value.includes(u.id))
    downloadMergedSalesReport(details, mergedFileName(selected))
    success.value = `${selected.length}개 파일 통합 엑셀을 다운로드했습니다. (${dateRangeLabel(details) || '기간 미상'})`
    error.value = ''
  }

  function clearFilters() {
    slice.filters.value = createDefaultFilters()
  }

  function resolveTableColumns() {
    const tab = slice.activeTab.value
    const details = scopedDetailRecords.value
    if (tab === 'detail' || tab === 'returns') {
      return sanitizeDetailColumns(resolveDetailColumns(details))
    }
    if (usesEsserDashboard(scope) || details.some(isEsserDetailRow)) {
      return resolveSummaryColumns(tab, details)
    }
    return sanitizeDetailColumns(RECORD_TYPES[tab]?.columns || [])
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
    availableYears,
    monthOptions,
    weekdayOptions,
    mergeSelectionLabel,
    isMergeActive,
    visualDailyRecords,
    serverKpiBucket: slice.serverKpiBucket,
    serverDailyChartBuckets: slice.serverDailyChartBuckets,
    serverPlatformKpiRows: slice.serverPlatformKpiRows,
    serverDayOverDayRows: slice.serverDayOverDayRows,
    serverKpiLoaded: slice.serverKpiLoaded,
    usesServerKpiMode,
    reloadServerKpi: () => loadServerKpiForScope(scope),
    uploadsByKind,
    uploadSalesMethod,
    ensureLoaded,
    ensureDashboardReady,
    ensureDetailCache,
    ensureDetailForScope,
    retryDetailCache,
    refreshAll,
    switchTab,
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
