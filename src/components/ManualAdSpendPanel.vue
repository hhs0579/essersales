<script setup>
import { computed, ref, watch } from 'vue'
import { useManualAdSpend } from '../composables/useManualAdSpend.js'
import {
  totalManualAdSpend,
  totalManualAdSales,
  manualAdSummaryText,
  manualAdEntryVisibleInPanel,
  manualAdHasDateFilter,
} from '../utils/manualAdSpend.js'
import { formatManualAdAmount } from '../utils/parseAmount.js'
import { formatNaverAdImportMessage } from '../utils/naverAdCenterParser.js'
import { MANUAL_AD_SOURCE_OPTIONS, normalizeManualAdSource } from '../config/manualAdSpend.js'
import { maxReportDateYmd } from '../utils/reportDateRange.js'
import YmdDateFields from './YmdDateFields.vue'
import YmMonthFields from './YmMonthFields.vue'

const props = defineProps({
  scope: { type: String, required: true },
  filterCtx: { type: Object, default: () => ({}) },
})

const { entries, addEntry, removeEntry, clearAll, saveEntries, importNaverAdCenterExcel } =
  useManualAdSpend(props.scope)

const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')
const naverImporting = ref(false)
const naverImportMsg = ref('')
const naverImportErr = ref('')
const newEntrySource = ref('meta')

const periodMode = computed(() => (props.filterCtx?.period === 'monthly' ? 'monthly' : 'daily'))

const isCompanyBScope = computed(
  () => props.scope === 'company_b' || props.scope === 'company_b_monthly',
)

/** 조회 조건이 하루(시작=종료)일 때 그 날짜 (daily) */
const singleFilterDate = computed(() => {
  const { dateFrom, dateTo } = props.filterCtx
  if (dateFrom && dateTo && dateFrom === dateTo) return dateFrom
  return ''
})

/** 조회 조건이 같은 달이면 그 달의 시작일(YYYY-MM-01) (monthly) */
const singleFilterMonthStart = computed(() => {
  const { year, month, dateFrom, dateTo } = props.filterCtx
  if (year && month) {
    return `${year}-${String(month).padStart(2, '0')}-01`
  }
  if (!dateFrom || !dateTo) return ''
  if (dateFrom.slice(0, 7) !== dateTo.slice(0, 7)) return ''
  return `${dateFrom.slice(0, 7)}-01`
})

const singleAutoDate = computed(() =>
  periodMode.value === 'monthly' ? singleFilterMonthStart.value : singleFilterDate.value,
)

/** 새 행·빈 일자 드롭다운 기본값 */
const entryDateSuggest = computed(() => {
  if (singleAutoDate.value) return singleAutoDate.value
  const { dateFrom, dateTo, year, month } = props.filterCtx
  if (periodMode.value === 'monthly' && year && month) {
    return `${year}-${String(month).padStart(2, '0')}-01`
  }
  if (dateFrom) return dateFrom
  if (dateTo) return dateTo
  return maxReportDateYmd()
})

watch(singleAutoDate, (date) => {
  if (!date) return
  for (const row of entries.value) {
    if (!row.date) row.date = date
  }
})

function onAddEntry() {
  addEntry(singleAutoDate.value || '', newEntrySource.value)
}

function onSourceChange(row, e) {
  row.source = normalizeManualAdSource(e?.target?.value)
}

function normalizeAmountField(row, field) {
  row[field] = formatManualAdAmount(row[field])
}

function sourceCellClass(source) {
  const v = normalizeManualAdSource(source)
  if (v === 'gfa') return 'cell-source-gfa'
  if (v === 'ad') return 'cell-source-ad'
  if (v === 'google_traffic') return 'cell-source-google'
  return 'cell-source-meta'
}

const visibleEntries = computed(() =>
  entries.value.filter((row) => manualAdEntryVisibleInPanel(row, props.filterCtx)),
)

const hiddenEntryCount = computed(
  () => entries.value.length - visibleEntries.value.length,
)

const hasDateFilter = computed(() => manualAdHasDateFilter(props.filterCtx))

const sortedEntries = computed(() =>
  [...visibleEntries.value].sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date.localeCompare(b.date)
  }),
)

function clearVisible() {
  const ids = visibleEntries.value.map((row) => row.id)
  for (const id of ids) removeEntry(id)
}

