<script setup>
import { computed, ref, watch } from 'vue'
import { maxReportDateYmd } from '../utils/reportDateRange.js'

const props = defineProps({
  /** YYYY-MM-DD (보통 YYYY-MM-01) */
  modelValue: { type: String, default: '' },
  suggestDate: { type: String, default: '' },
  minYear: { type: Number, default: 2020 },
  maxDate: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const year = ref('')
const month = ref('')

function pad2(n) {
  return String(n).padStart(2, '0')
}

function parseYmFromYmd(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})/)
  if (!m) return { y: '', m: '' }
  return { y: m[1], m: m[2] }
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

function daysInMonth(y, mo) {
  return new Date(Number(y), Number(mo), 0).getDate()
}

function isMonthAllowed(y, mo) {
  const yi = Number(y)
  const mi = Number(mo)
  if (!yi || !mi) return false
  const first = `${y}-${pad2(mo)}-01`
  if (first > effectiveMaxDate.value) return false
  return true
}

const monthOptions = computed(() => {
  const months = []
  for (let m = 1; m <= 12; m += 1) months.push(m)
  if (!year.value) return months
  return months.filter((m) => isMonthAllowed(year.value, m))
})

function syncFromSource(src) {
  const p = parseYmFromYmd(src)
  year.value = p.y
  month.value = p.m
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      syncFromSource(v)
      return
    }
    syncFromSource(props.suggestDate || effectiveMaxDate.value)
  },
  { immediate: true },
)

function commit() {
  if (!year.value || !month.value) {
    emit('update:modelValue', '')
    return
  }
  if (!isMonthAllowed(year.value, Number(month.value))) {
    const fallback = monthOptions.value[monthOptions.value.length - 1]
    if (fallback) month.value = pad2(fallback)
    else {
      emit('update:modelValue', '')
      return
    }
  }
  emit('update:modelValue', `${year.value}-${month.value}-01`)
}

function onYearChange(e) {
  year.value = e.target.value
  if (month.value && !isMonthAllowed(year.value, Number(month.value))) {
    month.value = monthOptions.value.length ? pad2(monthOptions.value[0]) : ''
  }
  commit()
}

function onMonthChange(e) {
  month.value = e.target.value
  commit()
}
</script>

<template>
  <div class="ym-fields" role="group" aria-label="월">
    <select :value="year" class="ym-select ym-y" aria-label="년" @change="onYearChange">
      <option value="">년</option>
      <option v-for="y in yearOptions" :key="y" :value="String(y)">{{ y }}년</option>
    </select>
    <select :value="month" class="ym-select ym-m" aria-label="월" @change="onMonthChange">
      <option value="">월</option>
      <option v-for="m in monthOptions" :key="m" :value="pad2(m)">{{ m }}월</option>
    </select>
  </div>
</template>

<style scoped>
.ym-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.ym-select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 6px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-family: inherit;
  background: #fff;
  color: var(--text, #0f172a);
  cursor: pointer;
}

.ym-y {
  flex: 1.2 1 56px;
}

.ym-m {
  flex: 1 1 48px;
}

.ym-select:focus {
  border-color: var(--primary, #2563eb);
  outline: none;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}
</style>
