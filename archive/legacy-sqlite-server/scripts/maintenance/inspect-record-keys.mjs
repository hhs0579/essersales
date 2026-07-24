import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const db = new Database(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'essersales.db'),
)
const row = db
  .prepare(
    `SELECT data FROM sales_records WHERE record_type='detail' ORDER BY created_at DESC LIMIT 1`,
  )
  .get()
if (row) {
  const data = JSON.parse(row.data)
  console.log('keys', Object.keys(data))
  console.log('salesMethod', data.salesMethod, 'deliveryMethod', data.deliveryMethod)
}
