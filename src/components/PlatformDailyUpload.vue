<script setup>
import { computed, ref } from 'vue'
import ExcelUpload from './ExcelUpload.vue'
import { PLATFORMS } from '../constants/platforms.js'
import { readPlatformDailyFile } from '../utils/platformOrderParser.js'
import { OWN_MALL_AIMWEB_UPLOAD_ERROR } from '../utils/ownMallSalesParser.js'
import {
  deleteUploadAndRecords,
  fetchUploads,
  savePlatformDailyUpload,
} from '../services/salesApi.js'
import {
  detectPlatformFromFileName,
  MARKETPLACE_PLATFORMS,
  normalizePlatformLabel,
  resolveUploadPlatform,
} from '../utils/platformDetect.js'

const props = defineProps({
  /** DB uploads.upload_kind — 채널별 분리 (platform_daily | sales_daily_b 등) */
  uploadKind: { type: String, default: 'platform_daily' },
  /** 사본느리 등 — 자사몰은 전용 패널 사용 */
  excludeOwnMallPlatform: { type: Boolean, default: false },
})

const emit = defineEmits(['uploaded'])

const platform = ref('쿠팡')
const platformOptions = computed(() =>
  props.excludeOwnMallPlatform || props.uploadKind === 'sales_daily_b'
    ? PLATFORMS.filter((p) => p !== '자사몰')
    : PLATFORMS,
)
const saving = ref(false)
const progressMessage = ref('')
const error = ref('')
const success = ref('')

// 비동기 작업 간 UI 렌더링을 허용하기 위한 Yield
const yieldTick = () => new Promise((resolve) => setTimeout(resolve, 50))

async function onFilesSelected(fileList) {
  if (!platform.value) {
    error.value = '플랫폼을 선택하세요.'
    return
  }
  if (platform.value === '자사몰') {
    error.value = OWN_MALL_AIMWEB_UPLOAD_ERROR
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
        details,
        skipped,
        skippedSummary = 0,
        skippedNoDate = 0,
        dateRangeHint = '',
        format,
        salesMethod,
        emptyHint = '',
      } = await readPlatformDailyFile(file, platform.value)

      progressMessage.value = `${filePrefix}데이터 정제 및 분석 중...`
      await yieldTick()

      const resolvedPlatform = resolveUploadPlatform(fileName, p, details)
      const methodPreview = [
        ...new Set(
          details
            .filter((d) => !d.isEsserSheetTotal)
            .map((d) => d.salesMethod)
            .filter(Boolean),
        ),
      ]
      if (!details.length) {
        let hint = emptyHint || '컬럼명·파일명 날짜를 확인하세요.'
        if (!emptyHint && skippedNoDate > 0) {
          hint = `날짜를 읽지 못한 행 ${skippedNoDate}건. 파일명(일자20260601 등) 또는 엑셀 날짜 열을 확인하세요.`
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

      progressMessage.value = `${filePrefix}서버 DB에 대용량 데이터 저장 중...`
      await yieldTick()

      const { count } = await savePlatformDailyUpload({
        file,
        fileName,
        platform: resolvedPlatform,
        businessDate,
        details,
        salesMethod: salesMethod || methodPreview[0] || '',
        uploadKind: props.uploadKind,
      })
      total += count
      const skipParts = []
      if (skipped > 0) skipParts.push(`미저장 ${skipped}행`)
      if (skippedSummary > 0) skipParts.push(`합계행 제외 ${skippedSummary}`)
      if (skippedNoDate > 0) skipParts.push(`날짜없음 ${skippedNoDate}행`)
      const skipNote = skipParts.length ? ` (${skipParts.join(', ')})` : ''
      const formatLabel = format === 'coupang_esser' ? ' · 빅셀 매출분석' : ''
      const methodLabel =
        methodPreview.length > 0
          ? ` · ${methodPreview.join('/')}`
          : salesMethod
            ? ` · ${salesMethod}`
            : ''
      const rangeLabel = dateRangeHint ? ` · 기간 ${dateRangeHint}` : ''
      success.value = `${fileList.length}개 파일 · ${resolvedPlatform}${formatLabel}${methodLabel}${rangeLabel} · 총 ${total}건 저장${skipNote}`
      if (
        resolvedPlatform &&
        MARKETPLACE_PLATFORMS.includes(normalizePlatformLabel(resolvedPlatform))
      ) {
        platform.value = normalizePlatformLabel(resolvedPlatform)
      }
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
      쿠팡·네이버 등 <strong>플랫폼을 고른 뒤</strong> 해당 일의 빅셀 엑셀을 올리면 로컬 DB에 저장됩니다.
      <strong>자사몰(기본_양식)</strong>은 여기가 아니라 아래 <strong>「사본느리 자사몰 → ③ 판매내역」</strong>에서
      올려주세요 (매출 = X열 품목 실결제가).
      <strong>빅셀 매출분석</strong>은 자동 인식합니다.
      파일명 <code>네이버</code>·<code>스마트스토어</code> → 플랫폼 <strong>스마트스토어</strong>,
      네이버 엑셀 <strong>배송구분</strong> 열 → <code>일반배송</code>/<code>N배송</code> (쿠팡은 파일명·판매방식 열).
      (예: <code>빅셀_로켓그로스_매출분석_20260531.xlsx</code>,
      <code>일자20260601</code>)
      파일명에 서로 다른 날짜 두 개(<code>…_20260501_20260601</code>)가 있으면
      <strong>하루치 일별 파일</strong>로 나눠 업로드하세요.
    </p>

    <div class="platform-row">
      <label class="platform-label" for="platform-select">플랫폼</label>
      <select id="platform-select" v-model="platform" class="platform-select" :disabled="saving">
        <option v-for="p in platformOptions" :key="p" :value="p">{{ p }}</option>
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