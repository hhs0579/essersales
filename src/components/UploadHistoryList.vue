<script setup>

import { computed, ref, watch } from 'vue'

import { uploadSalesMethod } from '../composables/useSalesData.js'
import { channelLabelForUploadKind } from '../config/dataChannels.js'
import { resolveUploadPlatform } from '../utils/platformDetect.js'

function displayPlatform(u) {
  return resolveUploadPlatform(u.fileName, u.platform) || u.platform
}



const props = defineProps({

  uploads: { type: Array, default: () => [] },

  selectedUploadIds: { type: Array, default: () => [] },

  saving: { type: Boolean, default: false },

  showMergeActions: { type: Boolean, default: true },

  emptyText: { type: String, default: '업로드된 파일이 없습니다.' },

  pageSize: { type: Number, default: 10 },

})



const emit = defineEmits([

  'toggle',

  'select-all',

  'clear-selection',

  'merge-download',

  'delete',

])



const currentPage = ref(1)



const totalCount = computed(() => props.uploads.length)

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / props.pageSize)))

const showPagination = computed(() => totalCount.value > props.pageSize)



const pagedUploads = computed(() => {

  if (!showPagination.value) return props.uploads

  const start = (currentPage.value - 1) * props.pageSize

  return props.uploads.slice(start, start + props.pageSize)

})



const pageRangeLabel = computed(() => {

  if (!totalCount.value) return ''

  const start = (currentPage.value - 1) * props.pageSize + 1

  const end = Math.min(currentPage.value * props.pageSize, totalCount.value)

  return `${start}–${end} / ${totalCount.value}건`

})



watch(
  () => props.uploads.length,
  (len, prevLen) => {
    if (len > (prevLen ?? 0)) currentPage.value = 1
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value
  },
)



watch(totalPages, (max) => {

  if (currentPage.value > max) currentPage.value = max

})



function goPrev() {

  if (currentPage.value > 1) currentPage.value -= 1

}



function goNext() {

  if (currentPage.value < totalPages.value) currentPage.value += 1

}

</script>



<template>

  <div v-if="!uploads.length" class="empty">{{ emptyText }}</div>

  <template v-else>

    <div v-if="showMergeActions" class="merge-actions">

      <button type="button" class="btn btn-outline btn-sm" @click="emit('select-all')">전체 선택</button>

      <button type="button" class="btn btn-outline btn-sm" @click="emit('clear-selection')">선택 해제</button>

      <button

        type="button"

        class="btn btn-primary btn-sm"

        :disabled="selectedUploadIds.length < 2"

        @click="emit('merge-download')"

      >

        통합 엑셀 다운로드 ({{ selectedUploadIds.length }}개)

      </button>

      <span v-if="showPagination" class="page-meta">{{ pageRangeLabel }}</span>

    </div>

    <ul class="file-list">

      <li v-for="u in pagedUploads" :key="u.id" class="file-item">

        <label v-if="showMergeActions" class="upload-check">

          <input

            type="checkbox"

            :checked="selectedUploadIds.includes(u.id)"

            @change="emit('toggle', u.id)"

          />

        </label>

        <span class="name">{{ u.fileName }}</span>

        <span v-if="displayPlatform(u)" class="tag tag-platform">{{ displayPlatform(u) }}</span>

        <span v-if="uploadSalesMethod(u)" class="tag tag-method">{{ uploadSalesMethod(u) }}</span>

        <span v-else-if="displayPlatform(u) === '쿠팡'" class="tag tag-muted">판매방식 미식별</span>

        <span v-if="channelLabelForUploadKind(u.uploadKind)" class="tag tag-channel">
          {{ channelLabelForUploadKind(u.uploadKind) }}
        </span>
        <span v-if="u.uploadKind === 'platform_daily'" class="tag">일별</span>
        <span v-else-if="u.uploadKind === 'platform_monthly'" class="tag tag-monthly">월별</span>
        <span v-else-if="u.uploadKind === 'platform_period'" class="tag tag-period">기간</span>
        <span v-else-if="u.uploadKind === 'sales_daily_b'" class="tag">일별</span>
        <span v-else-if="u.uploadKind === 'sales_monthly_b'" class="tag tag-monthly">월별</span>
        <span v-else-if="u.uploadKind === 'sales_period_b'" class="tag tag-period">기간</span>
        <span v-else class="tag">통합</span>

        <span v-if="u.businessDate" class="tag tag-date">{{ u.businessDate }}</span>

        <span class="tag tag-ok">상세 {{ u.detailCount }}건</span>

        <span class="tag">총 {{ u.totalCount }}건</span>

        <button

          type="button"

          class="btn btn-outline btn-sm danger-text"

          :disabled="saving"

          @click="emit('delete', u)"

        >

          배치 삭제

        </button>

      </li>

    </ul>

    <nav v-if="showPagination" class="pagination" aria-label="업로드 목록 페이지">

      <button

        type="button"

        class="btn btn-outline btn-sm"

        :disabled="currentPage <= 1"

        @click="goPrev"

      >

        이전

      </button>

      <span class="pagination-status">{{ currentPage }} / {{ totalPages }} 페이지</span>

      <button

        type="button"

        class="btn btn-outline btn-sm"

        :disabled="currentPage >= totalPages"

        @click="goNext"

      >

        다음

      </button>

    </nav>

  </template>

</template>



<style scoped>

.merge-actions {

  display: flex;

  flex-wrap: wrap;

  align-items: center;

  gap: 8px;

  margin-bottom: 12px;

}



.page-meta {

  margin-left: auto;

  font-size: 0.8rem;

  color: var(--muted);

}



.upload-check {

  display: flex;

  align-items: center;

  cursor: pointer;

}



.upload-check input {

  width: 16px;

  height: 16px;

  cursor: pointer;

}



.tag-platform {

  background: #e0f2fe;

  color: #0369a1;

}



.tag-method {

  background: #ffedd5;

  color: #c2410c;

}



.tag-muted {

  background: #f1f5f9;

  color: var(--muted);

}



.tag-period {

  background: #ede9fe;

  color: #5b21b6;

}



.tag-monthly {

  background: #fef3c7;

  color: #b45309;

}

.tag-channel {

  background: #dbeafe;

  color: #1d4ed8;

  font-weight: 600;

}



.tag-date {

  background: #f0fdf4;

  color: #15803d;

}



.danger-text {

  color: var(--danger);

}



.pagination {

  display: flex;

  align-items: center;

  justify-content: center;

  gap: 12px;

  margin-top: 12px;

  padding-top: 8px;

}



.pagination-status {

  font-size: 0.875rem;

  color: var(--muted);

  min-width: 7rem;

  text-align: center;

}

</style>

