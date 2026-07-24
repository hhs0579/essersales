<script setup>
import { computed, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
} from 'chart.js'
import {
  aggregateByYear,
  aggregateByMonth,
  aggregateByWeekday,
  aggregateDetailsByChannel,
  aggregateDetailsByProductOption,
  summarizeKpis,
  getMetricValue,
  parseAmount,
} from '../utils/salesAggregation.js'
import { parseSalesDate } from '../utils/dateParse.js'
import { CHART_METRICS, formatChartValue } from '../constants/chartMetrics.js'
import {
  chartValueFromBucket,
  ESSER_CHART_METRICS,
  formatEsserValue,
  aggregateEsserByYear,
  aggregateEsserByWeekday,
  aggregateEsserByChannel,
  aggregateEsserByProductOption,
} from '../utils/esserMetrics.js'
import {
  aggregateEsserByDayWithManual,
  aggregateEsserByWeekWithManual,
  aggregateEsserByMonthWithManual,
  aggregateEsserBySalesMethodWithManual,
} from '../utils/manualAdSpend.js'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

const props = defineProps({
  records: { type: Array, default: () => [] },
  filterYear: { type: String, default: '' },
  metric: { type: String, default: 'revenue' },
  dailyRecords: { type: Array, default: () => [] },
  /** 쿠팡·사본느리 일별 — KPI는 대시보드, 그래프는 여기 */
  esserMode: { type: Boolean, default: false },
  manualAdEntries: { type: Array, default: () => [] },
  manualFilterCtx: { type: Object, default: () => ({}) },
  salesMethod: { type: String, default: '' },
  /** esserMode일 때 초기 기간 탭 (daily | weekly | monthly) */
  defaultEsserPeriodMode: { type: String, default: 'daily' },
  /** Phase 2-1 — server KPI daily buckets */
  serverDailyChartBuckets: { type: Array, default: () => [] },
})

const esserPeriodMode = ref(
  ['daily', 'weekly', 'monthly'].includes(props.defaultEsserPeriodMode)
    ? props.defaultEsserPeriodMode
    : 'daily',
)

watch(
  () => props.defaultEsserPeriodMode,
  (mode) => {
    if (['daily', 'weekly', 'monthly'].includes(mode)) {
      esserPeriodMode.value = mode
    }
  },
)

const esserChartMetric = ref('sales')

const esserPeriodOptions = [
  { key: 'daily', label: '일간' },
  { key: 'weekly', label: '주간' },
  { key: 'monthly', label: '월간' },
]

const metricMeta = computed(() => CHART_METRICS[props.metric] || CHART_METRICS.revenue)
const metricLabel = computed(() => metricMeta.value.label)

const yearData = computed(() => aggregateByYear(props.records))
const monthData = computed(() => aggregateByMonth(props.records, props.filterYear))
const weekdayData = computed(() => aggregateByWeekday(props.records))
const kpiSummary = computed(() => summarizeKpis(props.records))

const kpiCards = computed(() => [
  { key: 'revenue', label: '매출', value: kpiSummary.value.revenue },
  { key: 'margin', label: '마진', value: kpiSummary.value.margin },
  { key: 'marginRate', label: '마진율', value: kpiSummary.value.marginRate },
  { key: 'totalCost', label: '총 원가', value: kpiSummary.value.totalCost },
  { key: 'costRate', label: '원가율', value: kpiSummary.value.costRate },
  { key: 'aov', label: '객단가', value: kpiSummary.value.aov },
  { key: 'quantity', label: '수량', value: kpiSummary.value.quantity },
])

function formatValue(n) {
  return formatChartValue(props.metric, n)
}

function formatKpi(key, n) {
  return formatChartValue(key, n)
}

function metricFromBucket(item) {
  if (props.metric === 'salesQty') {
    return parseAmount(item.salesQty ?? item.quantity) || getMetricValue(item, 'quantity') || 0
  }
  return item[props.metric] ?? getMetricValue(item, props.metric) ?? 0
}

