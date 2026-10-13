/**
 * 스마트스토어 「구매확정내역」 → 파워프라이스 매출 행
 * 매출: 최종 상품별 총 주문금액 / 수수료: 네이버페이+매출연동 / 정산: 정산예정금액
 */
import { loadXlsx } from './lazyXlsx.js'
import { parseAmount } from './parseAmount.js'
import { parseSalesDate, excelDateToYmd } from './dateParse.js'
import { formatYmd } from './recordFilters.js'
import { powerPriceCostKey } from '../config/powerPrice.js'

function cellStr(v) {
  if (v == null) return ''
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return excelDateToYmd(v)
  }
  return String(v).trim()
}

function headerNorm(cell) {
  return cellStr(cell).replace(/\s+/g, '').toLowerCase()
}

function excelSerialToYmd(n) {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return ''
  const utc = new Date(Math.round((n - 25569) * 86400 * 1000))
  if (Number.isNaN(utc.getTime())) return ''
  return formatYmd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

function parseYmd(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return excelDateToYmd(v)
  }
  if (typeof v === 'number') {
    const fromSerial = excelSerialToYmd(v)
    if (fromSerial) return fromSerial
  }
  const s = cellStr(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dotted = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/)
  if (dotted) {
    return formatYmd(Number(dotted[1]), Number(dotted[2]), Number(dotted[3]))
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const fromSerial = excelSerialToYmd(Number(s))
    if (fromSerial) return fromSerial
  }
  const parsed = parseSalesDate(v)
  if (!parsed) return ''
  return formatYmd(parsed.year, parsed.month, parsed.day)
}

/**
 * @param {string[]} headers
 * @returns {Record<string, number>}
 */
export function mapPurchaseConfirmHeaders(headers) {
  const norms = (headers || []).map((h) => headerNorm(h))
  /** @type {Record<string, number>} */
  const idx = {}
  const find = (pred) => {
    for (let i = 0; i < norms.length; i += 1) {
      if (pred(norms[i])) return i
    }
    return -1
  }
  idx.productOrderId = find((h) => h === '상품주문번호' || h.includes('상품주문번호'))
  idx.orderId = find((h) => h === '주문번호' && !h.includes('상품'))
  idx.confirmDate = find((h) => h.includes('구매확정일'))
  idx.orderStatus = find((h) => h === '주문상태' || h.includes('주문상태'))
  idx.productId = find((h) => h === '상품번호' || h.includes('상품번호'))
  idx.productName = find((h) => h === '상품명' || (h.includes('상품명') && !h.includes('옵션')))
  idx.option = find((h) => h === '옵션정보' || h.includes('옵션정보'))
  idx.qty = find((h) => h === '수량' || h === '주문수량')
  idx.orderAmount = find(
    (h) => h.includes('최종상품별총주문금액') || h.includes('최종상품별총주문'),
  )
  if (idx.orderAmount < 0) {
    idx.orderAmount = find((h) => h.includes('상품별총주문금액'))
  }
  idx.feeNpay = find((h) => h.includes('네이버페이') && h.includes('수수료'))
  idx.feeSales = find((h) => h.includes('매출연동') && h.includes('수수료'))
  idx.settleAmount = find((h) => h.includes('정산예정금액') || h === '정산예정금액')
  return idx
}

/**
 * @param {string[]} headers
 */
export function isPurchaseConfirmFormat(headers = []) {
  const idx = mapPurchaseConfirmHeaders(headers)
  return (
    idx.productOrderId >= 0 &&
    idx.productId >= 0 &&
    idx.confirmDate >= 0 &&
    (idx.orderAmount >= 0 || idx.settleAmount >= 0)
  )
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} [fileName]
 */
export async function parsePurchaseConfirmExcel(buffer, fileName = '') {
  const XLSX = await loadXlsx()
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('시트를 찾을 수 없습니다.')
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
  if (!aoa.length) throw new Error('빈 엑셀입니다.')

  const headerRow = aoa[0].map((c) => cellStr(c))
  if (!isPurchaseConfirmFormat(headerRow)) {
    throw new Error(
      '스마트스토어 「구매확정내역」 형식이 아닙니다. (상품주문번호·상품번호·구매확정일·주문금액 열 필요)',
    )
  }
  const idx = mapPurchaseConfirmHeaders(headerRow)
  const sourceFileName = String(fileName || '구매확정내역').trim() || '구매확정내역'

  /** @type {import('../config/powerPrice.js').PowerPriceConfirmLine[]} */
  const lines = []
  let skipped = 0

  for (let r = 1; r < aoa.length; r += 1) {
    const row = aoa[r] || []
    const productOrderId = cellStr(row[idx.productOrderId])
    if (!productOrderId) {
      skipped += 1
      continue
    }
    const status = idx.orderStatus >= 0 ? cellStr(row[idx.orderStatus]) : ''
    if (status && !/구매확정/.test(status) && /취소|환불|반품/.test(status)) {
      skipped += 1
      continue
    }

    const productId = cellStr(row[idx.productId])
    const productName = cellStr(row[idx.productName])
    const option = idx.option >= 0 ? cellStr(row[idx.option]) : ''
    const date = parseYmd(row[idx.confirmDate])
    const qty = Math.max(1, Math.round(parseAmount(row[idx.qty]) || 1))
    const orderAmount = Math.round(
      idx.orderAmount >= 0 ? parseAmount(row[idx.orderAmount]) || 0 : 0,
    )
    const feeNpay = Math.round(idx.feeNpay >= 0 ? parseAmount(row[idx.feeNpay]) || 0 : 0)
    const feeSales = Math.round(idx.feeSales >= 0 ? parseAmount(row[idx.feeSales]) || 0 : 0)
    const settleAmount = Math.round(
      idx.settleAmount >= 0 ? parseAmount(row[idx.settleAmount]) || 0 : 0,
    )
    const salesAmt = orderAmount || settleAmount
    if (!date || !productId || !salesAmt) {
      skipped += 1
      continue
    }

    lines.push({
      id: productOrderId,
      productOrderId,
      orderId: idx.orderId >= 0 ? cellStr(row[idx.orderId]) : '',
      date,
      productId,
      productName,
      option,
      quantity: String(qty),
      orderAmount: String(salesAmt),
      feeNpay: String(feeNpay),
      feeSales: String(feeSales),
      settleAmount: String(settleAmount || salesAmt + feeNpay + feeSales),
      costKey: powerPriceCostKey(productId, option),
      sourceFileName,
    })
  }

  if (!lines.length) {
    throw new Error('가져올 구매확정 행이 없습니다. (취소·빈 행만 있거나 금액이 없습니다)')
  }

  return {
    lines,
    skipped,
    sourceFileName,
    uniqueCostKeys: [...new Set(lines.map((l) => l.costKey))],
  }
}
