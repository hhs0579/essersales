import { ref, computed } from 'vue'
import {
  createEmptyCoupang1pStore,
  createCoupang1pProduct,
  createCoupang1pOrderEntry,
  COUPANG_1P_ROCKET_SCOPE,
} from '../config/coupang1pRocket.js'
import { buildCoupang1pDetailRows } from '../utils/coupang1pRocketRecords.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'

const LEGACY_STORAGE_KEY = 'essersales_coupang_1p_rocket_v1'
const SETTING_KIND = 'coupang_1p_rocket'

/** @type {import('vue').Ref<{ products: import('../config/coupang1pRocket.js').Coupang1pProduct[], orders: import('../config/coupang1pRocket.js').Coupang1pOrderEntry[] }>} */
const storeRef = ref(createEmptyCoupang1pStore())

export const coupang1pRocketDetailRecords = computed(() =>
  buildCoupang1pDetailRows(storeRef.value.products, storeRef.value.orders),
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

function storeHasContent(store) {
  return (store?.products?.length || 0) > 0 || (store?.orders?.length || 0) > 0
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

export async function persistCoupang1pRocketStore() {
  const res = await saveAppSetting(COUPANG_1P_ROCKET_SCOPE, SETTING_KIND, storeRef.value)
  if (res?.data) {
    storeRef.value = normalizeStore(res.data)
  }
  clearLegacyStore()
}

export async function hydrateCoupang1pRocketStore() {
  try {
    const res = await fetchAppSetting(COUPANG_1P_ROCKET_SCOPE, SETTING_KIND)
    if (res?.data) {
      storeRef.value = normalizeStore(res.data)
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

export function getCoupang1pRocketDetailRecords() {
  if (!hydrated) {
    hydrateCoupang1pRocketStore().catch(() => {})
  }
  return coupang1pRocketDetailRecords.value
}

export { storeRef as coupang1pRocketStoreRef }

export function useCoupang1pRocket() {
  if (!hydrated) {
    hydrateCoupang1pRocketStore().catch(() => {})
  }

  function addProduct() {
    storeRef.value.products.push(createCoupang1pProduct())
  }

  /** @param {string} id */
  function removeProduct(id) {
    const i = storeRef.value.products.findIndex((p) => p.id === id)
    if (i < 0) return
    storeRef.value.products.splice(i, 1)
    storeRef.value.orders = storeRef.value.orders.filter((s) => s.productId !== id)
  }

  /** @param {string} [defaultDate] */
  function addOrder(defaultDate = '') {
    storeRef.value.orders.push(createCoupang1pOrderEntry(defaultDate))
  }

  /** @param {string} id */
  function removeOrder(id) {
    const i = storeRef.value.orders.findIndex((s) => s.id === id)
    if (i >= 0) storeRef.value.orders.splice(i, 1)
  }

  function clearAll() {
    storeRef.value.products.splice(0, storeRef.value.products.length)
    storeRef.value.orders.splice(0, storeRef.value.orders.length)
  }

  async function saveStore() {
    await persistCoupang1pRocketStore()
  }

  return {
    store: storeRef,
    addProduct,
    removeProduct,
    addOrder,
    removeOrder,
    clearAll,
    saveStore,
  }
}
