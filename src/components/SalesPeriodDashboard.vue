<script setup>

import { computed } from 'vue'

import {

  ESSER_PROFIT_KPI_CARDS,

  ESSER_AD_KPI_CARDS,

  deriveEsserProfitKpis,

  summarizeEsserKpis,

  formatEsserValue,

  formatEsserProfitKpi,

  getEsserProfitKpiValue,

  reconcileEsserTotals,

} from '../utils/esserMetrics.js'

import { summarizeEsserKpisWithManual, manualAdSummaryText, totalManualAdSpend } from '../utils/manualAdSpend.js'
import {
  buildPlatformKpiSplitRows,
  buildPowerPriceKpiSplitRows,
  buildCoupang1pRocketKpiSplitRows,
  buildCombinedKpiSplitRows,
  buildOtherSellersKpiSplitRows,
  buildKpiSplitRowsForChannel,
  kpiSplitSectionTitle,
  filterKpiRowsWithAdSpend,
  PLATFORM_KPI_SPLIT_LABELS,
  POWER_PRICE_KPI_SPLIT_LABELS,
  COUPANG_1P_ROCKET_KPI_SPLIT_LABELS,
  COMBINED_KPI_SPLIT_LABELS,
  isExternalAdKpiNA,
  isPowerPriceKpiNA,
  isCoupang1pRocketKpiNA,
  isSpecialSaleKpiNA,
  isManualExpenseKpiNA,
} from '../utils/platformKpiSplit.js'
import { isManualAdKpiLabel } from '../config/manualAdSpend.js'

import { PLATFORM_OPTIONS } from '../constants/platforms.js'

import {
  salesMethodOptionsForPlatform,
  salesMethodFilterHint,
} from '../constants/salesMethods.js'

import { normalizePlatformLabel } from '../utils/platformDetect.js'
import { computeDayOverDaySales, computeCombinedBrandDayOverDaySales, buildCombinedBrandMonthOverMonthFromSegmentRows, brandPrevSalesMapFromLookupRecords, resolveSalesComparisonMode, salesComparisonSectionTitle, salesComparisonCurrentColumnLabel, salesComparisonPrevColumnLabel, salesComparisonChangeColumnLabel, specialSaleMonthlyTotalsSize } from '../utils/dayOverDaySales.js'
import { filterKpiCards } from '../config/combinedChannel.js'
import { isServerKpiOnly } from '../services/kpiSource.js'

const props = defineProps({
  records: { type: Array, default: () => [] },
  /** 플랫폼별 KPI 분리용 (플랫폼 필터 미적용) */
  platformSplitRecords: { type: Array, default: () => [] },
  /** 전일 대비 매출 집계용 (날짜 필터 미적용) */
  dayOverDayRecords: { type: Array, default: () => [] },
  filterYear: { type: String, default: '' },
  platform: { type: String, default: '' },
  salesMethod: { type: String, default: '' },
  hideScopeFilters: { type: Boolean, default: false },
  /** 일별 매출 대시보드: 쿠팡/스마트스토어/합계 표 항상 표시 */
  showPlatformBreakdown: { type: Boolean, default: false },
  /** 월별 대시보드에서는 전일 대비 숨김 */
  hideDayOverDay: { type: Boolean, default: false },
  manualAdEntries: { type: Array, default: () => [] },
  manualAdByChannel: { type: Array, default: () => [] },
  manualFilterCtx: { type: Object, default: () => ({}) },
  /** 통합 탭 등 — KPI 표·카드에서 제외할 지표 key */
  hiddenKpiKeys: { type: Array, default: () => [] },
  /** 파워프라이스 — 스마트스토어 단일 행 (수동 광고·자연매출·객단가·ROAS) */
  powerPriceKpi: { type: Boolean, default: false },
  /** 쿠팡 1P 로켓 — 쿠팡 단일 행 (발주 직접입력) */
  coupang1pKpi: { type: Boolean, default: false },
  /** 기타 판매처 — 특판 폐쇄몰 판매처 행 */
  otherSellersKpi: { type: Boolean, default: false },
  /** 통합 일별 — 파워프라이스 별도 행 포함 (스마트스토어 KPI와 분리) */
  combinedKpi: { type: Boolean, default: false },
  /** Phase 2-1 — server KPI bucket (pg + VITE_KPI_SOURCE=server) */
  serverKpiBucket: { type: Object, default: null },
  /** Phase 2-2 — server platform split rows */
  serverPlatformKpiRows: { type: Array, default: () => [] },
  /** 통합 월별 전월대비 — 전월 by-segment */
  serverPrevMonthPlatformKpiRows: { type: Array, default: () => [] },
  /** Phase 2-2 — server day-over-day rows */
  serverDayOverDayRows: { type: Array, default: () => [] },
  /** 통합 — 브랜드 세그먼트(베스트하임·사본느리 등) detail 로딩 중 */
  segmentsLoading: { type: Boolean, default: false },
  /** 서버 KPI fetch 중 */
  kpiLoading: { type: Boolean, default: false },
  /** KPI API 실패 메시지 */
  kpiError: { type: String, default: '' },
})



