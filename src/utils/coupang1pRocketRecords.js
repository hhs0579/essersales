import { parseAmount } from './parseAmount.js'
import {
  COUPANG_1P_ROCKET_UPLOAD_KIND,
  COUPANG_1P_ROCKET_SCOPE,
  COUPANG_1P_SALES_METHOD,
  coupang1pProductDisplayName,
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
 */
export function buildCoupang1pDetailRows(products, orders) {
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
      id: `c1p-order-${entry.id}`,
      uploadId: COUPANG_1P_ROCKET_UPLOAD_KIND,
      uploadKind: COUPANG_1P_ROCKET_UPLOAD_KIND,
      uploadFormat: 'coupang_1p_rocket_manual',
      scope: COUPANG_1P_ROCKET_SCOPE,
      date: entry.date,
      platform: '쿠팡',
      channel: '쿠팡',
      salesMethod: COUPANG_1P_SALES_METHOD,
      brand: '베스트하임',
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
      sourceFileName: '쿠팡 1P 로켓 직접입력',
    })
  }

  return rows
}
