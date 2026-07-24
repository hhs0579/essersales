import { ref, computed } from 'vue'
import {
  createEmptyOwnMallStore,
  createOwnMallProduct,
  OWN_MALL_MANUAL_SCOPE,
  OWN_MALL_MANUAL_SETTING_KIND,
} from '../config/ownMallManual.js'
import { buildOwnMallManualDetailRows } from '../utils/ownMallRecords.js'
import {
  createManualOwnMallSaleEntry,
  fileToSalesSourceRecord,
  partitionOwnMallSales,
  rebuildExcelSalesFromSources,
  upsertSalesSourceFile,
} from '../utils/ownMallSalesImport.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'

const storeRef = ref(createEmptyOwnMallStore())

export const ownMallManualDetailRecords = computed(() =>
  buildOwnMallManualDetailRows(storeRef.value.products, storeRef.value.sales),
)

let hydrated = false
let rebuildPromise = null

function normalizeSalesSourceFiles(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const s = /** @type {Record<string, unknown>} */ (item)
      if (typeof s.dataBase64 !== 'string' || !s.dataBase64) return null
      return {
        id: typeof s.id === 'string' ? s.id : '',
        fileName: typeof s.fileName === 'string' ? s.fileName : '',
        dataBase64: s.dataBase64,
        uploadedAt: typeof s.uploadedAt === 'string' ? s.uploadedAt : '',
      }
    })
    .filter(Boolean)
}

function normalizeStore(raw) {
  const base = createEmptyOwnMallStore()
  if (!raw || typeof raw !== 'object') return base
  const o = /** @type {Record<string, unknown>} */ (raw)

  const products = Array.isArray(o.products)
    ? o.products.map((item) => {
        if (!item || typeof item !== 'object') return createOwnMallProduct()
        const p = /** @type {Record<string, unknown>} */ (item)
        return {
          id: typeof p.id === 'string' ? p.id : createOwnMallProduct().id,
          productCode: typeof p.productCode === 'string' ? p.productCode : '',
          name: typeof p.name === 'string' ? p.name : '',
          salePrice:
            typeof p.salePrice === 'string' || typeof p.salePrice === 'number'
              ? String(p.salePrice)
              : '',
          unitCost:
            typeof p.unitCost === 'string' || typeof p.unitCost === 'number'
              ? String(p.unitCost)
              : '',
        }
      })
    : []

  const sales = Array.isArray(o.sales)
    ? o.sales.map((item) => {
        if (!item || typeof item !== 'object') return createManualOwnMallSaleEntry()
        const s = /** @type {Record<string, unknown>} */ (item)
        const entry = {
          id: typeof s.id === 'string' ? s.id : createManualOwnMallSaleEntry().id,
          date: typeof s.date === 'string' ? s.date : '',
          productId: typeof s.productId === 'string' ? s.productId : '',
          quantity:
            typeof s.quantity === 'string' || typeof s.quantity === 'number'
              ? String(s.quantity)
              : '1',
          optionPrice:
            typeof s.optionPrice === 'string' || typeof s.optionPrice === 'number'
              ? String(s.optionPrice)
              : '',
          lineTotal:
            typeof s.lineTotal === 'string' || typeof s.lineTotal === 'number'
              ? String(s.lineTotal)
              : '',
          source: s.source === 'manual' ? 'manual' : 'excel',
          importSourceId:
            typeof s.importSourceId === 'string' ? s.importSourceId : undefined,
        }
        return entry
      })
    : []

  const salesSourceFiles = normalizeSalesSourceFiles(o.salesSourceFiles)

  return { products, sales, salesSourceFiles }
}

function salesSnapshot(sales) {
  return JSON.stringify(
    (sales || []).map((s) => ({
      id: s.id,
      date: s.date,
      productId: s.productId,
      quantity: s.quantity,
      optionPrice: s.optionPrice,
      lineTotal: s.lineTotal,
      source: s.source,
    })),
  )
}

/** @returns {Promise<{ changed: boolean, skippedCanceled?: number }>} */
export async function rebuildOwnMallSalesFromStoredSources({ persist = false } = {}) {
  if (rebuildPromise) return rebuildPromise

  rebuildPromise = (async () => {
    const store = storeRef.value
    if (!store.salesSourceFiles?.length) {
      return { changed: false }
    }

    const before = salesSnapshot(store.sales)
    const { manual } = partitionOwnMallSales(store.sales)
    const { excelSales, skippedCanceled } = await rebuildExcelSalesFromSources(
      store.products,
      store.salesSourceFiles,
    )
    store.sales = [...manual, ...excelSales]

    const changed = before !== salesSnapshot(store.sales)
    if (changed && persist) {
      await persistOwnMallManualStore()
    }
    return { changed, skippedCanceled }
  })()

  try {
    return await rebuildPromise
  } finally {
    rebuildPromise = null
  }
}

