import { ref, computed, unref, isRef } from 'vue'
import {
  createEmptyCoupang1pStore,
  createEmptyCoupang1pPersistPayload,
  createCoupang1pProduct,
  createCoupang1pOrderEntry,
  COUPANG_1P_ROCKET_SCOPE,
  COUPANG_1P_ROCKET_SETTING_KIND,
  COUPANG_1P_ROCKET_BRANDS,
  getCoupang1pBrand,
} from '../config/coupang1pRocket.js'
import {
  buildCoupang1pDetailRows,
  buildCoupang1pDetailRowsFromStore,
  normalizeCoupang1pMultiStore,
} from '../utils/coupang1pRocketRecords.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'

const LEGACY_STORAGE_KEY = 'essersales_coupang_1p_rocket_v1'

/** @type {import('vue').Ref<Record<string, { products: import('../config/coupang1pRocket.js').Coupang1pProduct[], orders: import('../config/coupang1pRocket.js').Coupang1pOrderEntry[] }>>} */
const storesRef = ref(normalizeCoupang1pMultiStore(null))

export const coupang1pRocketDetailRecords = computed(() =>
  buildCoupang1pDetailRowsFromStore({ brands: storesRef.value }),
)

let hydrated = false

/** @param {unknown} raw */
function normalizeStore(raw) {
  const base = createEmptyCoupang1pStore()
  if (!raw || typeof raw !== 'object') return base
  const o = /** @type {Record<string, unknown>} */ (raw)

  const products = Array.isArray(o.products)
    ? o.products.map((item) => {
        if (!item || typeof item !== 'object') return createCoupang1pProduct()
        const p = /** @type {Record<string, unknown>} */ (item)
        return {
          id: typeof p.id === 'string' ? p.id : createCoupang1pProduct().id,
          name: typeof p.name === 'string' ? p.name : '',
          option: typeof p.option === 'string' ? p.option : '',
          purchasePrice:
            typeof p.purchasePrice === 'string' || typeof p.purchasePrice === 'number'
              ? String(p.purchasePrice)
              : typeof p.unitCost === 'string' || typeof p.unitCost === 'number'
                ? String(p.unitCost)
                : '',
          supplyPrice:
            typeof p.supplyPrice === 'string' || typeof p.supplyPrice === 'number'
              ? String(p.supplyPrice)
              : typeof p.salePrice === 'string' || typeof p.salePrice === 'number'
                ? String(p.salePrice)
                : '',
        }
      })
    : []

  const orders = Array.isArray(o.orders)
    ? o.orders.map((item) => {
        if (!item || typeof item !== 'object') return createCoupang1pOrderEntry()
        const s = /** @type {Record<string, unknown>} */ (item)
        return {
          id: typeof s.id === 'string' ? s.id : createCoupang1pOrderEntry().id,
          date: typeof s.date === 'string' ? s.date : '',
          productId: typeof s.productId === 'string' ? s.productId : '',
          quantity:
            typeof s.quantity === 'string' || typeof s.quantity === 'number'
              ? String(s.quantity)
              : '1',
        }
      })
    : Array.isArray(o.sales)
      ? o.sales.map((item) => {
          if (!item || typeof item !== 'object') return createCoupang1pOrderEntry()
          const s = /** @type {Record<string, unknown>} */ (item)
          return {
            id: typeof s.id === 'string' ? s.id : createCoupang1pOrderEntry().id,
            date: typeof s.date === 'string' ? s.date : '',
            productId: typeof s.productId === 'string' ? s.productId : '',
            quantity:
              typeof s.quantity === 'string' || typeof s.quantity === 'number'
                ? String(s.quantity)
                : '1',
          }
        })
      : []

  return { products, orders }
}

function normalizeMultiStore(raw) {
  const partial = normalizeCoupang1pMultiStore(raw)
  const out = {}
  for (const brandDef of COUPANG_1P_ROCKET_BRANDS) {
    out[brandDef.key] = normalizeStore(partial[brandDef.key])
  }
  return out
}

