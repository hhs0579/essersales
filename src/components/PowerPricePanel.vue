<script setup>
import { computed, ref, watch } from 'vue'
import { usePowerPrice } from '../composables/usePowerPrice.js'
import { calcPowerPriceLine } from '../utils/powerPriceRecords.js'
import ManualAdSpendPanel from './ManualAdSpendPanel.vue'
import { POWER_PRICE_PLATFORM_FEE_RATE, POWER_PRICE_SCOPE } from '../config/powerPrice.js'
import { manualAdEntryVisibleInPanel, manualAdHasDateFilter } from '../utils/manualAdSpend.js'
import { maxReportDateYmd } from '../utils/reportDateRange.js'
import YmdDateFields from './YmdDateFields.vue'

const props = defineProps({
  scope: { type: String, default: POWER_PRICE_SCOPE },
  filterCtx: { type: Object, default: () => ({}) },
})

const { store, addProduct, removeProduct, addSale, removeSale, saveStore } = usePowerPrice()

const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await saveStore()
    saveMsg.value = '물품·판매가 서버에 저장되었습니다.'
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

const saleDateSuggest = computed(() => {
  if (singleFilterDate.value) return singleFilterDate.value
  const { dateFrom, dateTo } = props.filterCtx
  if (dateFrom) return dateFrom
  if (dateTo) return dateTo
  return maxReportDateYmd()
})

watch(singleFilterDate, (date) => {
  if (!date) return
  for (const row of store.value.sales) {
    if (!row.date) row.date = date
  }
})

const productOptions = computed(() =>
  store.value.products.filter((p) => p.name.trim()),
)

function productById(id) {
  return store.value.products.find((p) => p.id === id) || null
}

function lineForSale(entry) {
  const product = productById(entry.productId)
  if (!product) return null
  const qty = Number(entry.quantity) || 1
  return calcPowerPriceLine(product, qty, entry.optionPrice)
}

const visibleSales = computed(() =>
  store.value.sales.filter((row) => manualAdEntryVisibleInPanel(row, props.filterCtx)),
)

const hiddenSaleCount = computed(() => store.value.sales.length - visibleSales.value.length)

const hasDateFilter = computed(() => manualAdHasDateFilter(props.filterCtx))

const sortedSales = computed(() =>
  [...visibleSales.value].sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  }),
)

function onAddSale() {
  addSale(singleFilterDate.value || '')
}

