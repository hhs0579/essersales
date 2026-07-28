<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, toRefs, watch } from 'vue'
import SalesRecordEditModal from './SalesRecordEditModal.vue'

const SalesPeriodDashboard = defineAsyncComponent(() => import('./SalesPeriodDashboard.vue'))
import {
  RECORD_TYPES,
  RECORD_TAB_KEYS_MAIN,
  RECORD_TAB_KEY_RETURNS,
  sanitizeDetailColumns,
} from '../constants/salesColumns'
import { formatCellValue, isNumericColumn, resolveDetailField } from '../utils/formatDisplay.js'
import { useSalesData } from '../composables/useSalesData.js'
import { isPgExportMode } from '../services/exportApiMode.js'
import {
  getChannelByScope,
  usesEsserDashboard,
  isPowerPriceScope as isPowerPriceScopeFn,
  isCoupang1pRocketScope as isCoupang1pRocketScopeFn,
  isOtherSellersScope as isOtherSellersScopeFn,
  isMonthlyScope,
  isCombinedScope,
  combinedIncludesPowerPrice,
  dailyScopeForMonthly,
} from '../config/dataChannels.js'
import { EXTERNAL_AD_CHANNELS, resolveExternalAdScope } from '../config/externalAdChannels.js'
import { COMBINED_HIDDEN_KPI_KEYS } from '../config/combinedChannel.js'
import { POWER_PRICE_HIDDEN_KPI_KEYS } from '../config/powerPrice.js'
import { COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS } from '../config/coupang1pRocket.js'
import { getManualAdSnapshot } from '../composables/useManualAdSpend.js'
import { maxReportDateYmd } from '../utils/reportDateRange.js'
import VirtualScrollTableBody from './VirtualScrollTableBody.vue'
import DatePeriodFilter from './DatePeriodFilter.vue'
import CollapsibleSection from './CollapsibleSection.vue'
import ManualAdSpendPanel from './ManualAdSpendPanel.vue'
import PowerPricePanel from './PowerPricePanel.vue'
import Coupang1pRocketPanel from './Coupang1pRocketPanel.vue'
import SpecialSalePanel from './SpecialSalePanel.vue'
import { useManualAdSpend } from '../composables/useManualAdSpend.js'
import { ownMallManualDetailRecords } from '../composables/useOwnMallManual.js'
import { powerPriceDetailRecords } from '../composables/usePowerPrice.js'
import { coupang1pRocketDetailRecords } from '../composables/useCoupang1pRocket.js'
import { mergeDashboardManualInputRecords } from '../utils/dashboardKpiRecords.js'
import { getCombinedCommentsSnapshot } from '../composables/useCombinedComments.js'
import { getSpecialSaleSnapshot, getSpecialSaleMonthlyMap } from '../composables/useSpecialSale.js'
import {
  buildSpecialSaleMonthlyTotals,
  resolveReferenceMonthKey,
} from '../utils/dayOverDaySales.js'
import { findExternalAdChannelByScope } from '../config/externalAdChannels.js'
import { PLATFORM_OPTIONS } from '../constants/platforms.js'
import { salesMethodOptionsForPlatform } from '../constants/salesMethods.js'
import { normalizePlatformLabel } from '../utils/platformDetect.js'
import { UI_BUILD_ID } from '../constants/appVersion.js'

const props = defineProps({
  /** @type {'platform' | 'company_b' | 'sales_report'} */
  scope: { type: String, required: true },
})

const isCombined = computed(() => isCombinedScope(props.scope))
const isPlatformDaily = computed(() => props.scope === 'platform')
const isCompanyBDaily = computed(() => props.scope === 'company_b')
const isPowerPriceScope = computed(() => isPowerPriceScopeFn(props.scope))
const isCoupang1pScope = computed(() => isCoupang1pRocketScopeFn(props.scope))
const isOtherSellersScope = computed(() => isOtherSellersScopeFn(props.scope))
const isManualInputScope = computed(() => isPowerPriceScope.value || isCoupang1pScope.value)
const isMonthlyEsserScope = computed(() => isMonthlyScope(props.scope))
const isDailyEsserScope = computed(() => usesEsserDashboard(props.scope) && !isMonthlyEsserScope.value)
const isEsserScope = computed(() => usesEsserDashboard(props.scope) || isMonthlyEsserScope.value)
const isPlatformScope = computed(() => isEsserScope.value && !isManualInputScope.value)

