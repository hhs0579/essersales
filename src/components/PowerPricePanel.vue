<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { usePowerPrice } from '../composables/usePowerPrice.js'
import { calcPowerPriceConfirmLine } from '../utils/powerPriceRecords.js'
import ManualAdSpendPanel from './ManualAdSpendPanel.vue'
import { POWER_PRICE_SCOPE } from '../config/powerPrice.js'
import { parseAmount } from '../utils/parseAmount.js'
import { manualAdEntryVisibleInPanel, manualAdHasDateFilter } from '../utils/manualAdSpend.js'

const props = defineProps({
  scope: { type: String, default: POWER_PRICE_SCOPE },
  filterCtx: { type: Object, default: () => ({}) },
})

const {
  store,
  importPurchaseConfirm,
  removeConfirmUpload,
  clearConfirmData,
  saveStore,
  markCostDirty,
} = usePowerPrice()

const COST_AUTOSAVE_MS = 1500
let costSaveTimer = null

function onCostInput(row) {
  markCostDirty(row.key)
  saveMsg.value = ''
  if (costSaveTimer) clearTimeout(costSaveTimer)
  costSaveTimer = setTimeout(async () => {
    costSaveTimer = null
    if (saving.value) return
    saving.value = true
    saveErr.value = ''
    try {
      await saveStore()
      saveMsg.value = '원가가 자동 저장되었습니다.'
    } catch (e) {
      saveErr.value = e?.message || '원가 자동 저장에 실패했습니다. 저장 버튼을 눌러 주세요.'
    } finally {
      saving.value = false
    }
  }, COST_AUTOSAVE_MS)
}

onBeforeUnmount(() => {
  if (costSaveTimer) {
    clearTimeout(costSaveTimer)
    costSaveTimer = null
    saveStore().catch(() => {})
  }
})

const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')
const importing = ref(false)
const importMsg = ref('')
const importErr = ref('')
const fileInputRef = ref(null)
const removingUploadId = ref('')

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await saveStore()
    saveMsg.value = '구매확정·원가가 서버에 저장되었습니다.'
  } catch (e) {
    saveErr.value = e?.message || '저장에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

async function onConfirmFileChange(ev) {
  const input = ev?.target
  const file = input?.files?.[0]
  if (!file) return
  importing.value = true
  importMsg.value = ''
  importErr.value = ''
  try {
    const buffer = await file.arrayBuffer()
    const result = await importPurchaseConfirm(buffer, file.name)
    importMsg.value = `「${result.sourceFileName}」 ${result.imported}건 반영 · 원가 미입력 ${result.missingCostCount}종`
    await saveStore()
    saveMsg.value = '구매확정·원가가 서버에 저장되었습니다.'
  } catch (e) {
    importErr.value = e?.message || '엑셀을 읽지 못했습니다.'
  } finally {
    importing.value = false
    if (input) input.value = ''
  }
}

function onClearConfirm() {
  if (!store.value.confirmLines.length) return
  if (!window.confirm('구매확정 업로드 데이터를 모두 지울까요? (원가 마스터는 유지)')) {
    return
  }
  clearConfirmData()
  importMsg.value = '구매확정 데이터를 비웠습니다. 저장을 눌러 반영하세요.'
}

async function onRemoveUpload(upload) {
  if (!upload) return
  if (
    !window.confirm(
      `「${upload.fileName}」 업로드(${upload.lineCount}건)를 삭제할까요?`,
    )
  ) {
    return
  }
  removingUploadId.value = upload.id
  try {
    removeConfirmUpload(upload.id)
    await saveStore()
    importMsg.value = `「${upload.fileName}」을(를) 삭제했습니다.`
    saveMsg.value = '업로드 삭제가 서버에 반영되었습니다.'
  } catch (e) {
    saveErr.value = e?.message || '삭제 저장에 실패했습니다.'
  } finally {
    removingUploadId.value = ''
  }
}

const costMap = computed(() => {
  /** @type {Map<string, import('../config/powerPrice.js').PowerPriceCostMasterEntry>} */
  const map = new Map()
  for (const c of store.value.costMaster || []) {
    if (c?.key) map.set(c.key, c)
  }
  return map
})

const missingCostCount = computed(
  () => (store.value.costMaster || []).filter((c) => !parseAmount(c.unitCost)).length,
)

const uploadSummaries = computed(() =>
  [...(store.value.confirmUploads || [])].map((u) => ({
    ...u,
    uploadedAtLabel: u.uploadedAt
      ? new Date(u.uploadedAt).toLocaleString('ko-KR')
      : '',
    dateRangeLabel:
      u.dateFrom && u.dateTo
        ? u.dateFrom === u.dateTo
          ? u.dateFrom
          : `${u.dateFrom} ~ ${u.dateTo}`
        : '',
  })),
)

const visibleConfirmLines = computed(() =>
  (store.value.confirmLines || []).filter((row) =>
    manualAdEntryVisibleInPanel(row, props.filterCtx),
  ),
)

const hiddenConfirmCount = computed(
  () => store.value.confirmLines.length - visibleConfirmLines.value.length,
)

const hasDateFilter = computed(() => manualAdHasDateFilter(props.filterCtx))

const confirmPreview = computed(() => {
  const sorted = [...visibleConfirmLines.value].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')),
  )
  return sorted.slice(0, 80).map((line) => ({
    line,
    calc: calcPowerPriceConfirmLine(line, costMap.value),
  }))
})

