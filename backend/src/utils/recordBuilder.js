import { randomUUID } from 'crypto'
import { normalizeSalesMethod } from '../../../src/utils/salesMethodDetect.js'
import {
  resolveRecordPlatform,
  resolveUploadPlatform,
  inferUploadSalesMethodFromDetails,
} from './platformResolve.js'
import { mapSalesRecordBackfill, inferFileType } from './recordBackfill.js'

const ALLOWED_DAILY_UPLOAD_KINDS = new Set(['platform_daily', 'sales_daily_b', '__test__'])
const ALLOWED_PERIOD_UPLOAD_KINDS = new Set(['platform_period', 'sales_period_b', '__test__'])
const ALLOWED_MONTHLY_UPLOAD_KINDS = new Set(['platform_monthly', 'sales_monthly_b', '__test__'])

export function nowIso() {
  return new Date().toISOString()
}

function resolveRowSalesMethod(row, uploadPlatform, fileName, fallbackMethod = '') {
  const platform =
    resolveRecordPlatform(row, uploadPlatform, fileName) || uploadPlatform
  const delivery =
    row.deliveryMethod || row.delivery_method || row['배송구분'] || ''
  return normalizeSalesMethod(platform, row.salesMethod || fallbackMethod, delivery) || ''
}

export function allParsedRecords(parsed, uploadId, sourceFileName) {
  const types = ['details', 'daily', 'channel', 'product', 'productOption']
  const typeMap = {
    details: 'detail',
    daily: 'daily',
    channel: 'channel',
    product: 'product',
    productOption: 'productOption',
  }
  const lists = []
  const ts = nowIso()
  for (const key of types) {
    const recordType = typeMap[key]
    for (const row of parsed[key] || []) {
      lists.push({
        recordType,
        uploadId,
        sourceFileName: row.sourceFileName || sourceFileName,
        createdAt: ts,
        updatedAt: ts,
        ...row,
      })
    }
  }
  return lists
}

export function buildSalesReportBundle(parsed, fileName, platform = '') {
  const uploadId = randomUUID()
  const createdAt = nowIso()
  const detailCount = parsed.details?.length || 0
  const dailyCount = parsed.daily?.length || 0
  const channelCount = parsed.channel?.length || 0
  const productCount = parsed.product?.length || 0
  const productOptionCount = parsed.productOption?.length || 0
  const totalCount =
    detailCount + dailyCount + channelCount + productCount + productOptionCount

  const upload = {
    id: uploadId,
    file_name: fileName,
    file_type: inferFileType(fileName),
    platform: platform || '',
    sales_method: '',
    upload_kind: 'sales_report',
    upload_format: 'sales_report',
    business_date: null,
    period_from: null,
    period_to: null,
    detail_count: detailCount,
    daily_count: dailyCount,
    channel_count: channelCount,
    product_count: productCount,
    product_option_count: productOptionCount,
    total_count: totalCount,
    parse_status: 'ok',
    parse_error: null,
    created_at: createdAt,
  }

  const records = allParsedRecords(parsed, uploadId, fileName).map((r) => ({
    ...r,
    id: randomUUID(),
    platform: platform || r.channel || '',
    uploadKind: 'sales_report',
    uploadFormat: 'sales_report',
  }))

  return { upload, records }
}

export function buildPlatformDetailBundle({
  fileName,
  platform,
  businessDate,
  periodFrom,
  periodTo,
  details,
  salesMethod = '',
  uploadKind = 'platform_daily',
  uploadFormat = '',
}) {
  const kind = normalizeUploadKind(uploadKind, details)
  const resolvedPlatform = resolveUploadPlatform(fileName, platform, details)
  const uploadId = randomUUID()
  const createdAt = nowIso()
  const method = inferUploadSalesMethodFromDetails(
    details,
    fileName,
    salesMethod || details[0]?.salesMethod || '',
  )
  const format = uploadFormat || details[0]?.uploadFormat || details[0]?.format || ''

  const upload = {
    id: uploadId,
    file_name: fileName,
    file_type: inferFileType(fileName),
    platform: resolvedPlatform,
    sales_method: method,
    upload_kind: kind,
    upload_format: format,
    business_date: businessDate || null,
    period_from: periodFrom || null,
    period_to: periodTo || null,
    detail_count: details.length,
    daily_count: 0,
    channel_count: 0,
    product_count: 0,
    product_option_count: 0,
    total_count: details.length,
    parse_status: 'ok',
    parse_error: null,
    created_at: createdAt,
  }

  const records = details.map((row) => {
    const rowPlatform =
      resolveRecordPlatform(row, resolvedPlatform, fileName) || resolvedPlatform
    const rowMethod = resolveRowSalesMethod(row, resolvedPlatform, fileName, method)
    const delivery =
      row.deliveryMethod || row.delivery_method || row['배송구분'] || ''
    return {
      id: randomUUID(),
      recordType: 'detail',
      uploadId,
      sourceFileName: row.sourceFileName || fileName,
      uploadKind: kind,
      uploadFormat: format || row.uploadFormat || row.format || '',
      createdAt,
      updatedAt: createdAt,
      ...row,
      platform: rowPlatform,
      channel: rowPlatform,
      deliveryMethod: delivery,
      salesMethod: rowMethod || method,
    }
  })

  return { upload, records: mapLegacyFlatRecords(records, upload) }
}

function normalizeUploadKind(rawKind, details) {
  if (rawKind === '__test__') return '__test__'
  if (ALLOWED_DAILY_UPLOAD_KINDS.has(rawKind)) return rawKind
  if (ALLOWED_PERIOD_UPLOAD_KINDS.has(rawKind)) return rawKind
  if (ALLOWED_MONTHLY_UPLOAD_KINDS.has(rawKind)) return rawKind
  if (details?.[0]?.periodFrom && details?.[0]?.periodTo) {
    const from = details[0].periodFrom
    const to = details[0].periodTo
    if (from !== to) return 'platform_period'
  }
  return 'platform_daily'
}

/**
 * legacy insertRecords 와 동일한 data 페이로드 + PG 정규 컬럼
 */
export function mapRecordRowForInsert(r) {
  const data = { ...r.data }
  const upload = r.upload_meta || null
  const backfill = mapSalesRecordBackfill(data, upload)
  return {
    id: r.id,
    upload_id: r.upload_id,
    record_type: r.record_type,
    ...backfill,
    data,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

export function mapLegacyFlatRecords(records, upload) {
  return records.map((r) => {
    const { id, uploadId, recordType, createdAt, updatedAt, ...data } = r
    const row = {
      id,
      upload_id: uploadId,
      record_type: recordType,
      data,
      created_at: createdAt,
      updated_at: updatedAt,
      upload_meta: upload,
    }
    return mapRecordRowForInsert(row)
  })
}
