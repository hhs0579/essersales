<script setup>
import { computed, ref, watch } from 'vue'
import { useOwnMallManual } from '../composables/useOwnMallManual.js'
import {
  calcOwnMallSaleLine,
  parseOwnMallCatalogText,
  parseOwnMallCatalogExcelFile,
  formatOwnMallCatalogImportMessage,
  parseOwnMallSalesExcelFile,
  formatOwnMallSalesImportMessage,
} from '../utils/ownMallRecords.js'
import { OWN_MALL_CARD_FEE_RATE } from '../config/ownMall.js'
import { manualAdEntryVisibleInPanel, manualAdHasDateFilter } from '../utils/manualAdSpend.js'
import {
  resolveManualEntryDefaultDate,
  resolveManualEntryDateSuggest,
  applyManualEntryDefaultToEmptyRows,
} from '../utils/manualEntryDate.js'
import YmdDateFields from './YmdDateFields.vue'
import CollapsibleSection from './CollapsibleSection.vue'

const props = defineProps({
  filterCtx: { type: Object, default: () => ({}) },
  /** 플랫폼 업로드 — 판매 등록 표 숨김 (카탈로그·엑셀만) */
  hideSalesTable: { type: Boolean, default: false },
})

const {
  store,
  addProduct,
  importCatalogItems,
  removeProduct,
  addSale,
  removeSale,
  importSalesExcelFile,
  removeSalesSourceFile,
  reapplyAllSalesSourceFiles,
  downloadSalesSourceFile,
  salesCountForSource,
  saveStore,
} = useOwnMallManual()

const saving = ref(false)
const saveMsg = ref('')
const saveErr = ref('')
const catalogText = ref('')
const catalogMsg = ref('')
const catalogErr = ref('')
const salesImportMsg = ref('')
const salesImportErr = ref('')
const salesImporting = ref(false)
const removingSourceId = ref('')
const downloadingSourceId = ref('')
const reapplyingSources = ref(false)
const previewProductId = ref('')

async function onSave() {
  saving.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await saveStore()
    saveMsg.value = '자사몰 상품·판매가 서버에 저장되었습니다. 사본느리·통합 대시보드에 반영됩니다.'
  } catch (e) {
    saveErr.value = e?.message || '저장에 실패했습니다.'
  } finally {
    saving.value = false
  }
}


const saleDateSuggest = computed(() => resolveManualEntryDateSuggest(props.filterCtx, 'daily'))

const newSaleDefaultDate = computed(() => resolveManualEntryDefaultDate(props.filterCtx, 'daily'))

watch(
  () => newSaleDefaultDate.value,
  (date) => {
    if (!date) return
    applyManualEntryDefaultToEmptyRows(store.value.sales, props.filterCtx, 'daily')
  },
)

const productOptions = computed(() => store.value.products.filter((p) => p.name.trim()))

function productById(id) {
  return store.value.products.find((p) => p.id === id) || null
}

function lineForProduct(product, qty = 1, optionPrice = 0) {
  if (!product?.name) return null
  return calcOwnMallSaleLine(product, qty, optionPrice)
}

function lineForSale(entry) {
  const product = productById(entry.productId)
  if (!product) return null
  return calcOwnMallSaleLine(product, entry.quantity, entry.optionPrice, entry.lineTotal)
}

function toggleProductPreview(id) {
  previewProductId.value = previewProductId.value === id ? '' : id
}

const visibleSales = computed(() =>
  store.value.sales.filter((row) => manualAdEntryVisibleInPanel(row, props.filterCtx)),
)

const hiddenSaleCount = computed(() => store.value.sales.length - visibleSales.value.length)

const hasDateFilter = computed(() => manualAdHasDateFilter(props.filterCtx))

/** 예전에 엑셀만 저장된 경우 — 원본이 없어 취소사유 재적용 불가 */
const needsSalesReapply = computed(() => {
  const hasExcelSales = store.value.sales.some((s) => s.source !== 'manual')
  const hasSources = (store.value.salesSourceFiles?.length || 0) > 0
  return hasExcelSales && !hasSources
})

const storedSalesSourceCount = computed(() => store.value.salesSourceFiles?.length || 0)