export async function persistOwnMallManualStore() {
  const res = await saveAppSetting(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND, storeRef.value)
  if (res?.data) {
    storeRef.value = normalizeStore(res.data)
  }
}

export async function hydrateOwnMallManualStore() {
  try {
    const res = await fetchAppSetting(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND)
    if (res?.data) {
      storeRef.value = normalizeStore(res.data)
      hydrated = true
      if (storeRef.value.salesSourceFiles.length) {
        try {
          await rebuildOwnMallSalesFromStoredSources({ persist: true })
        } catch (e) {
          console.warn('자사몰 원본 재파싱 실패:', e)
        }
      }
      return storeRef.value
    }
  } catch {
    /* 서버 미연결 */
  }
  hydrated = true
  return storeRef.value
}

export function useOwnMallManual() {
  if (!hydrated) {
    hydrateOwnMallManualStore().catch(() => {})
  }

  function addProduct() {
    storeRef.value.products.push(createOwnMallProduct())
  }

  /** @param {{ productCode?: string, name: string, salePrice?: string, unitCost?: string }} item */
  function addProductFromCatalog(item) {
    const row = createOwnMallProduct()
    row.productCode = item.productCode || ''
    row.name = item.name || ''
    row.salePrice = item.salePrice != null ? String(item.salePrice) : ''
    row.unitCost = item.unitCost != null ? String(item.unitCost) : ''
    storeRef.value.products.push(row)
    return row
  }

  /** @param {Array<{ productCode?: string, name: string, salePrice?: string, unitCost?: string }>} items */
  function importCatalogItems(items) {
    let count = 0
    for (const item of items || []) {
      if (!item?.name?.trim()) continue
      addProductFromCatalog(item)
      count += 1
    }
    return count
  }

  function removeProduct(id) {
    const i = storeRef.value.products.findIndex((p) => p.id === id)
    if (i < 0) return
    storeRef.value.products.splice(i, 1)
    storeRef.value.sales = storeRef.value.sales.filter((s) => s.productId !== id)
  }

  function addSale(defaultDate = '') {
    storeRef.value.sales.push(createManualOwnMallSaleEntry(defaultDate))
  }

  function removeSale(id) {
    const i = storeRef.value.sales.findIndex((s) => s.id === id)
    if (i >= 0) storeRef.value.sales.splice(i, 1)
  }

  /**
   * 판매 엑셀 원본을 저장하고 최신 파싱 규칙(취소사유 제외 등)으로 엑셀 판매를 재구성합니다.
   * @param {File} file
   */
  async function importSalesExcelFile(file) {
    const sourceRecord = await fileToSalesSourceRecord(file)
    storeRef.value.salesSourceFiles = upsertSalesSourceFile(
      storeRef.value.salesSourceFiles,
      sourceRecord,
    )
    const rebuild = await rebuildOwnMallSalesFromStoredSources()
    return {
      ...rebuild,
      sourceFileName: file.name,
      sourceId: sourceRecord.id,
      salesCount: storeRef.value.sales.filter((s) => s.importSourceId === sourceRecord.id).length,
    }
  }

  /** 업로드된 판매 엑셀 1개 삭제 — 해당 파일에서 파생된 판매 행 제거 후 재구성 */
  async function removeSalesSourceFile(sourceId) {
    const id = String(sourceId || '').trim()
    if (!id) return { changed: false }

    storeRef.value.salesSourceFiles = (storeRef.value.salesSourceFiles || []).filter(
      (f) => f.id !== id,
    )
    const { manual } = partitionOwnMallSales(storeRef.value.sales)
    const { excelSales } = await rebuildExcelSalesFromSources(
      storeRef.value.products,
      storeRef.value.salesSourceFiles,
    )
    storeRef.value.sales = [...manual, ...excelSales]
    await persistOwnMallManualStore()
    return { changed: true }
  }

  /** 저장된 판매 엑셀 전체를 최신 규칙으로 재파싱 */
  async function reapplyAllSalesSourceFiles() {
    const rebuild = await rebuildOwnMallSalesFromStoredSources({ persist: true })
    return rebuild
  }

  function salesCountForSource(sourceId) {
    return storeRef.value.sales.filter((s) => s.importSourceId === sourceId).length
  }

  async function saveStore() {
    await persistOwnMallManualStore()
  }

  return {
    store: storeRef,
    addProduct,
    addProductFromCatalog,
    importCatalogItems,
    removeProduct,
    addSale,
    removeSale,
    importSalesExcelFile,
    removeSalesSourceFile,
    reapplyAllSalesSourceFiles,
    salesCountForSource,
    saveStore,
  }
}
