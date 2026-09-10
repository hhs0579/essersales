/**
 * 특판 폐쇄몰 엑셀 파서 (에쎄르 / 베스트하임 · 프론트·백엔드 공통)
 */

import { loadXlsx } from './lazyXlsx.js'
import { parseSalesDate } from './dateParse.js'
import { parseAmount } from './parseAmount.js'
import { cleanHeaderText } from './platformDetect.js'
import {
  CLOSED_MALL_REQUIRED_HEADERS,
  CLOSED_MALL_OPTIONAL_HEADERS,
  CLOSED_MALL_PLATFORM,
  CLOSED_MALL_SALES_METHOD,
  CLOSED_MALL_BUSINESS_LINE,
  getClosedMallBrand,
  isClosedMallSummaryLabel,
  closedMallDuplicateFingerprint,
} from '../config/closedMall.js'

function cellStr(v) {
  if (v == null) return ''
  return cleanHeaderText(v)
}

function toYmd(parsed) {
  if (!parsed) return ''
  const m = String(parsed.month).padStart(2, '0')
  const d = String(parsed.day).padStart(2, '0')
  return `${parsed.year}-${m}-${d}`
}

/** 빈값 구분 — 필수 숫자 컬럼용 */
function parseRequiredNumber(val) {
  if (val == null || String(val).trim() === '') return { ok: false, value: null }
  const n = parseAmount(val)
  if (!Number.isFinite(n)) return { ok: false, value: null }
  // parseAmount는 빈/대시를 0으로 주므로, 원문이 숫자로 해석 가능한지 재확인
  const raw = String(val)
    .trim()
    .replace(/[원₩￦$]|won|krw|원화/gi, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
  if (!raw || raw === '-' || raw === '–') return { ok: false, value: null }
  return { ok: true, value: n }
}

function parseOptionalAmount(val) {
  if (val == null || String(val).trim() === '') return 0
  return parseAmount(val)
}

/** a마진·정산가 — 0·음수 허용 */
function parseOptionalSignedNumber(val) {
  if (val == null || String(val).trim() === '') return { ok: false, value: null }
  const raw = String(val)
    .trim()
    .replace(/,/g, '')
  if (!raw || raw === '-' || raw === '–') return { ok: false, value: null }
  const n = parseAmount(val)
  if (!Number.isFinite(n)) return { ok: false, value: null }
  return { ok: true, value: n }
}

/**
 * 마진·원가 — 엑셀 양식별 분기
 * 1) a마진 열 → 그 값 사용, a원가 = 행 합계 원가
 * 2) 정산가 열 → 정산가 − 배송비 − a원가(행 합계), a원가×수량 안 함
 * 3) 레거시(GSSHOP 등) → a원가 = 개당, 마진 = 결제가 − 배송 − 수수료 − 원가×수량
 */
function resolveClosedMallMargin({
  payment,
  qty,
  shippingFee,
  commission,
  costValue,
  settlementRaw,
  marginRaw,
}) {
  const marginParsed = parseOptionalSignedNumber(marginRaw)
  if (marginParsed.ok) {
    const settlementParsed = parseOptionalSignedNumber(settlementRaw)
    const settlementPrice = settlementParsed.ok ? settlementParsed.value : payment - commission
    return {
      netProfit: Math.round(marginParsed.value),
      totalCost: Math.round(costValue),
      unitCost: qty > 0 ? costValue / qty : costValue,
      settlementPrice: Math.round(settlementPrice),
    }
  }

  const settlementParsed = parseOptionalSignedNumber(settlementRaw)
  if (settlementParsed.ok) {
    return {
      netProfit: Math.round(settlementParsed.value - shippingFee - costValue),
      totalCost: Math.round(costValue),
      unitCost: qty > 0 ? costValue / qty : costValue,
      settlementPrice: Math.round(settlementParsed.value),
    }
  }

  const totalCost = costValue * qty
  return {
    netProfit: Math.round(payment - shippingFee - commission - totalCost),
    totalCost: Math.round(totalCost),
    unitCost: costValue,
    settlementPrice: Math.round(payment - commission),
  }
}

/**
 * a수수료 — 금액 또는 비율
 * - `25%` / `25.0%` → 결제가 × 25%
 * - 엑셀 퍼센트 셀(숫자 0.25) → 결제가 × 25%  (raw:true 시 % 문자 없이 0.25로 옴)
 * - `12500` 등 1 초과 숫자 → 수수료 금액
 */
function parseOptionalCommission(val, payment) {
  if (val == null || String(val).trim() === '') return 0
  const pay = Number(payment) || 0

  // 엑셀 퍼센트 서식: 셀 값이 0.25 숫자로 들어옴
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val > 0 && val <= 1) return Math.round(pay * val)
    return Math.round(Math.abs(val))
  }

  const raw = String(val).trim()
  if (raw.includes('%')) {
    const rate = parseAmount(raw.replace(/%/g, ''))
    if (!Number.isFinite(rate) || rate < 0) return 0
    // `25%` → 25, `0.25%` → 0.25 (초소 비율도 허용)
    return Math.round((pay * rate) / 100)
  }

  const n = parseAmount(raw)
  if (!Number.isFinite(n) || n === 0) return 0
  // 문자열 "0.25"도 엑셀 퍼센트와 동일하게 비율로 처리
  if (n > 0 && n <= 1) return Math.round(pay * n)
  return Math.round(Math.abs(n))
}

