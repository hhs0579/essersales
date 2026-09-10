/**
 * docs/ 원본 xlsx 분석 — 판매자+그ro스 KPI vs 상품행, 특판 period
 */
import fs from 'node:fs'
import path from 'node:path'
import { readExcelBuffer } from '../src/utils/excelReader.js'
import { readPlatformDailyFromExcel } from '../src/utils/platformOrderParser.js'
import { isEsserSheetTotalRecord, summarizeEsserKpis } from '../src/utils/esserMetrics.js'
import { isReturnRecord } from '../src/utils/transactionType.js'
import { readClosedMallBuffer } from '../src/utils/bestheimClosedMallParser.js'

const docsDir = path.resolve('docs')

async function analyzeBigcell(fileName) {
  const filePath = path.join(docsDir, fileName)
  const buf = fs.readFileSync(filePath)
  const excel = await readExcelBuffer(buf, fileName)
  let parsed
  try {
    parsed = readPlatformDailyFromExcel(excel, '쿠팡')
  } catch (e) {
    return { fileName, error: e.message }
  }
  const details = parsed.details || []
  const products = details.filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r))
  const sheetTotals = details.filter((r) => isEsserSheetTotalRecord(r))
  const productSum = products.reduce((s, r) => s + (Number(r.sales) || 0), 0)
  const kpi = summarizeEsserKpis(details)
  return {
    fileName,
    type: 'bigcell',
    totalRows: details.length,
    productRows: products.length,
    sheetTotalRows: sheetTotals.length,
    productSalesSum: Math.round(productSum),
    kpiSales: Math.round(kpi.sales || 0),
    kpiSalesQty: Math.round(kpi.salesQty || 0),
    sheetTotals: sheetTotals.map((r) => ({
      sales: r.sales,
      salesQty: r.salesQty,
      netProfit: r.netProfit,
      adSpend: r.adSpend,
      productName: r.productName,
      brand: r.brand,
      salesMethod: r.salesMethod,
      isEsserSheetTotal: r.isEsserSheetTotal,
    })),
    sampleProducts: products.slice(0, 3).map((r) => ({
      sales: r.sales,
      productName: String(r.productName || '').slice(0, 40),
      salesMethod: r.salesMethod,
    })),
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    businessDate: parsed.businessDate,
  }
}

async function analyzeClosedMall(fileName, brand = 'bestheim') {
  const filePath = path.join(docsDir, fileName)
  const buf = fs.readFileSync(filePath)
  let parsed
  try {
    parsed = await readClosedMallBuffer(buf, fileName, { brand })
  } catch (e) {
    return { fileName, error: e.message }
  }
  const details = parsed.details || []
  const byDate = new Map()
  for (const r of details) {
    const d = r.date || r.order_date || ''
    byDate.set(d, (byDate.get(d) || 0) + (Number(r.sales) || 0))
  }
  return {
    fileName,
    type: 'closed_mall',
    productRows: details.length,
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    businessDate: parsed.businessDate,
    totalSales: Math.round(details.reduce((s, r) => s + (Number(r.sales) || 0), 0)),
    dateSpread: [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, sales]) => ({ date, sales: Math.round(sales) })),
    sampleRows: details.slice(0, 3).map((r) => ({
      date: r.date,
      seller: r.closedMallSeller,
      sales: r.sales,
      productName: String(r.productName || '').slice(0, 30),
    })),
  }
}

async function analyzeGenericXlsx(fileName) {
  const filePath = path.join(docsDir, fileName)
  const buf = fs.readFileSync(filePath)
  const excel = await readExcelBuffer(buf, fileName)
  const sheets = excel.sheetNames || []
  const preview = {}
  for (const name of sheets.slice(0, 5)) {
    const rows = excel.sheets?.[name] || []
    preview[name] = {
      rowCount: rows.length,
      headers: rows[0]?.slice?.(0, 12) || rows[0],
      firstData: rows[1]?.slice?.(0, 8),
    }
  }
  return { fileName, type: 'generic', sheets, preview }
}

const targets = process.argv.slice(2)
const files =
  targets.length > 0
    ? targets
    : [
        '빅셀_판매자배송_매출분석_20260801_20260801.xlsx',
        '빅셀_로켓그로스_매출분석_20260801_20260801.xlsx',
        '통합20260810 (1).xlsx',
      ]

const results = []
for (const f of files) {
  if (!fs.existsSync(path.join(docsDir, f))) {
    results.push({ fileName: f, error: 'not found' })
    continue
  }
  if (/특판|closed|폐쇄|에쎄르|베스트하임.*몰/i.test(f) && !/빅셀|로켓|판매자/.test(f)) {
    results.push(await analyzeClosedMall(f))
    continue
  }
  if (/빅셀|로켓|판매자|네이버/.test(f)) {
    results.push(await analyzeBigcell(f))
    continue
  }
  // try closed mall headers first
  const cm = await analyzeClosedMall(f)
  if (!cm.error) {
    results.push(cm)
    continue
  }
  results.push(await analyzeGenericXlsx(f))
}

console.log(JSON.stringify(results, null, 2))
