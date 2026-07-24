import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'essersales.db')
const db = new Database(dbPath)
const rows = db
  .prepare(
    `SELECT file_name, platform, sales_method, upload_kind, created_at
     FROM uploads ORDER BY created_at DESC LIMIT 20`,
  )
  .all()
console.log('DB:', dbPath)
for (const r of rows) {
  const n = String(r.file_name || '').toLowerCase().replace(/\s/g, '')
  const hasNaver = n.includes('네이버') || n.includes('naver')
  console.log({
    file: r.file_name,
    platform: r.platform,
    sales_method: r.sales_method,
    kind: r.upload_kind,
    hasNaverInName: hasNaver,
    mismatch: hasNaver && r.platform === '쿠팡',
  })
}
