import { parseAmount } from './salesAggregation.js'
import { esserRowValues, resolveRowAdSpend } from './esserMetrics.js'
import { extractDeliveryFromRawRow, getSalesMethod } from './salesMethodDetect.js'
import { resolveRecordPlatform } from './platformDetect.js'
import { isOwnMallRecord, resolveOwnMallChannelFee } from '../config/ownMall.js'
/** 천 단위 콤마 표시 대상 */
export const AMOUNT_KEYS = new Set([
  'actualPayment',
  'sales',
  'salesQty',
  'grossSales',
  'netProfit',
  'salePrice',
  'shippingFee',
  'settlementPrice',
  'unitCost',
  'totalCost',
  'margin',
  'revenue',
  'quantity',
  'saleAmount',
  'discountAmount',
  'commission',
  'settlementAmount',
  'adSpend',
  'adSales',
  'adQty',
  'organicQty',
  'adProfit',
  'adNetProfit',
  'organicSales',
])

export const PERCENT_KEYS = new Set([
  'marginRate',
  'channelFee',
  'adSpendRate',
  'adSalesRate',
  'adQtyRate',
  'organicQtyRate',
  'adConversionRate',
  'adNetProfitRate',
  'adRoas',
  'roas',
  'salesRoas',
])

export function isNumericColumn(key) {
  return AMOUNT_KEYS.has(key) || PERCENT_KEYS.has(key)
}

/** 표시용 원시값 (필드 별칭·파일명 판매방식) */
export function resolveDetailField(row, key) {
  if (!row) return ''
  switch (key) {
    case 'sales':
      return row.sales ?? row.actualPayment ?? row.revenue ?? ''
    case 'salesQty':
      return row.salesQty ?? row.quantity ?? ''
    case 'netProfit': {
      const n = esserRowValues(row).netProfit
      if (n) return String(Math.round(n))
      return row.netProfit ?? row.margin ?? ''
    }
    case 'salesMethod':
      return row.salesMethod || getSalesMethod(row) || ''
    case 'platform': {
      const p = row.platform ?? row.channel ?? ''
      return p === '네이버' ? '스마트스토어' : p
    }
    case 'dataSourceLabel':
      return row.dataSourceLabel || ''
    case 'brand': {
      // 상세 표는 원문 유지 (에쎄르→사본느리 등 집계용 정규화 금지)
      return String(row.brand || row.storeName || '').trim()
    }
    case 'option':
      return row.option || row.optionName || ''
    case 'unitCost':
      return row.unitCost || row.cost_price || ''
    case 'totalCost': {
      const direct = row.totalCost ?? row.sales_cost ?? ''
      if (direct !== '' && direct != null) return direct
      const u = parseAmount(row.unitCost || row.cost_price)
      const q = parseAmount(row.salesQty ?? row.quantity)
      if (u && q) return String(Math.round(u * q))
      return ''
    }
    case 'revenue':
      return row.revenue ?? row.sales ?? row.actualPayment ?? ''
    case 'margin': {
      const n = esserRowValues(row).netProfit
      if (n) return String(Math.round(n))
      return row.margin ?? row.netProfit ?? ''
    }
    case 'quantity':
      return row.quantity ?? row.salesQty ?? ''
    case 'channel':
      return row.channel || row.platform || ''
    case 'grossSales':
      return row.grossSales ?? row.gross_sales ?? ''
    case 'salePrice':
      return row.salePrice ?? row.sale_price ?? ''
    case 'storeName': {
      // 상세 표·필드 정규화는 원문 스토어명 (집계용 normalizeStoreLabel 미적용)
      return String(row.storeName ?? row.store_name ?? row.brand ?? '').trim()
    }
    case 'channelFee':
    case 'commission': {
      if (isOwnMallRecord(row)) {
        const sales = parseAmount(row.sales ?? row.actualPayment ?? row.revenue)
        const fee = resolveOwnMallChannelFee(row, sales)
        if (fee) return String(fee)
      }
      return row.channelFee ?? row.commission ?? ''
    }
    case 'productName':
      return row.productName ?? row.product_name ?? ''
    case 'productId':
      return row.productId ?? row.product_id ?? ''
    case 'optionId':
      return row.optionId ?? row.option_id ?? ''
    case 'productCode':
      return row.productCode ?? row.product_code ?? ''
    case 'marginRate':
      return row.marginRate ?? row.net_profit_rate ?? ''
    case 'sourceFileName':
      return row.sourceFileName ?? row.source_file_name ?? row.fileName ?? ''
    case 'adQty':
      return row.adQty ?? row.ad_qty ?? ''
    case 'adSpend': {
      const n = resolveRowAdSpend(row)
      return n ? String(n) : row.adSpend ?? row.ad_spend ?? ''
    }
    case 'adSales':
      return row.adSales ?? row.ad_sales ?? ''
    default:
      return row[key] ?? ''
  }
}

/** actualPayment·quantity 등 구 저장 형식 → esser 필드 (클라이언트 캐시용) */
export function normalizeEsserDetailFields(row) {
  if (!row) return row
  const sales = resolveDetailField(row, 'sales')
  const salesQty = resolveDetailField(row, 'salesQty')
  const netProfit = resolveDetailField(row, 'netProfit')
  const grossSales = resolveDetailField(row, 'grossSales')
  const salePrice = resolveDetailField(row, 'salePrice')
  const unitCost = resolveDetailField(row, 'unitCost')
  const totalCost = resolveDetailField(row, 'totalCost')
  const storeName = resolveDetailField(row, 'storeName')
  const productName = resolveDetailField(row, 'productName')
  const platform = resolveRecordPlatform(row)
  const delivery =
    row.deliveryMethod ||
    row.delivery_method ||
    row['배송구분'] ||
    extractDeliveryFromRawRow(row) ||
    ''
  const salesMethod = getSalesMethod({ ...row, platform, deliveryMethod: delivery })
  const cleaned = { ...row }
  delete cleaned.channelKind
  delete cleaned.channel_kind
  delete cleaned['채널종류']
  delete cleaned.importUnitCost
  delete cleaned.import_unit_cost
  return {
    ...cleaned,
    sales,
    salesQty,
    netProfit,
    grossSales,
    salePrice,
    unitCost,
    totalCost,
    storeName,
    productName,
    platform,
    channel: platform,
    deliveryMethod: delivery,
    salesMethod,
  }
}

/** 숫자 → 1,234,567 (소수 없음) */
export function formatNumber(n, decimals = 0) {
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })
}

/** 표·미리보기 셀 표시용 */
export function formatCellValue(key, value, row = null) {
  const raw = row ? resolveDetailField(row, key) : value
  if (raw == null || raw === '') return ''

  const s = String(raw).trim()

  if (PERCENT_KEYS.has(key)) {
    if (s.includes('%')) return s
    const n = parseAmount(s)
    if (Number.isFinite(n) && /[\d]/.test(s)) return `${formatNumber(n, n % 1 ? 2 : 0)}%`
    return s
  }

  if (AMOUNT_KEYS.has(key)) {
    const n = parseAmount(s)
    if (!Number.isFinite(n)) return s
    if (n === 0 && !/^0/.test(s) && s !== '0') return s
    const decimals = key === 'salesQty' || key === 'adQty' || key === 'organicQty' ? 0 : 0
    return formatNumber(n, decimals)
  }

  return s
}
