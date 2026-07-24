import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const db = new Database(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'essersales.db'),
)
const rows = db
  .prepare(
    `SELECT data, created_at FROM sales_records
     WHERE record_type = 'detail' AND data LIKE '%스마트스토어%'
     ORDER BY created_at DESC LIMIT 8`,
  )
  .all()
console.log('count', rows.length)
for (const r of rows) {
  const d = JSON.parse(r.data)
  console.log({
    created: r.created_at,
    salesMethod: d.salesMethod,
    deliveryMethod: d.deliveryMethod,
    platform: d.platform,
    product: (d.productName || '').slice(0, 24),
  })
}
