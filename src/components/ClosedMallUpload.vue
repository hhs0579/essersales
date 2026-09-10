<script setup>
import { computed, ref, watch } from 'vue'
import ExcelUpload from './ExcelUpload.vue'
import {
  CLOSED_MALL_REQUIRED_HEADERS,
  CLOSED_MALL_PLATFORM,
  CLOSED_MALL_SALES_METHOD,
  getClosedMallBrand,
} from '../config/closedMall.js'
import { readClosedMallFile } from '../utils/bestheimClosedMallParser.js'
import {
  deleteUploadAndRecords,
  fetchUploads,
  savePlatformDailyUpload,
} from '../services/salesApi.js'
import VirtualScrollTableBody from './VirtualScrollTableBody.vue'

const props = defineProps({
  /** 'esser' | 'bestheim' */
  brand: { type: String, required: true },
})

const emit = defineEmits(['uploaded'])

const brandDef = computed(() => getClosedMallBrand(props.brand) || getClosedMallBrand('bestheim'))

const saving = ref(false)
const error = ref('')
const success = ref('')
const progressMessage = ref('')
const preview = ref(null)
const pendingFile = ref(null)
// 3단계: 미리보기 표가 브라우저 파싱에 의존하므로 Worker/서버단독 전환 대상이 아님.
// 후속: POST /api/v1/uploads/excel/preview → 서버 parseExcelUpload(저장 없음) → 동일 파서로 저장.

const summary = computed(() => preview.value?.summary || null)
const previewRows = computed(() => preview.value?.previewRows || [])
const canUpload = computed(() => (summary.value?.ok || 0) > 0 && !saving.value)

watch(
  () => props.brand,
  () => {
    clearPreview()
  },
)

function formatWon(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

function statusLabel(status) {
  const map = {
    ok: '정상',
    error: '오류',
    duplicate: '중복',
    skip_summary: '합계행',
  }
  return map[status] || status
}

function statusClass(status) {
  if (status === 'ok') return 'st-ok'
  if (status === 'duplicate') return 'st-dup'
  if (status === 'skip_summary') return 'st-skip'
  return 'st-err'
}

function clearPreview() {
  preview.value = null
  pendingFile.value = null
  error.value = ''
  success.value = ''
  progressMessage.value = ''
}

async function onFilesSelected(fileList) {
  error.value = ''
  success.value = ''
  preview.value = null
  pendingFile.value = null

  const file = fileList?.[0]
  if (!file) return

  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    error.value = 'xlsx/xls 파일만 지원합니다.'
    return
  }

  progressMessage.value = '엑셀 미리보기 파싱 중...'
  try {
    const parsed = await readClosedMallFile(file, { brand: brandDef.value.key })
    preview.value = parsed
    pendingFile.value = file
    progressMessage.value = ''
    if (!parsed.summary.ok) {
      error.value = '저장 가능한 정상 행이 없습니다. 필수값을 확인하세요.'
    }
  } catch (e) {
    progressMessage.value = ''
    if (e?.missingColumns?.length) {
      error.value = `필수 컬럼 누락: ${e.missingColumns.join(', ')}`
    } else {
      error.value = e?.message || '파싱에 실패했습니다.'
    }
  }
}

