<script setup>
import { computed, onMounted, ref } from 'vue'
import ExcelUpload from './ExcelUpload.vue'
import CollapsibleSection from './CollapsibleSection.vue'
import { useProfitLossTemplate } from '../composables/useProfitLossTemplate.js'
import { PROFIT_LOSS_FIELD_LABELS } from '../config/profitLossReport.js'

const {
  template,
  hasTemplate,
  hydrateProfitLossTemplate,
  uploadProfitLossTemplateFile,
  clearProfitLossTemplate,
} = useProfitLossTemplate()

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')

onMounted(async () => {
  loading.value = true
  try {
    await hydrateProfitLossTemplate()
  } finally {
    loading.value = false
  }
})

const summary = computed(() => template.value?.summary || null)

const previewRows = computed(() => {
  const sheet = template.value?.sheets?.[0]
  if (!sheet?.aoa?.length) return []
  return sheet.aoa.slice(0, 18)
})

const bindingPreview = computed(() => {
  const sheet = template.value?.sheets?.[0]
  if (!sheet?.labelBindings?.length) return []
  return sheet.labelBindings.slice(0, 24)
})

const placeholderPreview = computed(() => {
  const sheet = template.value?.sheets?.[0]
  if (!sheet?.placeholders?.length) return []
  return sheet.placeholders.slice(0, 16)
})

