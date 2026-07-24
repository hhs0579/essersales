import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { normalizeDetailFields } from './recordFields.js'
import {
  resolveUploadPlatform,
  resolveRecordPlatform,
} from './platformResolve.js'
import {
  extractDeliveryFromRawRow,
  normalizeSalesMethod,
} from '../src/utils/salesMethodDetect.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.DB_PATH || join(dataDir, 'essersales.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    platform TEXT DEFAULT '',
    upload_kind TEXT DEFAULT 'sales_report',
    business_date TEXT DEFAULT '',
    detail_count INTEGER DEFAULT 0,
    daily_count INTEGER DEFAULT 0,
    channel_count INTEGER DEFAULT 0,
    product_count INTEGER DEFAULT 0,
    product_option_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales_records (
    id TEXT PRIMARY KEY,
    upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_type ON sales_records(record_type);
  CREATE INDEX IF NOT EXISTS idx_records_upload ON sales_records(upload_id);

  CREATE TABLE IF NOT EXISTS app_settings (
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, kind)
  );
`)

try {
  db.exec(`ALTER TABLE uploads ADD COLUMN sales_method TEXT DEFAULT ''`)
} catch {
  /* column exists */
}

/** 예전 platform 업로드가 upload_kind 기본값(sales_report)인 경우 베스트하임 kind로 보정 */
function migrateLegacyPlatformUploadKinds() {
  const legacy = db
    .prepare(
      `SELECT id, upload_kind FROM uploads
       WHERE upload_kind IS NULL OR upload_kind = '' OR upload_kind = 'sales_report'`,
    )
    .all()
  if (!legacy.length) return

  const sampleStmt = db.prepare(
    `SELECT data FROM sales_records WHERE upload_id = ? AND record_type = 'detail' LIMIT 1`,
  )
  const updateStmt = db.prepare(`UPDATE uploads SET upload_kind = ? WHERE id = ?`)

  const run = db.transaction((rows) => {
    for (const row of rows) {
      const sample = sampleStmt.get(row.id)
      if (!sample) continue
      let data
      try {
        data = JSON.parse(sample.data)
      } catch {
        continue
      }
      let kind = null
      if (data.uploadFormat === 'coupang_esser_period') kind = 'platform_period'
      else if (data.uploadFormat === 'coupang_esser') kind = 'platform_daily'
      else if (data.platform || data.channel) kind = 'platform_daily'
      if (kind) updateStmt.run(kind, row.id)
    }
  })
  run(legacy)
}

migrateLegacyPlatformUploadKinds()

/** 파일명에 네이버인데 platform=쿠팡으로 저장된 업로드·상세 행 보정 */
function repairMislabeledUploadPlatforms() {
  const uploads = db.prepare(`SELECT id, file_name, platform FROM uploads`).all()
  if (!uploads.length) return

  const updateUpload = db.prepare(`UPDATE uploads SET platform = ? WHERE id = ?`)
  const listRecords = db.prepare(
    `SELECT id, data FROM sales_records WHERE upload_id = ? AND record_type = 'detail'`,
  )
  const updateRecord = db.prepare(
    `UPDATE sales_records SET data = ?, updated_at = ? WHERE id = ?`,
  )

  const run = db.transaction((rows) => {
    const ts = nowIso()
    let uploadFixes = 0
    let recordFixes = 0
    for (const u of rows) {
      const resolved = resolveUploadPlatform(u.file_name, u.platform)
      if (resolved && resolved !== u.platform) {
        updateUpload.run(resolved, u.id)
        uploadFixes += 1
      }
      for (const rec of listRecords.all(u.id)) {
        let data
        try {
          data = JSON.parse(rec.data)
        } catch {
          continue
        }
        const fixed = resolveRecordPlatform(
          data,
          resolved || u.platform,
          data.sourceFileName || u.file_name,
        )
        if (!fixed || fixed === data.platform) continue
        updateRecord.run(
          JSON.stringify({ ...data, platform: fixed, channel: fixed }),
          ts,
          rec.id,
        )
        recordFixes += 1
      }
    }
    if (uploadFixes || recordFixes) {
      console.log(
        `[essersales] 플랫폼 보정: 업로드 ${uploadFixes}건, 상세 ${recordFixes}건`,
      )
    }
  })
  run(uploads)
}

repairMislabeledUploadPlatforms()

/** 저장된 deliveryMethod·배송구분 → 판매방식(일반배송/N배송 등) 보정 */
function repairRecordSalesMethods() {
  const rows = db
    .prepare(`SELECT id, data FROM sales_records WHERE record_type = 'detail'`)
    .all()
  if (!rows.length) return

  const updateRecord = db.prepare(
    `UPDATE sales_records SET data = ?, updated_at = ? WHERE id = ?`,
  )
  const updateUploadMethod = db.prepare(
    `UPDATE uploads SET sales_method = ? WHERE id = ?`,
  )
  const uploadMethods = new Map()

  const run = db.transaction((list) => {
    const ts = nowIso()
    let fixes = 0
    for (const row of list) {
      let data
      try {
        data = JSON.parse(row.data)
      } catch {
        continue
      }
      const delivery =
        data.deliveryMethod ||
        data.delivery_method ||
        data['배송구분'] ||
        extractDeliveryFromRawRow(data) ||
        ''
      const method = normalizeSalesMethod(
        data.platform || data.channel,
        data.salesMethod,
        delivery,
      )
      if (!method || method === data.salesMethod) continue
      updateRecord.run(
        JSON.stringify({ ...data, salesMethod: method, deliveryMethod: delivery || data.deliveryMethod }),
        ts,
        row.id,
      )
      fixes += 1
      if (data.uploadId) {
        const prev = uploadMethods.get(data.uploadId) || new Map()
        prev.set(method, (prev.get(method) || 0) + 1)
        uploadMethods.set(data.uploadId, prev)
      }
    }
    for (const [uploadId, counts] of uploadMethods) {
      let best = ''
      let max = 0
      for (const [m, n] of counts) {
        if (n > max) {
          max = n
          best = m
        }
      }
      if (best) updateUploadMethod.run(best, uploadId)
    }
    if (fixes) console.log(`[essersales] 판매방식 보정: 상세 ${fixes}건`)
  })
  run(rows)
}

repairRecordSalesMethods()

export function nowIso() {
  return new Date().toISOString()
}

export function rowToRecord(row) {
  const data = normalizeDetailFields(JSON.parse(row.data))
  return {
    id: row.id,
    uploadId: row.upload_id,
    recordType: row.record_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...data,
  }
}

export { db, dbPath }