const pageMeta = computed(() => {
  const channel = getChannelByScope(props.scope)
  if (isPowerPriceScope.value) {
    return {
      dashboardTitle: `${channel?.tabLabel || '파워프라이스'} 일별 매출 대시보드`,
      dashboardHint:
        '스마트스토어 직접입력 KPI입니다. 판매·광고는 아래 입력란에서 수정하세요. 매출 KPI는 스마트스토어 행에 표시됩니다.',
      dataTitle: `${channel?.tabLabel || '파워프라이스'} · 판매 데이터`,
      emptyHint: '물품과 판매를 등록하면 표·대시보드에 반영됩니다.',
      showPeriodDashboard: true,
      showUploadPicker: false,
      hideDayOverDay: true,
      dateColumnHint: '날짜',
    }
  }
  if (isCoupang1pScope.value) {
    return {
      dashboardTitle: `${channel?.tabLabel || '쿠팡 1P 로켓'} 발주 대시보드`,
      dashboardHint:
        '발주 직접입력 KPI입니다. 공급매출·매입원가가 쿠팡 행에 표시되며, 베스트하임 일별 매출 대시보드 쿠팡 KPI에도 합산됩니다.',
      dataTitle: `${channel?.tabLabel || '쿠팡 1P 로켓'} · 발주 데이터`,
      emptyHint: '상품과 발주를 등록하면 표·대시보드에 반영됩니다.',
      showPeriodDashboard: true,
      showUploadPicker: false,
      hideDayOverDay: true,
      dateColumnHint: '발주일',
      showManualAdPanel: false,
    }
  }
  if (isCombined.value) {
    const monthly = isMonthlyEsserScope.value
    return {
      dashboardTitle: monthly
        ? '통합 월별 매출 대시보드'
        : '베스트하임·사본느리·파워프라이스 통합 대시보드',
      dashboardHint: monthly
        ? '일별 매출 데이터를 월 단위로 자동 집계합니다. 특판 매출은 월별로 저장·합산되며, 전월 대비 매출을 확인할 수 있습니다.'
        : '주간 보고용 — 베스트하임(판매자+그로스·로켓·스스)·사본느리(판매자·스스·자사몰)·파워프라이스·외부광고 순으로 KPI를 표시합니다. 쿠팡 1P 로켓 발주는 베스트하임(로켓)에 포함됩니다.',
      dataTitle: monthly ? '통합 월별 매출 · 판매 데이터 (일별 기반 자동 집계)' : '통합 일별 매출 · 판매 데이터',
      emptyHint:
        '베스트하임·사본느리 일별 엑셀 업로드와 파워프라이스 직접 입력이 통합 탭에 자동 반영됩니다.',
      showPeriodDashboard: true,
      showUploadPicker: false,
      hideDayOverDay: false,
      dateColumnHint: monthly ? '기간' : '날짜',
      showManualAdPanel: false,
    }
  }
  if (isMonthlyEsserScope.value) {
    return {
      dashboardTitle: `${channel?.tabLabel || ''} 월별 매출 대시보드`,
      dashboardHint:
        '일별 매출 데이터를 월 단위로 자동 집계합니다. 별도 월별 업로드 없이 일별 엑셀만 업로드하면 됩니다. 전월 대비 매출을 확인할 수 있습니다.',
      dataTitle: `월별 매출 · ${channel?.tabLabel || ''} (일별 기반 자동 집계)`,
      emptyHint: `플랫폼 업로드 → ${channel?.tabLabel || ''} → 일별 엑셀에서 파일을 업로드하세요.`,
      showPeriodDashboard: true,
      showUploadPicker: false,
      hideDayOverDay: false,
      dateColumnHint: '기간',
      showManualAdPanel: true,
    }
  }
  if (isDailyEsserScope.value) {
    return {
      dashboardTitle: `${channel?.reportTitle || '일별 매출'} 대시보드`,
      dashboardHint:
        '매출·마진·광고 KPI를 쿠팡 / 스마트스토어 / 합계으로 나눠 표시합니다. 쿠팡 1P 로켓 발주 직접입력도 쿠팡 KPI에 합산됩니다.',
      dataTitle: `${channel?.reportTitle || '일별 매출'} · ${channel?.tabLabel || ''}`,
      emptyHint: `플랫폼 업로드 → ${channel?.tabLabel || ''} → 일별 엑셀에서 파일을 업로드하세요.`,
      showPeriodDashboard: true,
      showUploadPicker: false,
      hideDayOverDay: false,
      dateColumnHint: '날짜',
      showManualAdPanel: true,
    }
  }
  return {
    uploadTitle: '통합 매출 업로드 선택',
    uploadHint: '체크한 통합 매출 리포트만 아래 표에 반영됩니다.',
    dataTitle: '통합 매출 저장 데이터',
    emptyHint: '통합 매출 리포트 탭에서 파일을 업로드하세요.',
    showPeriodDashboard: false,
    showUploadPicker: true,
    dateColumnHint: '날짜',
  }
})

const sales = useSalesData({ scope: props.scope })
const salesRoot = useSalesData()
const {
  detailCacheLoading,
  detailCacheError,
  detailCacheLoaded,
} = toRefs(salesRoot)
const { retryDetailCache: retryDetailCacheGlobal } = salesRoot
const {
  activeTab,
  loading,
  saving,
  error,
  success,
  filters,
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
  scopedUploads,
  serverKpiBucket,
  serverPlatformKpiRows,
  serverDayOverDayRows,
  serverKpiLoaded,
  usesServerKpiMode,
} = toRefs(sales)
const {
  ensureDashboardReady,
  ensureDetailForScope,
  retryDetailCache,
  refreshAll,
  switchTab,
  openEdit,
  onSaveEdit,
  onDelete,
  downloadDashboardExport,
  downloadCurrentTableExport,
  clearFilters: clearFiltersRaw,
  resolveTableColumns,
  reloadServerKpi,
} = sales