function buildChartConfig(items) {
  const meta = metricMeta.value
  const source = items.length ? items : [{ label: '-', [props.metric]: 0 }]
  return {
    data: {
      labels: source.map((x) => x.label),
      datasets: [
        {
          label: meta.label,
          data: source.map((x) => metricFromBucket(x)),
          backgroundColor: meta.color,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${meta.label}: ${formatValue(ctx.raw)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => formatValue(v),
          },
        },
      },
    },
  }
}

function sortChartItems(items, { sortBy = 'value' } = {}) {
  const list = [...items]
  if (sortBy === 'chrono') {
    return list.sort((a, b) => {
      const ta = a.sortTime ?? parseSalesDate(a.label)?.date.getTime() ?? 0
      const tb = b.sortTime ?? parseSalesDate(b.label)?.date.getTime() ?? 0
      return ta - tb
    })
  }
  return list.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
}

function buildBarChart(items, color, label, { horizontal = false, topN = null, sortBy = 'value' } = {}) {
  const sorted = sortChartItems(items, { sortBy })
  let source = topN ? sorted.slice(0, topN) : sorted
  if (!source.length) source = [{ label: '데이터 없음', value: 0 }]

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${label}: ${formatValue(ctx.raw)}`,
        },
      },
    },
  }

  if (horizontal) {
    return {
      data: {
        labels: source.map((x) => x.label),
        datasets: [
          {
            label,
            data: source.map((x) => x.value ?? 0),
            backgroundColor: color,
            borderRadius: 6,
          },
        ],
      },
      options: {
        ...baseOptions,
        indexAxis: 'y',
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: (v) => formatValue(v) },
          },
          y: {
            ticks: { autoSkip: false, font: { size: 11 } },
          },
        },
      },
    }
  }

  return {
    data: {
      labels: source.map((x) => x.label),
      datasets: [
        {
          label,
          data: source.map((x) => x.value ?? 0),
          backgroundColor: color,
          borderRadius: 6,
        },
      ],
    },
    options: {
      ...baseOptions,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => formatValue(v) },
        },
      },
    },
  }
}

const yearChart = computed(() => buildChartConfig(yearData.value))
const monthChart = computed(() => buildChartConfig(monthData.value))
const weekdayChart = computed(() => buildChartConfig(weekdayData.value))

const dailyChartItems = computed(() =>
  [...props.dailyRecords]
    .map((r) => {
      const p = parseSalesDate(r.date)
      return {
        label: r.date || '-',
        value: metricFromBucket(r),
        sortTime: p ? p.date.getTime() : 0,
      }
    })
    .sort((a, b) => a.sortTime - b.sortTime),
)

const channelChartItems = computed(() =>
  aggregateDetailsByChannel(props.records).map((x) => ({
    label: x.label,
    value: metricFromBucket(x),
  })),
)

const productOptionChartItems = computed(() =>
  aggregateDetailsByProductOption(props.records).map((x) => ({
    label: x.label,
    value: metricFromBucket(x),
  })),
)

const dailyChart = computed(() =>
  buildBarChart(dailyChartItems.value, metricMeta.value.color, `일별 ${metricLabel.value}`, {
    sortBy: 'chrono',
  }),
)

const channelChart = computed(() =>
  buildBarChart(channelChartItems.value, 'rgba(14, 116, 144, 0.75)', `판매처별 ${metricLabel.value}`, {
    horizontal: true,
    topN: 20,
  }),
)

const PRODUCT_OPTION_TOP_N = 12

const productOptionChart = computed(() =>
  buildBarChart(
    productOptionChartItems.value,
    'rgba(16, 185, 129, 0.75)',
    `상품·옵션별 ${metricLabel.value}`,
    { horizontal: true, topN: PRODUCT_OPTION_TOP_N },
  ),
)

const channelChartHeight = computed(() => {
  const count = Math.min(channelChartItems.value.length, 20)
  return Math.min(480, Math.max(280, count * 24))
})

const productChartHeight = computed(() => {
  const count = Math.min(productOptionChartItems.value.length, PRODUCT_OPTION_TOP_N)
  return Math.min(320, Math.max(220, count * 22))
})

const hasData = computed(() => props.records.length > 0 || props.dailyRecords.length > 0)

const esserPeriodBuckets = computed(() => {
  if (
    props.serverDailyChartBuckets?.length &&
    esserPeriodMode.value === 'daily'
  ) {
    return props.serverDailyChartBuckets
  }
  const ctx = props.manualFilterCtx
  const entries = props.manualAdEntries
  if (esserPeriodMode.value === 'weekly') {
    return aggregateEsserByWeekWithManual(props.records, entries, ctx, props.filterYear)
  }
  if (esserPeriodMode.value === 'monthly') {
    return aggregateEsserByMonthWithManual(props.records, entries, ctx, props.filterYear)
  }
  return aggregateEsserByDayWithManual(props.records, entries, ctx)
})

const esserChartItems = computed(() =>
  esserPeriodBuckets.value.map((bucket) => ({
    label: bucket.label,
    value: chartValueFromBucket(bucket, esserChartMetric.value),
    sortTime: bucket.sortTime ?? 0,
  })),
)

const esserChartMeta = computed(
  () =>
    ESSER_CHART_METRICS.find((m) => m.key === esserChartMetric.value) || ESSER_CHART_METRICS[0],
)

const esserMetricLabel = computed(() => esserChartMeta.value.label)

function esserItemsFromBuckets(buckets) {
  const key = esserChartMetric.value
  return buckets.map((b) => ({
    label: b.label,
    value: chartValueFromBucket(b, key),
    sortTime: b.sortTime ?? 0,
  }))
}

/** 월간 탭과 겹치지 않게 캘린더 월별(1~12월) */
const showEsserMonthCalendar = computed(() => esserPeriodMode.value !== 'monthly')

/** 일간 탭과 겹치지 않게 날짜별 상세 */
const showEsserDailyDetail = computed(() => esserPeriodMode.value !== 'daily')

const esserYearItems = computed(() => esserItemsFromBuckets(aggregateEsserByYear(props.records)))

const esserMonthItems = computed(() => {
  const ctx = props.manualFilterCtx
  const entries = props.manualAdEntries
  return esserItemsFromBuckets(
    aggregateEsserByMonthWithManual(props.records, entries, ctx, props.filterYear),
  )
})

const esserWeekdayItems = computed(() =>
  esserItemsFromBuckets(aggregateEsserByWeekday(props.records)),
)

const esserDailyDetailItems = computed(() =>
  esserItemsFromBuckets(
    aggregateEsserByDayWithManual(props.records, props.manualAdEntries, props.manualFilterCtx),
  ),
)

const esserChannelItems = computed(() =>
  aggregateEsserByChannel(props.records, esserChartMetric.value),
)

const esserProductItems = computed(() =>
  aggregateEsserByProductOption(props.records, esserChartMetric.value),
)

const ESSER_CHANNEL_TOP_N = 20
const ESSER_PRODUCT_TOP_N = 12

const showEsserChannelChart = computed(() => esserChannelItems.value.some((x) => x.value > 0))

const showEsserProductChart = computed(() => esserProductItems.value.some((x) => x.value > 0))

const esserSalesMethodBreakdown = computed(() => {
  if (props.salesMethod) return []
  return aggregateEsserBySalesMethodWithManual(
    props.records,
    props.manualAdEntries,
    props.manualFilterCtx,
    esserChartMetric.value,
  )
})

function formatEsserChartValue(n) {
  return formatEsserValue(esserChartMetric.value, n)
}

function buildEsserBarChart(items, color, title, { horizontal = false, topN = null, sortBy = 'value' } = {}) {
  const sorted = sortChartItems(items, { sortBy })
  let source = topN ? sorted.slice(0, topN) : sorted
  if (!source.length) source = [{ label: '데이터 없음', value: 0 }]
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${title}: ${formatEsserChartValue(ctx.raw)}`,
        },
      },
    },
  }

  if (horizontal) {
    return {
      data: {
        labels: source.map((x) => x.label),
        datasets: [
          {
            label: title,
            data: source.map((x) => x.value ?? 0),
            backgroundColor: color,
            borderRadius: 6,
          },
        ],
      },
      options: {
        ...baseOptions,
        indexAxis: 'y',
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: (v) => formatEsserChartValue(v) },
          },
          y: {
            ticks: { autoSkip: false, font: { size: 11 } },
          },
        },
      },
    }
  }

  return {
    data: {
      labels: source.map((x) => x.label),
      datasets: [
        {
          label: title,
          data: source.map((x) => x.value ?? 0),
          backgroundColor: color,
          borderRadius: 6,
        },
      ],
    },
    options: {
      ...baseOptions,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => formatEsserChartValue(v) },
        },
      },
    },
  }
}