const emit = defineEmits(['update:platform', 'update:salesMethod'])



const kpiSourceRecords = computed(() => {
  if (props.powerPriceKpi || props.coupang1pKpi) return props.records
  return props.platformSplitRecords.length ? props.platformSplitRecords : props.records
})

const activePlatformFilter = computed(() => normalizePlatformLabel(props.platform))

const showPlatformSplit = computed(() => {
  if (!props.showPlatformBreakdown) return false
  if (props.serverPlatformKpiRows?.length) return true
  return kpiSourceRecords.value.length > 0
})

const AD_METRIC_KEYS = [
  'adSpend',
  'adSales',
  'organicSales',
  'organicSalesRate',
  'roas',
  'salesRoas',
]

function preferServerAdMetrics(clientAd, serverBucket) {
  if (!serverBucket) return clientAd || {}
  const ad = { ...(clientAd || {}) }
  const missingAd = !ad.adSpend && !ad.adSales
  if (!missingAd) return ad
  for (const key of AD_METRIC_KEYS) {
    if (serverBucket[key] != null) ad[key] = serverBucket[key]
  }
  return ad
}

/** 합계 행 — 서버 KPI로 profit·ad 모두 고정 (클라 재집계 덮어쓰기 방지) */
function patchCombinedTotalFromServer(rows, serverBucket) {
  if (!serverBucket || !rows?.length) return rows
  return rows.map((row) => {
    if (row.label !== '합계') return row
    if (isServerKpiOnly()) {
      return {
        ...row,
        profit: { ...(row.profit || {}), ...serverBucket },
        ad: { ...(row.ad || {}), ...serverBucket },
      }
    }
    return { ...row, ad: preferServerAdMetrics(row.ad, serverBucket) }
  })
}

const platformKpiRows = computed(() => {
  // 직접입력 스코프는 클라 집계 우선 (서버 by-platform과 행 구조가 다름)
  if (props.powerPriceKpi || props.coupang1pKpi) {
    /* fall through to builders below */
  } else if (props.serverPlatformKpiRows?.length) {
    // 플랫폼·기타·통합(by-segment): 서버 행 고정
    return props.serverPlatformKpiRows
  }
  if (!showPlatformSplit.value && !props.powerPriceKpi && !props.coupang1pKpi) return []
  const channelGroups = props.manualAdByChannel.length
    ? props.manualAdByChannel
    : [{ label: '베스트하임', entries: props.manualAdEntries }]
  let rows = []
  if (props.powerPriceKpi) {
    rows = buildPowerPriceKpiSplitRows(
      kpiSourceRecords.value,
      channelGroups,
      props.manualFilterCtx,
    )
  } else if (props.coupang1pKpi) {
    rows = buildCoupang1pRocketKpiSplitRows(kpiSourceRecords.value)
  } else if (props.combinedKpi) {
    // 서버 by-segment 미응답 시 레거시 폴백
    rows = buildCombinedKpiSplitRows(
      props.records,
      kpiSourceRecords.value,
      channelGroups,
      props.manualFilterCtx,
    )
  } else if (props.otherSellersKpi) {
    rows = buildOtherSellersKpiSplitRows(kpiSourceRecords.value)
    if (props.serverKpiBucket) {
      rows = patchCombinedTotalFromServer(rows, props.serverKpiBucket)
    }
  } else {
    rows = buildPlatformKpiSplitRows(
      kpiSourceRecords.value,
      channelGroups,
      props.manualFilterCtx,
    )
  }
  return rows
})

