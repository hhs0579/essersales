<script setup>
import { ref } from 'vue'
import ExcelUpload from './ExcelUpload.vue'
import { PLATFORMS } from '../constants/platforms.js'
import { parsePlatformMonthlyInWorker } from '../utils/parseExcelInWorker.js'
import {
  deleteUploadAndRecords,
  fetchUploads,
  savePlatformMonthlyUpload,
} from '../services/salesApi.js'
import {
  detectPlatformFromFileName,
  resolveUploadPlatform,
} from '../utils/platformDetect.js'

const props = defineProps({
  /** DB uploads.upload_kind — platform_monthly | sales_monthly_b */
  uploadKind: { type: String, default: 'platform_monthly' },
})

const emit = defineEmits(['uploaded'])

const platform = ref('쿠팡')
const saving = ref(false)
const progressMessage = ref('')
const error = ref('')
const success = ref('')

const yieldTick = () => new Promise((resolve) => setTimeout(resolve, 50))

async function onFilesSelected(fileList) {
  if (!platform.value) {
    error.value = '플랫폼을 선택하세요.'
    return
  }

  saving.value = true
  progressMessage.value = '업로드 준비 중...'
  error.value = ''
  success.value = ''

  try {
    let total = 0
    for (const [idx, file] of fileList.entries()) {
      const filePrefix = fileList.length > 1 ? `[${idx + 1}/${fileList.length}] ` : ''
      const fromName = detectPlatformFromFileName(file.name)
      if (fromName) platform.value = fromName

      progressMessage.value = `${filePrefix}엑셀 파일 파싱 및 포맷 검증 중...`
      await yieldTick()

      const {
        fileName,
        platform: p,
        businessDate,
        periodFrom,
        periodTo,
        periodLabel,
        details,
        skipped,
        skippedSummary = 0,
        skippedNoDate = 0,
        format,
        salesMethod,
        dateRangeHint,
      } = await parsePlatformMonthlyInWorker(file, platform.value)

      progressMessage.value = `${filePrefix}데이터 정제 및 분석 중...`
      await yieldTick()

      const resolvedPlatform = resolveUploadPlatform(fileName, p, details)
      if (!details.length) {
        let hint = '파일명 기간·상품·매출 열을 확인하세요.'
        if (skippedNoDate > 0) {
          hint = `날짜를 읽지 못한 행 ${skippedNoDate}건. 날짜 열 또는 파일명(…_20260601_20260630)을 확인하세요.`
        }
        throw new Error(`「${fileName}」에서 저장할 행을 찾지 못했습니다. ${hint}`)
      }

      progressMessage.value = `${filePrefix}기존 중복 데이터 검사 중...`
      await yieldTick()

      const uploads = await fetchUploads()
      const sameName = uploads.filter(
        (u) => u.fileName === fileName && u.uploadKind === props.uploadKind,
      )
      for (const u of sameName) {
        await deleteUploadAndRecords(u.id)
      }

      progressMessage.value = `${filePrefix}서버 DB에 월간 데이터 저장 중...`
      await yieldTick()

      const { count } = await savePlatformMonthlyUpload({
        file,
        fileName,
        platform: resolvedPlatform,
        businessDate,
        periodFrom,
        periodTo,
        details,
        salesMethod: salesMethod || '',
        uploadKind: props.uploadKind,
      })
      total += count
      const skipParts = []
      if (skipped > 0) skipParts.push(`미저장 ${skipped}행`)
      if (skippedSummary > 0) skipParts.push(`합계행 제외 ${skippedSummary}`)
      const skipNote = skipParts.length ? ` (${skipParts.join(', ')})` : ''
      const formatLabel = format === 'coupang_esser_monthly' ? ' · 빅셀 매출분석(월별)' : ''
      const methodLabel = salesMethod ? ` · ${salesMethod}` : ''
      const rangeLabel = dateRangeHint || periodLabel || ''
      success.value = `${fileList.length}개 파일 · ${resolvedPlatform}${formatLabel}${methodLabel} · 기간 ${rangeLabel} · 총 ${total}건 저장${skipNote}`
    }
    emit('uploaded')
  } catch (e) {
    error.value = `업로드 실패: ${e.message}`
  } finally {
    saving.value = false
    progressMessage.value = ''
  }
}
</script>

<template>
  <div class="platform-upload">
    <p class="standard-ref">
      <strong>한 달치(1일~말일)</strong> 빅셀 매출분석 엑셀입니다. 파일명에
      <strong>시작·종료일</strong>이 있어야 합니다.
      (예: <code>빅셀_로켓그로스_매출분석_20260601_20260630.xlsx</code>)
      날짜 열이 있으면 일자별로, 없으면 월 합산으로 저장됩니다.
      하루치는 <strong>일별 엑셀</strong> 탭을 사용하세요.
    </p>

    <div class="platform-row">
      <label class="platform-label" for="platform-monthly-select">플랫폼</label>
      <select
        id="platform-monthly-select"
        v-model="platform"
        class="platform-select"
        :disabled="saving"
      >
        <option v-for="p in PLATFORMS" :key="p" :value="p">{{ p }}</option>
      </select>
    </div>

    <ExcelUpload
      :disabled="saving"
      @files-selected="onFilesSelected"
      @files-rejected="(e) => (error = e.message)"
    />
    <div v-if="saving" class="progress-box">
      <div class="progress-spinner"></div>
      <p class="progress-text"><strong>{{ progressMessage }}</strong></p>
    </div>
    <p v-if="success" class="success-msg">{{ success }}</p>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p class="standard-ref upload-tip">
      업로드가 안 되면: ① <strong>docker compose up -d api db</strong> 로 PG API 실행 ②
      <strong>npm run dev</strong> 로 Vue 실행 ③ 브라우저가
      <strong>http://localhost:5173</strong> 인지 확인 ④ 빨간 오류 문구 확인
    </p>
  </div>
</template>

<style scoped>
.platform-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.platform-label {
  font-size: 0.875rem;
  font-weight: 500;
}

.platform-select {
  min-width: 160px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.875rem;
}

.success-msg {
  color: var(--success);
  margin-top: 12px;
  font-size: 0.875rem;
}

.error-msg {
  color: var(--danger);
  margin-top: 12px;
  font-size: 0.875rem;
}

.upload-tip {
  margin-top: 16px;
  font-size: 0.8rem;
}
</style>

<style scoped>
.progress-box {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 16px;
  background-color: var(--surface-variant, #f5f5f5);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.progress-text {
  font-size: 0.875rem;
  color: var(--primary, #0056b3);
  margin: 0;
}

.progress-spinner {
  width: 20px;
  height: 20px;
  border: 3px solid rgba(0, 86, 179, 0.2);
  border-top-color: var(--primary, #0056b3);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>