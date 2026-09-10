<script setup>
import { computed, ref } from 'vue'
import { useManualExpense, currentMonthKey } from '../composables/useManualExpense.js'
import { normalizeManualExpenseEntry } from '../utils/manualExpenseKpi.js'

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

const { currentEntries, addEntry, removeEntry, saveExpense, resetExpense } = useManualExpense(
  props.scope,
  effectiveMonth,
)

const entries = computed(() => currentEntries())

const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')

function normalizeEntryField(entry, key) {
  const normalized = normalizeManualExpenseEntry(entry)
  entry[key] = normalized[key]
}

function normalizeAllFields() {
  const list = currentEntries()
  for (let i = 0; i < list.length; i += 1) {
    list[i] = normalizeManualExpenseEntry(list[i])
  }
}

const hasRows = computed(() => entries.value.length > 0)

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    normalizeAllFields()
    const result = await saveExpense()
    saveMsg.value =
      result?.mode === 'local' && result.warning
        ? result.warning
        : `${effectiveMonth.value} 수기 지출이 저장되었습니다.`
    emit('saved')
  } catch (e) {
    saveErr.value = e?.message || '저장에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

async function onReset() {
  if (!confirm(`${effectiveMonth.value} 수기 지출 입력값을 모두 비우고 저장할까요?`)) return
  resetExpense()
  await onSave()
}
</script>

<template>
  <div class="manual-expense-panel">
    <p class="standard-ref section-hint">
      엑셀에 없는 <strong>지출</strong>을 넣습니다. 이름·금액만 입력하면
      <strong>마진(순이익)에서 차감</strong>됩니다. 매출에는 더해지지 않습니다.
    </p>

    <div class="table-wrap">
      <table class="entry-table">
        <thead>
          <tr>
            <th>지출 이름</th>
            <th>금액</th>
            <th class="col-action" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="!hasRows">
            <td colspan="3" class="empty-row">지출 행이 없습니다. 아래에서 추가하세요.</td>
          </tr>
          <tr v-for="entry in entries" :key="entry.id">
            <td>
              <input
                v-model="entry.name"
                type="text"
                class="cell-input"
                placeholder="예: 물류비·수수료"
              />
            </td>
            <td>
              <input
                v-model="entry.amount"
                type="text"
                inputmode="numeric"
                class="cell-input cell-amount"
                placeholder="0"
                @blur="normalizeEntryField(entry, 'amount')"
              />
            </td>
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
.manual-expense-panel {
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