const salesSourceSummaries = computed(() =>
  [...(store.value.salesSourceFiles || [])]
    .map((file) => ({
      ...file,
      saleCount: salesCountForSource(file.id),
      uploadedAtLabel: file.uploadedAt
        ? new Date(file.uploadedAt).toLocaleString('ko-KR')
        : '',
    }))
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')),
)

const manualSaleCount = computed(
  () => store.value.sales.filter((s) => s.source === 'manual').length,
)

const sortedSales = computed(() =>
  [...visibleSales.value].sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  }),
)

function onAddSale() {
  addSale(newSaleDefaultDate.value || '')
}

function applyCatalogImport(parsed, sourceLabel = '') {
  catalogMsg.value = ''
  catalogErr.value = ''
  const result = formatOwnMallCatalogImportMessage(parsed, sourceLabel)
  if (!result.ok) {
    catalogErr.value = result.message
    return false
  }
  importCatalogItems(parsed.items)
  catalogMsg.value = result.message
  return true
}

function applyCatalogFromText() {
  const parsed = parseOwnMallCatalogText(catalogText.value)
  if (applyCatalogImport(parsed)) catalogText.value = ''
}

async function onSalesFileChange(e) {
  const file = e?.target?.files?.[0]
  if (!file) return
  salesImportMsg.value = ''
  salesImportErr.value = ''
  if (!productOptions.value.length) {
    salesImportErr.value = '판매내역을 반영하려면 먼저 ① 상품 카탈로그를 등록하세요.'
    e.target.value = ''
    return
  }
  salesImporting.value = true
  try {
    const parsed = await parseOwnMallSalesExcelFile(file, store.value.products)
    const result = formatOwnMallSalesImportMessage(parsed, file.name)
    if (!result.ok) {
      salesImportErr.value = result.message
      return
    }
    const rebuild = await importSalesExcelFile(file)
    try {
      await saveStore()
      let msg = result.message.replace(
        '서버 저장 후 대시보드에 반영됩니다.',
        '서버 저장 완료 — 매출 대시보드 → 사본느리에서 조회 일자에 주문일이 포함되는지 확인하세요.',
      )
      if (rebuild.changed && (parsed.skippedCanceled || 0) > 0) {
        msg += ` · 저장된 판매를 엑셀 기준으로 재적용했습니다 (취소 ${parsed.skippedCanceled}건 제외).`
      } else if (needsSalesReapply.value === false && rebuild.changed) {
        msg += ' · 저장된 엑셀 판매를 최신 규칙으로 재적용했습니다.'
      }
      salesImportMsg.value = msg
    } catch (saveError) {
      salesImportMsg.value = result.message
      saveErr.value = saveError?.message || '저장 실패 — 하단 「자사몰 상품·판매 저장」을 눌러주세요.'
    }
  } catch (err) {
    salesImportErr.value = err?.message || '판매내역 파일을 읽지 못했습니다.'
  } finally {
    salesImporting.value = false
    e.target.value = ''
  }
}

async function onRemoveSourceFile(file) {
  if (
    !window.confirm(
      `「${file.fileName}」 판매 엑셀을 삭제할까요?\n해당 파일에서 불러온 판매 ${file.saleCount}건도 함께 제거됩니다.`,
    )
  ) {
    return
  }
  removingSourceId.value = file.id
  saveMsg.value = ''
  saveErr.value = ''
  try {
    await removeSalesSourceFile(file.id)
    saveMsg.value = `「${file.fileName}」 삭제 완료 — 사본느리·통합 대시보드에 반영됩니다.`
  } catch (e) {
    saveErr.value = e?.message || '파일 삭제에 실패했습니다.'
  } finally {
    removingSourceId.value = ''
  }
}

async function onDownloadSourceFile(file) {
  if (!file?.id || downloadingSourceId.value) return
  downloadingSourceId.value = file.id
  saveMsg.value = ''
  saveErr.value = ''
  try {
    const res = await downloadSalesSourceFile(file.id)
    saveMsg.value = `「${res.fileName || file.fileName}」 원본 다운로드를 시작했습니다.`
  } catch (e) {
    saveErr.value = e?.message || '원본 다운로드에 실패했습니다.'
  } finally {
    downloadingSourceId.value = ''
  }
}