/** 월별 대시보드는 조회 월만 다루므로 초기화 시 기본 월로 되돌립니다. */
function clearFilters() {
  clearFiltersRaw()
  if (isMonthlyEsserScope.value) {
    filters.value.year = ''
    filters.value.month = ''
    ensureDefaultReportMonth()
  }
}

const columns = computed(() => sanitizeDetailColumns(resolveTableColumns()))

function thClass(key) {
  return {
    'cell-num': isNumericColumn(key),
    'col-platform': key === 'platform',
    'col-method': key === 'salesMethod',
    'col-product': key === 'productName' || key === 'option',
  }
}

function tdClass(key, row) {
  return {
    'cell-num': isNumericColumn(key),
    'col-platform': key === 'platform',
    'col-method': key === 'salesMethod',
    'col-product': key === 'productName' || key === 'option',
    'cell-empty': key === 'salesMethod' && !resolveDetailField(row, key),
  }
}

function pillClass(key, row) {
  const v = resolveDetailField(row, key)
  if (!v) return 'pill-muted'
  if (key === 'platform') {
    if (v === '스마트스토어') return 'pill-smartstore'
    if (v === '쿠팡') return 'pill-coupang'
  }
  if (key === 'salesMethod') {
    if (v === '일반배송') return 'pill-general'
    if (v === 'N배송') return 'pill-n'
    if (v === '로켓그로스') return 'pill-rocket'
    if (v === '판매자배송') return 'pill-seller'
  }
  return 'pill-default'
}


const periodSummary = computed(() => {
  const { dateFrom, dateTo } = filters.value
  if (!dateFrom && !dateTo) return ''
  if (dateFrom && dateTo && dateFrom === dateTo) return ` · ${dateFrom}`
  if (dateFrom && dateTo) return ` · ${dateFrom} ~ ${dateTo}`
  if (dateFrom) return ` · ${dateFrom}~`
  return ` · ~${dateTo}`
})

const hasAnyData = computed(
  () =>
    scopedSaleDetails.value.length > 0 ||
    scopedReturnDetails.value.length > 0 ||
    scopedUploads.value.length > 0 ||
    (isCombined.value &&
      (ownMallManualDetailRecords.value.length > 0 ||
        powerPriceDetailRecords.value.length > 0)) ||
    (usesServerKpiMode.value &&
      (serverKpiLoaded.value ||
        serverKpiBucket.value != null ||
        serverPlatformKpiRows.value.length > 0)),
)

/** Server KPI 로드 후에는 상세 캐시 로딩 중에도 대시보드 유지 */
const showPeriodDashboardSection = computed(
  () =>
    pageMeta.value.showPeriodDashboard &&
    hasAnyData.value &&
    (!loading.value || serverKpiLoaded.value),
)

/** PG export는 API가 DB에서 직접 조회 — 상세 캐시 없어도 다운로드 가능 */
const canDownloadDashboard = computed(
  () =>
    filteredDetailForCharts.value.length > 0 ||
    (isPgExportMode() && hasAnyData.value),
)

const tableEmptyHint = computed(() => {
  if (activeTab.value === 'returns') {
    return '반품(취소) 건이 없습니다. 마이너스 매출·수량 행만 반품으로 분류됩니다.'
  }
  return pageMeta.value.emptyHint
})

const returnTabCount = computed(() => scopedReturnDetails.value.length)

// 월별 대시보드도 일별 데이터 기반 — 광고는 일별 scope에서 조회 (일별=월별 동일)
const adScope = computed(() =>
  isMonthlyEsserScope.value ? dailyScopeForMonthly(props.scope) : props.scope,
)
const { entries: manualAdEntriesRef } = useManualAdSpend(adScope.value)
const manualAdEntries = computed(() =>
  isCombined.value ? getManualAdSnapshot(props.scope) : manualAdEntriesRef.value,
)

function buildManualAdByChannel(entries) {
  if (isCombined.value) {
    return EXTERNAL_AD_CHANNELS.filter((ch) =>
      combinedIncludesPowerPrice(props.scope) ? true : ch.dailyScope !== 'power_price',
    ).map((ch) => ({
      label: ch.label,
      entries: getManualAdSnapshot(resolveExternalAdScope(ch, 'daily')),
    }))
  }
  const ch = findExternalAdChannelByScope(props.scope)
  const label = ch?.label || getChannelByScope(props.scope)?.tabLabel || '외부 광고'
  return [{ label, entries }]
}

const manualFilterCtx = computed(() => ({
  platform: normalizePlatformLabel(filters.value.platform),
  salesMethod: filters.value.salesMethod,
  year: filters.value.year,
  month: filters.value.month,
  dateFrom: filters.value.dateFrom,
  dateTo: filters.value.dateTo,
  period: isMonthlyEsserScope.value ? 'monthly' : 'daily',
}))