function fmtWon(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('ko-KR')}원`
}
</script>

<template>
  <div class="power-price-panel">
    <section class="pp-section">
      <h4 class="pp-section-title">① 물품 등록</h4>
      <p class="standard-ref section-hint">
        제품명·판매가·원가를 등록하면 아래 판매 행에서 드롭다운으로 선택해 자동 계산됩니다.
        입력 후 하단 <strong>저장</strong>을 눌러야 다른 PC·대시보드에 반영됩니다.
      </p>

      <div class="table-wrap">
        <table class="pp-table">
          <thead>
            <tr>
              <th>제품명</th>
              <th class="col-num">판매가</th>
              <th class="col-num">원가</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!store.products.length">
              <td colspan="4" class="empty-row">등록된 물품이 없습니다.</td>
            </tr>
            <tr v-for="row in store.products" :key="row.id">
              <td>
                <input
                  v-model="row.name"
                  type="text"
                  class="cell-input"
                  placeholder="제품명"
                />
              </td>
              <td>
                <input
                  v-model="row.salePrice"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-amount"
                  placeholder="0"
                />
              </td>
              <td>
                <input
                  v-model="row.unitCost"
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
        <button type="button" class="btn btn-primary btn-sm" @click="addProduct">물품 추가</button>
      </div>
    </section>

    <section class="pp-section">
      <h4 class="pp-section-title">② 판매 등록</h4>
      <p class="standard-ref section-hint">
        일자·물품·수량·<strong>옵션가</strong>를 입력하면 매출·원가·순이익이 자동 계산되어 대시보드 KPI에 반영됩니다.
        매출의 <strong>{{ (POWER_PRICE_PLATFORM_FEE_RATE * 100).toFixed(0) }}%</strong>(판매수수료+배송료)를 차감한 뒤 원가를 빼 순이익을 표시합니다.
        옵션가는 물품 판매가에 더해지는 금액(1개당)입니다. 저장 버튼 없이도 아래 대시보드에 즉시 반영됩니다.
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
          에 맞는 판매 행만 표시합니다. 일자는 <strong>년 · 월 · 일</strong> 드롭다운으로 지정하세요.
        </span>
        <span v-if="hiddenSaleCount > 0" class="filter-date-hint muted-hint">
          조회 기간 밖 {{ hiddenSaleCount }}건은 숨겨져 있습니다. (저장 데이터는 유지)
        </span>
      </p>

      <div class="table-wrap">
        <table class="pp-table">
          <thead>
            <tr>
              <th class="col-date">일자</th>
              <th>물품</th>
              <th class="col-qty">수량</th>
              <th class="col-num">옵션가</th>
              <th class="col-num">매출</th>
              <th class="col-num">수수료(7%)</th>
              <th class="col-num">원가</th>
              <th class="col-num">순이익</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!sortedSales.length">
              <td colspan="9" class="empty-row">
                <template v-if="hasDateFilter">
                  조회 기간에 해당하는 판매 내역이 없습니다. 아래에서 추가하세요.
                </template>
                <template v-else>
                  판매 내역이 없습니다. 물품을 먼저 등록한 뒤 판매 행을 추가하세요.
                </template>
              </td>
            </tr>
            <tr v-for="row in sortedSales" :key="row.id">
              <td class="col-date-cell">
                <YmdDateFields v-model="row.date" :suggest-date="saleDateSuggest" />
              </td>
              <td>
                <select v-model="row.productId" class="cell-input cell-select">
                  <option value="">물품 선택</option>
                  <option v-for="p in productOptions" :key="p.id" :value="p.id">
                    {{ p.name }}
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
              <td>
                <input
                  v-model="row.optionPrice"
                  type="text"
                  inputmode="numeric"
                  class="cell-input cell-amount"
                  placeholder="0"
                />
              </td>
              <td class="calc-cell">{{ fmtWon(lineForSale(row)?.sales) }}</td>
              <td class="calc-cell fee-cell">{{ fmtWon(lineForSale(row)?.platformFee) }}</td>
              <td class="calc-cell">{{ fmtWon(lineForSale(row)?.totalCost) }}</td>
              <td class="calc-cell" :class="{ profit: (lineForSale(row)?.netProfit ?? 0) > 0, loss: (lineForSale(row)?.netProfit ?? 0) < 0 }">
                {{ fmtWon(lineForSale(row)?.netProfit) }}
              </td>
              <td class="col-action">
                <button type="button" class="btn-icon" title="삭제" @click="removeSale(row.id)">
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
          @click="onAddSale"
        >
          판매 행 추가
        </button>
        <p v-if="!productOptions.length" class="foot-note">판매 행을 추가하려면 먼저 물품을 등록하세요.</p>
      </div>
    </section>

    <div class="pp-save-bar">
      <p v-if="saveMsg" class="save-ok">{{ saveMsg }}</p>
      <p v-if="saveErr" class="save-fail">{{ saveErr }}</p>
      <button type="button" class="btn btn-primary" :disabled="saving" @click="onSave">
        {{ saving ? '저장 중…' : '물품·판매 저장' }}
      </button>
    </div>

    <section class="pp-section pp-ad-section">
      <h4 class="pp-section-title">③ 일별 광고비</h4>
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
  min-width: 140px;
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

.pp-ad-section :deep(.manual-ad-panel) {
  margin-top: 0;
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
