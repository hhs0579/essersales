import { ref, computed } from 'vue'
import {
  createEmptyPowerPriceStore,
  createPowerPriceCostMasterEntry,
  createPowerPriceConfirmUpload,
  powerPriceCostKey,
  POWER_PRICE_SCOPE,
} from '../config/powerPrice.js'
import { buildPowerPriceDetailRows } from '../utils/powerPriceRecords.js'
import { parseAmount } from '../utils/parseAmount.js'
import { parsePurchaseConfirmExcel } from '../utils/powerPriceConfirmParser.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'

const LEGACY_STORAGE_KEY = 'essersales_power_price_v1'
const SETTING_KIND = 'power_price'

/** @type {import('vue').Ref<ReturnType<typeof createEmptyPowerPriceStore>>} */
const storeRef = ref(createEmptyPowerPriceStore())

/** 대시보드·KPI — 구매확정 + 원가만 (수기 제외) */
export const powerPriceDetailRecords = computed(() =>
  buildPowerPriceDetailRows(
    [],
    [],
    storeRef.value.confirmLines,
    storeRef.value.costMaster,
  ),
)

let hydrated = false

/** @param {unknown} raw */
function normalizeConfirmLine(item) {
  if (!item || typeof item !== 'object') return null
  const s = /** @type {Record<string, unknown>} */ (item)
  const productId = typeof s.productId === 'string' ? s.productId : ''
  const option = typeof s.option === 'string' ? s.option : ''
  const productOrderId =
    typeof s.productOrderId === 'string'
      ? s.productOrderId
      : typeof s.id === 'string'
        ? s.id
        : ''
  if (!productOrderId || !productId) return null
  return {
    id: productOrderId,
    productOrderId,
    orderId: typeof s.orderId === 'string' ? s.orderId : '',
    date: typeof s.date === 'string' ? s.date : '',
    productId,
    productName: typeof s.productName === 'string' ? s.productName : '',
    option,
    quantity:
      typeof s.quantity === 'string' || typeof s.quantity === 'number'
        ? String(s.quantity)
        : '1',
    orderAmount:
      typeof s.orderAmount === 'string' || typeof s.orderAmount === 'number'
        ? String(s.orderAmount)
        : '0',
    feeNpay:
      typeof s.feeNpay === 'string' || typeof s.feeNpay === 'number'
        ? String(s.feeNpay)
        : '0',
    feeSales:
      typeof s.feeSales === 'string' || typeof s.feeSales === 'number'
        ? String(s.feeSales)
        : '0',
    settleAmount:
      typeof s.settleAmount === 'string' || typeof s.settleAmount === 'number'
        ? String(s.settleAmount)
        : '0',
    costKey:
      typeof s.costKey === 'string' && s.costKey
        ? s.costKey
        : powerPriceCostKey(productId, option),
    sourceFileName: typeof s.sourceFileName === 'string' ? s.sourceFileName : '',
  }
}

/** @param {unknown} raw */
function normalizeCostMasterEntry(item) {
  if (!item || typeof item !== 'object') return null
  const c = /** @type {Record<string, unknown>} */ (item)
  const productId = typeof c.productId === 'string' ? c.productId : ''
  const option = typeof c.option === 'string' ? c.option : ''
  const key =
    typeof c.key === 'string' && c.key ? c.key : powerPriceCostKey(productId, option)
  if (!key || key === '::') return null
  return createPowerPriceCostMasterEntry({
    key,
    productId,
    productName: typeof c.productName === 'string' ? c.productName : '',
    option,
    unitCost:
      typeof c.unitCost === 'string' || typeof c.unitCost === 'number'
        ? String(c.unitCost)
        : '',
  })
}

/**
 * @param {import('../config/powerPrice.js').PowerPriceConfirmLine[]} lines
 * @param {import('../config/powerPrice.js').PowerPriceConfirmUpload[]} [existing]
 */