/** 월별 대시보드 — 선택 월의 1일~말일로 기간 자동 설정 */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function applyMonthlyPeriodFromFilters() {
  if (!isMonthlyEsserScope.value) return
  const y = String(filters.value.year || '').trim()
  const mo = String(filters.value.month || '').trim()
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(mo)) return
  const month = Number(mo)
  const padMo = String(month).padStart(2, '0')
  const last = lastDayOfMonth(Number(y), month)
  filters.value.dayOfWeek = ''
  filters.value.dateFrom = `${y}-${padMo}-01`
  filters.value.dateTo = `${y}-${padMo}-${String(last).padStart(2, '0')}`
}

/** 데이터에서 기본월을 잡았는지 (사용자 선택 전 최신월 자동 지정) */
let reportMonthResolvedFromData = false

/** 월별 대시보드 진입 시 기본 조회 월을 데이터 최신월로 설정 (날짜 필터 미적용 데이터 기준) */
function ensureDefaultReportMonth() {
  if (!isMonthlyEsserScope.value) return
  if (filters.value.year && filters.value.month && reportMonthResolvedFromData) {
    applyMonthlyPeriodFromFilters()
    return
  }
  const mk = resolveReferenceMonthKey(scopedSaleDetails.value, { period: 'monthly' })
  if (!mk) {
    // 데이터 로딩 전 — 현재 월로 임시 지정, 데이터 도착 시 재지정
    if (!filters.value.year || !filters.value.month) {
      const [cy, cm] = currentDashboardMonthKey().split('-')
      filters.value.year = cy
      filters.value.month = String(Number(cm))
      applyMonthlyPeriodFromFilters()
    }
    return
  }
  const [y, mo] = mk.split('-')
  filters.value.year = y
  filters.value.month = String(Number(mo))
  reportMonthResolvedFromData = true
  applyMonthlyPeriodFromFilters()
}

function currentDashboardMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

watch(
  () => [filters.value.year, filters.value.month],
  () => applyMonthlyPeriodFromFilters(),
)

/** 특판·전월대비 기준월 (YYYY-MM) */
const specialSaleMonthKey = computed(() => {
  const y = String(filters.value.year || '').trim()
  const mo = String(filters.value.month || '').trim()
  if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(mo)) {
    return `${y}-${String(mo).padStart(2, '0')}`
  }
  return resolveReferenceMonthKey(filteredDetailForCharts.value, manualFilterCtx.value) || ''
})

function buildSpecialSaleContext() {
  if (!isCombined.value || !isMonthlyEsserScope.value) {
    return { specialSale: null, specialSaleByMonth: null }
  }
  const mk = specialSaleMonthKey.value
  const monthlyMap = getSpecialSaleMonthlyMap(props.scope, mk)
  return {
    specialSale: getSpecialSaleSnapshot(props.scope, mk),
    specialSaleByMonth: buildSpecialSaleMonthlyTotals(monthlyMap),
  }
}

/** 광고·조회 조건 변경 시 KPI 재계산 부담 완화 */
const MANUAL_AD_DASHBOARD_DEBOUNCE_MS = 320
const DASHBOARD_KPI_DEBOUNCE_MS = 380

const manualAdEntriesForDashboard = ref(manualAdEntries.value)
let manualAdDashboardTimer = null
watch(
  manualAdEntries,
  (v) => {
    if (manualAdDashboardTimer) clearTimeout(manualAdDashboardTimer)
    manualAdDashboardTimer = setTimeout(() => {
      manualAdEntriesForDashboard.value = v
    }, MANUAL_AD_DASHBOARD_DEBOUNCE_MS)
  },
  { deep: true },
)

const dashboardKpiRecords = ref(filteredDetailForCharts.value)
const dashboardKpiPlatformSplit = ref(dashboardPlatformSplitRecords.value)
const dashboardKpiDayOverDay = ref(dashboardDayOverDayRecords.value)
const dashboardKpiFilterCtx = ref({ ...manualFilterCtx.value })
const dashboardKpiManualAdByChannel = ref(buildManualAdByChannel(manualAdEntriesForDashboard.value))

function syncDashboardKpiSnapshot() {
  const ssCtx = buildSpecialSaleContext()
  const filterCtx = {
    ...manualFilterCtx.value,
    specialSale: ssCtx.specialSale,
    specialSaleByMonth: ssCtx.specialSaleByMonth,
    combinedComments: isCombined.value
      ? getCombinedCommentsSnapshot(props.scope, {
          dateFrom: filters.value.dateFrom || '',
          dateTo: filters.value.dateTo || '',
        })
      : null,
  }
  dashboardKpiRecords.value = mergeDashboardManualInputRecords(
    filteredDetailForCharts.value,
    props.scope,
    filterCtx,
    {
      coupang1p: coupang1pRocketDetailRecords.value,
      powerPrice: powerPriceDetailRecords.value,
      ownMall: ownMallManualDetailRecords.value,
    },
  )
  dashboardKpiPlatformSplit.value = dashboardPlatformSplitRecords.value
  dashboardKpiDayOverDay.value = dashboardDayOverDayRecords.value
  dashboardKpiFilterCtx.value = {
    ...manualFilterCtx.value,
    specialSale: ssCtx.specialSale,
    specialSaleByMonth: ssCtx.specialSaleByMonth,
    combinedComments: isCombined.value
      ? getCombinedCommentsSnapshot(props.scope, {
          dateFrom: filters.value.dateFrom || '',
          dateTo: filters.value.dateTo || '',
        })
      : null,
  }
  dashboardKpiManualAdByChannel.value = buildManualAdByChannel(manualAdEntriesForDashboard.value)
}

