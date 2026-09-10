import { parseAmount } from './parseAmount.js'
import {
  COUPANG_1P_ROCKET_UPLOAD_KIND,
  COUPANG_1P_ROCKET_SCOPE,
  COUPANG_1P_SALES_METHOD,
  coupang1pProductDisplayName,
  getCoupang1pBrand,
  COUPANG_1P_ROCKET_BRANDS,
  createEmptyCoupang1pMultiStore,
} from '../config/coupang1pRocket.js'

/**
 * 쿠팡 1P — 우리가 공급, 쿠팡이 매입
 * 매출 = 쿠팡 매입금액(매입단가×수량), 원가 = 공급원가(공급가×수량)
 * @param {import('../config/coupang1pRocket.js').Coupang1pProduct} product
 * @param {number|string} qty
 */
export function calcCoupang1pLine(product, qty = 1) {
  const q = Math.max(1, parseAmount(qty) || 1)
  /** 쿠팡 매입단가 — 쿠팡이 우리에게 지급하는 단가 */
  const coupangPurchaseUnit = parseAmount(product?.purchasePrice)
  /** 우리 공급원가 단가 */
  const supplyCostUnit = parseAmount(product?.supplyPrice)
  const coupangPurchaseTotal = Math.round(coupangPurchaseUnit * q)
  const supplyCostTotal = Math.round(supplyCostUnit * q)
  const sales = coupangPurchaseTotal
  const totalCost = supplyCostTotal
  const netProfit = sales - totalCost
  return {
    qty: q,
    coupangPurchaseUnit,
    supplyCostUnit,
    coupangPurchaseTotal,
    supplyCostTotal,
    sales,
    totalCost,
    netProfit,
    marginRate: sales > 0 ? `${((netProfit / sales) * 100).toFixed(2)}%` : '',
  }
}

/**
 * @param {import('../config/coupang1pRocket.js').Coupang1pProduct[]} products
 * @param {import('../config/coupang1pRocket.js').Coupang1pOrderEntry[]} orders
 * @param {import('../config/coupang1pRocket.js').Coupang1pBrandDef | import('../config/coupang1pRocket.js').Coupang1pBrandKey} [brand]
 */
export function buildCoupang1pDetailRows(products, orders, brand = 'bestheim') {
  const brandDef = typeof brand === 'string' ? getCoupang1pBrand(brand) : brand
  const productMap = new Map(
    (products || []).filter((p) => p?.id).map((p) => [p.id, p]),
  )
  const rows = []

  for (const entry of orders || []) {
    if (!entry?.date || !entry.productId) continue
    const product = productMap.get(entry.productId)
    if (!product?.name?.trim()) continue

    const line = calcCoupang1pLine(product, entry.quantity)
    const displayName = coupang1pProductDisplayName(product)

    rows.push({
      id: `c1p-order-${brandDef.key}-${entry.id}`,
      uploadId: COUPANG_1P_ROCKET_UPLOAD_KIND,
      uploadKind: COUPANG_1P_ROCKET_UPLOAD_KIND,
      uploadFormat: 'coupang_1p_rocket_manual',
      scope: COUPANG_1P_ROCKET_SCOPE,
      coupang1pBrandKey: brandDef.key,
      date: entry.date,
      platform: '쿠팡',
      channel: '쿠팡',
      salesMethod: COUPANG_1P_SALES_METHOD,
      brand: brandDef.recordBrand,
      dataSourceLabel: brandDef.dataSourceLabel,
      productName: displayName,
      option: String(product.option || '').trim(),
      sales: String(line.sales),
      salesQty: String(line.qty),
      salePrice: String(Math.round(line.coupangPurchaseUnit)),
      unitCost: String(Math.round(line.supplyCostUnit)),
      totalCost: String(line.totalCost),
      channelFee: '0',
      netProfit: String(line.netProfit),
      marginRate: line.marginRate,
      adSpend: '',
      adSales: '',
      sourceFileName: `쿠팡 1P 로켓 (${brandDef.tabLabel}) 직접입력`,
    })
  }

  return rows
}

/**
 * 단일·멀티 스토어 → detail rows (레거시 flat은 베스트하임)
 * @param {object | null | undefined} store
 */
export function buildCoupang1pDetailRowsFromStore(store) {
  if (!store || typeof store !== 'object') return []

  if (
    Array.isArray(store.products) ||
    Array.isArray(store.orders) ||
    Array.isArray(store.sales)
  ) {
    return buildCoupang1pDetailRows(
      store.products || [],
      store.orders || store.sales || [],
      'bestheim',
    )
  }

  const multi = store.brands && typeof store.brands === 'object' ? store.brands : store
  const rows = []
  for (const brandDef of COUPANG_1P_ROCKET_BRANDS) {
    const branch = multi[brandDef.key]
    if (!branch) continue
    rows.push(
      ...buildCoupang1pDetailRows(
        branch.products || [],
        branch.orders || branch.sales || [],
        brandDef,
      ),
    )
  }
  return rows
}

/** @param {object | null | undefined} raw @returns {Record<string, { products: unknown[], orders: unknown[] }>} */
export function normalizeCoupang1pMultiStore(raw) {
  const empty = createEmptyCoupang1pMultiStore()
  if (!raw || typeof raw !== 'object') return empty

  const o = /** @type {Record<string, unknown>} */ (raw)
  if (Array.isArray(o.products) || Array.isArray(o.orders) || Array.isArray(o.sales)) {
    empty.bestheim = {
      products: o.products || [],
      orders: o.orders || o.sales || [],
    }
    return empty
  }

  const brands =
    o.brands && typeof o.brands === 'object'
      ? /** @type {Record<string, unknown>} */ (o.brands)
      : o

  for (const brandDef of COUPANG_1P_ROCKET_BRANDS) {
    const branch = brands[brandDef.key]
    if (!branch || typeof branch !== 'object') continue
    const b = /** @type {Record<string, unknown>} */ (branch)
    empty[brandDef.key] = {
      products: Array.isArray(b.products) ? b.products : [],
      orders: Array.isArray(b.orders) ? b.orders : Array.isArray(b.sales) ? b.sales : [],
    }
  }
  return empty
}
