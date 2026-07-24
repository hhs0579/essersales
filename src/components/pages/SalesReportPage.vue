<script setup>
import { onMounted, toRefs } from 'vue'
import ExcelUpload from '../ExcelUpload.vue'
import { useSalesData } from '../../composables/useSalesData.js'

const emit = defineEmits(['go-data'])

const sales = useSalesData({ scope: 'sales_report' })
const { saving, success, error } = toRefs(sales)
const { ensureLoaded, onSalesReportFilesSelected } = sales

onMounted(() => ensureLoaded())
</script>

<template>
  <section class="card">
    <h2 class="card-title">통합 매출 리포트 업로드</h2>
    <p class="standard-ref">
      날짜·판매처·브랜드·상품명이 포함된 <strong>통합 매출 엑셀</strong> (상세 + 일별/판매처/상품 집계표)을
      업로드합니다.
    </p>
    <ExcelUpload
      :disabled="saving"
      @files-selected="onSalesReportFilesSelected"
      @files-rejected="(e) => (error = e.message)"
    />
    <p v-if="saving" class="standard-ref">저장 중… (행이 많으면 시간이 걸릴 수 있습니다)</p>
    <p v-if="success" class="success-msg">{{ success }}</p>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <div class="page-actions">
      <button type="button" class="btn btn-outline" @click="emit('go-data')">
        통합 매출 데이터에서 보기 →
      </button>
    </div>
  </section>
</template>

<style scoped>
.page-actions {
  margin-top: 16px;
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
</style>
