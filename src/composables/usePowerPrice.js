import { ref, computed } from 'vue'

import {

  createEmptyPowerPriceStore,

  createPowerPriceProduct,

  createPowerPriceSaleEntry,

  POWER_PRICE_SCOPE,

} from '../config/powerPrice.js'

import { buildPowerPriceDetailRows } from '../utils/powerPriceRecords.js'

import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'



const LEGACY_STORAGE_KEY = 'essersales_power_price_v1'

const SETTING_KIND = 'power_price'



/** @type {import('vue').Ref<{ products: import('../config/powerPrice.js').PowerPriceProduct[], sales: import('../config/powerPrice.js').PowerPriceSaleEntry[] }>} */

const storeRef = ref(createEmptyPowerPriceStore())

/** 대시보드·KPI — store 변경 시 자동 재계산 */
export const powerPriceDetailRecords = computed(() =>
  buildPowerPriceDetailRows(storeRef.value.products, storeRef.value.sales),
)

let hydrated = false



/** @param {unknown} raw */

function normalizeStore(raw) {

  const base = createEmptyPowerPriceStore()

  if (!raw || typeof raw !== 'object') return base

  const o = /** @type {Record<string, unknown>} */ (raw)

  const products = Array.isArray(o.products)

    ? o.products.map((item) => {

        if (!item || typeof item !== 'object') return createPowerPriceProduct()

        const p = /** @type {Record<string, unknown>} */ (item)

        return {

          id: typeof p.id === 'string' ? p.id : createPowerPriceProduct().id,

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

        if (!item || typeof item !== 'object') return createPowerPriceSaleEntry()

        const s = /** @type {Record<string, unknown>} */ (item)

        return {

          id: typeof s.id === 'string' ? s.id : createPowerPriceSaleEntry().id,

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

        }

      })

    : []

  return { products, sales }

}



function storeHasContent(store) {

  return (store?.products?.length || 0) > 0 || (store?.sales?.length || 0) > 0

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



export async function persistPowerPriceStore() {
  const res = await saveAppSetting(POWER_PRICE_SCOPE, SETTING_KIND, storeRef.value)
  if (res?.data) {
    storeRef.value = normalizeStore(res.data)
  }
  clearLegacyStore()
}



export async function hydratePowerPriceStore() {

  try {

    const res = await fetchAppSetting(POWER_PRICE_SCOPE, SETTING_KIND)

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



  function addProduct() {

    storeRef.value.products.push(createPowerPriceProduct())

  }



  /** @param {string} id */

  function removeProduct(id) {

    const i = storeRef.value.products.findIndex((p) => p.id === id)

    if (i < 0) return

    storeRef.value.products.splice(i, 1)

    storeRef.value.sales = storeRef.value.sales.filter((s) => s.productId !== id)

  }



  /** @param {string} [defaultDate] */

  function addSale(defaultDate = '') {

    storeRef.value.sales.push(createPowerPriceSaleEntry(defaultDate))

  }



  /** @param {string} id */

  function removeSale(id) {

    const i = storeRef.value.sales.findIndex((s) => s.id === id)

    if (i >= 0) storeRef.value.sales.splice(i, 1)

  }



  function clearAll() {

    storeRef.value.products.splice(0, storeRef.value.products.length)

    storeRef.value.sales.splice(0, storeRef.value.sales.length)

  }



  async function saveStore() {

    await persistPowerPriceStore()

  }



  return {

    store: storeRef,

    addProduct,

    removeProduct,

    addSale,

    removeSale,

    clearAll,

    saveStore,

  }

}


