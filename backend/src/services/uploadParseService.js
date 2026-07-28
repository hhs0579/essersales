import { readSalesReportBuffer } from '../../../src/utils/salesReportParser.js'
import {
  readPlatformDailyBuffer,
  readPlatformPeriodBuffer,
  readPlatformMonthlyBuffer,
} from '../../../src/utils/platformOrderParser.js'
import { readClosedMallBuffer } from '../../../src/utils/bestheimClosedMallParser.js'
import {
  CLOSED_MALL_UPLOAD_KINDS,
  CLOSED_MALL_PLATFORM,
  CLOSED_MALL_SALES_METHOD,
  closedMallBrandFromUploadKind,
} from '../../../src/config/closedMall.js'
import {
  buildSalesReportBundle,
  buildPlatformDetailBundle,
  mapLegacyFlatRecords,
} from '../utils/recordBuilder.js'
import { parseBusinessDateRange } from '../utils/recordBackfill.js'

const DAILY_KINDS = new Set(['platform_daily', 'sales_daily_b', '__test__'])
const PERIOD_KINDS = new Set(['platform_period', 'sales_period_b'])
const MONTHLY_KINDS = new Set(['platform_monthly', 'sales_monthly_b'])
const CLOSED_MALL_KINDS = new Set(CLOSED_MALL_UPLOAD_KINDS)

/**
 * @param {Buffer} buffer
 * @param {string} fileName
 * @param {object} opts
 */
export async function parseExcelUpload(buffer, fileName, opts = {}) {
  const uploadKind = String(opts.upload_kind || opts.uploadKind || 'platform_daily').trim()
  const platform = String(opts.platform || '').trim()
  const salesMethod = String(opts.sales_method || opts.salesMethod || '').trim()
  const uploadFormat = String(opts.upload_format || opts.uploadFormat || '').trim()

  if (uploadKind === 'sales_report') {
    const { parsed } = await readSalesReportBuffer(buffer, fileName)
    const bundle = buildSalesReportBundle(parsed, fileName, platform)
    return {
      upload: bundle.upload,
      records: mapLegacyFlatRecords(bundle.records, bundle.upload),
      parseMeta: { format: 'sales_report' },
    }
  }

  if (MONTHLY_KINDS.has(uploadKind)) {
    const parsed = await readPlatformMonthlyBuffer(buffer, fileName, platform)
    return buildFromPlatformParsed(parsed, {
      uploadKind,
      salesMethod,
      uploadFormat: uploadFormat || parsed.format || '',
    })
  }

  if (PERIOD_KINDS.has(uploadKind)) {
    const parsed = await readPlatformPeriodBuffer(buffer, fileName, platform)
    return buildFromPlatformParsed(parsed, {
      uploadKind,
      salesMethod,
      uploadFormat: uploadFormat || parsed.format || '',
    })
  }

  if (CLOSED_MALL_KINDS.has(uploadKind)) {
    const brand = closedMallBrandFromUploadKind(uploadKind)
    return buildFromClosedMallParsed(buffer, fileName, {
      uploadKind,
      salesMethod: salesMethod || CLOSED_MALL_SALES_METHOD,
      uploadFormat: uploadFormat || brand?.uploadFormat || '',
      platform: platform || CLOSED_MALL_PLATFORM,
      brandKey: brand?.key || 'bestheim',
    })
  }

  if (DAILY_KINDS.has(uploadKind) || !uploadKind) {
    const parsed = await readPlatformDailyBuffer(buffer, fileName, platform)
    return buildFromPlatformParsed(parsed, {
      uploadKind: DAILY_KINDS.has(uploadKind) ? uploadKind : 'platform_daily',
      salesMethod: salesMethod || parsed.salesMethod || '',
      uploadFormat: uploadFormat || parsed.format || '',
    })
  }

  const err = new Error(`unsupported upload_kind: ${uploadKind}`)
  err.status = 400
  err.code = 'INVALID_UPLOAD_KIND'
  throw err
}

async function buildFromClosedMallParsed(
  buffer,
  fileName,
  { uploadKind, salesMethod, uploadFormat, platform, brandKey },
) {
  let parsed
  try {
    // 중복 제외 없이 정상 행 전부 저장
    parsed = await readClosedMallBuffer(buffer, fileName, {
      brand: brandKey,
    })
  } catch (e) {
    const err = new Error(e.message || '폐쇄몰 엑셀 파싱 실패')
    err.status = 400
    err.code = e.code || 'PARSE_ERROR'
    err.missingColumns = e.missingColumns
    throw err
  }

  if (!parsed.details?.length) {
    const s = parsed.summary || {}
    const err = new Error(`저장할 정상 행이 없습니다 (오류 ${s.error || 0}).`)
    err.status = 400
    err.code = 'EMPTY_PARSE'
    throw err
  }

  const dateInfo = parseBusinessDateRange(parsed.businessDate)
  const bundle = buildPlatformDetailBundle({
    fileName: parsed.fileName,
    platform: platform || parsed.platform,
    businessDate: dateInfo.singleDate || parsed.businessDate || null,
    periodFrom: parsed.periodFrom || dateInfo.periodFrom,
    periodTo: parsed.periodTo || dateInfo.periodTo,
    details: parsed.details,
    salesMethod: salesMethod || parsed.salesMethod || CLOSED_MALL_SALES_METHOD,
    uploadKind,
    uploadFormat: uploadFormat || parsed.format || '',
  })

  return {
    ...bundle,
    parseMeta: {
      format: parsed.format,
      platform: parsed.platform,
      summary: parsed.summary,
      skipped: parsed.summary?.error || 0,
      skippedSummary: parsed.summary?.skipSummary || 0,
      duplicateExcluded: parsed.summary?.duplicate || 0,
    },
  }
}

function buildFromPlatformParsed(parsed, { uploadKind, salesMethod, uploadFormat }) {
  if (!parsed.details?.length) {
    const err = new Error(
      parsed.skippedNoDate > 0
        ? `저장할 행 없음 (날짜없음 ${parsed.skippedNoDate}행). 파일명·날짜 열 확인.`
        : '저장할 데이터 행이 없습니다.',
    )
    err.status = 400
    err.code = 'EMPTY_PARSE'
    throw err
  }

  const dateInfo = parseBusinessDateRange(parsed.businessDate)
  const bundle = buildPlatformDetailBundle({
    fileName: parsed.fileName,
    platform: parsed.platform,
    businessDate: dateInfo.singleDate || parsed.businessDate || null,
    periodFrom: parsed.periodFrom || dateInfo.periodFrom,
    periodTo: parsed.periodTo || dateInfo.periodTo,
    details: parsed.details,
    salesMethod: salesMethod || parsed.salesMethod || '',
    uploadKind,
    uploadFormat,
  })

  return {
    ...bundle,
    parseMeta: {
      format: parsed.format,
      platform: parsed.platform,
      skipped: parsed.skipped,
      skippedSummary: parsed.skippedSummary,
    },
  }
}
