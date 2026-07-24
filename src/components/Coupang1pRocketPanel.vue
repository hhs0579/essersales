<script setup>
import { computed, ref, watch } from 'vue'
import { useCoupang1pRocket } from '../composables/useCoupang1pRocket.js'
import { calcCoupang1pLine } from '../utils/coupang1pRocketRecords.js'
import { coupang1pProductDisplayName } from '../config/coupang1pRocket.js'
import { COUPANG_1P_ROCKET_SCOPE } from '../config/coupang1pRocket.js'
import { manualAdEntryVisibleInPanel, manualAdHasDateFilter } from '../utils/manualAdSpend.js'
import { maxReportDateYmd } from '../utils/reportDateRange.js'
import YmdDateFields from './YmdDateFields.vue'

const props = defineProps({
  scope: { type: String, default: COUPANG_1P_ROCKET_SCOPE },
  filterCtx: { type: Object, default: () => ({}) },
})

const { store, addProduct, removeProduct, addOrder, removeOrder, saveStore } = useCoupang1pRocket()

const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await saveStore()
    saveMsg.value = '상품·발주 내역이 서버에 저장되었습니다.'
  } catch (e) {
    saveErr.value = e?.message || '저장에 실패했습니다.'
  } finally {
    saving.value = false
  }
}

const singleFilterDate = computed(() => {
  const { dateFrom, dateTo } = props.filterCtx
  if (dateFrom && dateTo && dateFrom === dateTo) return dateFrom
  return ''
})

/** 새 행·빈 일자 드롭다운 기본값 */
const orderDateSuggest = computed(() => {
  if (singleFilterDate.value) return singleFilterDate.value
  const { dateFrom, dateTo } = props.filterCtx
  if (dateFrom) return dateFrom
  if (dateTo) return dateTo
  return maxReportDateYmd()
})

watch(singleFilterDate, (date) => {
  if (!date) return
  for (const row of store.value.orders) {
    if (!row.date) row.date = date
  }
})

const visibleOrders = computed(() =>
  store.value.orders.filter((row) => manualAdEntryVisibleInPanel(row, props.filterCtx)),
)

const hiddenOrderCount = computed(() => store.value.orders.length - visibleOrders.value.length)

const sortedOrders = computed(() =>
  [...visibleOrders.value].sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  }),
)

function onAddOrder() {
  addOrder(singleFilterDate.value || '')
}

const productOptions = computed(() =>
  store.value.products.filter((p) => p.name.trim()),
)

function productById(id) {
  return store.value.products.find((p) => p.id === id) || null
}

function lineForOrder(entry) {
  const product = productById(entry.productId)
  if (!product) return null
  return calcCoupang1pLine(product, entry.quantity)
}

const hasDateFilter = computed(() => manualAdHasDateFilter(props.filterCtx))

