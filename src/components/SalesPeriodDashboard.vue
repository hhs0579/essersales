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
  buildKpiSplitRowsForChannel,
  kpiSplitSectionTitle,
  PLATFORM_KPI_SPLIT_LABELS,
  POWER_PRICE_KPI_SPLIT_LABELS,
  COUPANG_1P_ROCKET_KPI_SPLIT_LABELS,
  COMBINED_KPI_SPLIT_LABELS,
  isExternalAdKpiNA,
  isPowerPriceKpiNA,
  isCoupang1pRocketKpiNA,
  isSpecialSaleKpiNA,
} from '../utils/platformKpiSplit.js'
import { isManualAdKpiLabel } from '../config/manualAdSpend.js'

import { PLATFORM_OPTIONS } from '../constants/platforms.js'

import {
  salesMethodOptionsForPlatform,
  salesMethodFilterHint,
} from '../constants/salesMethods.js'

import { normalizePlatformLabel } from '../utils/platformDetect.js'
import { computeDayOverDaySales, computeCombinedBrandDayOverDaySales, resolveSalesComparisonMode, salesComparisonSectionTitle, salesComparisonCurrentColumnLabel, salesComparisonPrevColumnLabel, salesComparisonChangeColumnLabel } from '../utils/dayOverDaySales.js'
import { filterKpiCards } from '../config/combinedChannel.js'

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
  /** 통합 일별 — 파워프라이스 별도 행 포함 (스마트스토어 KPI와 분리) */
  combinedKpi: { type: Boolean, default: false },
  /** Phase 2-1 — server KPI bucket (pg + VITE_KPI_SOURCE=server) */
  serverKpiBucket: { type: Object, default: null },
  /** Phase 2-2 — server platform split rows */
  serverPlatformKpiRows: { type: Array, default: () => [] },
  /** Phase 2-2 — server day-over-day rows */
  serverDayOverDayRows: { type: Array, default: () => [] },
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

function patchCombinedRowsWithServerAd(rows, serverBucket) {
  if (!serverBucket || !rows?.length) return rows
  return rows.map((row) => {
    if (row.label !== '합계') return row
    return { ...row, ad: preferServerAdMetrics(row.ad, serverBucket) }
  })
}

const platformKpiRows = computed(() => {
  if (props.serverPlatformKpiRows?.length && !props.combinedKpi) return props.serverPlatformKpiRows
  if (!showPlatformSplit.value) return []
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
    rows = buildCombinedKpiSplitRows(
      props.records,
      kpiSourceRecords.value,
      channelGroups,
      props.manualFilterCtx,
    )
    rows = patchCombinedRowsWithServerAd(rows, props.serverKpiBucket)
  } else {
    rows = buildPlatformKpiSplitRows(
      kpiSourceRecords.value,
      channelGroups,
      props.manualFilterCtx,
    )
  }
  return rows
})

const kpiProfitSectionTitle = computed(() =>
  kpiSplitSectionTitle(platformKpiRows.value, 'profit', { compact: props.combinedKpi }),
)

const kpiAdSectionTitle = computed(() =>
  kpiSplitSectionTitle(platformKpiRows.value, 'ad', { compact: props.combinedKpi }),
)

const kpiSummary = computed(() => {
  if (props.combinedKpi && platformKpiRows.value.length) {
    const total = platformKpiRows.value.find((r) => r.label === '합계')
    if (total) return { ...total.ad, ...total.profit }
  }
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

const reconcile = computed(() => reconcileEsserTotals(props.records))



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
  if (props.serverDayOverDayRows?.length && !props.combinedKpi) return props.serverDayOverDayRows
  const lookup = dayOverDayLookupRecords.value
  if (!lookup.length && !props.records.length) return []
  const compute = props.combinedKpi ? computeCombinedBrandDayOverDaySales : computeDayOverDaySales
  return compute(props.records, {
    manualAdEntries: props.manualAdEntries,
    manualFilterCtx: props.manualFilterCtx,
    lookupRows: lookup.length ? lookup : props.records,
    specialSaleByMonth: props.manualFilterCtx?.specialSaleByMonth || null,
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
    props.manualFilterCtx?.specialSaleByMonth?.size
      ? ' · 합계 행에 해당 월 특판 매출 포함'
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
          : PLATFORM_KPI_SPLIT_LABELS
    parts.push(`KPI: ${labels.join('·')}`)
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
  return formatEsserProfitKpi(card.key, value)
}

function formatAdKpiValue(card, value, rowLabel = '') {
  if (isExternalAdKpiNA(rowLabel, 'ad', card.key)) return '—'
  if (isPowerPriceKpiNA(rowLabel, 'ad', card.key)) return '—'
  if (props.coupang1pKpi && isCoupang1pRocketKpiNA(rowLabel, 'ad', card.key)) return '—'
  if (isSpecialSaleKpiNA(rowLabel, 'ad', card.key, props.manualFilterCtx?.specialSale)) return '—'
  return formatEsserValue(card.key, value)
}

</script>



<template>

  <div v-if="!hasData" class="empty chart-empty">
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
            v-for="row in platformKpiRows"
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

</style>

