import * as XLSX from 'xlsx'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  parseNaverAdCenterExcelFile,
  mergeNaverAdIntoManualEntries,
} from '../src/utils/naverAdCenterParser.js'
import { createManualAdEntry } from '../src/config/manualAdSpend.js'
import { parseAmount } from '../src/utils/parseAmount.js'

function makeWorkbook(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'report')
  const path = join(tmpdir(), `naver-ad-test-${Date.now()}.xlsx`)
  XLSX.writeFile(wb, path)
  return path
}

async function run() {
  const path = makeWorkbook([
    ['기간', '노출수', '클릭수', '소진액(VAT포함)'],
    ['2026.06.01.', 1000, 50, '￦397,215'],
    ['2026.06.15.(토)', 1000, 50, '12,345원'],
    ['2026.06.16.(일)', 900, 40, 9876],
    ['2026.06.17.(월)', 800, 30, '8,500원'],
  ])

  const buffer = readFileSync(path)
  const file = new File([buffer], 'naver-test.xlsx')
  const parsed = await parseNaverAdCenterExcelFile(file)

  console.log('parsed rows:', parsed.rows)
  if (parsed.rows[0]?.adSpend !== 397215) {
    throw new Error(`expected 397215, got ${parsed.rows[0]?.adSpend}`)
  }
  if (parsed.rows[0]?.date !== '2026-06-01') {
    throw new Error(`expected 2026-06-01, got ${parsed.rows[0]?.date}`)
  }
  if (parsed.rows[1]?.adSpend !== 12345) {
    throw new Error(`expected 12345, got ${parsed.rows[1]?.adSpend}`)
  }

  const entries = [createManualAdEntry()]
  entries[0].date = '2026-06-15'
  entries[0].adSpend = '0'
  entries[0].adSales = '999'

  mergeNaverAdIntoManualEntries(entries, parsed.rows.filter((r) => r.date === '2026-06-15'))
  if (entries[0].adSpend !== '0') throw new Error('meta adSpend should stay')
  if (entries[0].adSales !== '999') throw new Error('meta adSales should stay')
  const gfa = entries.find((e) => e.date === '2026-06-15' && e.source === 'gfa')
  if (!gfa || gfa.adSpend !== '12345') throw new Error('gfa adSpend failed')

  const manual = [createManualAdEntry('meta')]
  manual[0].date = '2026-06-01'
  manual[0].adSpend = '50000'
  manual[0].adSales = '₩120,000'
  mergeNaverAdIntoManualEntries(manual, [{ date: '2026-06-01', adSpend: 397215 }], { additive: true })
  if (manual.length !== 2) throw new Error(`expected 2 rows, got ${manual.length}`)
  if (parseAmount(manual[0].adSales) !== 120000) {
    throw new Error(`meta adSales parse failed, got ${manual[0].adSales}`)
  }
  const gfa2 = manual.find((e) => e.source === 'gfa')
  if (!gfa2 || gfa2.adSpend !== '397215') throw new Error('additive gfa failed')

  unlinkSync(path)
  console.log('ok')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