let dashboardKpiTimer = null
function scheduleDashboardKpiRefresh() {
  if (dashboardKpiTimer) clearTimeout(dashboardKpiTimer)
  dashboardKpiTimer = setTimeout(() => {
    syncDashboardKpiSnapshot()
    dashboardKpiTimer = null
  }, DASHBOARD_KPI_DEBOUNCE_MS)
}

watch(
  [
    filteredDetailForCharts,
    dashboardPlatformSplitRecords,
    dashboardDayOverDayRecords,
    manualFilterCtx,
    manualAdEntriesForDashboard,
    () => props.scope,
    coupang1pRocketDetailRecords,
    powerPriceDetailRecords,
    ownMallManualDetailRecords,
  ],
  scheduleDashboardKpiRefresh,
)

watch(
  [
    manualFilterCtx,
    () => props.scope,
    ownMallManualDetailRecords,
    powerPriceDetailRecords,
    coupang1pRocketDetailRecords,
  ],
  () => {
    if (usesServerKpiMode.value) {
      reloadServerKpi()
    }
  },
  { deep: true },
)

watch(detailCacheLoaded, (loaded) => {
  if (loaded && isCombined.value) {
    syncDashboardKpiSnapshot()
  }
})

onMounted(async () => {
  await ensureDashboardReady(props.scope)
  ensureDefaultReportMonth()
  syncDashboardKpiSnapshot()
})

watch(scopedSaleDetails, () => {
  ensureDefaultReportMonth()
})

async function onDataSectionExpand() {
  try {
    await ensureDetailForScope()
  } catch {
    /* error set in composable */
  }
}

async function retryDetailCacheLoad() {
  try {
    await retryDetailCacheGlobal()
    await ensureDetailForScope()
  } catch {
    /* error set */
  }
}

onUnmounted(() => {
  if (manualAdDashboardTimer) clearTimeout(manualAdDashboardTimer)
  if (dashboardKpiTimer) clearTimeout(dashboardKpiTimer)
})

const dataSectionSubtitle = computed(() => {
  const n = scopedSaleDetails.value.length
  const hint = '상품·판매처별 상세 표 (기본 접힘 — 펼치면 표시)'
  if (n > 0) return `${hint} · 판매 ${n.toLocaleString('ko-KR')}건`
  if (detailCacheLoading.value) return `${hint} · 상세 데이터 불러오는 중…`
  return hint
})

const salesMethodFilterOptions = computed(() =>
  salesMethodOptionsForPlatform(normalizePlatformLabel(filters.value.platform)),
)

const monthlyYearOptions = computed(() => {
  if (availableYears.value?.length) return availableYears.value
  return [new Date().getFullYear()]
})
</script>

