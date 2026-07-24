import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'
import { buildOwnMallSalesImport } from '../src/utils/ownMallSalesParser.js'
import { parseAmount } from '../src/utils/parseAmount.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, '../server/data/essersales.db'))
const row = db.prepare(`SELECT data FROM app_settings WHERE scope='company_b' AND kind='own_mall_manual'`).get()
const data = JSON.parse(row.data)
const products = data.products || []
const manual = (data.sales || []).filter((s) => s.source === 'manual')
const excelSales = []

for (const record of data.salesSourceFiles || []) {
  const buf = Buffer.from(record.dataBase64, 'base64')
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true })
  const parsed = buildOwnMallSalesImport(products, aoa)
  for (const entry of parsed.sales || []) {
    entry.source = 'excel'
    entry.importSourceId = record.id
    excelSales.push(entry)
  }
}
data.sales = [...manual, ...excelSales]

let total = 0
for (const s of data.sales) total += parseAmount(s.lineTotal) || 0

const ts = new Date().toISOString()
db.prepare(
  `INSERT INTO app_settings (scope, kind, data, updated_at) VALUES ('company_b', 'own_mall_manual', ?, ?)
   ON CONFLICT(scope, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
).run(JSON.stringify(data), ts)

console.log('rows', data.sales.length, 'total', total)