function rebuildConfirmUploads(lines, existing = []) {
  /** @type {Map<string, import('../config/powerPrice.js').PowerPriceConfirmUpload>} */
  const prevByName = new Map(
    (existing || [])
      .filter((u) => u?.fileName)
      .map((u) => [u.fileName, u]),
  )
  /** @type {Map<string, { dates: string[], count: number }>} */
  const groups = new Map()
  for (const line of lines || []) {
    const name = String(line?.sourceFileName || '').trim() || '구매확정내역'
    let g = groups.get(name)
    if (!g) {
      g = { dates: [], count: 0 }
      groups.set(name, g)
    }
    g.count += 1
    if (line.date) g.dates.push(line.date)
  }
  const uploads = []
  for (const [fileName, g] of groups) {
    const dates = g.dates.filter(Boolean).sort()
    const prev = prevByName.get(fileName)
    uploads.push(
      createPowerPriceConfirmUpload({
        id: prev?.id,
        fileName,
        uploadedAt: prev?.uploadedAt || new Date().toISOString(),
        lineCount: g.count,
        dateFrom: dates[0] || '',
        dateTo: dates[dates.length - 1] || '',
      }),
    )
  }
  return uploads.sort((a, b) =>
    String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')),
  )
}

/** @param {unknown} raw */
function normalizeUpload(item) {
  if (!item || typeof item !== 'object') return null
  const u = /** @type {Record<string, unknown>} */ (item)
  const fileName = typeof u.fileName === 'string' ? u.fileName.trim() : ''
  if (!fileName) return null
  return createPowerPriceConfirmUpload({
    id: typeof u.id === 'string' ? u.id : undefined,
    fileName,
    uploadedAt: typeof u.uploadedAt === 'string' ? u.uploadedAt : new Date().toISOString(),
    lineCount: typeof u.lineCount === 'number' ? u.lineCount : Number(u.lineCount) || 0,
    dateFrom: typeof u.dateFrom === 'string' ? u.dateFrom : '',
    dateTo: typeof u.dateTo === 'string' ? u.dateTo : '',
  })
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const base = createEmptyPowerPriceStore()
  if (!raw || typeof raw !== 'object') return base
  const o = /** @type {Record<string, unknown>} */ (raw)

  // 수기 products/sales 폐기 — 서버에도 빈 배열로 덮어씀
  const confirmLines = Array.isArray(o.confirmLines)
    ? o.confirmLines.map(normalizeConfirmLine).filter(Boolean)
    : []

  const costMaster = Array.isArray(o.costMaster)
    ? o.costMaster.map(normalizeCostMasterEntry).filter(Boolean)
    : []

  const storedUploads = Array.isArray(o.confirmUploads)
    ? o.confirmUploads.map(normalizeUpload).filter(Boolean)
    : []

  const confirmUploads = rebuildConfirmUploads(confirmLines, storedUploads)

  return {
    products: [],
    sales: [],
    confirmLines,
    costMaster,
    confirmUploads,
  }
}

function storeHasContent(store) {
  return (
    (store?.confirmLines?.length || 0) > 0 ||
    (store?.costMaster?.length || 0) > 0
  )
}

function loadLegacyStore() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const store = normalizeStore(JSON.parse(raw))
    return storeHasContent(store) ? store : null
  } catch {
    return null
  }
}

function clearLegacyStore() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * @param {import('../config/powerPrice.js').PowerPriceConfirmLine[]} lines
 */
function ensureCostMasterFromLines(lines) {
  const byKey = new Map(
    (storeRef.value.costMaster || []).filter((c) => c?.key).map((c) => [c.key, { ...c }]),
  )
  for (const line of lines || []) {
    if (!line?.costKey) continue
    const prev = byKey.get(line.costKey)
    if (prev) {
      if (!prev.productName && line.productName) prev.productName = line.productName
      if (!prev.productId) prev.productId = line.productId
      if (prev.option == null) prev.option = line.option || ''
      continue
    }
    byKey.set(
      line.costKey,
      createPowerPriceCostMasterEntry({
        key: line.costKey,
        productId: line.productId,
        productName: line.productName,
        option: line.option,
        unitCost: '',
      }),
    )
  }
  storeRef.value.costMaster = [...byKey.values()].sort((a, b) =>
    `${a.productName}${a.option}`.localeCompare(`${b.productName}${b.option}`, 'ko'),
  )
}

