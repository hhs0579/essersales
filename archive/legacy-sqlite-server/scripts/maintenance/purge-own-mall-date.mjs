import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const targetDate = process.argv[2] || '2026-06-17'
const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, '../server/data/essersales.db'))

const row = db
  .prepare(
    `SELECT data FROM app_settings WHERE scope = 'company_b' AND kind = 'own_mall_manual'`,
  )
  .get()

if (!row) {
  console.log('own_mall_manual 데이터 없음')
  process.exit(0)
}

const data = JSON.parse(row.data)
const before = (data.sales || []).length
const removed = (data.sales || []).filter((s) => s.date === targetDate).length
data.sales = (data.sales || []).filter((s) => s.date !== targetDate)

const ts = new Date().toISOString()
db.prepare(
  `INSERT INTO app_settings (scope, kind, data, updated_at)
   VALUES ('company_b', 'own_mall_manual', ?, ?)
   ON CONFLICT(scope, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
).run(JSON.stringify(data), ts)

console.log(`${targetDate}: ${removed}건 삭제 (${before} → ${data.sales.length})`)
