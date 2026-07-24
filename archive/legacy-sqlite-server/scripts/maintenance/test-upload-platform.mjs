import { randomUUID } from 'crypto'

const fileName = '빅셀_네이버_매출분석_20260603_20260603.xlsx'
const body = {
  fileName,
  platform: '쿠팡',
  businessDate: '2026-06-03',
  details: [
    {
      date: '2026. 6. 3',
      productName: '테스트상품',
      platform: '쿠팡',
      channel: '쿠팡',
      quantity: '1',
      actualPayment: '1000',
    },
  ],
  uploadKind: 'platform_daily',
}

const res = await fetch('http://127.0.0.1:3001/api/uploads/platform-daily', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const json = await res.json()
console.log('status', res.status, json)

import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'essersales.db')
const db = new Database(dbPath)
if (json.uploadId) {
  const row = db.prepare('SELECT platform, sales_method FROM uploads WHERE id = ?').get(json.uploadId)
  console.log('DB row', row)
  db.prepare('DELETE FROM uploads WHERE id = ?').run(json.uploadId)
}
