/**
 * 사본느리 자사몰 — 잘못 올라간 sales_daily_b(기본_양식) 판매내역 전체 삭제
 * 사용: node scripts/purge-own-mall-sales-daily-b.mjs
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, '../server/data/essersales.db'))

const targets = db
  .prepare(
    `SELECT u.id, u.file_name, u.platform, u.upload_kind,
            (SELECT COUNT(1) FROM sales_records sr WHERE sr.upload_id = u.id) AS record_count
     FROM uploads u
     WHERE u.upload_kind = 'sales_daily_b'
       AND (u.platform = '자사몰' OR u.file_name LIKE '기본_양식%')
     ORDER BY u.created_at`,
  )
  .all()

if (!targets.length) {
  console.log('삭제할 자사몰 sales_daily_b 업로드 없음')
  process.exit(0)
}

let totalRecords = 0
const del = db.transaction((uploadIds) => {
  for (const id of uploadIds) {
    const r = db.prepare(`DELETE FROM sales_records WHERE upload_id = ?`).run(id)
    totalRecords += r.changes
    db.prepare(`DELETE FROM uploads WHERE id = ?`).run(id)
  }
})

del(targets.map((t) => t.id))

console.log('삭제한 업로드:')
for (const t of targets) {
  console.log(`  - ${t.file_name} (${t.record_count}건)`)
}
console.log(`\n합계: 업로드 ${targets.length}개, sales_records ${totalRecords}건 삭제`)

const row = db
  .prepare(`SELECT data FROM app_settings WHERE scope = 'company_b' AND kind = 'own_mall_manual'`)
  .get()

if (row) {
  const data = JSON.parse(row.data)
  const beforeSales = (data.sales || []).length
  const beforeSources = (data.salesSourceFiles || []).length
  data.sales = (data.sales || []).filter((s) => s.source === 'manual')
  data.salesSourceFiles = []

  if (beforeSales !== data.sales.length || beforeSources > 0) {
    const ts = new Date().toISOString()
    db.prepare(
      `INSERT INTO app_settings (scope, kind, data, updated_at)
       VALUES ('company_b', 'own_mall_manual', ?, ?)
       ON CONFLICT(scope, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(data), ts)
    console.log(
      `\nown_mall_manual: 엑셀 판매 ${beforeSales - data.sales.length}건·원본 ${beforeSources}개 제거 (상품 ${(data.products || []).length}개 유지)`,
    )
  } else {
    console.log('\nown_mall_manual: 엑셀 판매/원본 없음 (변경 없음)')
  }
}
