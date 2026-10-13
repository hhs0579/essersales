import { access } from 'fs/promises'
import { createReadStream } from 'fs'
import { basename, isAbsolute, join } from 'path'
import { getPool } from '../db/pool.js'
import { loadEnv } from '../config/env.js'

/**
 * @param {string} id
 * @returns {Promise<{ id: string, fileName: string, storagePath: string, fileType: string } | null>}
 */
export async function getUploadFileMeta(id) {
  const pool = getPool()
  const res = await pool.query(
    `SELECT id, file_name, storage_path, file_type FROM uploads WHERE id = $1`,
    [id],
  )
  if (!res.rows.length) return null
  const row = res.rows[0]
  return {
    id: row.id,
    fileName: row.file_name || 'upload.xlsx',
    storagePath: row.storage_path || '',
    fileType: row.file_type || '',
  }
}

/**
 * @param {{ id: string, fileName: string, storagePath: string }} meta
 * @returns {Promise<string | null>}
 */
export async function resolveUploadOriginalAbsolutePath(meta) {
  const env = loadEnv()
  const uploadDir = env.uploadDir
  /** @type {string[]} */
  const candidates = []

  if (meta.storagePath) {
    candidates.push(meta.storagePath)
    if (!isAbsolute(meta.storagePath)) {
      candidates.push(join(uploadDir, meta.storagePath))
    }
  }
  candidates.push(join(uploadDir, meta.id, meta.fileName))
  // 파일명만 basename으로 한 번 더 (경로에 다른 이름이 저장된 경우)
  const base = basename(meta.fileName || '')
  if (base && base !== meta.fileName) {
    candidates.push(join(uploadDir, meta.id, base))
  }

  for (const p of candidates) {
    if (!p) continue
    try {
      await access(p)
      return p
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * @param {string} id
 * @returns {Promise<{ absolutePath: string, fileName: string, fileType: string }>}
 */
export async function openUploadOriginalFile(id) {
  const meta = await getUploadFileMeta(id)
  if (!meta) {
    const err = new Error('Upload not found')
    err.status = 404
    err.code = 'NOT_FOUND'
    throw err
  }
  const absolutePath = await resolveUploadOriginalAbsolutePath(meta)
  if (!absolutePath) {
    const err = new Error(
      '원본 엑셀 파일이 서버에 없습니다. (이전 이관 데이터이거나 디스크에서 삭제됨)',
    )
    err.status = 404
    err.code = 'ORIGINAL_MISSING'
    throw err
  }
  return {
    absolutePath,
    fileName: meta.fileName,
    fileType: meta.fileType,
  }
}

/**
 * Express 응답으로 원본 파일 스트리밍
 * @param {import('express').Response} res
 * @param {{ absolutePath: string, fileName: string, fileType: string }} file
 */
export function pipeUploadOriginalToResponse(res, file) {
  const mime =
    file.fileType ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  res.setHeader('Content-Type', mime)
  const encoded = encodeURIComponent(file.fileName)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="upload.xlsx"; filename*=UTF-8''${encoded}`,
  )
  const stream = createReadStream(file.absolutePath)
  stream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, code: 'READ_ERROR' })
    } else {
      res.destroy(err)
    }
  })
  stream.pipe(res)
}