async function onReapplyAllSources() {
  if (!storedSalesSourceCount.value) return
  reapplyingSources.value = true
  saveMsg.value = ''
  saveErr.value = ''
  try {
    const rebuild = await reapplyAllSalesSourceFiles()
    saveMsg.value = rebuild.changed
      ? `저장된 판매 엑셀 ${storedSalesSourceCount.value}개를 최신 규칙으로 재적용했습니다.`
      : '변경된 판매 데이터가 없습니다.'
  } catch (e) {
    saveErr.value = e?.message || '재적용에 실패했습니다.'
  } finally {
    reapplyingSources.value = false
  }
}

async function onCatalogFileChange(e) {
  const file = e?.target?.files?.[0]
  if (!file) return
  catalogMsg.value = ''
  catalogErr.value = ''
  try {
    const name = file.name.toLowerCase()
    let parsed
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
      parsed = await parseOwnMallCatalogExcelFile(file)
    } else {
      const text = await file.text()
      parsed = parseOwnMallCatalogText(text)
      parsed.fileName = file.name
    }
    applyCatalogImport(parsed, file.name)
  } catch (err) {
    catalogErr.value = err?.message || '파일을 읽지 못했습니다.'
  } finally {
    e.target.value = ''
  }
}

function fmtWon(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('ko-KR')}원`
}

function productPreviewText(product) {
  const line = lineForProduct(product, 1, 0)
  if (!line) return ''
  const margin = line.sales - line.totalCost
  return `판매가 ${fmtWon(line.sales)} − 원가 ${fmtWon(line.totalCost)} = ${fmtWon(margin)} (카드수수료 ${(OWN_MALL_CARD_FEE_RATE * 100).toFixed(1)}% 별도)`
}
</script>

<template>
  <div class="own-mall-panel">
    <header class="om-head">
      <h3 class="om-title">사본느리 자사몰</h3>
      <p class="standard-ref om-desc">
        <strong>상품 카탈로그</strong>와 <strong>주문·판매 엑셀</strong>을 업로드하면 사본느리·통합 탭
        <strong>자사몰</strong> KPI에 자동 반영됩니다. 업로드한 판매 엑셀은 아래 목록에서
        <strong>삭제·재적용</strong>할 수 있습니다. 매출에서 카드수수료
        <strong>{{ (OWN_MALL_CARD_FEE_RATE * 100).toFixed(1) }}%</strong>를 차감한 뒤 원가를 빼
        순이익을 계산합니다.
      </p>
    </header>

    <CollapsibleSection
      title="① 상품 카탈로그 업로드"
      :default-collapsed="hideSalesTable"
      card-class="om-collapsible"
    >
      <p class="standard-ref section-hint">
        <strong>엑셀</strong> 업로드 시 <code>A</code>상품번호 · <code>B</code>상품명 ·
        <code>H</code>판매가 · <code>K</code>원가 열을 자동으로 읽습니다.
        <strong>원가가 0인 상품은 목록에서 제외</strong>됩니다.
        텍스트 붙여넣기는 <code>상품명,판매가,원가</code> 또는
        <code>상품번호,상품명,판매가,원가</code> 형식입니다.
      </p>
      <textarea
        v-model="catalogText"
        class="catalog-textarea"
        rows="5"
        placeholder="예시&#10;드니옹 티셔츠,39000,12000&#10;에쎄르 후드,89000,28000"
      />
      <div class="catalog-actions">
        <button type="button" class="btn btn-primary btn-sm" @click="applyCatalogFromText">
          붙여넣기 반영
        </button>
        <label class="btn btn-outline btn-sm file-btn">
          엑셀/CSV 파일 선택
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
            hidden
            @change="onCatalogFileChange"
          />
        </label>
      </div>
      <p v-if="catalogMsg" class="catalog-ok">{{ catalogMsg }}</p>
      <p v-if="catalogErr" class="catalog-fail">{{ catalogErr }}</p>
    </CollapsibleSection>

    <CollapsibleSection
      title="② 상품 등록"
      :default-collapsed="hideSalesTable"
      card-class="om-collapsible"
    >
      <p class="standard-ref section-hint">
        <strong>상품명을 클릭</strong>하면 판매가 − 원가 미리보기가 나옵니다. 판매 행에서 상품을 고르면
        매출·수수료·순이익이 자동 계산됩니다.
      </p>

      <div class="table-wrap">
        <table class="om-table">
          <thead>
            <tr>
              <th class="col-code">상품번호</th>
              <th>상품명</th>
              <th class="col-num">판매가</th>
              <th class="col-num">원가</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!store.products.length">
              <td colspan="5" class="empty-row">등록된 상품이 없습니다. 카탈로그 업로드 또는 직접 추가하세요.</td>
            </tr>
            <tr v-for="row in store.products" :key="row.id">
              <td>
                <input
                  v-model="row.productCode"
                  type="text"
                  class="cell-input cell-code"
                  placeholder="번호"
                />
              </td>
              <td class="product-name-cell">
                <button
                  type="button"
                  class="product-preview-btn"
                  :class="{ active: previewProductId === row.id }"
                  :title="productPreviewText(row) || '판매가·원가 입력 후 클릭'"
                  @click="toggleProductPreview(row.id)"
                >
                  {{ row.name.trim() || '상품명 (클릭 시 미리보기)' }}
                </button>
                <input v-model="row.name" type="text" class="cell-input" placeholder="상품명" />
                <p v-if="previewProductId === row.id && row.name.trim()" class="product-tip">
                  {{ productPreviewText(row) }}
                </p>
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
                <button type="button" class="btn-icon" title="삭제" @click="removeProduct(row.id)">×</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="section-foot">
        <button type="button" class="btn btn-primary btn-sm" @click="addProduct">상품 추가</button>
      </div>
    </CollapsibleSection>

    <section class="om-section om-sales-import">
      <h4 class="om-section-title">③ 판매내역 엑셀 업로드</h4>
      <p class="standard-ref section-hint">
        주문·판매 엑셀을 올리면 <code>AK</code>주문일 · <code>AL</code>상품고유번호 ·
        <code>R</code>상품명 · <code>Q</code>구매수량 · <code>C</code>주문상태 ·
        <code>X</code>품목 실결제가 · <code>AG</code>취소사유 열을 읽습니다.
        매출은 아임웹과 동일하게 <strong>주문상태 「거래개시」</strong>만 포함하며,
        품목별 매출은 <strong><code>X</code>열 품목 실결제가</strong>를 그대로 사용합니다
        (D열 총 품목 합계금액·H열 최종주문금액 배분은 사용하지 않음).
        <code>AG</code> 취소사유가 있으면 해당 품목 행은 제외합니다.
        동일 파일명으로 다시 올리면 기존 엑셀 판매가 <strong>덮어쓰기·재적용</strong>됩니다 (중복 추가 없음).
        <strong>파일명(예: 기본_양식_20260615…)은 주문일이 아닙니다.</strong> 엑셀
        <code>AK</code> 주문일 기준으로 들어갑니다. 업로드 후 자동 저장되며, 대시보드 조회
        기간에 해당 일자가 포함되어야 KPI에 보입니다.
        상품은 <strong>AL 고유번호 → R 상품명</strong> 순으로 ① 카탈로그와 매칭합니다.
        카탈로그 판매가와 엑셀 판매가가 다르면 옵션가로 반영합니다.
      </p>
      <p v-if="needsSalesReapply" class="catalog-fail reapply-hint">
        이전에 저장된 엑셀 판매에는 취소사유(AG) 반영이 안 되어 있을 수 있습니다.
        <strong>같은 판매내역 엑셀을 한 번 더 선택</strong>하면 취소 건을 제외하고 재적용됩니다.
      </p>
      <p v-else-if="storedSalesSourceCount > 0" class="section-hint source-hint">
        저장된 판매 엑셀 {{ storedSalesSourceCount }}개 — 앱을 열 때마다 최신 규칙으로 자동 재적용됩니다.
      </p>
      <div class="catalog-actions">
        <label class="btn btn-primary btn-sm file-btn" :class="{ disabled: salesImporting }">
          {{ salesImporting ? '읽는 중…' : '판매내역 엑셀 선택' }}
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            hidden
            :disabled="salesImporting"
            @change="onSalesFileChange"
          />
        </label>
      </div>
      <p v-if="salesImportMsg" class="catalog-ok">{{ salesImportMsg }}</p>
      <p v-if="salesImportErr" class="catalog-fail">{{ salesImportErr }}</p>
    </section>

    <section class="om-section om-upload-history">
      <h4 class="om-section-title">④ 업로드된 판매 엑셀 관리</h4>
      <p class="standard-ref section-hint">
        업로드한 주문·판매 엑셀 원본이 서버에 저장됩니다. 파일을 삭제하면 해당 엑셀에서 불러온
        판매 행만 제거됩니다. 직접 입력 판매({{ manualSaleCount }}건)는 유지됩니다.
      </p>
      <div v-if="!salesSourceSummaries.length" class="empty-source-list">
        업로드된 판매 엑셀이 없습니다. ③에서 주문·판매 엑셀을 선택하세요.
      </div>
      <template v-else>
        <div class="source-actions">
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="reapplyingSources"
            @click="onReapplyAllSources"
          >
            {{ reapplyingSources ? '재적용 중…' : '전체 재적용' }}
          </button>
          <span class="source-meta">저장된 파일 {{ salesSourceSummaries.length }}개</span>
        </div>
        <ul class="source-file-list">
          <li v-for="file in salesSourceSummaries" :key="file.id" class="source-file-item">
            <div class="source-file-main">
              <span class="source-file-name">{{ file.fileName }}</span>
              <span v-if="file.uploadedAtLabel" class="source-tag">{{ file.uploadedAtLabel }}</span>
              <span class="source-tag source-tag-ok">판매 {{ file.saleCount }}건</span>
            </div>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              :disabled="downloadingSourceId === file.id || removingSourceId === file.id"
              title="서버에 저장된 판매 엑셀 원본"
              @click="onDownloadSourceFile(file)"
            >
              {{ downloadingSourceId === file.id ? '받는 중…' : '원본 받기' }}
            </button>
            <button
              type="button"
              class="btn btn-outline btn-sm btn-danger-outline"
              :disabled="removingSourceId === file.id"
              @click="onRemoveSourceFile(file)"
            >
              {{ removingSourceId === file.id ? '삭제 중…' : '삭제' }}
            </button>
          </li>
        </ul>
      </template>
    </section>

    <section v-if="!hideSalesTable" class="om-section">
      <h4 class="om-section-title">⑤ 일별 판매 등록</h4>
      <p class="standard-ref section-hint">
        일자·상품·수량을 입력하거나 ③ 엑셀 업로드 결과를 확인·수정할 수 있습니다.
        <span v-if="saleDateSuggest" class="filter-date-hint">
          조회 기간 자동 적용 — <strong>{{ saleDateSuggest }}</strong>
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
        <table class="om-table">
          <thead>
            <tr>
              <th class="col-date">일자</th>
              <th>상품</th>
              <th class="col-qty">수량</th>
              <th class="col-num">옵션가</th>
              <th class="col-num">매출</th>
              <th class="col-num">수수료(3.3%)</th>
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
                  판매 내역이 없습니다. 상품을 등록한 뒤 판매 행을 추가하세요.
                </template>
              </td>
            </tr>
            <template v-for="row in sortedSales" :key="row.id">
              <tr>
                <td class="col-date-cell">
                  <YmdDateFields v-model="row.date" :suggest-date="saleDateSuggest" />
                </td>
                <td class="sale-product-cell">
                  <select v-model="row.productId" class="cell-input cell-select">
                    <option value="">상품 선택</option>
                    <option v-for="p in productOptions" :key="p.id" :value="p.id">
                      {{ p.productCode ? `[${p.productCode}] ` : '' }}{{ p.name }}
                    </option>
                  </select>
                  <p
                    v-if="row.productId && productById(row.productId)"
                    class="product-tip sale-tip"
                  >
                    {{ productPreviewText(productById(row.productId)) }}
                  </p>
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
                <td class="calc-cell fee-cell">{{ fmtWon(lineForSale(row)?.cardFee) }}</td>
                <td class="calc-cell">{{ fmtWon(lineForSale(row)?.totalCost) }}</td>
                <td
                  class="calc-cell"
                  :class="{
                    profit: (lineForSale(row)?.netProfit ?? 0) > 0,
                    loss: (lineForSale(row)?.netProfit ?? 0) < 0,
                  }"
                >
                  {{ fmtWon(lineForSale(row)?.netProfit) }}
                </td>
                <td class="col-action">
                  <button type="button" class="btn-icon" title="삭제" @click="removeSale(row.id)">×</button>
                </td>
              </tr>
            </template>
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
      </div>
    </section>

    <div class="om-save-bar">
      <p v-if="saveMsg" class="save-ok">{{ saveMsg }}</p>
      <p v-if="saveErr" class="save-fail">{{ saveErr }}</p>
      <button type="button" class="btn btn-primary" :disabled="saving" @click="onSave">
        {{ saving ? '저장 중…' : '자사몰 상품·판매 저장' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.own-mall-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 2px solid #e0e7ff;
}

.om-head {
  margin: 0;
}

.om-title {
  margin: 0 0 6px;
  font-size: 1.05rem;
  font-weight: 700;
  color: #3730a3;
}

.om-desc {
  margin: 0;
  line-height: 1.55;
}

.om-section-title {
  margin: 0 0 6px;
  font-size: 0.95rem;
  font-weight: 600;
}

.section-hint {
  margin: 0 0 10px;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.om-collapsible {
  margin-bottom: 0;
  padding: 14px;
  border: 1px dashed #c7d2fe;
  border-radius: 10px;
  background: #f8fafc;
  box-shadow: none;
}

.om-collapsible :deep(.card-title) {
  font-size: 0.95rem;
  font-weight: 600;
  color: #3730a3;
}

.om-collapsible :deep(.collapsible-body) {
  margin-top: 8px;
}

.om-sales-import {
  padding: 14px;
  border: 1px dashed #c7d2fe;
  border-radius: 10px;
  background: #f8fafc;
}

.file-btn.disabled {
  opacity: 0.65;
  pointer-events: none;
}

.catalog-textarea {
  width: 100%;
  min-height: 100px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-family: ui-monospace, monospace;
  font-size: 0.8125rem;
  resize: vertical;
}

.catalog-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.file-btn {
  cursor: pointer;
  margin: 0;
}

.catalog-ok {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: #047857;
}

.catalog-fail {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: var(--danger);
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

.om-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.om-table th,
.om-table td {
  border: 1px solid var(--border);
  padding: 6px;
  vertical-align: top;
}

.om-table th {
  background: #312e81;
  color: #fff;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  vertical-align: middle;
}

.col-code {
  width: 100px;
}

.cell-code {
  font-variant-numeric: tabular-nums;
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
  width: 110px;
}

.col-action {
  width: 36px;
  text-align: center;
  vertical-align: middle;
}

.empty-row {
  text-align: center;
  color: var(--muted);
  padding: 16px !important;
  background: #fff;
}

.product-name-cell,
.sale-product-cell {
  min-width: 180px;
}

.product-preview-btn {
  display: block;
  width: 100%;
  margin-bottom: 4px;
  padding: 4px 6px;
  border: 1px solid #e0e7ff;
  border-radius: 6px;
  background: #eef2ff;
  color: #3730a3;
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.product-preview-btn.active {
  background: #c7d2fe;
  font-weight: 600;
}

.product-tip {
  margin: 6px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  font-size: 0.78rem;
  color: #166534;
  line-height: 1.45;
}

.sale-tip {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
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
  vertical-align: middle;
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

.om-save-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid #c7d2fe;
  border-radius: 10px;
  background: #eef2ff;
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

.om-upload-history {
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
}

.empty-source-list {
  padding: 14px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  font-size: 0.8125rem;
  color: var(--muted);
  text-align: center;
}

.source-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.source-meta {
  font-size: 0.78rem;
  color: var(--muted);
}

.source-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.source-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

.source-file-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.source-file-name {
  font-size: 0.875rem;
  font-weight: 500;
  word-break: break-all;
}

.source-tag {
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  white-space: nowrap;
}

.source-tag-ok {
  background: #dcfce7;
  color: #166534;
}

.btn-danger-outline {
  color: var(--danger);
  border-color: #fecaca;
  flex-shrink: 0;
}

.btn-danger-outline:hover:not(:disabled) {
  background: #fef2f2;
}
</style>
