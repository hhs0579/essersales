/**
 * 사본느리 자사몰 — 지정일 이전(미만) 판매 데이터 삭제
 * 사용: node scripts/purge-own-mall-before-date.mjs [YYYY-MM-DD]
 * 기본: 2026-06-16 → 16일 이전(15일까지) 삭제
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  partitionOwnMallSales,
  rebuildExcelSalesFromSources,
} from '../src/utils/ownMallSalesImport.js'

const cutoff = process.argv[2] || '2026-06-16'
const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, '../server/data/essersales.db'))

function isBeforeCutoff(dateStr) {
  const d = String(dateStr || '').trim()
  if (!d) return false
  return d < cutoff
}

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
const beforeTotal = (data.sales || []).length
const { manual } = partitionOwnMallSales(data.sales)
const manualKept = manual.filter((s) => !isBeforeCutoff(s.date))
const manualRemoved = manual.length - manualKept.length

const { excelSales } = await rebuildExcelSalesFromSources(
  data.products || [],
  data.salesSourceFiles || [],
)
const excelKept = excelSales.filter((s) => !isBeforeCutoff(s.date))
const excelRemoved = excelSales.length - excelKept.length

data.sales = [...manualKept, ...excelKept]

const ts = new Date().toISOString()
db.prepare(
  `INSERT INTO app_settings (scope, kind, data, updated_at)
   VALUES ('company_b', 'own_mall_manual', ?, ?)
   ON CONFLICT(scope, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
).run(JSON.stringify(data), ts)

const byDate = new Map()
for (const s of data.sales) {
  byDate.set(s.date || '(empty)', (byDate.get(s.date || '(empty)') || 0) + 1)
}

console.log(`기준일: ${cutoff} 미만 삭제`)
console.log(`삭제: 수동 ${manualRemoved}건, 엑셀 ${excelRemoved}건 (합계 ${manualRemoved + excelRemoved}건)`)
console.log(`잔여: ${beforeTotal} → ${data.sales.length}건`)
console.log('잔여 일자:', [...byDate.entries()].sort())
