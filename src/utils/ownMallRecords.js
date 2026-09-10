import { partitionOwnMallSales, rebuildExcelSalesFromSources } from './ownMallSalesImport.js'
import { parseAmount } from './parseAmount.js'
import { calcOwnMallCardFee } from '../config/ownMall.js'
import {
  OWN_MALL_MANUAL_UPLOAD_KIND,
  OWN_MALL_MANUAL_SCOPE,
  OWN_MALL_MANUAL_DATA_SOURCE,
  OWN_MALL_MANUAL_PLATFORM,
} from '../config/ownMallManual.js'

/**
 * sales 배열이 비어 있고 salesSourceFiles(base64)만 있을 때 KPI용 판매 행 복원
 * @param {import('../config/ownMallManual.js').OwnMallStore | null | undefined} store
 */
export async function resolveOwnMallStoreForKpi(store) {
  if (!store || typeof store !== 'object') return store
  const products = store.products || []
  const sales = store.sales || []
  const sources = (store.salesSourceFiles || []).filter((f) => f?.dataBase64)
  if (sales.length || !sources.length) return store

  const { manual } = partitionOwnMallSales(sales)
  const { excelSales } = await rebuildExcelSalesFromSources(products, sources)
  return { ...store, sales: [...manual, ...excelSales] }
}

export {
  parseOwnMallCatalogText,
  parseOwnMallCatalogExcelFile,
  formatOwnMallCatalogImportMessage,
  OWN_MALL_CATALOG_COL,
} from './ownMallCatalogParser.js'

export {
  parseOwnMallSalesExcelFile,
  formatOwnMallSalesImportMessage,
  OWN_MALL_SALES_COL,
} from './ownMallSalesParser.js'

/**
 * @param {import('../config/ownMallManual.js').OwnMallProduct} product
 * @param {number|string} qty
 * @param {number|string} [optionPrice=0]
 * @param {number|string} [lineTotal=0] 엑셀 X열 품목 실결제가
 */
export function calcOwnMallSaleLine(product, qty = 1, optionPrice = 0, lineTotal = 0) {
  const q = Math.max(1, parseAmount(qty) || 1)
  const salePrice = parseAmount(product?.salePrice)
  const opt = parseAmount(optionPrice)
  const unitCost = parseAmount(product?.unitCost)
  const line = parseAmount(lineTotal)

  let sales
  let unitSale
  if (line > 0) {
    sales = Math.round(line)
    unitSale = sales / q
  } else {
    unitSale = salePrice + opt
    sales = Math.round(unitSale * q)
  }

  const totalCost = Math.round(unitCost * q)
  const cardFee = calcOwnMallCardFee(sales)
  const netProfit = sales - totalCost - cardFee
  return {
    sales,
    totalCost,
    cardFee,
    netProfit,
    salePrice: unitSale,
    unitCost,
    optionPrice: line > 0 ? 0 : opt,
    qty: q,
    margin: sales - totalCost,
    fromLineTotal: line > 0,
  }
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 * @param {import('../config/ownMallManual.js').OwnMallSaleEntry[]} sales
 */
export function buildOwnMallManualDetailRows(products, sales) {
  const productMap = new Map(
    (products || []).filter((p) => p?.id).map((p) => [p.id, p]),
  )
  const rows = []

  for (const entry of sales || []) {
    if (!entry?.date || !entry.productId) continue
    const product = productMap.get(entry.productId)
    if (!product?.name) continue

    const line = calcOwnMallSaleLine(product, entry.quantity, entry.optionPrice, entry.lineTotal)

    rows.push({
      id: `ownmall-sale-${entry.id}`,
      isOwnMallManual: true,
      uploadId: OWN_MALL_MANUAL_UPLOAD_KIND,
      uploadKind: OWN_MALL_MANUAL_UPLOAD_KIND,
      uploadFormat: 'own_mall_manual',
      scope: OWN_MALL_MANUAL_SCOPE,
      dataSourceLabel: OWN_MALL_MANUAL_DATA_SOURCE,
      date: entry.date,
      platform: OWN_MALL_MANUAL_PLATFORM,
      channel: OWN_MALL_MANUAL_PLATFORM,
      salesMethod: OWN_MALL_MANUAL_PLATFORM,
      brand: OWN_MALL_MANUAL_DATA_SOURCE,
      storeName: OWN_MALL_MANUAL_DATA_SOURCE,
      productName: product.name,
      productCode: product.productCode || '',
      sales: String(line.sales),
      salesQty: String(line.qty),
      salePrice: String(Math.round(line.salePrice)),
      optionPrice: line.optionPrice ? String(Math.round(line.optionPrice)) : '',
      unitCost: String(Math.round(line.unitCost)),
      totalCost: String(line.totalCost),
      channelFee: String(line.cardFee),
      commission: String(line.cardFee),
      netProfit: String(line.netProfit),
      margin: String(line.netProfit),
      marginRate: line.sales > 0 ? `${((line.netProfit / line.sales) * 100).toFixed(2)}%` : '',
      adSpend: '',
      adSales: '',
      sourceFileName: '사본느리 자사몰 직접입력',
    })
  }

  return rows
}