/** 통합 — 광고·판매량 표에서 광고비 0원 행 제외 */
const platformKpiAdRows = computed(() =>
  props.combinedKpi ? filterKpiRowsWithAdSpend(platformKpiRows.value) : platformKpiRows.value,
)

const kpiSplitCompact = computed(() =>
  props.combinedKpi ||
  (props.serverPlatformKpiRows || []).some((r) => String(r.label || '').startsWith('베스트하임(')),
)

const kpiProfitSectionTitle = computed(() =>
  kpiSplitSectionTitle(platformKpiRows.value, 'profit', { compact: kpiSplitCompact.value }),
)

const kpiAdSectionTitle = computed(() =>
  kpiSplitSectionTitle(platformKpiAdRows.value, 'ad', { compact: kpiSplitCompact.value }),
)

const kpiSummary = computed(() => {
  // 통합: 서버 세그먼트 합계 행 = 상단 KPI (summary와 섞지 않음)
  if (props.combinedKpi && platformKpiRows.value.length) {
    const total = platformKpiRows.value.find((r) => r.label === '합계')
    if (total) {
      // profit 스프레드가 adSpend를 덮어쓰지 않도록 광고 필드는 ad 우선
      return {
        ...total.profit,
        ...total.ad,
        totalCost: total.profit?.totalCost ?? total.ad?.totalCost ?? 0,
        netProfit: total.profit?.netProfit ?? total.ad?.netProfit ?? 0,
        adSpend: total.ad?.adSpend ?? 0,
        adSales: total.ad?.adSales ?? 0,
        roas: total.ad?.roas ?? 0,
        salesRoas: total.ad?.salesRoas ?? 0,
        organicSales: total.ad?.organicSales ?? 0,
        organicSalesRate: total.ad?.organicSalesRate ?? 0,
      }
    }
  }
  // 그 외 스코프: 화면 상단 KPI는 서버 단일 소스
  if (props.serverKpiBucket && isServerKpiOnly()) return props.serverKpiBucket
  if (props.serverKpiBucket && !props.combinedKpi) return props.serverKpiBucket
  if (showPlatformSplit.value) {
    if (props.powerPriceKpi && platformKpiRows.value.length) {
      const row = platformKpiRows.value[0]
      return { ...row.ad, ...row.profit }
    }
    if (props.coupang1pKpi && platformKpiRows.value.length) {
      const row = platformKpiRows.value[0]
      return { ...row.ad, ...row.profit }
    }
    const total = platformKpiRows.value.find((r) => r.label === '합계')
    if (total) return { ...total.ad, ...total.profit }
  }
  const productRows = props.records.filter((r) => !r.isEsserSheetTotal)
  const productKpi = summarizeEsserKpis(productRows)
  return deriveEsserProfitKpis(
    summarizeEsserKpisWithManual(props.records, props.manualAdEntries, props.manualFilterCtx),
    {
      estimateCostFromMargin: activePlatformFilter.value === '스마트스토어',
      productKpi,
    },
  )
})

const reconcile = computed(() => {
  // 서버 KPI 단일 소스일 때는 전량 reconcile 생략 (날짜 변경 렉)
  if (props.serverKpiBucket && isServerKpiOnly()) {
    return { rowCount: 0, kpi: {}, dailyBucketCount: 0, dailySalesSum: 0, salesMismatch: false, salesDiff: 0 }
  }
  return reconcileEsserTotals(props.records)
})



const manualAdNote = computed(() => {
  if (props.powerPriceKpi) {
    const spend = totalManualAdSpend(props.manualAdEntries, props.manualFilterCtx)
    if (!spend) return ''
    const count = props.manualAdEntries.filter((e) => Number(String(e.adSpend || '').replace(/,/g, '')) > 0)
      .length
    return `광고비 ${Math.round(spend).toLocaleString('ko-KR')}원 (${count}일 반영 · 광고매출 미사용)`
  }
  return manualAdSummaryText(props.manualAdEntries, props.manualFilterCtx)
})