async function onFilesSelected(files) {
  const file = files?.[0]
  if (!file) return
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    const parsed = await uploadProfitLossTemplateFile(file)
    const s = parsed.summary
    success.value = `템플릿 인식 완료 — 시트 ${s.sheetCount}개 · 플레이스홀더 ${s.placeholderCount}개 · 행매핑 ${s.labelBindingCount}개`
  } catch (e) {
    error.value = e?.message || '템플릿 파싱에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

async function onClear() {
  if (!confirm('저장된 손익계산 템플릿을 삭제할까요?')) return
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await clearProfitLossTemplate()
    success.value = '템플릿을 삭제했습니다.'
  } catch (e) {
    error.value = e?.message || '삭제에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

const fieldGuide = Object.entries(PROFIT_LOSS_FIELD_LABELS)

const phBrandSales = '{{brand:베스트하임.sales}}'
const phPeriod = '{{period}}'
const phGeneratedAt = '{{generatedAt}}'

function phField(key) {
  return `{{${key}}}`
}
</script>

<template>
  <CollapsibleSection
    title="통합 매출 손익계산 리포트 · 형식 업로드"
    subtitle="통합 엑셀 ①요약리포트는 손익계산 고정 양식(외부광고·KPI·판매방식·스토어·일별)으로 자동 생성됩니다. 추가 맞춤 양식은 선택 업로드."
    :default-collapsed="hasTemplate"
  >
    <div class="pl-template-panel">
      <div class="pl-guide card-inset">
        <h4 class="pl-guide-title">양식 준비 방법</h4>
        <ol class="pl-guide-list">
          <li>사용 중인 <strong>통합 매출 손익계산 리포트</strong> 엑셀 파일을 그대로 업로드하세요.</li>
          <li>
            값이 들어갈 칸에 <code v-pre>{{sales}}</code> 처럼 플레이스홀더를 넣으면 합계 KPI가 채워집니다.
            브랜드별은 <code>{{ phBrandSales }}</code> 형식입니다.
          </li>
          <li>
            플레이스홀더 없이도, 1행에 <strong>베스트하임·사본느리·파워프라이스·합계</strong> 열 제목이 있고
            왼쪽에 <strong>매출·원가·순이익·광고비</strong> 등 행 라벨이 있으면 자동으로 칸을 찾습니다.
          </li>
        </ol>
        <details class="pl-field-details">
          <summary>플레이스홀더 목록</summary>
          <table class="pl-mini-table">
            <thead>
              <tr>
                <th>코드</th>
                <th>의미</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>{{ phPeriod }}</code></td>
                <td>선택 기간</td>
              </tr>
              <tr>
                <td><code>{{ phGeneratedAt }}</code></td>
                <td>생성 시각</td>
              </tr>
              <tr v-for="[key, label] in fieldGuide" :key="key">
                <td>
                  <code>{{ phField(key) }}</code>
                </td>
                <td>합계 {{ label }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>

      <ExcelUpload :disabled="saving || loading" @files-selected="onFilesSelected" />

      <p v-if="loading" class="standard-ref">저장된 템플릿 불러오는 중…</p>
      <p v-if="saving" class="standard-ref">템플릿 분석·저장 중…</p>
      <p v-if="success" class="success-msg">{{ success }}</p>
      <p v-if="error" class="error-msg">{{ error }}</p>

      <div v-if="hasTemplate" class="pl-status card-inset">
        <div class="pl-status-head">
          <div>
            <strong>등록된 템플릿</strong>
            <span class="pl-file">{{ template.fileName }}</span>
          </div>
          <button type="button" class="btn btn-outline btn-sm" :disabled="saving" @click="onClear">
            템플릿 삭제
          </button>
        </div>
        <ul class="pl-summary-list">
          <li>시트: {{ summary?.sheetCount }}개 (대표: {{ summary?.primarySheet }})</li>
          <li>플레이스홀더: {{ summary?.placeholderCount }}개</li>
          <li>행 라벨 자동 매핑: {{ summary?.labelBindingCount }}개</li>
          <li v-if="summary?.detectedBrands?.length">
            인식 브랜드 열: {{ summary.detectedBrands.join(', ') }}
          </li>
          <li v-if="summary?.detectedFields?.length">
            인식 지표: {{ summary.detectedFields.map((k) => PROFIT_LOSS_FIELD_LABELS[k] || k).join(', ') }}
          </li>
        </ul>

        <div v-if="placeholderPreview.length" class="pl-preview-block">
          <h4>플레이스홀더 (일부)</h4>
          <table class="pl-mini-table">
            <thead>
              <tr>
                <th>셀</th>
                <th>토큰</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in placeholderPreview" :key="i">
                <td>R{{ p.row + 1 }}C{{ p.col + 1 }}</td>
                <td><code>{{ phField(p.token) }}</code></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="bindingPreview.length" class="pl-preview-block">
          <h4>행 라벨 자동 매핑 (일부)</h4>
          <table class="pl-mini-table">
            <thead>
              <tr>
                <th>셀</th>
                <th>브랜드</th>
                <th>지표</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(b, i) in bindingPreview" :key="i">
                <td>R{{ b.sheetRow + 1 }}C{{ b.col + 1 }}</td>
                <td>{{ b.brand }}</td>
                <td>{{ b.label }} → {{ b.fieldKey }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="previewRows.length" class="pl-preview-block">
          <h4>양식 미리보기 (상단 18행)</h4>
          <div class="pl-grid-wrap">
            <table class="pl-grid-table">
              <tbody>
                <tr v-for="(row, ri) in previewRows" :key="ri">
                  <td v-for="(cell, ci) in row" :key="ci" class="pl-grid-cell">
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </CollapsibleSection>
</template>

<style scoped>
.pl-template-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card-inset {
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.pl-guide-title {
  margin: 0 0 8px;
  font-size: 0.9rem;
}

.pl-guide-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.85rem;
  color: var(--text);
  line-height: 1.55;
}

.pl-guide-list code {
  font-size: 0.8rem;
  background: #e2e8f0;
  padding: 1px 5px;
  border-radius: 4px;
}

.pl-field-details {
  margin-top: 10px;
  font-size: 0.85rem;
}

.pl-field-details summary {
  cursor: pointer;
  color: var(--primary);
  font-weight: 600;
}

.pl-status-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.pl-file {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
  margin-top: 2px;
}

.pl-summary-list {
  margin: 0 0 12px;
  padding-left: 1.1rem;
  font-size: 0.85rem;
  line-height: 1.5;
}

.pl-preview-block h4 {
  margin: 0 0 6px;
  font-size: 0.85rem;
}

.pl-mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.pl-mini-table th,
.pl-mini-table td {
  border: 1px solid #e2e8f0;
  padding: 4px 8px;
  text-align: left;
}

.pl-mini-table th {
  background: #f1f5f9;
}

.pl-grid-wrap {
  overflow: auto;
  max-height: 280px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.pl-grid-table {
  border-collapse: collapse;
  font-size: 0.75rem;
  min-width: 100%;
}

.pl-grid-cell {
  border: 1px solid #e2e8f0;
  padding: 3px 6px;
  white-space: pre-wrap;
  min-width: 72px;
  max-width: 200px;
}

.success-msg {
  color: var(--success);
  font-size: 0.875rem;
}

.error-msg {
  color: var(--danger);
  font-size: 0.875rem;
}
</style>