function syncConfirmUploads() {
  storeRef.value.confirmUploads = rebuildConfirmUploads(
    storeRef.value.confirmLines,
    storeRef.value.confirmUploads,
  )
}

/**
 * 마지막 서버 동기화 이후 이 화면에서 바뀐 것 — 저장 시 서버 최신본과 병합할 때 사용.
 * 오래 열어 둔 탭·다른 PC가 통째로 덮어써 업로드·원가가 사라지는 것을 막음.
 */
const pending = {
  /** @type {Set<string>} */
  costKeys: new Set(),
  /** @type {Set<string>} */
  deletedFiles: new Set(),
  clearedAll: false,
}

function hasPendingChanges() {
  return pending.costKeys.size > 0 || pending.deletedFiles.size > 0 || pending.clearedAll
}

function resetPending() {
  pending.costKeys.clear()
  pending.deletedFiles.clear()
  pending.clearedAll = false
}

/** @param {string} key */
export function markPowerPriceCostDirty(key) {
  if (key) pending.costKeys.add(key)
}

/**
 * 서버 최신본 + 로컬 변경 병합. 확정 행은 합집합(로컬에서 지운 파일만 제외),
 * 원가는 이 화면에서 고친 키만 로컬 값, 나머지는 서버 값 우선(비어 있으면 로컬 값).
 * @param {ReturnType<typeof normalizeStore>} local
 * @param {ReturnType<typeof normalizeStore>} server
 */
function mergeWithServer(local, server) {
  const lineById = new Map()
  if (!pending.clearedAll) {
    for (const line of server.confirmLines || []) {
      if (pending.deletedFiles.has(line.sourceFileName)) continue
      lineById.set(line.productOrderId || line.id, line)
    }
  }
  for (const line of local.confirmLines || []) {
    lineById.set(line.productOrderId || line.id, line)
  }
  const confirmLines = [...lineById.values()].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')),
  )

  const costByKey = new Map((server.costMaster || []).map((c) => [c.key, { ...c }]))
  for (const c of local.costMaster || []) {
    const prev = costByKey.get(c.key)
    if (!prev || pending.costKeys.has(c.key)) {
      costByKey.set(c.key, { ...c })
    } else if (!parseAmount(prev.unitCost) && parseAmount(c.unitCost)) {
      prev.unitCost = c.unitCost
    }
  }
  const costMaster = [...costByKey.values()].sort((a, b) =>
    `${a.productName}${a.option}`.localeCompare(`${b.productName}${b.option}`, 'ko'),
  )

  const uploadMeta = [
    ...(server.confirmUploads || []).filter((u) => !pending.deletedFiles.has(u.fileName)),
    ...(local.confirmUploads || []),
  ]
  return {
    products: [],
    sales: [],
    confirmLines,
    costMaster,
    confirmUploads: rebuildConfirmUploads(confirmLines, uploadMeta),
  }
}

async function fetchServerStore() {
  const res = await fetchAppSetting(POWER_PRICE_SCOPE, SETTING_KIND)
  return normalizeStore(res?.data ?? null)
}

export async function persistPowerPriceStore() {
  storeRef.value.products = []
  storeRef.value.sales = []
  syncConfirmUploads()
  const latest = await fetchServerStore()
  const merged = mergeWithServer(storeRef.value, latest)
  const res = await saveAppSetting(POWER_PRICE_SCOPE, SETTING_KIND, merged)
  storeRef.value = res?.data ? normalizeStore(res.data) : merged
  resetPending()
  clearLegacyStore()
}

