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
      const id = typeof s.id === 'string' ? s.id : ''
      const fileName = typeof s.fileName === 'string' ? s.fileName : ''
      const dataBase64 = typeof s.dataBase64 === 'string' ? s.dataBase64 : ''
      const uploadedAt = typeof s.uploadedAt === 'string' ? s.uploadedAt : ''
      // omit_sources 응답: 메타만 유지 (재파싱은 dataBase64 있을 때만)
      if (!dataBase64 && !id && !fileName) return null
      return { id, fileName, dataBase64, uploadedAt }
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

function sourceHasBase64(files) {
  return (files || []).some((f) => typeof f?.dataBase64 === 'string' && f.dataBase64.length > 0)
}

/** 목록에 메타만 있고 base64가 비어 있는 원본이 있는지 */
function hasMissingOwnMallSourceBase64(files) {
  return (files || []).some(
    (f) => (f?.id || f?.fileName) && !(typeof f?.dataBase64 === 'string' && f.dataBase64.length > 0),
  )
}

/**
 * omit_sources 메타에 서버 full GET의 dataBase64를 채웁니다.
 * 로컬에 이미 있는 파일만 보강(삭제된 원본을 서버에서 되살리지 않음).
 * @param {import('../config/ownMallManual.js').OwnMallSalesSourceFile[]} localFiles
 * @param {import('../config/ownMallManual.js').OwnMallSalesSourceFile[]} serverFiles
 */
function fillOwnMallSourceBase64FromServer(localFiles, serverFiles) {
  const byId = new Map(serverFiles.filter((f) => f.id && f.dataBase64).map((f) => [f.id, f]))
  const byName = new Map(
    serverFiles.filter((f) => f.fileName && f.dataBase64).map((f) => [f.fileName, f]),
  )
  return (localFiles || []).map((f) => {
    if (f?.dataBase64) return f
    const fromId = f.id ? byId.get(f.id) : null
    if (fromId?.dataBase64) return { ...f, dataBase64: fromId.dataBase64 }
    const fromName = f.fileName ? byName.get(f.fileName) : null
    if (fromName?.dataBase64) return { ...f, dataBase64: fromName.dataBase64 }
    return f
  })
}

/**
 * rebuild/persist 전에 omit_sources로 빠진 base64를 서버에서 보강합니다.
 * @returns {Promise<import('../config/ownMallManual.js').OwnMallSalesSourceFile[]>}
 */
async function ensureOwnMallSourceBase64Loaded() {
  const localFiles = Array.isArray(storeRef.value.salesSourceFiles)
    ? storeRef.value.salesSourceFiles
    : []
  if (!localFiles.length || !hasMissingOwnMallSourceBase64(localFiles)) {
    return localFiles
  }

  const full = await fetchAppSetting(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND, {
    trackBase: false,
  })
  const serverFiles = normalizeSalesSourceFiles(full?.data?.salesSourceFiles)
  const merged = fillOwnMallSourceBase64FromServer(localFiles, serverFiles)
  storeRef.value = { ...storeRef.value, salesSourceFiles: merged }
  return merged
}

/**
 * omit_sources 하이드레이트 후 저장 시 dataBase64가 비어 DB 원본을 지우지 않도록
 * 서버 full 설정과 id 기준으로 병합합니다.
 */
async function mergeOwnMallSourcesForPersist(store) {
  const localFiles = Array.isArray(store?.salesSourceFiles) ? store.salesSourceFiles : []
  if (!localFiles.length) return store
  if (localFiles.every((f) => f?.dataBase64)) return store

  let serverFiles = []
  try {
    const full = await fetchAppSetting(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND, {
      trackBase: false,
    })
    serverFiles = normalizeSalesSourceFiles(full?.data?.salesSourceFiles)
  } catch {
    if (localFiles.some((f) => f.id || f.fileName) && !sourceHasBase64(localFiles)) {
      throw new Error(
        '자사몰 원본 엑셀을 불러오지 못해 저장을 중단했습니다. (업로드 원본 덮어쓰기 방지)',
      )
    }
    return store
  }

  const merged = fillOwnMallSourceBase64FromServer(localFiles, serverFiles)

  if (
    merged.some((f) => f.id || f.fileName) &&
    !sourceHasBase64(merged) &&
    sourceHasBase64(serverFiles)
  ) {
    // 로컬 목록이 비정상 — 서버 원본 파일 유지, sales는 로컬 우선
    return {
      ...store,
      salesSourceFiles: serverFiles,
    }
  }

  return { ...store, salesSourceFiles: merged }
}

