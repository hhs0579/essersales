import { parseAmount } from './parseAmount.js'
import {
  POWER_PRICE_UPLOAD_KIND,
  POWER_PRICE_SCOPE,
  POWER_PRICE_PLATFORM_FEE_RATE,
} from '../config/powerPrice.js'

/** @param {number} salesAmt */
export function calcPowerPricePlatformFee(salesAmt) {
  const sales = parseAmount(salesAmt)
  if (!sales) return 0
  return Math.round(sales * POWER_PRICE_PLATFORM_FEE_RATE)
}

/**
 * @param {import('../config/powerPrice.js').PowerPriceProduct[]} products
 * @param {import('../config/powerPrice.js').PowerPriceSaleEntry[]} sales
 */
export function buildPowerPriceDetailRows(products, sales) {
  /** @type {Map<string, import('../config/powerPrice.js').PowerPriceProduct>} */
  const productMap = new Map(
    (products || []).filter((p) => p?.id).map((p) => [p.id, p]),
  )
  const rows = []

  for (const entry of sales || []) {
    if (!entry?.date || !entry.productId) continue
    const product = productMap.get(entry.productId)
    if (!product?.name) continue

    const line = calcPowerPriceLine(product, entry.quantity, entry.optionPrice)

    rows.push({
      id: `pp-sale-${entry.id}`,
      uploadId: POWER_PRICE_UPLOAD_KIND,
      uploadKind: POWER_PRICE_UPLOAD_KIND,
      uploadFormat: 'power_price_manual',
      scope: POWER_PRICE_SCOPE,
      date: entry.date,
      platform: '스마트스토어',
      channel: '스마트스토어',
      salesMethod: '',
      brand: '파워프라이스',
      productName: product.name,
      sales: String(line.sales),
      salesQty: String(line.qty),
      salePrice: String(Math.round(line.salePrice)),
      optionPrice: line.optionPrice ? String(Math.round(line.optionPrice)) : '',
      unitCost: String(Math.round(line.unitCost)),
      totalCost: String(line.totalCost),
      channelFee: String(line.platformFee),
      netProfit: String(line.netProfit),
      marginRate: line.sales > 0 ? `${((line.netProfit / line.sales) * 100).toFixed(2)}%` : '',
      adSpend: '',
      adSales: '',
      sourceFileName: '파워프라이스 직접입력',
    })
  }

  return rows
}

/**
 * @param {import('../config/powerPrice.js').PowerPriceProduct} product
 * @param {number|string} qty
 * @param {number|string} [optionPrice=0]
 */
export function calcPowerPriceLine(product, qty = 1, optionPrice = 0) {
  const q = Math.max(1, parseAmount(qty) || 1)
  const salePrice = parseAmount(product?.salePrice)
  const opt = parseAmount(optionPrice)
  const unitCost = parseAmount(product?.unitCost)
  const unitSale = salePrice + opt
  const sales = Math.round(unitSale * q)
  const totalCost = Math.round(unitCost * q)
  const platformFee = calcPowerPricePlatformFee(sales)
  const netProfit = sales - totalCost - platformFee
  return {
    sales,
    totalCost,
    platformFee,
    netProfit,
    salePrice: unitSale,
    unitCost,
    optionPrice: opt,
    qty: q,
  }
}
