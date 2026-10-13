import { join } from 'path'
import { loadEnv } from '../config/env.js'
import { parseExcelUpload } from './uploadParseService.js'
import {
  findDuplicateUpload,
  findUploadIdsByFileName,
  insertUploadBundle,
  sha256Buffer,
} from '../repositories/uploadInsertRepository.js'

function truthy(val) {
  if (val === true || val === 'true' || val === '1') return true
  return false
}

/**
 * @param {object} params
 * @param {Buffer} params.buffer
 * @param {string} params.fileName
 * @param {Record<string, string>} params.fields
 */
export async function processExcelUpload({ buffer, fileName, fields }) {
  const uploadKind = String(fields.upload_kind || fields.uploadKind || 'platform_daily').trim()
  const platform = String(fields.platform || '').trim()
  const salesMethod = String(fields.sales_method || fields.salesMethod || '').trim()
  const uploadFormat = String(fields.upload_format || fields.uploadFormat || '').trim()
  const force = truthy(fields.force)
  const replaceSameName = truthy(
    fields.replace_same_name ?? fields.replaceSameName ?? 'true',
  )

  const sha256 = sha256Buffer(buffer)

  // 동일 파일명 배치는 새 데이터 INSERT 트랜잭션 안에서 교체 (파싱 실패 시 기존 데이터 보존)
  const replaceUploadIds =
    replaceSameName && uploadKind !== 'sales_report'
      ? await findUploadIdsByFileName(fileName, uploadKind)
      : []

  if (!force) {
    const dup = await findDuplicateUpload(sha256, uploadKind, replaceUploadIds)
    if (dup) {
      return {
        ok: false,
        duplicate: true,
        message: '이미 업로드된 파일입니다.',
        existingUploadId: dup.upload_id,
        existingFileName: dup.file_name,
      }
    }
  }

  let bundle
  try {
    bundle = await parseExcelUpload(buffer, fileName, {
      upload_kind: uploadKind,
      platform,
      sales_method: salesMethod,
      upload_format: uploadFormat,
    })
  } catch (err) {
    if (err.status) throw err
    const e = new Error(err.message || 'parse failed')
    e.status = 400
    e.code = 'PARSE_ERROR'
    throw e
  }

  const env = loadEnv()
  const storageDir = join(env.uploadDir, bundle.upload.id)
  const storagePath = join(storageDir, fileName)

  const inserted = await insertUploadBundle({
    upload: bundle.upload,
    records: bundle.records,
    fileBuffer: buffer,
    fileName,
    sha256,
    storageDir,
    storagePath,
    replaceUploadIds,
  })

  return {
    ok: true,
    uploadId: inserted.uploadId,
    count: inserted.recordCount,
    uploadKind: bundle.upload.upload_kind,
    platform: bundle.upload.platform,
    salesMethod: bundle.upload.sales_method,
    parseMeta: bundle.parseMeta,
    duplicate: false,
    replacedUploads: replaceUploadIds.length,
  }
}