const esserMainChart = computed(() => {
  const meta = esserChartMeta.value
  const periodLabel =
    esserPeriodOptions.find((p) => p.key === esserPeriodMode.value)?.label || ''
  const items = esserChartItems.value.map((x) => ({
    label: x.label,
    value: x.value,
    sortTime: x.sortTime,
  }))
  return buildEsserBarChart(items, meta.color, `${periodLabel} ${meta.label}`, { sortBy: 'chrono' })
})

const esserMethodChart = computed(() =>
  buildEsserBarChart(
    esserSalesMethodBreakdown.value,
    'rgba(234, 88, 12, 0.75)',
    `판매방식별 ${esserChartMeta.value.label}`,
  ),
)

const esserYearChart = computed(() =>
  buildEsserBarChart(esserYearItems.value, esserChartMeta.value.color, `년도별 ${esserMetricLabel.value}`, {
    sortBy: 'chrono',
  }),
)

const esserMonthChart = computed(() =>
  buildEsserBarChart(
    esserMonthItems.value,
    'rgba(59, 130, 246, 0.75)',
    `월별 ${esserMetricLabel.value}`,
    { sortBy: 'chrono' },
  ),
)

const esserWeekdayChart = computed(() =>
  buildEsserBarChart(
    esserWeekdayItems.value,
    'rgba(16, 185, 129, 0.75)',
    `요일별 ${esserMetricLabel.value}`,
    { sortBy: 'chrono' },
  ),
)