function downloadErrorCsv() {
  const rows = previewRows.value.filter((r) => r.status === 'error')
  if (!rows.length) return

  const header = ['원본행번호', 'a날짜', 'a판매처', 'a상품명', 'a옵션', 'a브랜드', '오류사유']
  const lines = [header.join(',')]
  for (const r of rows) {
    const cells = [
      r.excelRowNumber ?? '',
      r.dateYmd || '',
      r.seller || '',
      r.productName || '',
      r.option || '',
      r.productBrand || '',
      r.errorMessage || statusLabel(r.status),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`)
    lines.push(cells.join(','))
  }

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `특판폐쇄몰_${brandDef.value.tabLabel}_오류행_${preview.value?.fileName || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function confirmUpload() {
  if (!pendingFile.value || !canUpload.value) return

  saving.value = true
  error.value = ''
  success.value = ''
  progressMessage.value = '서버에 저장 중...'

  const s = summary.value
  const def = brandDef.value
  try {
    const fileName = pendingFile.value.name
    const uploads = await fetchUploads()
    const sameName = uploads.filter(
      (u) => u.fileName === fileName && u.uploadKind === def.uploadKind,
    )
    for (const u of sameName) {
      await deleteUploadAndRecords(u.id)
    }

    const result = await savePlatformDailyUpload({
      file: pendingFile.value,
      fileName,
      platform: CLOSED_MALL_PLATFORM,
      businessDate: preview.value?.businessDate || null,
      details: preview.value?.details || [],
      salesMethod: CLOSED_MALL_SALES_METHOD,
      uploadKind: def.uploadKind,
      uploadFormat: def.uploadFormat,
    })

    const saved = result?.count ?? 0
    success.value = `정상 저장 ${saved}건 / 오류 제외 ${s?.error || 0}건`
    emit('uploaded', { brand: def.key, uploadKind: def.uploadKind })
  } catch (e) {
    error.value = `업로드 실패: ${e?.message || e}`
  } finally {
    saving.value = false
    progressMessage.value = ''
  }
}
</script>

<template>
  <section class="closed-mall-panel">
    <h3 class="section-subtitle">특판 폐쇄몰 · {{ brandDef.tabLabel }} 엑셀 업로드</h3>
    <p class="standard-ref hint">
      필수 컬럼:
      <code v-for="h in CLOSED_MALL_REQUIRED_HEADERS" :key="h">{{ h }}</code>
      · 선택:
      <code>a옵션</code>
      <code>a브랜드</code>
      · a판매처 = 특판 판매처명 (대시보드에 「{{ brandDef.dataSourceLabel }}(판매처)」로 표시)       · a수수료는
      금액(<code>12500</code>) 또는 비율(<code>25%</code>·엑셀 퍼센트 셀)
      · <code>정산가</code>·<code>마진</code>(<code>a마진</code>) 열이 있으면 엑셀 마진 공식 사용
      (정산가 − 배송비 − a원가, a원가 = 행 합계 원가)
      · 없으면 a원가 = 개당 원가 (마진 = 결제가 − 배송비 − 수수료 − 원가×수량)
    </p>

    <ExcelUpload
      :disabled="saving"
      @files-selected="onFilesSelected"
      @files-rejected="(p) => (error = p.message)"
    />

    <p v-if="progressMessage" class="progress">{{ progressMessage }}</p>
    <p v-if="error" class="msg err">{{ error }}</p>
    <p v-if="success" class="msg ok">{{ success }}</p>

    <div v-if="summary" class="preview-block">
      <div class="summary-grid">
        <div><span class="k">전체</span><strong>{{ summary.total }}</strong></div>
        <div><span class="k">저장 예정</span><strong class="c-ok">{{ summary.ok }}</strong></div>
        <div><span class="k">오류</span><strong class="c-err">{{ summary.error }}</strong></div>
        <div><span class="k">결제가 합</span><strong>{{ formatWon(summary.sumPayment) }}</strong></div>
        <div><span class="k">예상 마진</span><strong>{{ formatWon(summary.sumNetProfit) }}</strong></div>
      </div>

      <div class="actions">
        <button type="button" class="btn primary" :disabled="!canUpload" @click="confirmUpload">
          업로드
        </button>
        <button
          type="button"
          class="btn"
          :disabled="!previewRows.some((r) => r.status === 'error')"
          @click="downloadErrorCsv"
        >
          오류 행 CSV
        </button>
        <button type="button" class="btn" :disabled="saving" @click="clearPreview">미리보기 지우기</button>
      </div>

      <div class="table-wrap">
        <VirtualScrollTableBody :rows="previewRows" :threshold="60" class="preview-table">
          <template #head>
            <tr>
              <th>상태</th>
              <th>날짜</th>
              <th>판매처</th>
              <th>브랜드</th>
              <th class="name">상품명</th>
              <th class="name">옵션</th>
              <th class="num">수량</th>
              <th class="num">결제가</th>
              <th class="num">배송비</th>
              <th class="num">수수료</th>
              <th class="num">원가</th>
              <th>오류</th>
            </tr>
          </template>
          <template #row="{ row: r }">
            <tr :class="statusClass(r.status)">
              <td>{{ statusLabel(r.status) }}</td>
              <td>{{ r.dateYmd || '-' }}</td>
              <td>{{ r.seller || '-' }}</td>
              <td>{{ r.productBrand || '-' }}</td>
              <td class="name">{{ r.productName || '-' }}</td>
              <td class="name">{{ r.option || '-' }}</td>
              <td class="num">{{ r.qty ?? '-' }}</td>
              <td class="num">{{ r.payment != null ? formatWon(r.payment) : '-' }}</td>
              <td class="num">{{ r.shippingFee != null ? formatWon(r.shippingFee) : '-' }}</td>
              <td class="num">{{ r.commission != null ? formatWon(r.commission) : '-' }}</td>
              <td class="num">{{ r.unitCost != null ? formatWon(r.unitCost) : '-' }}</td>
              <td class="err-cell">{{ r.errorMessage || '' }}</td>
            </tr>
          </template>
        </VirtualScrollTableBody>
      </div>
    </div>
  </section>
</template>

<style scoped>
.closed-mall-panel {
  margin-top: 0.5rem;
}
.hint {
  margin: 0.35rem 0 0.85rem;
  line-height: 1.5;
}
.hint code {
  margin-right: 0.35rem;
  font-size: 0.85em;
}
.progress {
  color: #555;
  margin: 0.5rem 0;
}
.msg {
  margin: 0.5rem 0;
}
.msg.err {
  color: #b42318;
}
.msg.ok {
  color: #027a48;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.5rem 0.75rem;
  margin: 0.75rem 0;
}
.summary-grid .k {
  display: block;
  font-size: 0.75rem;
  color: #667;
}
.c-ok {
  color: #027a48;
}
.c-err {
  color: #b42318;
}
.c-dup {
  color: #6941c6;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.btn {
  border: 1px solid #c5c9d1;
  background: #fff;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  font-size: 0.9rem;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.primary {
  background: #1f3a5f;
  border-color: #1f3a5f;
  color: #fff;
}
.table-wrap {
  overflow: auto;
  max-height: 22rem;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
th,
td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #eef0f3;
  text-align: left;
  white-space: nowrap;
  vertical-align: middle;
}
th {
  position: sticky;
  top: 0;
  background: #f8f9fb;
  z-index: 1;
}
th.name,
td.name {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
th.num,
td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
td.err-cell {
  color: #b42318;
  white-space: normal;
  max-width: 12rem;
}
tr.st-ok td:first-child {
  color: #027a48;
}
tr.st-err {
  background: #fff5f5;
}
tr.st-dup {
  background: #f8f5ff;
}
tr.st-skip {
  color: #888;
}
</style>