/** @param {{ forceRefresh?: boolean }} [opts] */
export async function hydratePowerPriceStore(opts = {}) {
  if (!opts.forceRefresh && hydrated) return storeRef.value

  try {
    const res = await fetchAppSetting(POWER_PRICE_SCOPE, SETTING_KIND)
    if (res?.data) {
      const server = normalizeStore(res.data)
      // 저장 전 로컬 수정(원가 입력 등)이 있으면 새로고침에도 지우지 않음
      storeRef.value = hasPendingChanges() ? mergeWithServer(storeRef.value, server) : server
      hydrated = true
      return storeRef.value
    }
  } catch {
    /* 서버 미연결 */
  }

  const legacy = loadLegacyStore()
  if (legacy) {
    storeRef.value = legacy
  }
  hydrated = true
  return storeRef.value
}

export function getPowerPriceDetailRecords() {
  if (!hydrated) {
    hydratePowerPriceStore().catch(() => {})
  }
  return powerPriceDetailRecords.value
}

export { storeRef as powerPriceStoreRef }

export function usePowerPrice() {
  if (!hydrated) {
    hydratePowerPriceStore().catch(() => {})
  }

  /**
   * @param {ArrayBuffer} buffer
   * @param {string} [fileName]
   */
  async function importPurchaseConfirm(buffer, fileName = '') {
    const parsed = await parsePurchaseConfirmExcel(buffer, fileName)
    const sourceFileName = parsed.sourceFileName
    const byId = new Map(
      (storeRef.value.confirmLines || []).map((l) => [l.productOrderId || l.id, l]),
    )
    // 같은 파일명 재업로드 시 해당 파일 행만 교체
    for (const [id, line] of [...byId.entries()]) {
      if (line.sourceFileName === sourceFileName) byId.delete(id)
    }
    for (const line of parsed.lines) {
      byId.set(line.productOrderId || line.id, line)
    }
    storeRef.value.confirmLines = [...byId.values()].sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')),
    )
    ensureCostMasterFromLines(parsed.lines)

    const dates = parsed.lines.map((l) => l.date).filter(Boolean).sort()
    const prev = (storeRef.value.confirmUploads || []).find(
      (u) => u.fileName === sourceFileName,
    )
    const others = (storeRef.value.confirmUploads || []).filter(
      (u) => u.fileName !== sourceFileName,
    )
    storeRef.value.confirmUploads = [
      createPowerPriceConfirmUpload({
        id: prev?.id,
        fileName: sourceFileName,
        uploadedAt: new Date().toISOString(),
        lineCount: parsed.lines.length,
        dateFrom: dates[0] || '',
        dateTo: dates[dates.length - 1] || '',
      }),
      ...others,
    ].sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))

    return {
      imported: parsed.lines.length,
      skipped: parsed.skipped,
      sourceFileName,
      uniqueCostKeys: parsed.uniqueCostKeys,
      missingCostCount: storeRef.value.costMaster.filter(
        (c) => !c.unitCost || !String(c.unitCost).trim() || Number(c.unitCost) === 0,
      ).length,
    }
  }

  /** @param {string} uploadIdOrFileName */
  function removeConfirmUpload(uploadIdOrFileName) {
    const key = String(uploadIdOrFileName || '').trim()
    if (!key) return
    const upload = (storeRef.value.confirmUploads || []).find(
      (u) => u.id === key || u.fileName === key,
    )
    const fileName = upload?.fileName || key
    pending.deletedFiles.add(fileName)
    storeRef.value.confirmLines = (storeRef.value.confirmLines || []).filter(
      (l) => l.sourceFileName !== fileName,
    )
    storeRef.value.confirmUploads = (storeRef.value.confirmUploads || []).filter(
      (u) => u.fileName !== fileName && u.id !== key,
    )
  }

  function clearConfirmData() {
    pending.clearedAll = true
    storeRef.value.confirmLines = []
    storeRef.value.confirmUploads = []
  }

  function clearAll() {
    storeRef.value = createEmptyPowerPriceStore()
  }

  async function saveStore() {
    await persistPowerPriceStore()
  }

  return {
    store: storeRef,
    importPurchaseConfirm,
    removeConfirmUpload,
    clearConfirmData,
    clearAll,
    saveStore,
    markCostDirty: markPowerPriceCostDirty,
  }
}
