import { parseAmount } from './parseAmount.js'
import {
  POWER_PRICE_UPLOAD_KIND,
  POWER_PRICE_CONFIRM_UPLOAD_KIND,
  POWER_PRICE_SCOPE,
  POWER_PRICE_PLATFORM_FEE_RATE,
  powerPriceCostKey,
} from '../config/powerPrice.js'

/** @param {number} salesAmt */
export function calcPowerPricePlatformFee(salesAmt) {
  const sales = parseAmount(salesAmt)
  if (!sales) return 0
  return Math.round(sales * POWER_PRICE_PLATFORM_FEE_RATE)
}

/**
 * @param {import('../config/powerPrice.js').PowerPriceConfirmLine} line
 * @param {Map<string, import('../config/powerPrice.js').PowerPriceCostMasterEntry>} costMap
 */
export function calcPowerPriceConfirmLine(line, costMap) {
  const qty = Math.max(1, parseAmount(line?.quantity) || 1)
  const sales = Math.round(parseAmount(line?.orderAmount) || 0)
  const feeNpay = Math.abs(Math.round(parseAmount(line?.feeNpay) || 0))
  const feeSales = Math.abs(Math.round(parseAmount(line?.feeSales) || 0))
  const platformFee = feeNpay + feeSales
  const key = line?.costKey || powerPriceCostKey(line?.productId, line?.option)
  const unitCost = parseAmount(costMap?.get?.(key)?.unitCost)
  const totalCost = Math.round(unitCost * qty)
  const netProfit = sales - platformFee - totalCost
  return {
    sales,
    platformFee,
    unitCost,
    totalCost,
    netProfit,
    qty,
    costKey: key,
    missingCost: !unitCost,
  }
}

/**
 * @param {import('../config/powerPrice.js').PowerPriceProduct[]} products
 * @param {import('../config/powerPrice.js').PowerPriceSaleEntry[]} sales
 * @param {import('../config/powerPrice.js').PowerPriceConfirmLine[]} [confirmLines]
 * @param {import('../config/powerPrice.js').PowerPriceCostMasterEntry[]} [costMaster]
 */
export function buildPowerPriceDetailRows(
  products,
  sales,
  confirmLines = [],
  costMaster = [],
) {
  /** @type {Map<string, import('../config/powerPrice.js').PowerPriceProduct>} */
  const productMap = new Map(
    (products || []).filter((p) => p?.id).map((p) => [p.id, p]),
  )
  /** @type {Map<string, import('../config/powerPrice.js').PowerPriceCostMasterEntry>} */
  const costMap = new Map(
    (costMaster || []).filter((c) => c?.key).map((c) => [c.key, c]),
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

  for (const entry of confirmLines || []) {
    if (!entry?.date || !entry.productId) continue
    const calc = calcPowerPriceConfirmLine(entry, costMap)
    if (!calc.sales) continue
    const optionLabel = String(entry.option || '').trim()
    const productLabel = optionLabel
      ? `${entry.productName || entry.productId} / ${optionLabel}`
      : entry.productName || entry.productId

    rows.push({
      id: `pp-confirm-${entry.id || entry.productOrderId}`,
      uploadId: POWER_PRICE_CONFIRM_UPLOAD_KIND,
      uploadKind: POWER_PRICE_CONFIRM_UPLOAD_KIND,
      uploadFormat: 'power_price_confirm',
      scope: POWER_PRICE_SCOPE,
      date: entry.date,
      platform: '스마트스토어',
      channel: '스마트스토어',
      salesMethod: '',
      brand: '파워프라이스',
      productName: productLabel,
      productId: entry.productId,
      option: optionLabel,
      sales: String(calc.sales),
      salesQty: String(calc.qty),
      salePrice: '',
      optionPrice: '',
      unitCost: calc.unitCost ? String(Math.round(calc.unitCost)) : '',
      totalCost: String(calc.totalCost),
      channelFee: String(calc.platformFee),
      netProfit: String(calc.netProfit),
      marginRate: calc.sales > 0 ? `${((calc.netProfit / calc.sales) * 100).toFixed(2)}%` : '',
      adSpend: '',
      adSales: '',
      sourceFileName: entry.sourceFileName || '구매확정내역',
      settleAmount: entry.settleAmount || '',
      missingCost: calc.missingCost,
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