/**
 * @param {string[]} headerRow
 * @returns {Record<string, number>|null}
 */
function mapRequiredHeaderIndexes(headerRow) {
  const normToIdx = new Map()
  headerRow.forEach((h, i) => {
    const key = cellStr(h).replace(/\s+/g, '')
    if (key && !normToIdx.has(key)) normToIdx.set(key, i)
  })
  const col = {}
  for (const name of CLOSED_MALL_REQUIRED_HEADERS) {
    const key = name.replace(/\s+/g, '')
    if (!normToIdx.has(key)) return null
    col[name] = normToIdx.get(key)
  }
  for (const name of CLOSED_MALL_OPTIONAL_HEADERS) {
    const key = name.replace(/\s+/g, '')
    if (normToIdx.has(key)) col[name] = normToIdx.get(key)
  }
  return col
}

/**
 * @param {unknown[][]} aoa
 */
function findHeader(aoa) {
  for (let i = 0; i < Math.min(40, aoa.length); i++) {
    const row = (aoa[i] || []).map(cellStr)
    const col = mapRequiredHeaderIndexes(row)
    if (col) return { headerRowIndex: i, col }
  }
  return null
}

/**
 * @param {unknown[]} row
 * @param {Record<string, number>} col
 */
function cellAt(row, col, name) {
  const idx = col[name]
  if (idx == null) return ''
  return row[idx]
}

/** a마진 · 마진 — 둘 중 있는 쪽 */
function marginCellAt(row, col) {
  const v = cellAt(row, col, 'a마진')
  if (v !== '' && v != null) return v
  return cellAt(row, col, '마진')
}

/**
 * @param {object} p
 * @param {Set<string>} [_existingFingerprints] 미사용(중복 제외 안 함)
 */
export function parseClosedMallDataRow(p, _existingFingerprints = new Set()) {
  const excelRowNumber = p.excelRowNumber
  const dateRaw = p.dateRaw
  const sellerRaw = p.sellerRaw
  const productRaw = p.productRaw
  const optionRaw = p.optionRaw
  const productBrandRaw = p.productBrandRaw
  const qtyRaw = p.qtyRaw
  const paymentRaw = p.paymentRaw
  const shippingRaw = p.shippingRaw
  const feeRaw = p.feeRaw
  const costRaw = p.costRaw
  const settlementRaw = p.settlementRaw
  const marginRaw = p.marginRaw

  const option = String(optionRaw ?? '').trim()
  const productBrand = String(productBrandRaw ?? '').trim()

  if (
    isClosedMallSummaryLabel(dateRaw) ||
    isClosedMallSummaryLabel(sellerRaw) ||
    isClosedMallSummaryLabel(productRaw)
  ) {
    return {
      status: 'skip_summary',
      excelRowNumber,
      errorMessage: '합계 행',
      dateYmd: '',
      seller: String(sellerRaw ?? ''),
      productName: String(productRaw ?? ''),
      option,
      productBrand,
    }
  }

  const emptyRow =
    !cellStr(dateRaw) &&
    !cellStr(sellerRaw) &&
    !cellStr(productRaw) &&
    !cellStr(qtyRaw) &&
    !cellStr(paymentRaw)
  if (emptyRow) {
    return { status: 'skip_empty', excelRowNumber }
  }

  const errors = []
  const parsedDate = parseSalesDate(dateRaw)
  const dateYmd = toYmd(parsedDate)
  if (!dateYmd) errors.push('a날짜 형식 오류')

  const seller = String(sellerRaw ?? '').trim()
  if (!seller) errors.push('a판매처 없음')

  const productName = String(productRaw ?? '').trim()
  if (!productName) errors.push('a상품명 없음')

  const qtyParsed = parseRequiredNumber(qtyRaw)
  if (!qtyParsed.ok) errors.push('a수량 없음/오류')

  const payParsed = parseRequiredNumber(paymentRaw)
  if (!payParsed.ok) errors.push('a결제가 없음/오류')

  const costParsed = parseRequiredNumber(costRaw)
  if (!costParsed.ok) errors.push('a원가 없음/오류')

  const shippingFee = parseOptionalAmount(shippingRaw)
  const commission = parseOptionalCommission(feeRaw, payParsed.value || 0)

  if (errors.length) {
    return {
      status: 'error',
      excelRowNumber,
      errorMessage: errors.join(', '),
      dateYmd,
      seller,
      productName,
      option,
      productBrand,
      qty: qtyParsed.value,
      payment: payParsed.value,
      shippingFee,
      commission,
      unitCost: costParsed.value,
    }
  }

  const qty = qtyParsed.value
  const payment = payParsed.value
  const costValue = costParsed.value
  const { netProfit, totalCost, unitCost, settlementPrice } = resolveClosedMallMargin({
    payment,
    qty,
    shippingFee,
    commission,
    costValue,
    settlementRaw,
    marginRaw,
  })

  const fp = closedMallDuplicateFingerprint({
    dateYmd,
    seller,
    productName,
    qty,
    payment,
    shippingFee,
    commission,
    unitCost,
  })

  return {
    status: 'ok',
    excelRowNumber,
    errorMessage: '',
    dateYmd,
    seller,
    productName,
    option,
    productBrand,
    qty,
    payment,
    shippingFee,
    commission,
    unitCost,
    totalCost,
    netProfit,
    settlementPrice,
    fingerprint: fp,
  }
}