const dayOverDayLookupRecords = computed(() =>
  props.dayOverDayRecords.length ? props.dayOverDayRecords : kpiSourceRecords.value,
)

const dayOverDayRows = computed(() => {
  if (props.hideDayOverDay) return []
  const mode = resolveSalesComparisonMode(props.manualFilterCtx)
  const combinedMonth = props.combinedKpi && mode === 'month'
  const specialSaleByMonth = props.manualFilterCtx?.specialSaleByMonth || null
  const lookup = dayOverDayLookupRecords.value
  const hasClientRows = Boolean(lookup.length || props.records.length)

  // 통합 월별 전월대비 — 서버 세그먼트 합계와 동일 SoT (클라 records보다 우선)
  if (combinedMonth) {
    if (props.serverPlatformKpiRows?.length) {
      const prevFallback =
        lookup.length || props.records.length
          ? brandPrevSalesMapFromLookupRecords(lookup.length ? lookup : props.records, {
              manualFilterCtx: props.manualFilterCtx,
              specialSaleByMonth,
            })
          : null
      return buildCombinedBrandMonthOverMonthFromSegmentRows(
        props.serverPlatformKpiRows,
        props.serverPrevMonthPlatformKpiRows || [],
        {
          manualFilterCtx: props.manualFilterCtx,
          specialSaleByMonth,
          specialSaleLabels: props.manualFilterCtx?.specialSaleRowLabels || [],
          prevBrandSalesFallback: prevFallback,
        },
      )
    }
    if (hasClientRows) {
      return computeCombinedBrandDayOverDaySales(props.records, {
        manualAdEntries: props.manualAdEntries,
        manualFilterCtx: props.manualFilterCtx,
        lookupRows: lookup.length ? lookup : props.records,
        specialSaleByMonth,
      })
    }
    if (specialSaleMonthlyTotalsSize(specialSaleByMonth)) {
      return computeCombinedBrandDayOverDaySales([], {
        manualFilterCtx: props.manualFilterCtx,
        specialSaleByMonth,
      })
    }
    return []
  }

  // Phase 2: 서버 전일대비가 있으면 통합(일·주) 포함 우선
  if (props.serverDayOverDayRows?.length && (isServerKpiOnly() || !props.combinedKpi)) {
    return props.serverDayOverDayRows
  }
  if (!lookup.length && !props.records.length) return []
  const compute = props.combinedKpi ? computeCombinedBrandDayOverDaySales : computeDayOverDaySales
  return compute(props.records, {
    manualAdEntries: props.manualAdEntries,
    manualFilterCtx: props.manualFilterCtx,
    lookupRows: lookup.length ? lookup : props.records,
    specialSaleByMonth,
  })
})

const salesComparisonMode = computed(() =>
  resolveSalesComparisonMode(props.manualFilterCtx),
)

const dayOverDaySectionTitle = computed(() =>
  salesComparisonSectionTitle(salesComparisonMode.value),
)

const dayOverDayCurrentColLabel = computed(() =>
  salesComparisonCurrentColumnLabel(salesComparisonMode.value),
)

const dayOverDayPrevColLabel = computed(() =>
  salesComparisonPrevColumnLabel(salesComparisonMode.value, dayOverDayRows.value[0]),
)

const dayOverDayChangeColLabel = computed(() =>
  salesComparisonChangeColumnLabel(salesComparisonMode.value),
)

