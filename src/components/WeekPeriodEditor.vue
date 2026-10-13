<script setup>
import { ref, watch } from 'vue'
import {
  getWeeksForMonth,
  hasCustomWeekPeriods,
  saveWeekPeriods,
} from '../composables/useWeekPeriods.js'
import { listFriThuWeeksInMonth, validateWeekPeriods } from '../utils/friThuWeeks.js'

const props = defineProps({
  monthKey: { type: String, required: true },
})

const emit = defineEmits(['saved', 'close'])

const rows = ref([])
const saving = ref(false)
const error = ref('')

function loadRows() {
  rows.value = getWeeksForMonth(props.monthKey).map((w) => ({ from: w.from, to: w.to }))
  error.value = ''
}

watch(() => props.monthKey, loadRows, { immediate: true })

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function addRow() {
  if (rows.value.length >= 6) return
  const last = rows.value[rows.value.length - 1]
  if (last?.to) {
    const from = addDays(last.to, 1)
    rows.value.push({ from, to: addDays(from, 6) })
  } else {
    rows.value.push({ from: `${props.monthKey}-01`, to: `${props.monthKey}-07` })
  }
}

function removeRow(i) {
  if (rows.value.length <= 1) return
  rows.value.splice(i, 1)
}

/** 1일부터 7일 단위로 채우기 (1~7, 8~14, …, 말일까지) */
function fillSevenDays() {
  const [y, m] = props.monthKey.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const out = []
  for (let d = 1; d <= last && out.length < 6; d += 7) {
    const to = Math.min(d + 6, last)
    out.push({
      from: `${props.monthKey}-${String(d).padStart(2, '0')}`,
      to: `${props.monthKey}-${String(to).padStart(2, '0')}`,
    })
  }
  rows.value = out
  error.value = ''
}

function fillDefault() {
  rows.value = listFriThuWeeksInMonth(props.monthKey).map((w) => ({ from: w.from, to: w.to }))
  error.value = ''
}

async function save() {
  error.value = validateWeekPeriods(rows.value)
  if (error.value) return
  saving.value = true
  try {
    await saveWeekPeriods(props.monthKey, rows.value)
    emit('saved')
  } catch (e) {
    error.value = `저장 실패: ${e?.message || e}`
  } finally {
    saving.value = false
  }
}

async function resetToAuto() {
  if (!confirm('이 달의 주차 기간을 금~목 자동 계산으로 되돌릴까요?')) return
  saving.value = true
  try {
    await saveWeekPeriods(props.monthKey, null)
    loadRows()
    emit('saved')
  } catch (e) {
    error.value = `저장 실패: ${e?.message || e}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="week-period-editor">
    <div class="wpe-head">
      <strong>{{ monthKey }} 주차 기간 설정</strong>
      <span class="wpe-hint">
        {{ hasCustomWeekPeriods(monthKey) ? '직접 설정한 기간 사용 중' : '금~목 자동 계산 사용 중' }}
        · 저장하면 모든 PC에 같은 주차가 적용됩니다. 주차별 특판·지출은 주차 번호에 그대로 붙어 있습니다.
      </span>
    </div>

    <table class="wpe-table">
      <tbody>
        <tr v-for="(r, i) in rows" :key="i">
          <th>{{ i + 1 }}주차</th>
          <td><input v-model="r.from" type="date" class="filter-input" /></td>
          <td>~</td>
          <td><input v-model="r.to" type="date" class="filter-input" /></td>
          <td>
            <button type="button" class="wpe-btn" :disabled="rows.length <= 1" @click="removeRow(i)">
              삭제
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="wpe-actions">
      <button type="button" class="wpe-btn" :disabled="rows.length >= 6" @click="addRow">주차 추가</button>
      <button type="button" class="wpe-btn" @click="fillSevenDays">1일부터 7일씩 채우기</button>
      <button type="button" class="wpe-btn" @click="fillDefault">금~목 기본값 채우기</button>
      <span class="wpe-spacer" />
      <button
        v-if="hasCustomWeekPeriods(monthKey)"
        type="button"
        class="wpe-btn"
        :disabled="saving"
        @click="resetToAuto"
      >
        자동 계산으로 되돌리기
      </button>
      <button type="button" class="wpe-btn" :disabled="saving" @click="emit('close')">닫기</button>
      <button type="button" class="wpe-btn primary" :disabled="saving" @click="save">
        {{ saving ? '저장 중…' : '저장' }}
      </button>
    </div>
    <p v-if="error" class="wpe-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.week-period-editor {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 12px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wpe-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wpe-hint {
  font-size: 12px;
  color: #64748b;
}
.wpe-table th {
  text-align: left;
  padding-right: 8px;
  font-weight: 600;
  white-space: nowrap;
}
.wpe-table td {
  padding: 2px 4px;
}
.wpe-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.wpe-spacer {
  flex: 1;
}
.wpe-btn {
  padding: 4px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}
.wpe-btn:hover:not(:disabled) {
  background: #f1f5f9;
}
.wpe-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.wpe-btn.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.wpe-btn.primary:hover:not(:disabled) {
  background: #1d4ed8;
}
.wpe-error {
  color: #dc2626;
  font-size: 12px;
  margin: 0;
}
</style>