/**
 * 미리보기·저장용 상세 레코드
 * @param {object} parsedRow
 * @param {string} [fileName]
 * @param {import('../config/closedMall.js').ClosedMallBrandDef|string} [brandOrKey]
 */
export function closedMallRowToDetail(parsedRow, fileName = '', brandOrKey = 'bestheim') {
  const brand =
    typeof brandOrKey === 'object' && brandOrKey?.uploadKind
      ? brandOrKey
      : getClosedMallBrand(brandOrKey) || getClosedMallBrand('bestheim')
  const productBrand = String(parsedRow.productBrand || '').trim()
  const option = String(parsedRow.option || '').trim()
  return {
    date: parsedRow.dateYmd,
    order_date: parsedRow.dateYmd,
    saleDate: parsedRow.dateYmd,
    periodFrom: parsedRow.dateYmd,
    periodTo: parsedRow.dateYmd,
    storeName: parsedRow.seller,
    store_name: parsedRow.seller,
    closedMallSeller: parsedRow.seller,
    // a브랜드 = 상품 브랜드 / dataSourceLabel = 업로드 채널(에쎄르|베스트하임)
    brand: productBrand,
    productBrand,
    dataSourceLabel: brand.dataSourceLabel,
    productName: parsedRow.productName,
    option,
    optionName: option,
    salesQty: parsedRow.qty,
    quantity: parsedRow.qty,
    sales: parsedRow.payment,
    actualPayment: parsedRow.payment,
    shippingFee: parsedRow.shippingFee,
    channelFee: parsedRow.commission,
    commission: parsedRow.commission,
    settlementPrice: parsedRow.settlementPrice,
    unitCost: parsedRow.unitCost,
    totalCost: parsedRow.totalCost,
    netProfit: parsedRow.netProfit,
    margin: parsedRow.netProfit,
    platform: CLOSED_MALL_PLATFORM,
    channel: CLOSED_MALL_PLATFORM,
    salesMethod: CLOSED_MALL_SALES_METHOD,
    businessLine: CLOSED_MALL_BUSINESS_LINE,
    uploadKind: brand.uploadKind,
    uploadFormat: brand.uploadFormat,
    sourceFileName: fileName,
    excelRowNumber: parsedRow.excelRowNumber,
    closedMallFingerprint: parsedRow.fingerprint,
  }
}

/**
 * @param {ArrayBuffer|Uint8Array|Buffer} buffer
 * @param {string} fileName
 * @param {{ existingFingerprints?: Set<string>, brand?: string }} [opts]
 */
