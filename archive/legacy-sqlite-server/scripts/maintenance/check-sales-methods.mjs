import '../server/db.js'
import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'essersales.db')
const db = new Database(dbPath)
const uploads = db
  .prepare(`SELECT id, file_name, platform, sales_method FROM uploads WHERE file_name LIKE '%네이버%'`)
  .all()
for (const u of uploads) {
  const sample = db
    .prepare(
      `SELECT data FROM sales_records WHERE upload_id = ? AND record_type = 'detail' LIMIT 3`,
    )
    .get(u.id)
  const data = sample ? JSON.parse(sample.data) : null
  console.log(u.file_name, 'upload sales_method:', u.sales_method, 'sample:', {
    salesMethod: data?.salesMethod,
    deliveryMethod: data?.deliveryMethod,
    channelKind: data?.channelKind,
  })
}
