<script setup>
import { computed } from 'vue'
import { STANDARD_COLUMNS } from '../constants/standardColumns'
import { formatCellValue, AMOUNT_KEYS } from '../utils/formatDisplay.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  limit: { type: Number, default: 200 },
})

const displayRows = computed(() => props.rows.slice(0, props.limit))
const hasMore = computed(() => props.rows.length > props.limit)
</script>

<template>
  <div v-if="!rows.length" class="empty">변환된 데이터가 없습니다. 파일을 업로드하고 변환하세요.</div>
  <template v-else>
    <div class="stats">
      <span>총 <strong>{{ rows.length }}</strong>건</span>
      <span v-if="hasMore" class="tag tag-warn">미리보기 {{ limit }}건 제한</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="col in STANDARD_COLUMNS" :key="col.key">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in displayRows" :key="i">
            <td
              v-for="col in STANDARD_COLUMNS"
              :key="col.key"
              :class="{
                'cell-warn': col.key === 'remarks' && row[col.key],
                'cell-num': AMOUNT_KEYS.has(col.key),
              }"
            >
              {{ formatCellValue(col.key, row[col.key]) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
.cell-warn {
  color: var(--warn);
  max-width: 200px;
  white-space: normal;
}

.cell-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
