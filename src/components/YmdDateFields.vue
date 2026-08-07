<script setup>
import { computed, ref, watch } from 'vue'
import { clampToMaxReportDate, maxReportDateYmd } from '../utils/reportDateRange.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 값이 비어 있을 때 드롭다운에 보여 줄 기준일 (YYYY-MM-DD) */
  suggestDate: { type: String, default: '' },
  minYear: { type: Number, default: 2020 },
  maxDate: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const year = ref('')
const month = ref('')
const day = ref('')

function parseYmd(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return { y: '', m: '', d: '' }
  return { y: m[1], m: m[2], d: m[3] }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function daysInMonth(y, mo) {
  const yi = Number(y)
  const mi = Number(mo)
  if (!yi || !mi) return 31
  return new Date(yi, mi, 0).getDate()
}

const effectiveMaxDate = computed(() => props.maxDate || maxReportDateYmd())

const maxYear = computed(() => {
  const cap = effectiveMaxDate.value
  const m = cap.match(/^(\d{4})/)
  return m ? Number(m[1]) : new Date().getFullYear()
})

const yearOptions = computed(() => {
  const out = []
  for (let y = maxYear.value; y >= props.minYear; y -= 1) out.push(y)
  return out
})

const monthOptions = computed(() => {
  const months = []
  for (let m = 1; m <= 12; m += 1) months.push(m)
  if (!year.value) return months
  return months.filter((m) => isMonthAllowed(year.value, m))
})

const dayOptions = computed(() => {
  if (!year.value || !month.value) {
    return Array.from({ length: 31 }, (_, i) => i + 1)
  }
  const n = daysInMonth(year.value, month.value)
  const days = []
  for (let d = 1; d <= n; d += 1) {
    if (isDayAllowed(year.value, month.value, d)) days.push(d)
  }
  return days.length ? days : [1]
})

function ymdFromParts(y, mo, d) {
  if (!y || !mo || !d) return ''
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

function isDayAllowed(y, mo, d) {
  const ymd = ymdFromParts(y, mo, d)
  if (!ymd) return false
  if (ymd > effectiveMaxDate.value) return false
  return true
}

function isMonthAllowed(y, mo) {
  for (let d = 1; d <= daysInMonth(y, mo); d += 1) {
    if (isDayAllowed(y, mo, d)) return true
  }
  return false
}

function syncFromSource(src) {
  const p = parseYmd(src)
  year.value = p.y
  month.value = p.m
  day.value = p.d
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      syncFromSource(v)
      return
    }
    // 값이 비면 드롭다운도 비움. suggestDate를 표시만 하면 저장된 날짜처럼 보이거나
    // 필터 시작일(dateFrom)로 오인·저장되는 사고가 난다.
    year.value = ''
    month.value = ''
    day.value = ''
  },
  { immediate: true },
)

function clampDay() {
  if (!year.value || !month.value || !day.value) return
  const maxD = daysInMonth(year.value, month.value)
  if (Number(day.value) > maxD) day.value = pad2(maxD)
  let ymd = ymdFromParts(year.value, month.value, day.value)
  ymd = clampToMaxReportDate(ymd)
  const p = parseYmd(ymd)
  year.value = p.y
  month.value = p.m
  day.value = p.d
}

function commit() {
  if (!year.value || !month.value || !day.value) {
    emit('update:modelValue', '')
    return
  }
  clampDay()
  emit('update:modelValue', ymdFromParts(year.value, month.value, day.value))
}

function onYearChange(e) {
  year.value = e.target.value
  if (month.value && !isMonthAllowed(year.value, Number(month.value))) {
    month.value = monthOptions.value[0] ? pad2(monthOptions.value[0]) : ''
  }
  if (day.value && !isDayAllowed(year.value, Number(month.value), Number(day.value))) {
    day.value = dayOptions.value.length ? pad2(dayOptions.value[dayOptions.value.length - 1]) : ''
  }
  commit()
}

function onMonthChange(e) {
  month.value = e.target.value
  clampDay()
  commit()
}

function onDayChange(e) {
  day.value = e.target.value
  clampDay()
  commit()
}
</script>

<template>
  <div class="ymd-fields" role="group" aria-label="날짜">
    <select
      :value="year"
      class="ymd-select ymd-y"
      aria-label="년"
      @change="onYearChange"
    >
      <option value="">년</option>
      <option v-for="y in yearOptions" :key="y" :value="String(y)">{{ y }}년</option>
    </select>
    <select
      :value="month"
      class="ymd-select ymd-m"
      aria-label="월"
      @change="onMonthChange"
    >
      <option value="">월</option>
      <option v-for="m in monthOptions" :key="m" :value="pad2(m)">{{ m }}월</option>
    </select>
    <select
      :value="day"
      class="ymd-select ymd-d"
      aria-label="일"
      @change="onDayChange"
    >
      <option value="">일</option>
      <option v-for="d in dayOptions" :key="d" :value="pad2(d)">{{ d }}일</option>
    </select>
  </div>
</template>

<style scoped>
.ymd-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.ymd-select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 4px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.75rem;
  font-family: inherit;
  background: #fff;
  color: var(--text, #0f172a);
  cursor: pointer;
}

.ymd-y {
  flex: 1.2 1 52px;
}

.ymd-m,
.ymd-d {
  flex: 1 1 44px;
}

.ymd-select:focus {
  border-color: var(--primary, #2563eb);
  outline: none;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}
</style>
