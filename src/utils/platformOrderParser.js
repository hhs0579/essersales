import { readExcelFile, readExcelBuffer } from './excelReader.js'
import { buildAutoMapping } from '../config/channelMappings.js'
import { transformRows } from './dataTransformer.js'
import { parseSalesDate } from './dateParse.js'
import {
  detectPlatformFromFileName,
  finalizeParsedDailyUpload,
  isBigsellerFileName,
  normalizePlatformLabel,
} from './platformDetect.js'
import {
  isOwnMallAimwebSalesFormat,
  OWN_MALL_AIMWEB_UPLOAD_ERROR,
} from './ownMallSalesParser.js'
import {
  isCoupangEsserFormat,
  parseCoupangEsserDaily,
  parseCoupangEsserPeriod,
  parseCoupangEsserMonthly,
} from './coupangEsserParser.js'
import { parseFilenameDateSpec } from './dateParse.js'

/** 표준 주문 행 → 상세 거래 레코드 */
export function standardRowToDetail(std, platform) {
  const channel = platform || std.channel || ''
  return {
    recordType: 'detail',
    date: std.saleDate,
    channel,
    platform: channel,
    brand: '',
    productName: std.productName,
    option: std.optionName,
    quantity: std.quantity,
    actualPayment: std.saleAmount,
    shippingFee: std.shippingFee,
    channelFee: std.commission,
    settlementPrice: std.settlementAmount || std.saleAmount,
    unitCost: '',
    totalCost: '',
    margin: '',
    marginRate: '',
    sourceFileName: std.sourceFileName,
    orderNo: std.orderNo,
    orderStatus: std.orderStatus,
    remarks: std.remarks || '',
  }
}

function guessBusinessDate(fileName, details) {
  for (const row of details) {
    const p = parseSalesDate(row.date)
    if (p) return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  }
  const m = fileName.match(/(\d{4})[.\-_]?(\d{1,2})[.\-_]?(\d{1,2})/)
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  }
  return ''
}

/**
 * @param {{ fileName: string, headers: string[], rows: object[] }} excel
 * @param {string} platform
 * @param {{ allowZeroSalesProducts?: boolean }} [options]
 */
export function readPlatformDailyFromExcel(excel, platform, options = {}) {
  const { fileName, headers, rows } = excel
  const fallbackPlatform =
    detectPlatformFromFileName(fileName) || normalizePlatformLabel(platform)

  if (
    normalizePlatformLabel(platform) === '자사몰' ||
    isOwnMallAimwebSalesFormat(fileName, headers)
  ) {
    throw new Error(OWN_MALL_AIMWEB_UPLOAD_ERROR)
  }

  const spec = parseFilenameDateSpec(fileName)
  if (spec.type === 'range') {
    throw new Error(
      '기간 합산 파일은 지원하지 않습니다. 하루치 일별 파일로 업로드하세요. (예: …_20260531.xlsx)',
    )
  }

  if (isCoupangEsserFormat(headers)) {
    return finalizeParsedDailyUpload(
      parseCoupangEsserDaily(fileName, headers, rows, fallbackPlatform, options),
    )
  }

  if (isBigsellerFileName(fileName)) {
    throw new Error(
      `「${fileName}」을 빅셀 매출분석으로 인식하지 못했습니다. 엑셀 상단에 상품명·매출·판매방식(또는 배송방식) 열이 있는지 확인하세요.`,
    )
  }

  const mapping = buildAutoMapping(platform, headers)
  const standardRows = transformRows({ channel: platform, mapping, rows, fileName })
  const details = standardRows
    .map((r) => standardRowToDetail(r, fallbackPlatform))
    .filter((r) => r.date && r.productName)

  const businessDate = guessBusinessDate(fileName, details)

  return finalizeParsedDailyUpload({
    fileName,
    platform: fallbackPlatform,
    businessDate,
    details,
    mapping,
    skipped: standardRows.length - details.length,
    format: 'order',
  })
}

/**
 * 플랫폼 일일 주문 엑셀 → 상세 거래 레코드 목록
 */
export async function readPlatformDailyFile(file, platform, options = {}) {
  const excel = await readExcelFile(file)
  return readPlatformDailyFromExcel(excel, platform, options)
}

/** @param {ArrayBuffer | Uint8Array | Buffer} buffer */
export async function readPlatformDailyBuffer(buffer, fileName, platform, options = {}) {
  const excel = await readExcelBuffer(buffer, fileName)
  return readPlatformDailyFromExcel(excel, platform, options)
}

/** 플랫폼 월별 매출 엑셀 (파일명 1일~말일) */
export async function readPlatformMonthlyFromExcel(excel, platform, options = {}) {
  const { fileName, headers, rows } = excel
  const fallbackPlatform = normalizePlatformLabel(platform)

  if (isCoupangEsserFormat(headers)) {
    return finalizeParsedDailyUpload(
      parseCoupangEsserMonthly(fileName, headers, rows, fallbackPlatform, options),
    )
  }

  throw new Error(
    '월별 엑셀은 빅셀 매출분석 형식이어야 합니다. 파일명 예: …_20260601_20260630.xlsx',
  )
}

export async function readPlatformMonthlyFile(file, platform, options = {}) {
  const excel = await readExcelFile(file)
  return readPlatformMonthlyFromExcel(excel, platform, options)
}

/** @param {ArrayBuffer | Uint8Array | Buffer} buffer */
export async function readPlatformMonthlyBuffer(buffer, fileName, platform, options = {}) {
  const excel = await readExcelBuffer(buffer, fileName)
  return readPlatformMonthlyFromExcel(excel, platform, options)
}

/** 플랫폼 기간 매출 엑셀 (파일명에 시작·종료일) */
export async function readPlatformPeriodFromExcel(excel, platform, options = {}) {
  const { fileName, headers, rows } = excel
  const fallbackPlatform = normalizePlatformLabel(platform)

  if (isCoupangEsserFormat(headers)) {
    return parseCoupangEsserPeriod(fileName, headers, rows, fallbackPlatform, options)
  }

  throw new Error(
    '기간 합산 엑셀 업로드는 지원하지 않습니다. 하루치 일별 파일을 사용하세요.',
  )
}

export async function readPlatformPeriodFile(file, platform, options = {}) {
  const excel = await readExcelFile(file)
  return readPlatformPeriodFromExcel(excel, platform, options)
}

/** @param {ArrayBuffer | Uint8Array | Buffer} buffer */
export async function readPlatformPeriodBuffer(buffer, fileName, platform, options = {}) {
  const excel = await readExcelBuffer(buffer, fileName)
  return readPlatformPeriodFromExcel(excel, platform, options)
}