/** @returns {Promise<{ changed: boolean, skippedCanceled?: number }>} */
export async function rebuildOwnMallSalesFromStoredSources({ persist = false } = {}) {
  if (rebuildPromise) return rebuildPromise

  rebuildPromise = (async () => {
    // omit_sources 후 새 파일만 base64가 있어도 예전 원본을 반드시 보강한 뒤 전체 재파싱
    let files
    try {
      files = await ensureOwnMallSourceBase64Loaded()
    } catch {
      files = storeRef.value.salesSourceFiles || []
    }

    if (hasMissingOwnMallSourceBase64(files)) {
      const beforeExcelCount = (storeRef.value.sales || []).filter(
        (s) => s.source !== 'manual',
      ).length
      const withB64 = (files || []).filter((f) => f?.dataBase64)
      // 일부 원본만으로 sales를 갈아끼우면 이전 엑셀 판매가 삭제됨 → 중단
      if (beforeExcelCount > 0 && withB64.length > 0 && withB64.length < files.length) {
        throw new Error(
          '자사몰 이전 업로드 원본을 불러오지 못해 판매 재구성을 중단했습니다. 새로고침 후 다시 시도하세요.',
        )
      }
    }

    const sources = (files || []).filter((f) => f?.dataBase64)
    if (!sources.length) {
      return { changed: false }
    }

    const before = salesSnapshot(storeRef.value.sales)
    const beforeExcelCount = (storeRef.value.sales || []).filter((s) => s.source !== 'manual').length
    const { manual } = partitionOwnMallSales(storeRef.value.sales)
    const { excelSales, skippedCanceled } = await rebuildExcelSalesFromSources(
      storeRef.value.products,
      sources,
    )
    // 파싱 결과가 비었는데 기존 엑셀 판매가 있으면 덮어쓰지 않음 (데이터 소실 방지)
    if (!excelSales.length && beforeExcelCount > 0) {
      return { changed: false, skippedCanceled }
    }
    storeRef.value.sales = [...manual, ...excelSales]

    const changed = before !== salesSnapshot(storeRef.value.sales)
    if (changed && persist && sourceHasBase64(storeRef.value.salesSourceFiles)) {
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
  const payload = await mergeOwnMallSourcesForPersist(storeRef.value)
  const res = await saveAppSetting(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND, payload)
  if (res?.data) {
    // 응답에 base64가 없어도(프록시 생략 등) 방금 저장한 payload 유지
    const normalized = normalizeStore(res.data)
    if (!sourceHasBase64(normalized.salesSourceFiles) && sourceHasBase64(payload.salesSourceFiles)) {
      storeRef.value = {
        ...normalized,
        salesSourceFiles: payload.salesSourceFiles,
      }
    } else {
      storeRef.value = normalized
    }
  }
}

/** @type {Promise<unknown> | null} */
let hydratePromise = null

/** @param {{ forceRefresh?: boolean }} [opts] */
export async function hydrateOwnMallManualStore(opts = {}) {
  if (!opts.forceRefresh && hydrated) return storeRef.value
  if (!opts.forceRefresh && hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    try {
      // Phase 3: 기본은 base64 제외(payload 다이어트). products/sales 비면 full fallback
      let res = await fetchAppSetting(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND, {
        omitSources: true,
      })
      if (res?.data) {
        let normalized = normalizeStore(res.data)
        const empty =
          !normalized.products.length && !normalized.sales.length
        const needsSourceRebuild =
          !normalized.sales.length &&
          normalized.salesSourceFiles.some((f) => f.id || f.fileName)
        // products만 있고 sales가 원본(base64)에만 있는 경우도 full 보강
        if (empty || needsSourceRebuild) {
          res = await fetchAppSetting(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND)
          if (res?.data) normalized = normalizeStore(res.data)
        }
        storeRef.value = normalized
        hydrated = true
        const hasBase64 = sourceHasBase64(storeRef.value.salesSourceFiles)
        const sourceMetaCount = (storeRef.value.salesSourceFiles || []).filter(
          (f) => f.id || f.fileName,
        ).length
        const excelImportIds = new Set(
          (storeRef.value.sales || [])
            .filter((s) => s.source !== 'manual' && s.importSourceId)
            .map((s) => s.importSourceId),
        )
        // omit_sources 버그로 sales만 잘린 경우: 원본 메타보다 import 출처가 적으면 full+재파싱
        const salesMayBeIncomplete =
          sourceMetaCount > 0 && excelImportIds.size < sourceMetaCount
        // 하이드레이트 직후 DB에 빈 원본을 쓰지 않음 — sales 복원만 하고
        // persist는 base64가 있을 때만(merge 가드 포함)
        if (
          hasBase64 ||
          (!storeRef.value.sales.length && needsSourceRebuild) ||
          salesMayBeIncomplete
        ) {
          try {
            if (salesMayBeIncomplete && !hasBase64) {
              await ensureOwnMallSourceBase64Loaded()
            }
            await rebuildOwnMallSalesFromStoredSources({
              persist: sourceHasBase64(storeRef.value.salesSourceFiles),
            })
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
  })().finally(() => {
    hydratePromise = null
  })

  return hydratePromise
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

    const remaining = storeRef.value.salesSourceFiles || []
    if (!remaining.length) {
      const { manual } = partitionOwnMallSales(storeRef.value.sales)
      storeRef.value.sales = manual
      await persistOwnMallManualStore()
      return { changed: true }
    }

    // 남은 원본의 omit_sources base64를 보강한 뒤 전체 재파싱
    await rebuildOwnMallSalesFromStoredSources({ persist: true })
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

  /** 저장된 판매 엑셀 원본 다시 받기 */
  async function downloadSalesSourceFile(sourceId) {
    const id = String(sourceId || '').trim()
    if (!id) throw new Error('원본 파일이 없습니다.')
    await ensureOwnMallSourceBase64Loaded()
    const file = (storeRef.value.salesSourceFiles || []).find((f) => f.id === id)
    if (!file?.dataBase64) {
      throw new Error('원본 엑셀을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.')
    }
    const bin = atob(file.dataBase64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const { triggerBlobDownload } = await import('../services/exportApi.js')
    triggerBlobDownload(blob, file.fileName || 'own_mall_sales.xlsx')
    return { fileName: file.fileName }
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
    downloadSalesSourceFile,
    salesCountForSource,
    saveStore,
  }
}