const dayOverDayCaption = computed(() => {
  const first = dayOverDayRows.value[0]
  if (!first) return ''
  if (salesComparisonMode.value === 'month') {
  const ssNote =
    props.manualFilterCtx?.specialSaleByMonth &&
    specialSaleMonthlyTotalsSize(props.manualFilterCtx.specialSaleByMonth)
      ? ' · 특판 행 = 해당 월 수기 특판 총합 (합계에 포함)'
      : ''
    return `기준월 ${first.refMonth || first.referenceDate || '—'} · 전월 ${first.prevMonth || first.prevDate || '—'} (일별 매출 월 합산${ssNote})`
  }
  if (salesComparisonMode.value === 'week' && first.periodFrom && first.periodTo) {
    return `조회 기간 ${first.periodFrom}~${first.periodTo} · 전주 동기간 ${first.prevPeriodFrom}~${first.prevPeriodTo} (7일 합산 · 업로드 전체 기준)`
  }
  return `기준일 ${first.referenceDate || '—'} · 전일 ${first.prevDate || '—'} (달력 전일 · 전일 매출은 업로드 전체 기준, 기준일은 조회 기간 반영)`
})

const showDayOverDayChangeAmount = computed(() => salesComparisonMode.value === 'month')

function formatChangeAmount(row) {
  const amt = row.changeAmount ?? (row.currentSales || 0) - (row.prevSales || 0)
  return formatEsserValue('sales', amt)
}

const visibleProfitKpiCards = computed(() =>
  filterKpiCards(ESSER_PROFIT_KPI_CARDS, props.hiddenKpiKeys),
)

const visibleAdKpiCards = computed(() => filterKpiCards(ESSER_AD_KPI_CARDS, props.hiddenKpiKeys))

const profitKpiCards = computed(() =>
  visibleProfitKpiCards.value.map((card) => ({
    ...card,
    value: getEsserProfitKpiValue(kpiSummary.value, card.key),
  })),
)



const ROAS_KPI_KEYS = new Set(['roas', 'salesRoas'])

const adKpiCards = computed(() =>
  visibleAdKpiCards.value.map((card) => ({
    ...card,
    value: kpiSummary.value[card.key] ?? 0,
  })),
)

const roasKpiCards = computed(() => adKpiCards.value.filter((c) => ROAS_KPI_KEYS.has(c.key)))

const adKpiCardsOther = computed(() =>
  adKpiCards.value.filter((c) => !ROAS_KPI_KEYS.has(c.key)),
)



const hasData = computed(() => {
  if (props.serverKpiBucket) return true
  if (props.serverPlatformKpiRows?.length) return true
  if (props.serverDayOverDayRows?.length) return true
  if (props.showPlatformBreakdown) {
    return kpiSourceRecords.value.length > 0 || props.records.length > 0
  }
  return props.records.length > 0
})



const filterSummary = computed(() => {

  const parts = []

  if (props.platform) parts.push(`차트·표: ${props.platform}`)
  else parts.push('전체 플랫폼')

  if (props.showPlatformBreakdown) {
    const labels = props.powerPriceKpi
      ? POWER_PRICE_KPI_SPLIT_LABELS
      : props.coupang1pKpi
        ? COUPANG_1P_ROCKET_KPI_SPLIT_LABELS
        : props.combinedKpi
          ? COMBINED_KPI_SPLIT_LABELS
          : (props.serverPlatformKpiRows || []).map((r) => r.label).filter(Boolean)
    parts.push(`KPI: ${(labels.length ? labels : PLATFORM_KPI_SPLIT_LABELS).join('·')}`)
  }

  if (props.salesMethod) parts.push(props.salesMethod)
  else parts.push(salesMethodFilterHint(props.platform, props.salesMethod))

  return parts.join(' · ')

})



const salesMethodFilterOptions = computed(() => salesMethodOptionsForPlatform(props.platform))



const showSalesMethodFilter = computed(() => {
  const p = props.platform === '네이버' ? '스마트스토어' : props.platform
  return !p || p === '쿠팡' || p === '스마트스토어'
})



function formatKpiValue(card, value, rowLabel = '') {
  if (isExternalAdKpiNA(rowLabel, 'profit', card.key)) return '—'
  if (isPowerPriceKpiNA(rowLabel, 'profit', card.key)) return '—'
  if (props.coupang1pKpi && isCoupang1pRocketKpiNA(rowLabel, 'profit', card.key)) return '—'
  if (isSpecialSaleKpiNA(rowLabel, 'profit', card.key, props.manualFilterCtx?.specialSale)) return '—'
  if (
    isManualExpenseKpiNA(
      rowLabel,
      'profit',
      card.key,
      props.manualFilterCtx?.manualExpense,
    )
  ) {
    return '—'
  }
  return formatEsserProfitKpi(card.key, value)
}

