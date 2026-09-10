<script setup>
import { ref } from 'vue'
import ExcelUpload from './ExcelUpload.vue'
import { PLATFORMS } from '../constants/platforms.js'
import { savePlatformPeriodUpload } from '../services/salesApi.js'
import {
  detectPlatformFromFileName,
  resolveUploadPlatform,
} from '../utils/platformDetect.js'
import { formatPlatformUploadSuccess } from '../utils/uploadSuccessMessage.js'

const props = defineProps({
  /** DB uploads.upload_kind — 채널별 분리 (platform_period | sales_period_b) */
  uploadKind: { type: String, default: 'platform_period' },
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
      const fileName = file.name
      progressMessage.value = `${filePrefix}파일 선택 완료 (${fileName})`
      await yieldTick()

      const fromName = detectPlatformFromFileName(fileName)
      if (fromName) platform.value = fromName
      const resolvedPlatform = resolveUploadPlatform(fileName, platform.value, [])

      progressMessage.value = `${filePrefix}업로드 중...`
      await yieldTick()
      progressMessage.value = `${filePrefix}서버 처리 중...`

      const { count, parseMeta, salesMethod, platform: savedPlatform } = await savePlatformPeriodUpload({
        file,
        fileName,
        platform: resolvedPlatform,
        uploadKind: props.uploadKind,
      })
      total += count
      success.value = formatPlatformUploadSuccess({
        fileCount: fileList.length,
        platform: savedPlatform || parseMeta?.platform || resolvedPlatform,
        parseMeta,
        total,
        kind: 'period',
        salesMethod,
      })
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
      엑셀에 <strong>날짜 열이 없어도</strong> 됩니다. 파일명에
      <strong>시작·종료일</strong>이 있으면 그 기간의 상품별 매출로 저장됩니다.
      (예: <code>빅셀_로켓그로스_매출분석_20260501_20260601.xlsx</code>)
      하루치(<code>…20260531.xlsx</code>, <code>일자20260601</code>)는
      <strong>플랫폼 업로드 → 일별 엑셀</strong> 탭을 사용하세요.
    </p>

    <div class="platform-row">
      <label class="platform-label" for="platform-period-select">플랫폼</label>
      <select
        id="platform-period-select"
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