function fmtWon(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('ko-KR')}원`
}
</script>

<template>
  <div class="coupang-1p-panel">
    <section class="c1p-section">
      <h4 class="c1p-section-title">① 판매 상품 리스트</h4>
      <p class="standard-ref section-hint">
        <strong>쿠팡 매입단가</strong>는 쿠팡이 우리에게 지급하는 금액(매출 단가),
        <strong>공급원가</strong>는 우리가 물건을 공급하는 데 드는 원가입니다.
        입력 후 하단 <strong>저장</strong>을 눌러야 다른 PC·대시보드에 반영됩니다.
      </p>

      <div class="table-wrap">
        <table class="c1p-table">
          <thead>
            <tr>
              <th>상품명</th>
              <th>옵션</th>
              <th class="col-num">쿠팡 매입단가</th>
              <th class="col-num">공급원가</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!store.products.length">
              <td colspan="5" class="empty-row">등록된 상품이 없습니다.</td>
            </tr>
            <tr v-for="row in store.products" :key="row.id">
              <td>
                <input v-model="row.name" type="text" class="cell-input" placeholder="상품명" />
              </td>
              <td>
                <input v-model="row.option" type="text" class="cell-input" placeholder="옵션" />
              </td>
              <td>
                <input
                  v-model="row.purchasePrice"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-amount"
                  placeholder="0"
                />
              </td>
              <td>
                <input
                  v-model="row.supplyPrice"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-amount"
                  placeholder="0"
                />
              </td>
              <td class="col-action">
                <button type="button" class="btn-icon" title="삭제" @click="removeProduct(row.id)">
                  ×
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="section-foot">
        <button type="button" class="btn btn-primary btn-sm" @click="addProduct">상품 추가</button>
      </div>
    </section>

    <section class="c1p-section">
      <h4 class="c1p-section-title">② 발주 내역</h4>
      <p class="standard-ref section-hint">
        발주일·제품·발주수량을 입력하면
        <strong>쿠팡 매입금액</strong>(매출)·<strong>총 공급원가</strong>(원가)·<strong>순이익</strong>이 자동 계산되어
        베스트하임 쿠팡 매출 KPI에 반영됩니다.
        <span v-if="singleFilterDate" class="filter-date-hint">
          조회 일자 <strong>{{ singleFilterDate }}</strong> — 새 행·빈 일자에 자동 적용
        </span>
        <span v-else-if="hasDateFilter" class="filter-date-hint">
          조회 기간 —
          <strong v-if="filterCtx.dateFrom && filterCtx.dateTo">
            {{ filterCtx.dateFrom }} ~ {{ filterCtx.dateTo }}
          </strong>
          <strong v-else-if="filterCtx.dateFrom">{{ filterCtx.dateFrom }} ~</strong>
          <strong v-else-if="filterCtx.dateTo">~ {{ filterCtx.dateTo }}</strong>
          에 맞는 발주만 표시합니다. 발주일은 <strong>년 · 월 · 일</strong> 드롭다운으로 지정하세요.
        </span>
        <span v-if="hiddenOrderCount > 0" class="filter-date-hint muted-hint">
          조회 기간 밖 {{ hiddenOrderCount }}건은 숨겨져 있습니다. (저장 데이터는 유지)
        </span>
      </p>

      <div class="table-wrap">
        <table class="c1p-table">
          <thead>
            <tr>
              <th class="col-date">발주일</th>
              <th>제품명</th>
              <th class="col-qty">발주수량</th>
              <th class="col-num">쿠팡 매입금액</th>
              <th class="col-num">총 공급원가</th>
              <th class="col-num">순이익</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!sortedOrders.length">
              <td colspan="7" class="empty-row">
                <template v-if="hasDateFilter">
                  조회 기간에 해당하는 발주가 없습니다. 아래에서 추가하세요.
                </template>
                <template v-else>
                  발주 내역이 없습니다. 상품을 먼저 등록한 뒤 발주 행을 추가하세요.
                </template>
              </td>
            </tr>
            <tr v-for="row in sortedOrders" :key="row.id">
              <td class="col-date-cell">
                <YmdDateFields v-model="row.date" :suggest-date="orderDateSuggest" />
              </td>
              <td>
                <select v-model="row.productId" class="cell-input cell-select">
                  <option value="">제품 선택</option>
                  <option v-for="p in productOptions" :key="p.id" :value="p.id">
                    {{ coupang1pProductDisplayName(p) }}
                  </option>
                </select>
              </td>
              <td>
                <input
                  v-model="row.quantity"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-qty"
                  placeholder="1"
                />
              </td>
              <td class="calc-cell">{{ fmtWon(lineForOrder(row)?.sales) }}</td>
              <td class="calc-cell">{{ fmtWon(lineForOrder(row)?.totalCost) }}</td>
              <td
                class="calc-cell"
                :class="{
                  profit: (lineForOrder(row)?.netProfit ?? 0) > 0,
                  loss: (lineForOrder(row)?.netProfit ?? 0) < 0,
                }"
              >
                {{ fmtWon(lineForOrder(row)?.netProfit) }}
              </td>
              <td class="col-action">
                <button type="button" class="btn-icon" title="삭제" @click="removeOrder(row.id)">
                  ×
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="section-foot">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="!productOptions.length"
          @click="onAddOrder"
        >
          발주 행 추가
        </button>
        <p v-if="!productOptions.length" class="foot-note">발주를 추가하려면 먼저 상품을 등록하세요.</p>
      </div>
    </section>

    <div class="c1p-save-bar">
      <p v-if="saveMsg" class="save-ok">{{ saveMsg }}</p>
      <p v-if="saveErr" class="save-fail">{{ saveErr }}</p>
      <button type="button" class="btn btn-primary" :disabled="saving" @click="onSave">
        {{ saving ? '저장 중…' : '상품·발주 저장' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.coupang-1p-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.c1p-section-title {
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
  display: block;
  margin-top: 6px;
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

.c1p-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.c1p-table th,
.c1p-table td {
  border: 1px solid var(--border);
  padding: 6px;
  vertical-align: middle;
}

.c1p-table th {
  background: #1e293b;
  color: #fff;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.col-date {
  width: 200px;
}

.col-date-cell {
  min-width: 200px;
  padding: 4px 6px !important;
}

.col-qty {
  width: 72px;
}

.col-num {
  width: 120px;
}

.col-action {
  width: 36px;
  text-align: center;
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

.cell-amount,
.cell-qty {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cell-select {
  min-width: 160px;
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

.section-foot {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.foot-note {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.btn-icon {
  width: 28px;
  height: 28px;
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

.c1p-save-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #eff6ff;
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
