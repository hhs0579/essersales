<script setup>
import { computed, ref } from 'vue'
import { useSpecialSale, currentMonthKey } from '../composables/useSpecialSale.js'
import { formatManualAdAmount, formatSignedManualAdAmount } from '../utils/parseAmount.js'
import {
  computeSpecialSaleMarginRate,
  normalizeSpecialSaleEntry,
} from '../utils/specialSaleKpi.js'

const props = defineProps({
  scope: { type: String, required: true },
  /** 조회 조건과 동일한 기준월 (YYYY-MM) */
  monthKey: { type: String, default: '' },
})

const emit = defineEmits(['saved'])

const effectiveMonth = computed(() => {
  const mk = String(props.monthKey || '').trim()
  return /^\d{4}-\d{2}$/.test(mk) ? mk : currentMonthKey()
})

const { currentEntries, addEntry, removeEntry, saveSale, resetSale } = useSpecialSale(
  props.scope,
  effectiveMonth,
)

const entries = computed(() => currentEntries())

const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')

function normalizeEntryField(entry, key) {
  const normalized = normalizeSpecialSaleEntry(entry)
  entry[key] = normalized[key]
}

function normalizeAllFields() {
  const list = currentEntries()
  for (let i = 0; i < list.length; i += 1) {
    list[i] = normalizeSpecialSaleEntry(list[i])
  }
}

function marginRateLabel(entry) {
  const rate = computeSpecialSaleMarginRate(entry)
  if (rate == null) return '—'
  return `${rate.toFixed(1)}%`
}

const hasRows = computed(() => entries.value.length > 0)

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    normalizeAllFields()
    const result = await saveSale()
    saveMsg.value =
      result?.mode === 'local' && result.warning
        ? result.warning
        : `${effectiveMonth.value} 특판 매출이 저장되었습니다.`
    emit('saved')
  } catch (e) {
    saveErr.value = e?.message || '저장에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

async function onReset() {
  if (!confirm(`${effectiveMonth.value} 특판 입력값을 모두 비우고 저장할까요?`)) return
  resetSale()
  await onSave()
}
</script>

<template>
  <div class="special-sale-panel">
    <p class="standard-ref section-hint">
      오픈마켓 엑셀에 없는 <strong>특판·위탁</strong> 실적을 넣습니다.
      <strong>+</strong>로 행을 추가하고, 특판 이름·매출·마진만 입력하세요.
      <strong>마진율</strong>은 자동 계산되며, 매출이 비어 있으면 KPI·엑셀에 출력하지 않습니다.
      월별 총 매출 = <strong>일별 매출 합계 + 해당 월 특판</strong>입니다.
    </p>

    <div class="table-wrap">
      <table class="entry-table">
        <thead>
          <tr>
            <th>특판 이름</th>
            <th>매출</th>
            <th>마진</th>
            <th>마진율</th>
            <th class="col-action" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="!hasRows">
            <td colspan="5" class="empty-row">특판 행이 없습니다. 아래에서 추가하세요.</td>
          </tr>
          <tr v-for="entry in entries" :key="entry.id">
            <td>
              <input
                v-model="entry.name"
                type="text"
                class="cell-input"
                placeholder="예: 코스트코 특판"
              />
            </td>
            <td>
              <input
                v-model="entry.sales"
                type="text"
                inputmode="numeric"
                class="cell-input cell-amount"
                placeholder="0"
                @blur="normalizeEntryField(entry, 'sales')"
              />
            </td>
            <td>
              <input
                v-model="entry.margin"
                type="text"
                inputmode="numeric"
                class="cell-input cell-amount"
                placeholder="0"
                @blur="normalizeEntryField(entry, 'margin')"
              />
            </td>
            <td class="calc-cell">{{ marginRateLabel(entry) }}</td>
            <td class="col-action">
              <button
                type="button"
                class="btn-icon"
                title="행 삭제"
                @click="removeEntry(entry.id)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section-foot">
      <button type="button" class="btn btn-outline btn-sm" :disabled="saving" @click="addEntry">
        + 행 추가
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="saving" @click="onSave">
        {{ saving ? '저장 중…' : '저장' }}
      </button>
      <button type="button" class="btn btn-outline btn-sm" :disabled="saving" @click="onReset">
        입력 초기화
      </button>
    </div>
    <p v-if="saveMsg" class="success-msg">{{ saveMsg }}</p>
    <p v-if="saveErr" class="error-msg">{{ saveErr }}</p>
  </div>
</template>

<style scoped>
.special-sale-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 10px;
}

.entry-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.entry-table th,
.entry-table td {
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--border, #e2e8f0);
  text-align: left;
  vertical-align: middle;
}

.entry-table th {
  background: #f8fafc;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  white-space: nowrap;
}

.entry-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-input {
  width: 100%;
  min-width: 120px;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 6px;
}

.cell-amount {
  min-width: 110px;
}

.calc-cell {
  color: var(--text-muted, #64748b);
  white-space: nowrap;
}

.col-action {
  width: 44px;
  text-align: center;
}

.btn-icon {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 6px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
}

.btn-icon:hover {
  background: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}

.empty-row {
  text-align: center;
  color: var(--text-muted, #94a3b8);
  padding: 1rem;
}

.section-foot {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