const esserDailyDetailChart = computed(() =>
  buildEsserBarChart(
    esserDailyDetailItems.value,
    esserChartMeta.value.color,
    `일별 ${esserMetricLabel.value}`,
    { sortBy: 'chrono' },
  ),
)

const esserChannelChart = computed(() =>
  buildEsserBarChart(
    esserChannelItems.value,
    'rgba(14, 116, 144, 0.75)',
    `플랫폼별 ${esserMetricLabel.value} (쿠팡·네이버)`,
    { horizontal: true, topN: ESSER_CHANNEL_TOP_N },
  ),
)

const esserProductChart = computed(() =>
  buildEsserBarChart(
    esserProductItems.value,
    'rgba(16, 185, 129, 0.75)',
    `상품·옵션별 ${esserMetricLabel.value}`,
    { horizontal: true, topN: ESSER_PRODUCT_TOP_N },
  ),
)

const esserChannelChartHeight = computed(() => {
  const count = Math.min(esserChannelItems.value.length, ESSER_CHANNEL_TOP_N)
  return Math.min(480, Math.max(280, count * 24))
})

const esserProductChartHeight = computed(() => {
  const count = Math.min(esserProductItems.value.length, ESSER_PRODUCT_TOP_N)
  return Math.min(320, Math.max(220, count * 22))
})
</script>