const appliedAdSpend = computed(() => totalManualAdSpend(entries.value, props.filterCtx))
const appliedAdSales = computed(() => totalManualAdSales(entries.value, props.filterCtx))

const summaryLine = computed(() => manualAdSummaryText(entries.value, props.filterCtx))

const saveButtonLabel = computed(() =>
  periodMode.value === 'monthly' ? '월별 광고 저장하기' : '일별 광고 저장하기',
)

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    for (const row of entries.value) {
      normalizeAmountField(row, 'adSpend')
      normalizeAmountField(row, 'adSales')
    }
    await saveEntries()
    saveMsg.value = '서버에 저장되었습니다.'
  } catch (e) {
    saveErr.value = e?.message || '저장에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

async function onNaverAdFileChange(e) {
  const file = e?.target?.files?.[0]
  if (!file) return
  naverImporting.value = true
  naverImportMsg.value = ''
  naverImportErr.value = ''
  saveMsg.value = ''
  saveErr.value = ''
  try {
    const { parsed, mergeResult } = await importNaverAdCenterExcel(file, {
      period: periodMode.value,
    })
    naverImportMsg.value = `${formatNaverAdImportMessage(parsed, mergeResult)} — 아래 「저장」을 눌러 반영을 유지하세요.`
  } catch (err) {
    naverImportErr.value = err?.message || '엑셀을 읽지 못했습니다.'
  } finally {
    naverImporting.value = false
    e.target.value = ''
  }
}
</script>

<template>
  <div class="manual-ad-panel">
    <p class="standard-ref panel-hint">
      광고 플랫폼
      <strong v-if="periodMode === 'monthly'">월별</strong>
      <strong v-else>일별</strong>
      리포트에서 <strong>광고비용</strong>·<strong>전환매출액</strong>만 입력하면
      KPI·그래프·엑셀에 반영됩니다. (노출·클릭 등은 불필요)
      <span v-if="singleAutoDate" class="filter-date-hint">
        조회 기간 자동 적용 — <strong v-if="periodMode === 'monthly'">{{ singleAutoDate.slice(0, 7) }}</strong><strong v-else>{{ singleAutoDate }}</strong>
      </span>
      <span v-else-if="hasDateFilter" class="filter-date-hint">
        조회 기간 —
        <strong v-if="periodMode === 'monthly' && filterCtx.year && filterCtx.month">
          {{ filterCtx.year }}-{{ String(filterCtx.month).padStart(2, '0') }}
        </strong>
        <strong v-else-if="filterCtx.dateFrom && filterCtx.dateTo">
          {{ filterCtx.dateFrom }} ~ {{ filterCtx.dateTo }}
        </strong>
        <strong v-else-if="filterCtx.dateFrom">{{ filterCtx.dateFrom }} ~</strong>
        <strong v-else-if="filterCtx.dateTo">~ {{ filterCtx.dateTo }}</strong>
        에 맞는 행만 표시합니다.
        <template v-if="periodMode === 'monthly'"> 월은 <strong>년 · 월</strong> 드롭다운으로 지정하세요.</template>
        <template v-else> 일자는 <strong>년 · 월 · 일</strong> 드롭다운으로 지정하세요.</template>
      </span>
      <span v-if="hiddenEntryCount > 0" class="filter-date-hint muted-hint">
        조회 기간 밖 {{ hiddenEntryCount }}건은 숨겨져 있습니다. (저장 데이터는 유지)
      </span>
      <strong v-if="summaryLine" class="applied">{{ summaryLine }}</strong>
      <span class="save-hint">입력 후 <strong>저장</strong>을 눌러야 다른 PC에서도 보입니다.</span>
    </p>

    <div class="naver-upload-block">
      <p class="naver-upload-title">네이버 광고주센터 엑셀 업로드</p>
      <p class="naver-upload-hint">
        광고주센터에서 받은 엑셀의 <strong>A열(기간)</strong> · <strong>D열(소진액)</strong>만 읽어
        외부 광고비용에 반영합니다. <strong>전환매출액은 넣지 않습니다.</strong>
        <span v-if="isCompanyBScope">
          사본느리: 엑셀 소진액은 <strong>GFA</strong>로 반영되고, 수기
          <strong>Meta·AD·구글 트래픽</strong>과는 합치지 않습니다. 엑셀을 다시 올리면 GFA 항목만 갱신됩니다.
        </span>
        <span v-if="periodMode === 'monthly'">월별 화면에서는 일별 소진액을 월 합계로 묶어 넣습니다.</span>
      </p>
      <label class="naver-upload-label">
        <input
          type="file"
          class="naver-upload-input"
          accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          :disabled="naverImporting"
          @change="onNaverAdFileChange"
        />
        <span class="btn btn-outline btn-sm">{{ naverImporting ? '읽는 중…' : '엑셀 선택' }}</span>
      </label>
      <p v-if="naverImportMsg" class="naver-import-ok">{{ naverImportMsg }}</p>
      <p v-if="naverImportErr" class="naver-import-fail">{{ naverImportErr }}</p>
    </div>

    <div class="manual-ad-table-wrap">
      <table class="ad-table">
        <thead>
          <tr>
            <th class="col-date">{{ periodMode === 'monthly' ? '월' : '일자' }}</th>
            <th class="col-kind">구분</th>
            <th class="col-amount">광고비용</th>
            <th class="col-amount">전환매출액</th>
            <th class="col-action"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!sortedEntries.length">
            <td colspan="5" class="empty-row">
              <template v-if="hasDateFilter">
                조회 기간에 해당하는
                <span v-if="periodMode === 'monthly'">월별</span><span v-else>일별</span>
                광고 실적이 없습니다. 아래에서 추가하세요.
              </template>
              <template v-else>
                등록된
                <span v-if="periodMode === 'monthly'">월별</span><span v-else>일별</span>
                광고 실적이 없습니다. 아래에서 추가하세요.
              </template>
            </td>
          </tr>
          <template v-else>
            <tr v-for="row in sortedEntries" :key="row.id">
              <td class="col-date col-date-cell">
                <YmMonthFields
                  v-if="periodMode === 'monthly'"
                  v-model="row.date"
                  :suggest-date="entryDateSuggest"
                />
                <YmdDateFields v-else v-model="row.date" :suggest-date="entryDateSuggest" />
              </td>
              <td class="col-kind">
                <select
                  :value="normalizeManualAdSource(row.source)"
                  class="cell-input cell-source"
                  :class="sourceCellClass(row.source)"
                  @change="onSourceChange(row, $event)"
                >
                  <option
                    v-for="opt in MANUAL_AD_SOURCE_OPTIONS"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </option>
                </select>
              </td>
              <td class="col-amount">
                <input
                  v-model="row.adSpend"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-amount"
                  placeholder="0"
                  @blur="normalizeAmountField(row, 'adSpend')"
                />
              </td>
              <td class="col-amount">
                <input
                  v-model="row.adSales"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-amount"
                  placeholder="0"
                  @blur="normalizeAmountField(row, 'adSales')"
                />
              </td>
              <td class="col-action">
                <button type="button" class="btn-icon" title="삭제" @click="removeEntry(row.id)">
                  ×
                </button>
              </td>
            </tr>
          </template>
        </tbody>
        <tfoot v-if="appliedAdSpend > 0 || appliedAdSales > 0">
          <tr>
            <th colspan="2">합계</th>
            <td class="foot-num">{{ appliedAdSpend.toLocaleString('ko-KR') }}원</td>
            <td class="foot-num">{{ appliedAdSales.toLocaleString('ko-KR') }}원</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="panel-foot">
      <p v-if="saveMsg" class="save-ok">{{ saveMsg }}</p>
      <p v-if="saveErr" class="save-fail">{{ saveErr }}</p>
      <div class="panel-foot-actions">
        <label class="add-source-picker">
          <span class="add-source-label">구분</span>
          <select v-model="newEntrySource" class="cell-input cell-source add-source-select">
            <option
              v-for="opt in MANUAL_AD_SOURCE_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </label>
        <button type="button" class="btn btn-primary btn-sm" @click="onAddEntry">
          {{ periodMode === 'monthly' ? '월별 행 추가' : '일별 행 추가' }}
        </button>
        <button
          v-if="sortedEntries.length && hasDateFilter"
          type="button"
          class="btn btn-outline btn-sm"
          @click="clearVisible"
        >
          표시 행 삭제
        </button>
        <button
          v-if="entries.length"
          type="button"
          class="btn btn-outline btn-sm"
          @click="clearAll"
        >
          전체 초기화
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="saving"
          @click="onSave"
        >
          {{ saving ? '저장 중…' : saveButtonLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manual-ad-panel {
  margin: 0;
}

.panel-hint {
  margin: 0 0 10px;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.panel-hint .applied {
  display: block;
  margin-top: 6px;
  color: var(--primary);
  font-weight: 600;
}

.filter-date-hint {
  display: block;
  margin-top: 6px;
  font-size: 0.78rem;
  color: var(--muted);
}

.filter-date-hint strong {
  color: var(--text);
}

.muted-hint {
  color: var(--muted);
}

.table-wrap,
.manual-ad-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fafbfc;
}

.manual-ad-panel table.ad-table {
  width: 100%;
  min-width: 560px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.manual-ad-panel table.ad-table th,
.manual-ad-panel table.ad-table td {
  border: 1px solid var(--border);
  padding: 8px 10px;
  vertical-align: middle;
  white-space: normal;
}

.ad-table {
  width: 100%;
  min-width: 560px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.ad-table th,
.ad-table td {
  border: 1px solid var(--border);
  padding: 8px 10px;
  vertical-align: middle;
}

.ad-table th {
  background: #1e293b;
  color: #fff;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.ad-table tfoot th,
.ad-table tfoot td {
  background: #eff6ff;
  font-weight: 600;
}

.col-date {
  width: 22%;
}

.col-date-cell {
  padding: 6px 8px !important;
}

.col-kind {
  width: 17%;
  text-align: center;
}

.col-amount {
  width: 28%;
}

.col-action {
  width: 8%;
  text-align: center;
  padding-left: 6px !important;
  padding-right: 6px !important;
}

.empty-row {
  text-align: center;
  color: var(--muted);
  padding: 16px !important;
  background: #fff;
}

.manual-ad-panel .cell-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  font-family: inherit;
  background: #fff;
  min-width: 0;
}

.manual-ad-panel .cell-date,
.manual-ad-panel input[type='date'].cell-date,
.manual-ad-panel input[type='month'].cell-date {
  width: 100%;
  min-width: 0;
  max-width: none;
}

.manual-ad-panel .cell-amount,
.manual-ad-panel input[type='text'].cell-amount {
  width: 100%;
  min-width: 0;
  max-width: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cell-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  font-family: inherit;
  background: #fff;
  min-width: 0;
}

.cell-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.source-tag {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
}

.cell-source {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.cell-source-meta {
  color: #475569;
  background: #f8fafc;
}

.cell-source-gfa {
  color: #1d4ed8;
  background: #eff6ff;
}

.cell-source-ad {
  color: #b45309;
  background: #fffbeb;
}

.cell-source-google {
  color: #15803d;
  background: #f0fdf4;
}

.add-source-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.add-source-label {
  font-size: 0.8125rem;
  color: var(--muted);
  white-space: nowrap;
}

.add-source-select {
  width: 156px;
  min-width: 156px;
}

.source-tag-naver {
  color: #1d4ed8;
  background: #dbeafe;
}

.source-tag-manual {
  color: #475569;
  background: #f1f5f9;
}

.cell-input:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: none;
}

.manual-ad-panel .cell-input:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: none;
}

.foot-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.save-hint {
  display: block;
  margin-top: 6px;
  font-size: 0.78rem;
  color: var(--muted);
}

.naver-upload-block {
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
}

.naver-upload-title {
  margin: 0 0 4px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text);
}

.naver-upload-hint {
  margin: 0 0 10px;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--muted);
}

.naver-upload-label {
  display: inline-flex;
  cursor: pointer;
}

.naver-upload-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.naver-import-ok {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: var(--success);
}

.naver-import-fail {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: var(--danger);
}

.save-ok {
  margin: 0 0 6px;
  font-size: 0.8125rem;
  color: var(--success);
}

.save-fail {
  margin: 0 0 6px;
  font-size: 0.8125rem;
  color: var(--danger);
}

.panel-foot {
  margin-top: 8px;
}

.panel-foot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.btn-icon {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--danger);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
}

.btn-icon:hover {
  background: #fef2f2;
}
</style>
