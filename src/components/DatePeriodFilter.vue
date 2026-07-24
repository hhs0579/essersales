<script setup>
import { computed, ref, watch } from 'vue'
import {
  yesterdayYmd,
  offsetYmdFromToday,
  maxReportDateYmd,
  clampToMaxReportDate,
} from '../utils/reportDateRange.js'

const props = defineProps({
  dateFrom: { type: String, default: '' },
  dateTo: { type: String, default: '' },
  minDate: { type: String, default: '' },
  maxDate: { type: String, default: '' },
})

const emit = defineEmits(['update:dateFrom', 'update:dateTo'])

const mode = ref('range')

const effectiveMaxDate = computed(() => props.maxDate || maxReportDateYmd())

const singleDate = computed({
  get() {
    if (props.dateFrom && props.dateFrom === props.dateTo) return props.dateFrom
    return props.dateFrom || props.dateTo || ''
  },
  set(v) {
    const clamped = clampToMaxReportDate(v || '')
    emit('update:dateFrom', clamped)
    emit('update:dateTo', clamped)
  },
})

function setRange(from, to) {
  const f = from ? clampToMaxReportDate(from) : ''
  let t = to ? clampToMaxReportDate(to) : ''
  if (f && t && t < f) t = f
  emit('update:dateFrom', f)
  emit('update:dateTo', t)
}

function clearRange() {
  setRange('', '')
}

function presetYesterday() {
  mode.value = 'day'
  const y = yesterdayYmd()
  setRange(y, y)
}

function presetLast7Days() {
  mode.value = 'range'
  setRange(offsetYmdFromToday(-7), yesterdayYmd())
}

function presetThisMonth() {
  mode.value = 'range'
  const d = new Date()
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  setRange(start, yesterdayYmd())
}

const periodLabel = computed(() => {
  if (!props.dateFrom && !props.dateTo) return '전체 기간'
  if (props.dateFrom && props.dateTo && props.dateFrom === props.dateTo) return props.dateFrom
  if (props.dateFrom && props.dateTo) return `${props.dateFrom} ~ ${props.dateTo}`
  if (props.dateFrom) return `${props.dateFrom} ~`
  return `~ ${props.dateTo}`
})

const hasDate = computed(() => Boolean(props.dateFrom || props.dateTo))

watch(
  () => [props.dateFrom, props.dateTo],
  ([from, to]) => {
    if (from && to && from === to) mode.value = 'day'
    else if (from || to) mode.value = 'range'
  },
  { immediate: true },
)

function onModeChange(next) {
  mode.value = next
  if (next === 'day' && props.dateFrom && props.dateTo && props.dateFrom !== props.dateTo) {
    setRange(props.dateFrom, props.dateFrom)
  }
}
</script>

<template>
  <div class="date-period-filter" role="group" aria-label="기간 필터">
    <div class="segmented" role="tablist">
      <button
        type="button"
        class="segment"
        role="tab"
        :aria-selected="mode === 'day'"
        :class="{ active: mode === 'day' }"
        @click="onModeChange('day')"
      >
        하루
      </button>
      <button
        type="button"
        class="segment"
        role="tab"
        :aria-selected="mode === 'range'"
        :class="{ active: mode === 'range' }"
        @click="onModeChange('range')"
      >
        기간
      </button>
    </div>

    <span class="period-pill" :class="{ muted: !hasDate }">{{ periodLabel }}</span>

    <div class="date-inputs">
      <template v-if="mode === 'day'">
        <input
          v-model="singleDate"
          class="date-input"
          type="date"
          :min="minDate"
          :max="effectiveMaxDate"
          aria-label="날짜"
        />
      </template>
      <template v-else>
        <input
          :value="dateFrom"
          class="date-input"
          type="date"
          :min="minDate"
          :max="dateTo || effectiveMaxDate"
          aria-label="시작일"
          @input="setRange($event.target.value, dateTo)"
        />
        <span class="range-sep">~</span>
        <input
          :value="dateTo"
          class="date-input"
          type="date"
          :min="dateFrom || minDate"
          :max="effectiveMaxDate"
          aria-label="종료일"
          @input="setRange(dateFrom, $event.target.value)"
        />
      </template>
    </div>

    <button
      v-if="hasDate"
      type="button"
      class="icon-btn"
      title="날짜 지우기"
      aria-label="날짜 지우기"
      @click="clearRange"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M18 6L6 18M6 6l12 12"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <div class="preset-group" role="group" aria-label="빠른 기간">
      <button type="button" class="preset" @click="presetYesterday">어제</button>
      <button type="button" class="preset" @click="presetLast7Days">최근 7일</button>
      <button type="button" class="preset" @click="presetThisMonth">이번 달</button>
    </div>
  </div>
</template>

<style scoped>
.date-period-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  min-width: 0;
}

.segmented {
  display: inline-flex;
  padding: 2px;
  background: #e2e8f0;
  border-radius: 8px;
  gap: 2px;
}

.segment {
  padding: 5px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}

.segment.active {
  background: var(--surface);
  color: var(--primary);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.period-pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.75rem;
  font-weight: 600;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.period-pill.muted {
  background: #f1f5f9;
  color: var(--muted);
  font-weight: 500;
}

.date-inputs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.date-input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.8125rem;
  font-family: inherit;
  color: var(--text);
  background: var(--surface);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.date-input:hover {
  border-color: #cbd5e1;
}

.date-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.range-sep {
  color: #94a3b8;
  font-size: 0.8125rem;
  user-select: none;
}

.preset-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: 4px;
  border-left: 1px solid #e2e8f0;
}

.preset {
  padding: 5px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.preset:hover {
  background: #e2e8f0;
  color: var(--text);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.icon-btn:hover {
  background: #fee2e2;
  color: var(--danger);
}
</style>