<template>
  <CollapsibleSection title="조회 조건" card-class="filters-panel">
    <div v-if="isMonthlyEsserScope" class="filters-month-block">
      <div class="filters-month-row">
        <label class="filter-field">
          <span class="field-label">연도</span>
          <select v-model="filters.year" class="filter-select">
            <option v-for="y in monthlyYearOptions" :key="y" :value="String(y)">{{ y }}년</option>
          </select>
        </label>
        <label class="filter-field">
          <span class="field-label">월</span>
          <select v-model="filters.month" class="filter-select">
            <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </label>
        <span class="month-only-hint">
          선택한 월 1일~말일 일별 매출을 자동 집계합니다.
        </span>
      </div>
      <div v-if="isCombined" class="filters-special-sale">
        <SpecialSalePanel
          :scope="props.scope"
          :month-key="specialSaleMonthKey"
          @saved="syncDashboardKpiSnapshot"
        />
      </div>
    </div>

    <template v-else>
    <div class="filters-date-block">
      <DatePeriodFilter
        v-model:date-from="filters.dateFrom"
        v-model:date-to="filters.dateTo"
        :max-date="maxReportDateYmd()"
      />
    </div>

    <div class="filters-grid">
      <label class="filter-field">
        <span class="field-label">연도</span>
        <select v-model="filters.year" class="filter-select">
          <option value="">전체</option>
          <option v-for="y in availableYears" :key="y" :value="String(y)">{{ y }}년</option>
        </select>
      </label>
      <label class="filter-field">
        <span class="field-label">월</span>
        <select v-model="filters.month" class="filter-select">
          <option value="">전체</option>
          <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </label>
      <label class="filter-field">
        <span class="field-label">요일</span>
        <select v-model="filters.dayOfWeek" class="filter-select">
          <option value="">전체</option>
          <option v-for="w in weekdayOptions" :key="w.value" :value="w.value">{{ w.label }}</option>
        </select>
      </label>
      <label v-if="isPlatformScope" class="filter-field">
        <span class="field-label">플랫폼</span>
        <select v-model="filters.platform" class="filter-select">
          <option v-for="opt in PLATFORM_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label v-if="isPlatformScope" class="filter-field">
        <span class="field-label">판매방식</span>
        <select v-model="filters.salesMethod" class="filter-select">
          <option
            v-for="opt in salesMethodFilterOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>
    </div>
    </template>
    <div class="filters-footer-actions">
      <button type="button" class="filter-action ghost" @click="clearFilters">초기화</button>
      <button type="button" class="filter-action primary" :disabled="loading" @click="refreshAll">
        새로고침
      </button>
    </div>
  </CollapsibleSection>

  <CollapsibleSection
    v-if="isPowerPriceScope"
    title="파워프라이스 · 물품·판매·광고 입력"
    subtitle="엑셀 없이 직접 기입 — 대시보드 KPI·엑셀에 반영"
  >
    <PowerPricePanel :scope="scope" :filter-ctx="manualFilterCtx" />
  </CollapsibleSection>

  <CollapsibleSection
    v-if="isCoupang1pScope"
    title="쿠팡 1P 로켓 · 상품·발주 입력"
    subtitle="발주 직접 기입 — 베스트하임 쿠팡 매출 KPI·엑셀에 반영"
  >
    <Coupang1pRocketPanel :scope="scope" :filter-ctx="manualFilterCtx" />
  </CollapsibleSection>

  <CollapsibleSection
    v-if="isEsserScope && !isManualInputScope && pageMeta.showManualAdPanel !== false"
    :title="isMonthlyEsserScope ? '외부·타 채널 월별 광고' : '외부·타 채널 일별 광고'"
    :subtitle="
      isMonthlyEsserScope
        ? '월별 광고비용 · 전환매출액 입력 — KPI·엑셀에 반영'
        : '일자별 광고비용 · 전환매출액 입력 — KPI·엑셀에 반영'
    "
    default-collapsed
    lazy
  >
    <ManualAdSpendPanel :scope="adScope" :filter-ctx="manualFilterCtx" />
  </CollapsibleSection>

  <CollapsibleSection
    v-if="showPeriodDashboardSection"
    :title="pageMeta.dashboardTitle"
    :subtitle="pageMeta.dashboardHint"
  >
    <template #actions>
      <button
        type="button"
        class="btn btn-success btn-sm"
        :disabled="saving || !canDownloadDashboard"
        @click="downloadDashboardExport"
      >
        {{ saving ? '엑셀 생성 중…' : '대시보드 엑셀 다운로드' }}
      </button>
    </template>
    <SalesPeriodDashboard
      v-model:platform="filters.platform"
      v-model:sales-method="filters.salesMethod"
      hide-scope-filters
      :show-platform-breakdown="isEsserScope"
      :power-price-kpi="isPowerPriceScope"
      :coupang1p-kpi="isCoupang1pScope"
      :other-sellers-kpi="isOtherSellersScope"
      :combined-kpi="isCombined"
      :hide-day-over-day="pageMeta.hideDayOverDay"
      :records="dashboardKpiRecords"
      :platform-split-records="dashboardKpiPlatformSplit"
      :day-over-day-records="dashboardKpiDayOverDay"
      :filter-year="filters.year"
      :manual-ad-entries="manualAdEntriesForDashboard"
      :manual-ad-by-channel="dashboardKpiManualAdByChannel"
      :manual-filter-ctx="dashboardKpiFilterCtx"
      :server-kpi-bucket="usesServerKpiMode ? serverKpiBucket : null"
      :server-platform-kpi-rows="usesServerKpiMode ? serverPlatformKpiRows : []"
      :server-day-over-day-rows="usesServerKpiMode ? serverDayOverDayRows : []"
      :hidden-kpi-keys="
        isPowerPriceScope
          ? POWER_PRICE_HIDDEN_KPI_KEYS
          : isCoupang1pScope
            ? COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS
            : isCombined
              ? COMBINED_HIDDEN_KPI_KEYS
              : []
      "
    />
  </CollapsibleSection>

  <CollapsibleSection
    :title="pageMeta.dataTitle"
    :subtitle="dataSectionSubtitle"
    default-collapsed
    lazy
    @expand="onDataSectionExpand"
  >
    <template #actions>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        :disabled="!sortedFilteredRecords.length"
        @click="downloadCurrentTableExport"
      >
        현재 표 엑셀 다운로드
      </button>
    </template>
    <p v-if="usesServerKpiMode && detailCacheLoading" class="standard-ref detail-cache-status">
      상세 데이터를 불러오는 중입니다.
    </p>
    <p v-else-if="usesServerKpiMode && detailCacheError" class="error-msg detail-cache-status">
      상세 데이터 로드 실패: {{ detailCacheError }}
      <button type="button" class="btn btn-outline btn-sm" @click="retryDetailCacheLoad">
        다시 시도
      </button>
    </p>
    <div class="tab-bar">
      <button
        v-for="key in RECORD_TAB_KEYS_MAIN"
        :key="key"
        type="button"
        class="tab"
        :class="{ active: activeTab === key }"
        @click="switchTab(key)"
      >
        {{ RECORD_TYPES[key].label }}
      </button>
      <span class="tab-bar-divider" aria-hidden="true" />
      <button
        type="button"
        class="tab tab-returns"
        :class="{ active: activeTab === RECORD_TAB_KEY_RETURNS }"
        @click="switchTab(RECORD_TAB_KEY_RETURNS)"
      >
        {{ RECORD_TYPES.returns.label }}
        <span v-if="returnTabCount > 0" class="tab-badge">{{ returnTabCount }}</span>
      </button>
    </div>
    <p v-if="isPlatformScope" class="standard-ref tab-scope-hint">
      <strong>판매</strong> 탭·위 KPI에는 판매만 표시됩니다.
      <strong>반품·취소</strong>는 오른쪽 맨 아래 <strong>반품</strong> 탭에서만 확인하세요.
    </p>

    <div v-if="activeTab === 'detail' || activeTab === 'returns'" class="filter-bar tab-filters">
      <input v-model="filters.channel" type="text" placeholder="판매처" />
      <input v-model="filters.brand" type="text" placeholder="스토어/브랜드" />
      <input v-model="filters.productName" type="text" placeholder="상품명" />
    </div>
    <div v-else-if="activeTab === 'channel'" class="filter-bar tab-filters">
      <input v-model="filters.channel" type="text" placeholder="판매처 검색" />
    </div>
    <div v-else-if="activeTab === 'product'" class="filter-bar tab-filters">
      <input v-model="filters.productName" type="text" placeholder="상품명 검색" />
    </div>
    <div v-else-if="activeTab === 'productOption'" class="filter-bar tab-filters">
      <input v-model="filters.productName" type="text" placeholder="상품명 검색" />
      <input v-model="filters.option" type="text" placeholder="옵션 검색" />
    </div>

    <p
      v-if="isPlatformScope && activeTab === 'detail' && columns.length > 14"
      class="standard-ref table-hint"
    >
      에쎄르 형식: <strong>매출·순이익·광고</strong> 컬럼 포함. 표가 넓으면 <strong>가로 스크롤</strong>하세요.
      판매방식이 비면 네이버 빅셀 파일을 <strong>다시 업로드</strong>하세요. 엑셀 <strong>배송구분</strong> 열(일반배송·N배송)이 반영됩니다.
      <span class="ui-build-tag">빌드 {{ UI_BUILD_ID }}</span>
    </p>
    <div class="stats">
      <span>
        표시 <strong>{{ sortedFilteredRecords.length }}</strong> / 전체
        <strong>{{ recordsForActiveTab.length }}</strong>건 · 컬럼 {{ columns.length }}개
        <span v-if="activeTab === 'detail'" class="type-counts">
          · 판매 <strong>{{ scopedSaleDetails.length }}</strong>건
        </span>
        <span v-else-if="activeTab === 'returns'" class="type-counts">
          · 반품 <strong class="return-count">{{ scopedReturnDetails.length }}</strong>건
        </span>
        <span v-if="periodSummary" class="period-summary">{{ periodSummary }}</span>
      </span>
    </div>

    <div v-if="loading" class="empty">불러오는 중…</div>
    <div v-else-if="!sortedFilteredRecords.length" class="empty">{{ tableEmptyHint }}</div>
    <div v-else class="table-wrap table-wrap-tall sales-table-shell">
      <VirtualScrollTableBody :rows="sortedFilteredRecords" class="data-table-wide sales-detail-table">
        <template #head>
          <tr>
            <th
              v-for="col in columns"
              :key="col.key"
              :class="thClass(col.key)"
            >
              {{ col.label }}
            </th>
            <th v-if="!isManualInputScope" class="col-actions">관리</th>
          </tr>
        </template>
        <template #row="{ row }">
          <tr :class="{ 'row-return': activeTab === RECORD_TAB_KEY_RETURNS }">
            <td
              v-for="col in columns"
              :key="col.key"
              :class="tdClass(col.key, row)"
            >
              <span
                v-if="col.key === 'platform' || col.key === 'salesMethod'"
                class="cell-pill"
                :class="pillClass(col.key, row)"
              >
                {{ formatCellValue(col.key, resolveDetailField(row, col.key), row) || '—' }}
              </span>
              <template v-else>
                {{ formatCellValue(col.key, resolveDetailField(row, col.key), row) }}
              </template>
            </td>
            <td v-if="!isManualInputScope" class="col-actions">
              <button type="button" class="btn btn-outline btn-sm" @click="openEdit(row)">수정</button>
              <button type="button" class="btn btn-outline btn-sm danger-text" @click="onDelete(row)">
                삭제
              </button>
            </td>
          </tr>
        </template>
      </VirtualScrollTableBody>
    </div>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="success" class="success-msg">{{ success }}</p>
  </CollapsibleSection>

  <SalesRecordEditModal
    :open="editOpen"
    :columns="columns"
    :record="editingRecord"
    @close="editOpen = false"
    @save="onSaveEdit"
  />