function multiStoreHasContent(stores) {
  for (const brandDef of COUPANG_1P_ROCKET_BRANDS) {
    const store = stores?.[brandDef.key]
    if ((store?.products?.length || 0) > 0 || (store?.orders?.length || 0) > 0) return true
  }
  return false
}

function persistPayloadFromStores(stores) {
  const brands = {}
  for (const brandDef of COUPANG_1P_ROCKET_BRANDS) {
    brands[brandDef.key] = stores[brandDef.key] || createEmptyCoupang1pStore()
  }
  return { brands }
}

function loadLegacyStore() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const store = normalizeMultiStore(JSON.parse(raw))
    return multiStoreHasContent(store) ? store : null
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

export async function persistCoupang1pRocketStore() {
  const payload = persistPayloadFromStores(storesRef.value)
  const res = await saveAppSetting(COUPANG_1P_ROCKET_SCOPE, COUPANG_1P_ROCKET_SETTING_KIND, payload)
  if (res?.data) {
    storesRef.value = normalizeMultiStore(res.data)
  }
  clearLegacyStore()
}

/** @param {{ forceRefresh?: boolean }} [opts] */
export async function hydrateCoupang1pRocketStore(opts = {}) {
  if (!opts.forceRefresh && hydrated) return storesRef.value

  try {
    const res = await fetchAppSetting(COUPANG_1P_ROCKET_SCOPE, COUPANG_1P_ROCKET_SETTING_KIND)
    if (res?.data) {
      storesRef.value = normalizeMultiStore(res.data)
      hydrated = true
      return storesRef.value
    }
  } catch {
    /* 서버 미연결 */
  }

  const legacy = loadLegacyStore()
  if (legacy) {
    storesRef.value = legacy
  }
  hydrated = true
  return storesRef.value
}

export function getCoupang1pRocketDetailRecords() {
  if (!hydrated) {
    hydrateCoupang1pRocketStore().catch(() => {})
  }
  return coupang1pRocketDetailRecords.value
}

export { storesRef as coupang1pRocketStoresRef }

/**
 * @param {import('vue').MaybeRefOrGetter<import('../config/coupang1pRocket.js').Coupang1pBrandKey|string>} [brandKey]
 */
export function useCoupang1pRocket(brandKey = 'bestheim') {
  const brandKeyRef = computed(() => {
    const k = isRef(brandKey) ? brandKey.value : unref(brandKey)
    return k === 'esser' ? 'esser' : 'bestheim'
  })
  const brand = computed(() => getCoupang1pBrand(brandKeyRef.value))

  if (!hydrated) {
    hydrateCoupang1pRocketStore().catch(() => {})
  }

  const store = computed(() => {
    const key = brandKeyRef.value
    return storesRef.value[key] || createEmptyCoupang1pStore()
  })

  function addProduct() {
    store.value.products.push(createCoupang1pProduct())
  }

  /** @param {string} id */
  function removeProduct(id) {
    const i = store.value.products.findIndex((p) => p.id === id)
    if (i < 0) return
    store.value.products.splice(i, 1)
    store.value.orders = store.value.orders.filter((s) => s.productId !== id)
  }

  /** @param {string} [defaultDate] */
  function addOrder(defaultDate = '') {
    store.value.orders.push(createCoupang1pOrderEntry(defaultDate))
  }

  /** @param {string} id */
  function removeOrder(id) {
    const i = store.value.orders.findIndex((s) => s.id === id)
    if (i >= 0) store.value.orders.splice(i, 1)
  }

  function clearAll() {
    store.value.products.splice(0, store.value.products.length)
    store.value.orders.splice(0, store.value.orders.length)
  }

  async function saveStore() {
    await persistCoupang1pRocketStore()
  }

  return {
    brand,
    brandKey: brandKeyRef,
    store,
    addProduct,
    removeProduct,
    addOrder,
    removeOrder,
    clearAll,
    saveStore,
  }
}
