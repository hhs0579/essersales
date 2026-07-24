import { createHash } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { getPool } from '../db/pool.js'
import { deleteUploadById } from '../repositories/uploadsRepository.js'

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * @param {string} sha256
 * @param {string} [uploadKind]
 */
export async function findDuplicateUpload(sha256, uploadKind = '') {
  const pool = getPool()
  const params = [sha256]
  let sql = `
    SELECT uf.upload_id, u.file_name, u.upload_kind, u.created_at
    FROM upload_files uf
    JOIN uploads u ON u.id = uf.upload_id
    WHERE uf.sha256 = $1`
  if (uploadKind) {
    sql += ` AND u.upload_kind = $2`
    params.push(uploadKind)
  }
  sql += ` ORDER BY u.created_at DESC LIMIT 1`
  const res = await pool.query(sql, params)
  return res.rows[0] || null
}

export async function deleteUploadsByFileName(fileName, uploadKind) {
  const pool = getPool()
  const res = await pool.query(
    `SELECT id FROM uploads WHERE file_name = $1 AND upload_kind = $2`,
    [fileName, uploadKind],
  )
  for (const row of res.rows) {
    await deleteUploadById(row.id)
  }
  return res.rows.length
}

/**
 * @param {object} params
 */
export async function insertUploadBundle({
  upload,
  records,
  fileBuffer,
  fileName,
  sha256,
  storageDir,
  storagePath,
}) {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const uploadSql = `
      INSERT INTO uploads (
        id, file_name, file_type, storage_path, platform, sales_method, upload_kind,
        business_date, period_from, period_to,
        detail_count, daily_count, channel_count, product_count, product_option_count,
        total_count, parse_status, parse_error, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )`

    await client.query(uploadSql, [
      upload.id,
      upload.file_name,
      upload.file_type,
      storagePath,
      upload.platform,
      upload.sales_method,
      upload.upload_kind,
      upload.business_date,
      upload.period_from,
      upload.period_to,
      upload.detail_count,
      upload.daily_count,
      upload.channel_count,
      upload.product_count,
      upload.product_option_count,
      upload.total_count,
      upload.parse_status,
      upload.parse_error,
      upload.created_at,
    ])

    await client.query(
      `INSERT INTO upload_files (upload_id, sha256, size_bytes, mime_type, stored_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [upload.id, sha256, fileBuffer.length, upload.file_type || ''],
    )

    const BATCH_SIZE = 2500;
    const insertCols = `
        id, upload_id, record_type,
        order_date, business_date, period_from, period_to,
        platform, sales_method, channel, store_name,
        product_code, product_name, option_name,
        sales, sales_qty, net_profit, ad_spend,
        transaction_type, upload_kind, upload_format,
        data, created_at, updated_at`;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      const valueStrings = [];
      const flatValues = [];
      let paramIdx = 1;

      for (const r of chunk) {
        valueStrings.push(
          `($${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++})`
        );
        flatValues.push(
          r.id,
          r.upload_id,
          r.record_type,
          r.order_date,
          r.business_date,
          r.period_from,
          r.period_to,
          r.platform,
          r.sales_method,
          r.channel,
          r.store_name,
          r.product_code,
          r.product_name,
          r.option_name,
          r.sales,
          r.sales_qty,
          r.net_profit,
          r.ad_spend,
          r.transaction_type,
          r.upload_kind,
          r.upload_format,
          JSON.stringify(r.data),
          r.created_at,
          r.updated_at
        );
      }

      if (valueStrings.length > 0) {
        const query = `INSERT INTO sales_records (${insertCols}) VALUES ${valueStrings.join(',')}`;
        await client.query(query, flatValues);
      }
    }

    await client.query('COMMIT')

    await mkdir(storageDir, { recursive: true })
    await writeFile(join(storageDir, fileName), fileBuffer)

    return { uploadId: upload.id, recordCount: records.length }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