</template>

<style scoped>
.filters-panel {
  padding: 12px 14px;
  margin-bottom: 12px;
  border-color: #dbeafe;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: 0 4px 16px rgba(37, 99, 235, 0.06);
}

.filters-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.filters-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.filters-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

.filters-title::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 0.875rem;
  margin-right: 8px;
  border-radius: 2px;
  background: var(--primary);
  vertical-align: -1px;
}

.filters-actions {
  display: flex;
  gap: 6px;
}

.filter-action {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.filter-action.ghost {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
}

.filter-action.ghost:hover {
  border-color: #cbd5e1;
  color: var(--text);
  background: #f8fafc;
}

.filter-action.primary {
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
}

.filter-action.primary:hover:not(:disabled) {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.filter-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.filters-date-block {
  padding: 10px 12px;
  margin-bottom: 10px;
  border-radius: 10px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.filters-month-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.filters-month-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 14px;
}

.filters-special-sale {
  padding-top: 4px;
  border-top: 1px solid #e2e8f0;
}

.month-only-hint {
  font-size: 0.8rem;
  color: var(--text-muted, #64748b);
  align-self: center;
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: 8px 10px;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.filter-field-wide {
  grid-column: span 2;
}

@media (max-width: 640px) {
  .filter-field-wide {
    grid-column: span 1;
  }
}

.field-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
}

.filter-select {
  height: 32px;
  padding: 0 28px 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.8125rem;
  font-family: inherit;
  color: var(--text);
  background: var(--surface)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M6 9l6 6 6-6' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")
    no-repeat right 8px center;
  appearance: none;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.filter-select:hover {
  border-color: #cbd5e1;
}

.filter-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-head .card-title {
  margin: 0;
}

.tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.tab {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  cursor: pointer;
  font-size: 0.8125rem;
}

.tab.active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.tab-bar-divider {
  width: 1px;
  align-self: stretch;
  margin: 2px 4px;
  background: var(--border);
}

.tab-returns {
  margin-left: auto;
  border-color: #fecaca;
  color: #b91c1c;
}

.tab-returns.active {
  background: #dc2626;
  border-color: #dc2626;
  color: #fff;
}

.tab-badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.12);
}

.tab-returns.active .tab-badge {
  background: rgba(255, 255, 255, 0.25);
}

.tab-scope-hint {
  margin: -4px 0 12px;
  font-size: 0.8125rem;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.period-summary {
  color: var(--primary);
  font-weight: 500;
}

.type-counts .return-count {
  color: var(--danger);
}

.filter-ctl-inline {
  min-width: 7rem;
  padding: 6px 8px;
  font-size: 0.8125rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.row-return td {
  background: #fef2f2;
}

.tag-sale {
  background: #d1fae5;
  color: #047857;
}

.tag-return {
  background: #fee2e2;
  color: #b91c1c;
}

.filter-bar input {
  min-width: 120px;
  flex: 1;
}

.table-wrap-tall {
  max-height: 520px;
}

.table-hint {
  margin: 0 0 8px;
}

.ui-build-tag {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #1d4ed8;
  background: #dbeafe;
}

.table-wrap-scroll {
  overflow: auto;
}

.sales-table-shell {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.data-table-wide {
  min-width: max-content;
}

.sales-table-shell :deep(.virtual-inner-table) {
  width: 100%;
  min-width: 100%;
}

.sales-detail-table {
  border-collapse: separate;
  border-spacing: 0;
}

.sales-detail-table th,
.sales-detail-table td {
  white-space: nowrap;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  padding: 9px 12px;
  vertical-align: middle;
}

.sales-detail-table th:last-child,
.sales-detail-table td:last-child {
  border-right: none;
}

.sales-detail-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: linear-gradient(180deg, #f8fafc 0%, #e8eef4 100%);
  color: #0f172a;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  box-shadow: inset 0 -2px 0 #94a3b8;
}

.sales-detail-table tbody tr:nth-child(even) td {
  background: #f8fafc;
}

.sales-detail-table tbody tr:hover td {
  background: #eff6ff;
}

.sales-detail-table .col-product {
  white-space: normal;
  max-width: 220px;
  min-width: 140px;
  line-height: 1.35;
}

.cell-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cell-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.3;
  border: 1px solid transparent;
}

.pill-muted {
  color: #94a3b8;
  background: #f1f5f9;
  border-color: #e2e8f0;
  font-weight: 500;
}

.pill-smartstore {
  color: #047857;
  background: #d1fae5;
  border-color: #6ee7b7;
}

.pill-coupang {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #93c5fd;
}

.pill-general {
  color: #0f766e;
  background: #ccfbf1;
  border-color: #5eead4;
}

.pill-n {
  color: #7c3aed;
  background: #ede9fe;
  border-color: #c4b5fd;
}

.pill-rocket {
  color: #b45309;
  background: #ffedd5;
  border-color: #fdba74;
}

.pill-seller {
  color: #4338ca;
  background: #e0e7ff;
  border-color: #a5b4fc;
}

.pill-default {
  color: #334155;
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.col-actions {
  white-space: nowrap;
}

.merge-banner {
  margin: 0 0 12px;
  padding: 10px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  font-size: 0.875rem;
}

.success-msg {
  color: var(--success);
  margin-top: 12px;
  font-size: 0.875rem;
}

.error-msg {
  color: var(--danger);
  margin-top: 12px;
  font-size: 0.875rem;
}
</style>
