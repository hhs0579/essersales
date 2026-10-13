import * as XLSX from 'xlsx'
import {
  CLOSED_MALL_ALL_HEADERS,
  isClosedMallRecord,
} from '../config/closedMall.js'

/** 재업로드용 — 필수 a* + 옵션 + 정산가·a마진(행합계 원가 모드) */
export const CLOSED_MALL_REUPLOAD_HEADERS = [...CLOSED_MALL_ALL_HEADERS, '정산가', 'a마진']

function numOrEmpty(v) {
  if (v == null || v === '') return ''
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : ''
}

/**
 * DB 상세 행 → 기타 판매처 재업로드 a* 행
 * a마진·정산가를 넣어 a원가 = 행 합계로 파싱되게 함 (×수량 이중 계산 방지)
 * @param {object} row
 */
export function detailToClosedMallReuploadRow(row) {
  const qty = numOrEmpty(row.salesQty ?? row.quantity)
  const totalCost = numOrEmpty(row.totalCost)
  const unitCost = numOrEmpty(row.unitCost)
  let aCost = totalCost
  if (aCost === '' && unitCost !== '' && qty !== '' && qty > 0) {
    aCost = Math.round(unitCost * qty)
  } else if (aCost === '') {
    aCost = unitCost
  }
  const margin = numOrEmpty(row.netProfit ?? row.margin)
  const settlement = numOrEmpty(row.settlementPrice)

  return {
    a날짜: String(row.date || row.order_date || row.saleDate || '').trim(),
    a판매처: String(row.storeName || row.closedMallSeller || row.store_name || '').trim(),
    a상품명: String(row.productName || '').trim(),
    a옵션: String(row.option || row.optionName || '').trim(),
    a브랜드: String(row.productBrand || row.brand || '').trim(),
    a수량: qty === '' ? '' : qty,
    a결제가: numOrEmpty(row.sales ?? row.actualPayment),
    a배송비: numOrEmpty(row.shippingFee) === '' ? 0 : numOrEmpty(row.shippingFee),
    a수수료: numOrEmpty(row.commission ?? row.channelFee) === ''
      ? 0
      : numOrEmpty(row.commission ?? row.channelFee),
    a원가: aCost === '' ? 0 : aCost,
    정산가: settlement === '' ? '' : settlement,
    a마진: margin === '' ? '' : margin,
  }
}

/**
 * @param {object[]} details
 * @returns {unknown[][]}
 */
export function buildClosedMallReuploadAoa(details) {
  const rows = (details || []).filter(isClosedMallRecord)
  const aoa = [CLOSED_MALL_REUPLOAD_HEADERS]
  for (const row of rows) {
    const mapped = detailToClosedMallReuploadRow(row)
    aoa.push(CLOSED_MALL_REUPLOAD_HEADERS.map((h) => mapped[h] ?? ''))
  }
  return aoa
}

/**
 * @param {object[]} details
 * @param {string} [fileName]
 */
export function downloadClosedMallReuploadExcel(details, fileName = '기타판매처_재업로드.xlsx') {
  const aoa = buildClosedMallReuploadAoa(details)
  if (aoa.length <= 1) {
    throw new Error('기타 판매처(폐쇄몰) 상세 데이터가 없습니다.')
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '폐쇄몰')
  XLSX.writeFile(wb, fileName)
}

/** @param {object[]} details */
export function detailsAreClosedMall(details) {
  const list = details || []
  if (!list.length) return false
  return list.every(isClosedMallRecord)
}