function fmtWon(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('ko-KR')}원`
}
</script>

<template>
  <div class="power-price-panel">
    <section class="pp-section">
      <h4 class="pp-section-title">① 구매확정 엑셀 업로드</h4>
      <p class="standard-ref section-hint">
        스마트스토어 <strong>구매확정내역</strong> 엑셀을 올리면 매출·수수료가 자동 반영됩니다.
        같은 파일명으로 다시 올리면 해당 파일 분량만 교체됩니다.
      </p>

      <div class="pp-upload-row">
        <input
          ref="fileInputRef"
          type="file"
          accept=".xlsx,.xls"
          class="file-input"
          :disabled="importing"
          @change="onConfirmFileChange"
        />
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="importing"
          @click="fileInputRef?.click()"
        >
          {{ importing ? '읽는 중…' : '구매확정 엑셀 업로드' }}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="!store.confirmLines.length"
          @click="onClearConfirm"
        >
          전체 비우기
        </button>
        <span class="upload-meta" v-if="store.confirmLines.length">
          확정 {{ store.confirmLines.length }}건 · 파일 {{ uploadSummaries.length }}개
          <template v-if="missingCostCount"> · 원가 미입력 {{ missingCostCount }}종</template>
        </span>
      </div>
      <p v-if="importMsg" class="save-ok upload-feedback">{{ importMsg }}</p>
      <p v-if="importErr" class="save-fail upload-feedback">{{ importErr }}</p>
    </section>

    <section class="pp-section">
      <h4 class="pp-section-title">② 업로드 내역</h4>
      <p class="standard-ref section-hint">
        업로드한 구매확정 엑셀 목록입니다. 삭제하면 해당 파일에서 불러온 확정 행만 제거됩니다.
        원가 마스터는 유지됩니다.
      </p>
      <div v-if="!uploadSummaries.length" class="empty-source-list">
        업로드된 구매확정 엑셀이 없습니다.
      </div>
      <ul v-else class="source-file-list">
        <li v-for="file in uploadSummaries" :key="file.id" class="source-file-item">
          <div class="source-file-main">
            <span class="source-file-name">{{ file.fileName }}</span>
            <span v-if="file.uploadedAtLabel" class="source-tag">{{ file.uploadedAtLabel }}</span>
            <span class="source-tag source-tag-ok">확정 {{ file.lineCount }}건</span>
            <span v-if="file.dateRangeLabel" class="source-tag">{{ file.dateRangeLabel }}</span>
          </div>
          <button
            type="button"
            class="btn btn-outline btn-sm btn-danger-outline"
            :disabled="removingUploadId === file.id"
            @click="onRemoveUpload(file)"
          >
            {{ removingUploadId === file.id ? '삭제 중…' : '삭제' }}
          </button>
        </li>
      </ul>
    </section>

    <section class="pp-section">
      <h4 class="pp-section-title">③ 원가(단가)</h4>
      <p class="standard-ref section-hint">
        상품번호·옵션별 <strong>원가(단가)</strong>만 입력하세요. 택배비를 녹이려면 단가에 합산하면 됩니다.
        입력을 멈추면 자동 저장되며, 다른 PC에서 올린 업로드·원가와 합쳐서 저장합니다.
      </p>

      <div class="table-wrap">
        <table class="pp-table">
          <thead>
            <tr>
              <th>상품번호</th>
              <th>상품명</th>
              <th>옵션</th>
              <th class="col-num">원가(단가)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!store.costMaster.length">
              <td colspan="4" class="empty-row">
                구매확정 엑셀을 올리면 상품·옵션별 원가 입력란이 생깁니다.
              </td>
            </tr>
            <tr
              v-for="row in store.costMaster"
              :key="row.key"
              :class="{ 'missing-cost': !parseAmount(row.unitCost) }"
            >
              <td class="mono-cell">{{ row.productId }}</td>
              <td>{{ row.productName || '—' }}</td>
              <td>{{ row.option || '—' }}</td>
              <td>
                <input
                  v-model="row.unitCost"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-amount"
                  placeholder="0"
                  @input="onCostInput(row)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="pp-section">
      <h4 class="pp-section-title">④ 구매확정 내역</h4>
      <p class="standard-ref section-hint">
        업로드된 확정 행 미리보기입니다.
        <span v-if="hasDateFilter" class="filter-date-hint">
          조회 기간에 맞는 행만 표시합니다.
          <span v-if="hiddenConfirmCount > 0" class="muted-hint">
            (기간 밖 {{ hiddenConfirmCount }}건 숨김)
          </span>
        </span>
      </p>
      <div class="table-wrap">
        <table class="pp-table pp-table-preview">
          <thead>
            <tr>
              <th class="col-date">확정일</th>
              <th>상품</th>
              <th class="col-qty">수량</th>
              <th class="col-num">매출</th>
              <th class="col-num">수수료</th>
              <th class="col-num">원가</th>
              <th class="col-num">순이익</th>
              <th>파일</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!confirmPreview.length">
              <td colspan="8" class="empty-row">표시할 구매확정 내역이 없습니다.</td>
            </tr>
            <tr v-for="{ line, calc } in confirmPreview" :key="line.id">
              <td>{{ line.date }}</td>
              <td>
                {{ line.productName }}
                <span v-if="line.option" class="opt-tag">{{ line.option }}</span>
                <span v-if="calc.missingCost" class="warn-tag">원가없음</span>
              </td>
              <td class="calc-cell">{{ calc.qty }}</td>
              <td class="calc-cell">{{ fmtWon(calc.sales) }}</td>
              <td class="calc-cell fee-cell">{{ fmtWon(calc.platformFee) }}</td>
              <td class="calc-cell">{{ fmtWon(calc.totalCost) }}</td>
              <td
                class="calc-cell"
                :class="{ profit: calc.netProfit > 0, loss: calc.netProfit < 0 }"
              >
                {{ fmtWon(calc.netProfit) }}
              </td>
              <td class="file-cell">{{ line.sourceFileName || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="visibleConfirmLines.length > confirmPreview.length" class="foot-note">
        상위 {{ confirmPreview.length }}건만 표시 · 전체 {{ visibleConfirmLines.length }}건은 KPI에 반영됩니다.
      </p>
    </section>

    <div class="pp-save-bar">
      <p v-if="saveMsg" class="save-ok">{{ saveMsg }}</p>
      <p v-if="saveErr" class="save-fail">{{ saveErr }}</p>
      <button type="button" class="btn btn-primary" :disabled="saving" @click="onSave">
        {{ saving ? '저장 중…' : '원가·업로드 저장' }}
      </button>
    </div>

    <section class="pp-section pp-ad-section">
      <h4 class="pp-section-title">⑤ 일별 광고비</h4>
      <ManualAdSpendPanel :scope="scope" :filter-ctx="filterCtx" />
    </section>
  </div>
</template>

<style scoped>
.power-price-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.pp-section-title {
  margin: 0 0 6px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text);
}

.section-hint {
  margin: 0 0 10px;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.filter-date-hint {
  display: inline;
  margin-left: 4px;
  font-size: 0.78rem;
  color: var(--muted);
}

.muted-hint {
  color: #94a3b8;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fafbfc;
}

.pp-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.pp-table th,
.pp-table td {
  border: 1px solid var(--border);
  padding: 6px;
  vertical-align: middle;
}

.pp-table th {
  background: #1e293b;
  color: #fff;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.col-date {
  width: 110px;
}

.col-qty {
  width: 72px;
}

.col-num {
  width: 120px;
}

.empty-row {
  text-align: center;
  color: var(--muted);
  padding: 16px !important;
  background: #fff;
}

.cell-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-family: inherit;
  background: #fff;
}

.cell-input:focus {
  border-color: var(--primary);
  outline: none;
}

.cell-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.calc-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  background: #fff;
}

.calc-cell.profit {
  color: #047857;
}

.calc-cell.loss {
  color: var(--danger);
}

.calc-cell.fee-cell {
  color: #b45309;
}

.file-cell {
  font-size: 0.72rem;
  color: var(--muted);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.foot-note {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.pp-ad-section :deep(.manual-ad-panel) {
  margin-top: 0;
}

.pp-upload-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.upload-meta {
  font-size: 0.78rem;
  color: var(--muted);
}

.upload-feedback {
  margin: 0 0 10px;
}

.missing-cost td {
  background: #fff7ed;
}

.mono-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
}

.pp-table-preview {
  min-width: 800px;
}

.opt-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.72rem;
  color: var(--muted);
}

.warn-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.7rem;
  color: #c2410c;
  font-weight: 600;
}

.empty-source-list {
  padding: 14px 16px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--muted);
  font-size: 0.8125rem;
  background: #fafbfc;
}

.source-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.source-file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fafbfc;
}

.source-file-main {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.source-file-name {
  font-weight: 600;
  font-size: 0.8125rem;
}

.source-tag {
  font-size: 0.72rem;
  color: var(--muted);
  background: #eef2f7;
  padding: 2px 8px;
  border-radius: 999px;
}

.source-tag-ok {
  color: #047857;
  background: #ecfdf5;
}

.btn-danger-outline {
  color: var(--danger);
  border-color: #fecaca;
}

.pp-save-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f0fdf4;
}

.save-ok {
  margin: 0 auto 0 0;
  font-size: 0.8125rem;
  color: #047857;
}

.save-fail {
  margin: 0 auto 0 0;
  font-size: 0.8125rem;
  color: var(--danger);
}
</style>