export async function readClosedMallBuffer(buffer, fileName, opts = {}) {
  const brand = getClosedMallBrand(opts.brand || 'bestheim') || getClosedMallBrand('bestheim')
  const XLSX = await loadXlsx()
  const data =
    buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const lower = String(fileName || '').toLowerCase()
  const readOpts = { type: 'array', cellDates: true }
  if (lower.endsWith('.xls') && !lower.endsWith('.xlsx')) {
    readOpts.codepage = 949
  }

  const workbook = XLSX.read(data, readOpts)
  let found = null
  let sheetName = ''

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
    const headerInfo = findHeader(aoa)
    if (!headerInfo) continue
    found = { aoa, ...headerInfo }
    sheetName = name
    break
  }

  if (!found) {
    const err = new Error(`필수 컬럼이 없습니다: ${CLOSED_MALL_REQUIRED_HEADERS.join(', ')}`)
    err.code = 'MISSING_COLUMNS'
    err.missingColumns = [...CLOSED_MALL_REQUIRED_HEADERS]
    throw err
  }

  const { aoa, headerRowIndex, col } = found
  const previewRows = []
  const details = []

  let ok = 0
  let error = 0
  let skipSummary = 0

  let sumPayment = 0
  let sumShipping = 0
  let sumFee = 0
  let sumCost = 0
  let sumNetProfit = 0
  let sumQty = 0
  let minDate = ''
  let maxDate = ''

  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    if (row.every((c) => cellStr(c) === '')) continue

    const parsed = parseClosedMallDataRow({
      excelRowNumber: r + 1,
      dateRaw: cellAt(row, col, 'a날짜'),
      sellerRaw: cellAt(row, col, 'a판매처'),
      productRaw: cellAt(row, col, 'a상품명'),
      optionRaw: cellAt(row, col, 'a옵션'),
      productBrandRaw: cellAt(row, col, 'a브랜드'),
      qtyRaw: cellAt(row, col, 'a수량'),
      paymentRaw: cellAt(row, col, 'a결제가'),
      shippingRaw: cellAt(row, col, 'a배송비'),
      feeRaw: cellAt(row, col, 'a수수료'),
      costRaw: cellAt(row, col, 'a원가'),
      settlementRaw: cellAt(row, col, '정산가'),
      marginRaw: marginCellAt(row, col),
    })

    if (parsed.status === 'skip_empty') continue

    previewRows.push(parsed)

    if (parsed.status === 'skip_summary') {
      skipSummary += 1
      continue
    }
    if (parsed.status === 'error') {
      error += 1
      continue
    }

    ok += 1
    sumPayment += parsed.payment
    sumShipping += parsed.shippingFee
    sumFee += parsed.commission
    sumCost += parsed.totalCost
    sumNetProfit += parsed.netProfit
    sumQty += parsed.qty
    if (parsed.dateYmd) {
      if (!minDate || parsed.dateYmd < minDate) minDate = parsed.dateYmd
      if (!maxDate || parsed.dateYmd > maxDate) maxDate = parsed.dateYmd
    }
    details.push(closedMallRowToDetail(parsed, fileName, brand))
  }

  return {
    fileName,
    sheetName,
    format: brand.uploadFormat,
    platform: CLOSED_MALL_PLATFORM,
    salesMethod: CLOSED_MALL_SALES_METHOD,
    uploadKind: brand.uploadKind,
    brandKey: brand.key,
    dataSourceLabel: brand.dataSourceLabel,
    businessDate: minDate && minDate === maxDate ? minDate : minDate || null,
    periodFrom: minDate || null,
    periodTo: maxDate || null,
    details,
    previewRows,
    summary: {
      total: previewRows.length,
      ok,
      error,
      duplicate: 0,
      skipSummary,
      sumPayment,
      sumShipping,
      sumFee,
      sumCost,
      sumNetProfit,
      sumQty,
      minDate,
      maxDate,
    },
  }
}

/** @param {ArrayBuffer|Uint8Array|Buffer} buffer @param {string} fileName @param {object} [opts] */
export async function readBestheimClosedMallBuffer(buffer, fileName, opts = {}) {
  return readClosedMallBuffer(buffer, fileName, { ...opts, brand: opts.brand || 'bestheim' })
}

/** @param {File} file @param {{ existingFingerprints?: Set<string>, brand?: string }} [opts] */
export async function readClosedMallFile(file, opts = {}) {
  const buffer = await file.arrayBuffer()
  return readClosedMallBuffer(buffer, file.name, opts)
}

/** @param {File} file @param {{ existingFingerprints?: Set<string> }} [opts] */
export async function readBestheimClosedMallFile(file, opts = {}) {
  return readClosedMallFile(file, { ...opts, brand: 'bestheim' })
}

/**
 * 저장용 상세 레코드에서 지문 추출
 * @param {object} detail
 */
export function fingerprintFromClosedMallDetail(detail) {
  return closedMallDuplicateFingerprint({
    dateYmd: detail.date || detail.order_date || detail.saleDate || '',
    seller: detail.storeName || detail.brand || '',
    productName: detail.productName || '',
    qty: detail.salesQty ?? detail.quantity ?? 0,
    payment: detail.sales ?? detail.actualPayment ?? 0,
    shippingFee: detail.shippingFee ?? 0,
    commission: detail.commission ?? detail.channelFee ?? 0,
    unitCost: detail.unitCost ?? 0,
  })
}