function formatAdKpiValue(card, value, rowLabel = '') {
  if (isExternalAdKpiNA(rowLabel, 'ad', card.key)) return '—'
  if (isPowerPriceKpiNA(rowLabel, 'ad', card.key)) return '—'
  if (props.coupang1pKpi && isCoupang1pRocketKpiNA(rowLabel, 'ad', card.key)) return '—'
  if (isSpecialSaleKpiNA(rowLabel, 'ad', card.key, props.manualFilterCtx?.specialSale)) return '—'
  if (
    isManualExpenseKpiNA(rowLabel, 'ad', card.key, props.manualFilterCtx?.manualExpense)
  ) {
    return '—'
  }  return formatEsserValue(card.key, value)
}

</script>



<template>

  <div v-if="kpiLoading" class="empty chart-empty kpi-loading">
    <span class="segments-loading-spinner" aria-hidden="true" />
    KPI를 불러오는 중입니다…
  </div>

  <div v-else-if="kpiError" class="empty chart-empty kpi-error">
    <strong>KPI를 불러오지 못했습니다.</strong>
    <span>{{ kpiError }}</span>
    <span class="kpi-error-hint">NAS API(8080)가 켜져 있는지, 브라우저에서 새로고침(Ctrl+F5) 후 다시 시도하세요.</span>
  </div>

  <div v-else-if="!hasData" class="empty chart-empty">
    선택한 조회 기간에 표시할 데이터가 없습니다. 상단 조회 일자를 넓히거나 엑셀·직접입력 데이터를 확인하세요.
  </div>

  <div v-else class="period-dashboard">

    <div v-if="!hideScopeFilters" class="toolbar">

      <div class="filter-group">

        <select

          class="platform-filter"

          :value="platform"

          @change="emit('update:platform', $event.target.value)"

        >

          <option v-for="opt in PLATFORM_OPTIONS" :key="opt.value" :value="opt.value">

            {{ opt.label }}

          </option>

        </select>

        <select

          v-if="showSalesMethodFilter"

          class="platform-filter"

          :value="salesMethod"

          @change="emit('update:salesMethod', $event.target.value)"

        >

          <option v-for="opt in salesMethodFilterOptions" :key="opt.value" :value="opt.value">

            {{ opt.label }}

          </option>

        </select>

      </div>

    </div>



    <p class="filter-summary">{{ filterSummary }} · 상품 {{ records.length }}행</p>

    <div
      v-if="segmentsLoading"
      class="segments-loading"
      role="status"
      aria-live="polite"
    >
      <span class="segments-loading-spinner" aria-hidden="true" />
      <div class="segments-loading-text">
        <strong>브랜드·채널 상세 불러오는 중</strong>
        <span>베스트하임·사본느리·자사몰·파워프라이스 행이 곧 표시됩니다. 상단 합계 KPI는 이미 반영된 값입니다.</span>
      </div>
    </div>

    <p v-if="manualAdNote" class="manual-ad-note">{{ manualAdNote }}</p>

    <p v-if="reconcile.rowCount" class="reconcile-note">

      집계: 상품 행 {{ reconcile.rowCount }}건 · 매출

      {{ formatEsserValue('sales', reconcile.kpi.sales) }}

      <template v-if="reconcile.dailyBucketCount">

        · 일별 합계 {{ formatEsserValue('sales', reconcile.dailySalesSum) }}

        <span v-if="reconcile.salesMismatch" class="warn">

          (차이 {{ formatEsserValue('sales', reconcile.salesDiff) }} — 날짜 없는 행 확인)

        </span>

      </template>

      <span class="hint"> · 매출·마진=상품 합 · 광고비=엑셀 합계 칸(로켓+판매자)</span>

    </p>



    <template v-if="!hideDayOverDay">
    <h4 class="kpi-section-title">{{ dayOverDaySectionTitle }}</h4>
    <div v-if="dayOverDayRows.length" class="kpi-split-wrap dod-wrap">
      <p class="dod-caption">
        {{ dayOverDayCaption }}
      </p>
      <table class="kpi-split-table dod-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">{{ dayOverDayCurrentColLabel }}</th>
            <th scope="col">{{ dayOverDayPrevColLabel }}</th>
            <th v-if="showDayOverDayChangeAmount" scope="col">{{ dayOverDayChangeColLabel }} 증감액</th>
            <th scope="col">{{ dayOverDayChangeColLabel }}(%)</th>
            <th scope="col">추이</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in dayOverDayRows"
            :key="`dod-${row.platform}`"
            :class="{
              'row-total': row.platform === '합계',
              'row-up': row.trend === '상승',
              'row-down': row.trend === '하락',
            }"
          >
            <th scope="row">{{ row.platform }}</th>
            <td>{{ row.currentSalesLabel }}</td>
            <td>{{ row.prevSalesLabel }}</td>
            <td v-if="showDayOverDayChangeAmount" class="dod-pct">{{ formatChangeAmount(row) }}</td>
            <td class="dod-pct">{{ row.changeLabel }}</td>
            <td>{{ row.trend }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    </template>

    <h4 class="kpi-section-title">{{ kpiProfitSectionTitle }}</h4>

    <div v-if="showPlatformSplit" class="kpi-split-wrap">
      <table class="kpi-split-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th v-for="card in visibleProfitKpiCards" :key="card.key" scope="col">
              {{ card.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in platformKpiRows"
            :key="row.label"
            :class="{
              'row-total': row.label === '합계',
              'row-external': isManualAdKpiLabel(row.label),
              'row-active': activePlatformFilter && row.label === activePlatformFilter,
            }"
          >
            <th scope="row">
              {{ row.label }}
              <span v-if="row.rowCount" class="row-count">({{ row.rowCount }}행)</span>
            </th>
            <td v-for="card in visibleProfitKpiCards" :key="card.key">
              {{ formatKpiValue(card, row.profit[card.key], row.label) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="kpi-grid kpi-grid-profit">

      <div v-for="card in profitKpiCards" :key="card.key" class="kpi-card">

        <span class="kpi-label">{{ card.label }}</span>

        <span class="kpi-hint">{{ card.hint }}</span>

        <strong class="kpi-value">{{ formatKpiValue(card, card.value) }}</strong>

      </div>

    </div>



    <h4 class="kpi-section-title">{{ kpiAdSectionTitle }}</h4>

    <div v-if="showPlatformSplit" class="kpi-split-wrap">
      <table class="kpi-split-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th
              v-for="card in visibleAdKpiCards"
              :key="card.key"
              scope="col"
              :class="{ 'th-roas': ROAS_KPI_KEYS.has(card.key) }"
            >
              {{ card.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in platformKpiAdRows"
            :key="`ad-${row.label}`"
            :class="{
              'row-total': row.label === '합계',
              'row-external': isManualAdKpiLabel(row.label),
              'row-active': activePlatformFilter && row.label === activePlatformFilter,
            }"
          >
            <th scope="row">{{ row.label }}</th>
            <td
              v-for="card in visibleAdKpiCards"
              :key="card.key"
              :class="{ 'td-roas': ROAS_KPI_KEYS.has(card.key) }"
            >
              {{ formatAdKpiValue(card, row.ad[card.key], row.label) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="kpi-grid">
      <div v-for="card in adKpiCardsOther" :key="card.key" class="kpi-card">
        <span class="kpi-label">{{ card.label }}</span>
        <span class="kpi-hint">{{ card.hint }}</span>
        <strong class="kpi-value">{{ formatEsserValue(card.key, card.value) }}</strong>
      </div>

      <div class="kpi-roas-pair">
        <div v-for="card in roasKpiCards" :key="card.key" class="kpi-card kpi-card-roas">
          <span class="kpi-label">{{ card.label }}</span>
          <span class="kpi-hint">{{ card.hint }}</span>
          <strong class="kpi-value">{{ formatEsserValue(card.key, card.value) }}</strong>
        </div>
      </div>
    </div>

  </div>

</template>



<style scoped>

.period-dashboard {

  display: flex;

  flex-direction: column;

  gap: 12px;

}



.toolbar {

  display: flex;

  flex-wrap: wrap;

  gap: 12px;

  align-items: flex-start;

}



.filter-group {

  display: flex;

  flex-wrap: wrap;

  gap: 8px;

}



.platform-filter {

  min-width: 160px;

  padding: 8px 10px;

  border: 1px solid var(--border);

  border-radius: 8px;

  font-size: 0.875rem;

}



.filter-summary {

  margin: 0;

  font-size: 0.8rem;

  color: var(--muted);

}



.manual-ad-note {

  margin: 4px 0 0;

  font-size: 0.78rem;

  color: var(--primary);

  font-weight: 600;

}



.reconcile-note {

  margin: 0;

  font-size: 0.78rem;

  color: var(--muted);

}



.reconcile-note .warn {

  color: var(--danger);

  font-weight: 600;

}



.reconcile-note .hint {

  color: var(--muted);

}



.kpi-section-title {

  margin: 8px 0 0;

  font-size: 0.8rem;

  font-weight: 600;

  color: var(--muted);

}



.kpi-grid {

  display: grid;

  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));

  gap: 10px;

}



.kpi-grid-profit {

  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));

}

.kpi-roas-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  grid-column: 1 / -1;
}

.kpi-card-roas {
  background: #f5f3ff;
  border-color: #c4b5fd;
}

.kpi-split-table .th-roas,
.kpi-split-table .td-roas {
  background: #f5f3ff;
}



.kpi-card {

  border: 1px solid var(--border);

  border-radius: 8px;

  padding: 12px;

  background: var(--surface);

}



.kpi-label {

  display: block;

  font-size: 0.8rem;

  font-weight: 600;

  margin-bottom: 2px;

}



.kpi-hint {

  display: block;

  font-size: 0.7rem;

  color: var(--muted);

  margin-bottom: 6px;

}



.kpi-value {

  font-size: 1.05rem;

  font-variant-numeric: tabular-nums;

}



.chart-empty {

  padding: 24px;

}



.kpi-split-wrap {

  overflow-x: auto;

}

.dod-caption {
  margin: 0;
  padding: 10px 12px 0;
  font-size: 0.8rem;
  color: var(--muted);
}

.dod-pct {
  font-weight: 700;
}

.dod-table .row-up .dod-pct {
  color: #047857;
}

.dod-table .row-down .dod-pct {
  color: #dc2626;
}

.kpi-split-table {

  width: 100%;

  border-collapse: collapse;

  font-size: 0.82rem;

}



.kpi-split-table th,

.kpi-split-table td {

  border: 1px solid var(--border);

  padding: 8px 10px;

  text-align: right;

  font-variant-numeric: tabular-nums;

  white-space: nowrap;

}



.kpi-split-table th[scope='col'],

.kpi-split-table th[scope='row'] {

  text-align: center;

  background: #f8fafc;

  font-weight: 600;

}



.kpi-split-table .row-total {

  background: #f0f9ff;

  font-weight: 600;

}

.kpi-split-table .row-external {

  background: #fffbeb;

}

.kpi-split-table .row-active {

  outline: 2px solid var(--primary);

  outline-offset: -2px;

}

.kpi-split-table .row-count {

  display: block;

  font-size: 0.68rem;

  font-weight: 400;

  color: var(--muted);

}

.segments-loading {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin: 0.5rem 0 0.85rem;
  padding: 0.75rem 1rem;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  color: #1e3a5f;
}

.segments-loading-spinner {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.15rem;
  border: 3px solid rgba(37, 99, 235, 0.2);
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: segments-spin 0.8s linear infinite;
}

.segments-loading-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.segments-loading-text strong {
  font-size: 0.9rem;
}

.segments-loading-text span {
  font-size: 0.8rem;
  line-height: 1.4;
  color: #334155;
}

@keyframes segments-spin {
  to {
    transform: rotate(360deg);
  }
}

.kpi-loading {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  color: #1e40af;
}

.kpi-error {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-start;
  color: #991b1b;
}

.kpi-error-hint {
  font-size: 0.88rem;
  color: var(--muted);
}

</style>