<template>
  <div v-if="!hasData" class="empty chart-empty">차트에 표시할 상세 거래 데이터가 없습니다.</div>
  <div v-else-if="esserMode" class="esser-charts">
    <div class="charts-toolbar">
      <select v-model="esserChartMetric" class="chart-metric-select">
        <option v-for="m in ESSER_CHART_METRICS" :key="m.key" :value="m.key">
          그래프 지표: {{ m.label }}
        </option>
      </select>
      <p class="toolbar-hint">KPI는 위 대시보드 · 아래는 선택 지표 기준 그래프</p>
    </div>

    <section class="chart-section">
      <div class="section-head">
        <h3 class="section-title">기간 추이</h3>
        <div class="period-tabs">
          <button
            v-for="opt in esserPeriodOptions"
            :key="opt.key"
            type="button"
            class="period-tab"
            :class="{ active: esserPeriodMode === opt.key }"
            @click="esserPeriodMode = opt.key"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
      <div class="chart-card chart-card-wide">
        <h4 class="chart-title">
          {{ esserPeriodOptions.find((p) => p.key === esserPeriodMode)?.label }}
          {{ esserMetricLabel }} 추이
        </h4>
        <div class="chart-canvas chart-canvas-esser-main">
          <Bar :data="esserMainChart.data" :options="esserMainChart.options" />
        </div>
      </div>
      <div v-if="showEsserDailyDetail" class="chart-card chart-card-wide">
        <p class="section-note chart-inline-note">
          주간·월간 보기일 때 날짜별 흐름 — 「일간」 탭에서는 위 추이 차트와 동일합니다.
        </p>
        <h4 class="chart-title">일별 {{ esserMetricLabel }}</h4>
        <div class="chart-canvas chart-canvas-wide">
          <Bar :data="esserDailyDetailChart.data" :options="esserDailyDetailChart.options" />
        </div>
      </div>
    </section>

    <section class="chart-section">
      <h3 class="section-title">캘린더·패턴</h3>
      <p v-if="!showEsserMonthCalendar" class="section-note">
        월별(1~12월) 그래프는 「기간 추이」에서 <strong>월간</strong> 탭과 같습니다.
      </p>
      <div class="chart-grid">
        <div class="chart-card">
          <h4 class="chart-title">년도별 {{ esserMetricLabel }}</h4>
          <div class="chart-canvas">
            <Bar :data="esserYearChart.data" :options="esserYearChart.options" />
          </div>
        </div>
        <div v-if="showEsserMonthCalendar" class="chart-card">
          <h4 class="chart-title">
            월별 {{ esserMetricLabel }}
            <span v-if="filterYear" class="chart-sub">({{ filterYear }}년)</span>
          </h4>
          <div class="chart-canvas">
            <Bar :data="esserMonthChart.data" :options="esserMonthChart.options" />
          </div>
        </div>
        <div class="chart-card" :class="{ 'chart-card-wide': !showEsserMonthCalendar }">
          <h4 class="chart-title">요일별 {{ esserMetricLabel }}</h4>
          <div class="chart-canvas">
            <Bar :data="esserWeekdayChart.data" :options="esserWeekdayChart.options" />
          </div>
        </div>
      </div>
    </section>

    <section class="chart-section">
      <h3 class="section-title">항목별 분해</h3>
      <div class="chart-grid">
        <div
          v-if="esserSalesMethodBreakdown.length > 1"
          class="chart-card chart-card-wide"
        >
          <h4 class="chart-title">
            판매방식별 {{ esserMetricLabel }}
            <span class="chart-sub">로켓그로스 · 판매자배송</span>
          </h4>
          <div class="chart-canvas chart-canvas-esser-method">
            <Bar :data="esserMethodChart.data" :options="esserMethodChart.options" />
          </div>
        </div>

        <div v-if="showEsserChannelChart" class="chart-card chart-card-wide chart-card-large">
          <h4 class="chart-title">
            플랫폼별 {{ esserMetricLabel }} (쿠팡·네이버)
            <span class="chart-sub">(상위 {{ ESSER_CHANNEL_TOP_N }}개)</span>
          </h4>
          <div
            class="chart-canvas chart-canvas-dynamic"
            :style="{ height: `${esserChannelChartHeight}px` }"
          >
            <Bar :data="esserChannelChart.data" :options="esserChannelChart.options" />
          </div>
        </div>

        <div v-if="showEsserProductChart" class="chart-card chart-card-wide">
          <h4 class="chart-title">
            상품·옵션별 {{ esserMetricLabel }}
            <span class="chart-sub">(상위 {{ ESSER_PRODUCT_TOP_N }}개)</span>
          </h4>
          <div
            class="chart-canvas chart-canvas-product"
            :style="{ height: `${esserProductChartHeight}px` }"
          >
            <Bar :data="esserProductChart.data" :options="esserProductChart.options" />
          </div>
        </div>
      </div>
    </section>
  </div>
  <div v-else>
    <p v-if="metricMeta.hint" class="metric-hint">선택 지표: {{ metricMeta.hint }}</p>

    <div class="kpi-grid">
      <div
        v-for="card in kpiCards"
        :key="card.key"
        class="kpi-card"
        :class="{ active: metric === card.key }"
      >
        <span class="kpi-label">{{ card.label }}</span>
        <strong class="kpi-value">{{ formatKpi(card.key, card.value) }}</strong>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <h3 class="chart-title">년도별 {{ metricLabel }}</h3>
        <div class="chart-canvas">
          <Bar :data="yearChart.data" :options="yearChart.options" />
        </div>
      </div>
      <div class="chart-card">
        <h3 class="chart-title">
          월별 {{ metricLabel }}
          <span v-if="filterYear" class="chart-sub">({{ filterYear }}년)</span>
        </h3>
        <div class="chart-canvas">
          <Bar :data="monthChart.data" :options="monthChart.options" />
        </div>
      </div>
      <div class="chart-card chart-card-wide">
        <h3 class="chart-title">요일별 {{ metricLabel }}</h3>
        <div class="chart-canvas">
          <Bar :data="weekdayChart.data" :options="weekdayChart.options" />
        </div>
      </div>

      <div class="chart-card chart-card-wide">
        <h3 class="chart-title">일별 {{ metricLabel }}</h3>
        <div class="chart-canvas chart-canvas-wide">
          <Bar :data="dailyChart.data" :options="dailyChart.options" />
        </div>
      </div>

      <div class="chart-card chart-card-wide chart-card-large">
        <h3 class="chart-title">판매처별 {{ metricLabel }}</h3>
        <div class="chart-canvas chart-canvas-dynamic" :style="{ height: `${channelChartHeight}px` }">
          <Bar :data="channelChart.data" :options="channelChart.options" />
        </div>
      </div>

      <div class="chart-card chart-card-wide">
        <h3 class="chart-title">
          상품·옵션별 {{ metricLabel }}
          <span class="chart-sub">(상위 {{ PRODUCT_OPTION_TOP_N }}개)</span>
        </h3>
        <div class="chart-canvas chart-canvas-product" :style="{ height: `${productChartHeight}px` }">
          <Bar :data="productOptionChart.data" :options="productOptionChart.options" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metric-hint {
  margin: 0 0 12px;
  font-size: 0.8rem;
  color: var(--muted);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.kpi-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--surface);
}

