#!/usr/bin/env node
/**
 * Phase 3-2 — PG integrated export regression.
 * node infra/scripts/phase-3-2-export-pg-regression.mjs
 */
import ExcelJS from 'exceljs'
import { loadDotEnv, pgConfigFromEnv } from './lib/migration-utils.mjs'
import { createPool, closePool } from '../../backend/src/db/pool.js'
import { buildIntegratedExport } from '../../backend/src/services/integratedExportService.js'
import { loadExportPayload } from '../../backend/src/services/exportDataLoadService.js'
import { buildDashboardWorkbook } from '../../src/utils/dashboardExporter.js'
import { workbookToBuffer } from '../../src/utils/excelWorkbookStyle.js'
import { summarizeEsserKpisWithManual } from '../../src/utils/manualAdSpend.js'
import { partitionSalesAndReturns } from '../../src/utils/transactionType.js'
import { isEsserSheetTotalRecord } from '../../src/utils/esserMetrics.js'

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')

const REQUIRED_SHEETS = [
  '①요약리포트',
  '②전일대비',
  '②판매방식별',
  '③일별',
  '④주별',
  '⑤월별',
  '⑥기간통합',
  '⑦스토어별',
  'KPI',
]

function okLine(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb
}

function sheetRowCount(ws) {
  let n = 0
  ws.eachRow(() => {
    n += 1
  })
  return n
}

function findKpiSalesValue(ws) {
  let sales = null
  ws.eachRow((row) => {
    const label = String(row.getCell(1).value || '').trim()
    if (label === '매출' || label === '총 매출') {
      const v = row.getCell(2).value
      if (v != null && v !== '') sales = Number(String(v).replace(/,/g, ''))
    }
  })
  return sales
}

async function main() {
  loadDotEnv()
  const pgCfg = pgConfigFromEnv()
  createPool(pgCfg)
  let allOk = true

  const exportQuery = {
    scope: 'platform',
    include_manual_ads: 'true',
  }

  let serverResult
  try {
    serverResult = await buildIntegratedExport(exportQuery)
    allOk =
      okLine(
        'PG export 생성',
        serverResult.buffer?.length > 1000,
        `bytes=${serverResult.buffer?.length} sheets=${serverResult.sheetCount}`,
      ) && allOk
  } catch (e) {
    allOk = okLine('PG export 생성', false, e.message) && allOk
    console.log(`OVERALL: FAIL`)
    process.exit(1)
  }

  const pgWb = await parseWorkbook(serverResult.buffer)
  const sheetNames = pgWb.worksheets.map((s) => s.name)
  for (const name of REQUIRED_SHEETS) {
    allOk = okLine(`시트 존재: ${name}`, sheetNames.includes(name)) && allOk
  }

  const detailSheet = pgWb.getWorksheet('⑧상세_판매')
  if (detailSheet) {
    allOk =
      okLine('⑧상세_판매 row count', sheetRowCount(detailSheet) > 1, `rows=${sheetRowCount(detailSheet)}`) &&
      allOk
  }

  const kpiSheet = pgWb.getWorksheet('KPI')
  const pgKpiSales = kpiSheet ? findKpiSalesValue(kpiSheet) : null

  const kpiRes = await fetch(`${PG}/kpi/summary?scope=platform&upload_kind=platform_daily`)
  const kpiBody = kpiRes.ok ? await kpiRes.json() : null
  if (kpiBody && pgKpiSales != null) {
    const diff = Math.abs(Number(kpiBody.salesTotal) - pgKpiSales)
    allOk =
      okLine(
        'KPI 시트 vs summary API 매출',
        diff <= 1,
        `sheet=${pgKpiSales} api=${kpiBody.salesTotal}`,
      ) && allOk
  } else {
    allOk = okLine('KPI 시트 vs summary API', false, 'missing data') && allOk
  }

  const payload = await loadExportPayload(exportQuery)
  const clientBuilt = buildDashboardWorkbook(payload)
  const clientBuf = await workbookToBuffer(clientBuilt.wb)
  const clientWb = await parseWorkbook(clientBuf)

  allOk =
    okLine(
      'client build vs server sheet count',
      clientWb.worksheets.length === pgWb.worksheets.length,
      `client=${clientWb.worksheets.length} server=${pgWb.worksheets.length}`,
    ) && allOk

  const { sales: saleRecords } = partitionSalesAndReturns(payload.records)
  const productRows = saleRecords.filter((r) => !isEsserSheetTotalRecord(r))
  const clientKpi = summarizeEsserKpisWithManual(
    payload.records,
    payload.manualAdEntries,
    {
      dateFrom: payload.filters.dateFrom,
      dateTo: payload.filters.dateTo,
      platform: payload.filters.platform,
      salesMethod: payload.filters.salesMethod,
      year: payload.filters.year,
      month: payload.filters.month,
      period: payload.filters.period,
    },
  )
  if (pgKpiSales != null) {
    const diff = Math.abs(Math.round(clientKpi.sales) - pgKpiSales)
    allOk =
      okLine(
        'client KPI vs export KPI 시트',
        diff <= 1,
        `client=${Math.round(clientKpi.sales)} sheet=${pgKpiSales}`,
      ) && allOk
  }

  const rankSheet = pgWb.getWorksheet('⑩상품순위')
  if (rankSheet && productRows.length) {
    allOk =
      okLine(
        '⑩상품순위 row count',
        sheetRowCount(rankSheet) > 1,
        `rows=${sheetRowCount(rankSheet)}`,
      ) && allOk
  }

  const httpRes = await fetch(`${PG}/exports/integrated?scope=platform`)
  allOk =
    okLine(
      'HTTP GET /exports/integrated',
      httpRes.ok && httpRes.headers.get('content-type')?.includes('spreadsheet'),
      `status=${httpRes.status}`,
    ) && allOk

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  await closePool()
  if (!allOk) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
