<script setup>
import { computed, ref, watch } from 'vue'
import DatePeriodFilter from './DatePeriodFilter.vue'
import {
  COMBINED_COMMENT_LABELS,
  commentSlotsHaveContent,
  getCommentSlotsForDate,
} from '../config/combinedComments.js'
import { useCombinedComments } from '../composables/useCombinedComments.js'
import { yesterdayYmd } from '../utils/reportDateRange.js'

const yesterday = yesterdayYmd()
const dateFrom = ref(yesterday)
const dateTo = ref(yesterday)

const rangeRefs = {
  dateFrom,
  dateTo,
}

const {
  store,
  slotCount,
  isSingleDay,
  editDate,
  editSlots,
  rangeDays,
  saveDayComments,
  clearDayComments,
} = useCombinedComments('combined_comments', rangeRefs)

const labels = COMBINED_COMMENT_LABELS
const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')

const displayDays = computed(() => {
  const days = [...rangeDays.value]
  const legacy = store.byDate.__legacy__
  if (commentSlotsHaveContent(legacy)) {
    days.push({
      date: '',
      comments: getCommentSlotsForDate({ __legacy__: legacy }, '__legacy__'),
      isLegacy: true,
    })
  }
  return days
})

const periodHint = computed(() => {
  if (isSingleDay.value) {
    return `${editDate.value} 코멘트를 입력한 뒤 저장하세요.`
  }
  return '기간 안의 일별 코멘트를 날짜순으로 표시합니다. 수정하려면 날짜를 「하루」로 맞추세요.'
})

watch([dateFrom, dateTo], () => {
  saveMsg.value = ''
  saveErr.value = ''
})

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    const result = await saveDayComments()
    saveMsg.value =
      result?.mode === 'local' && result.warning
        ? result.warning
        : `${editDate.value} 코멘트가 저장되었습니다.`
  } catch (e) {
    saveErr.value = e?.message || '저장에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

async function onClearDay() {
  if (!editDate.value) return
  if (!confirm(`${editDate.value} 코멘트를 비우고 저장할까요?`)) return
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await clearDayComments()
    saveMsg.value = `${editDate.value} 코멘트를 비웠습니다.`
  } catch (e) {
    saveErr.value = e?.message || '삭제에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

function jumpToDay(ymd) {
  dateFrom.value = ymd
  dateTo.value = ymd
}
</script>

<template>
  <div class="combined-comments-page">
    <p class="standard-ref page-hint">
      베스트하임 · 사본느리 · 파워프라이스 · 마케팅 코멘트를 <strong>날짜마다</strong> 저장합니다.
      주간 등 기간을 지정하면 그 구간에 작성한 일별 코멘트가 모두 보입니다. (기준일: 어제까지)
    </p>

    <div class="filter-row">
      <DatePeriodFilter v-model:date-from="dateFrom" v-model:date-to="dateTo" />
    </div>

    <p class="period-hint">{{ periodHint }}</p>

    <!-- 하루: 편집 -->
    <template v-if="isSingleDay">
      <div class="memo-table-wrap">
        <table class="memo-table">
          <thead>
            <tr>
              <th colspan="2" class="day-title">{{ editDate }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in slotCount" :key="`edit-${i}`">
              <th class="memo-row-label">{{ labels[i - 1] }}</th>
              <td>
                <textarea
                  v-model="editSlots[i - 1]"
                  class="memo-cell"
                  rows="3"
                  :placeholder="`${labels[i - 1]} 코멘트`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="memo-foot">
        <p v-if="saveMsg" class="save-ok">{{ saveMsg }}</p>
        <p v-if="saveErr" class="save-fail">{{ saveErr }}</p>
        <button type="button" class="btn btn-outline btn-sm" :disabled="saving" @click="onClearDay">
          이 날 비우기
        </button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="saving" @click="onSave">
          {{ saving ? '저장 중…' : '저장' }}
        </button>
      </div>
    </template>

    <!-- 기간: 목록 -->
    <template v-else>
      <div v-if="!displayDays.length" class="empty-range">
        이 기간에 저장된 일별 코멘트가 없습니다.
      </div>
      <div v-for="day in displayDays" :key="day.date || 'legacy'" class="day-block">
        <div class="day-block-head">
          <h4 class="day-block-title">
            {{ day.isLegacy ? '날짜 미지정(이전 저장)' : day.date }}
          </h4>
          <button
            v-if="day.date"
            type="button"
            class="btn btn-outline btn-sm"
            @click="jumpToDay(day.date)"
          >
            이 날 수정
          </button>
        </div>
        <table class="memo-table readonly">
          <tbody>
            <tr v-for="i in slotCount" :key="`${day.date}-${i}`">
              <th class="memo-row-label">{{ labels[i - 1] }}</th>
              <td class="memo-text">{{ day.comments[i - 1] || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.combined-comments-page {
  margin-top: 4px;
}

.page-hint {
  margin: 0 0 12px;
  font-size: 0.875rem;
  line-height: 1.5;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 16px;
  margin-bottom: 8px;
}

.period-hint {
  margin: 0 0 12px;
  font-size: 0.8125rem;
  color: var(--muted);
}

.memo-table-wrap,
.day-block {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fafbfc;
  margin-bottom: 12px;
}

.day-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 0;
}

.day-block-title,
.day-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  background: #e2e8f0;
  text-align: center;
}

.day-title {
  padding: 10px;
}

.memo-table {
  width: 100%;
  min-width: 480px;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.memo-table th,
.memo-table td {
  border: 1px solid var(--border);
  padding: 6px;
  vertical-align: top;
}

.memo-row-label {
  width: 108px;
  min-width: 108px;
  background: #e2e8f0;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.memo-cell {
  width: 100%;
  min-height: 72px;
  padding: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-family: inherit;
  resize: vertical;
  background: #fff;
}

.memo-cell:focus {
  border-color: var(--primary);
  outline: none;
}

.memo-text {
  white-space: pre-wrap;
  background: #fff;
  line-height: 1.45;
  padding: 10px 12px;
}

.memo-foot {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.save-ok {
  margin: 0 auto 0 0;
  font-size: 0.8125rem;
  color: var(--success, #047857);
}

.save-fail {
  margin: 0 auto 0 0;
  font-size: 0.8125rem;
  color: var(--danger);
}

.empty-range {
  padding: 24px 16px;
  text-align: center;
  color: var(--muted);
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: #f8fafc;
}
</style>