.kpi-card.active {
  border-color: var(--primary);
  background: #eff6ff;
}

.kpi-label {
  display: block;
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 4px;
}

.kpi-value {
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.chart-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: #fafbfc;
}

.chart-card-wide {
  grid-column: 1 / -1;
}

.chart-card-large {
  padding: 16px;
}

.chart-title {
  margin: 0 0 8px;
  font-size: 0.875rem;
  font-weight: 600;
}

.chart-sub {
  font-weight: 400;
  color: var(--muted);
  font-size: 0.8rem;
}

.chart-canvas {
  height: 220px;
  position: relative;
}

.chart-canvas-wide {
  height: 280px;
}

.chart-canvas-dynamic {
  min-height: 280px;
  max-height: 480px;
  position: relative;
  width: 100%;
}

.chart-canvas-product {
  min-height: 220px;
  max-height: 320px;
  position: relative;
  width: 100%;
}

.chart-canvas :deep(canvas) {
  max-width: 100%;
}

.chart-empty {
  padding: 24px;
}

.esser-charts {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.charts-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.toolbar-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.chart-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text, inherit);
}

.section-note {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.chart-inline-note {
  margin: 0 0 8px;
}

.period-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.period-tab {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
}

.period-tab.active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.chart-metric-select {
  min-width: 200px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.875rem;
}

.chart-canvas-esser-main {
  height: 300px;
  position: relative;
}

.chart-canvas-esser-method {
  height: 240px;
  position: relative;
}
</style>
