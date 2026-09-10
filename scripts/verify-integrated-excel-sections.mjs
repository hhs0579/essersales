/**
 * 통합 ①요약리포트 — 섹션별 매출·원가·마진·수량·광고 교차 검증
 * Usage: node scripts/verify-integrated-excel-sections.mjs
 */
import { buildKpiSplitRowsForChannel } from '../src/utils/platformKpiSplit.js'
import {
  segmentTotalKpiFromRows,
  buildIntegratedProfitLossSummaryRows,
  INTEGRATED_REPORT_LAYOUT_VER,
} from '../src/utils/profitLossReportExporter.js'
import { parseAmount } from '../src/utils/parseAmount.js'

function nearly(a, b, tol = 1) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tol
}

function sampleRecords() {
  return [
    {
      uploadId: 'c1',
      sourceFileName: 'bh-cp.xlsx',
      date: '2026-08-10',
      platform: '쿠팡',
      salesMethod: '판매자배송',
      storeName: '베스트하임',
      dataSourceLabel: '베스트하임',
      uploadKind: 'platform_daily',
      uploadFormat: 'coupang_esser',
      sales: '500000',
      salesQty: '50',
      netProfit: '100000',
      totalCost: '400000',
    },
    {
      uploadId: 'c1',
      sourceFileName: 'bh-cp.xlsx',
      date: '2026-08-10',
      platform: '쿠팡',
      salesMethod: '판매자배송',
      storeName: '베스트하임',
      dataSourceLabel: '베스트하임',
      uploadKind: 'platform_daily',
      uploadFormat: 'coupang_esser',
      sales: '39900',
      salesQty: '4',
      netProfit: '8000',
      totalCost: '31900',
    },
    {
      uploadId: 'c1',
      sourceFileName: 'bh-cp.xlsx',
      date: '2026-08-10',
      platform: '쿠팡',
      salesMethod: '판매자배송',
      storeName: '베스트하임',
      dataSourceLabel: '베스트하임',
      uploadKind: 'platform_daily',
      uploadFormat: 'coupang_esser',
      sales: '500000',
      salesQty: '54',
      netProfit: '100000',
      totalCost: '400000',
      adSpend: '20000',
      adSales: '80000',
      isEsserSheetTotal: true,
      sheetTotalKind: 'header',
    },
    {
      uploadId: 's1',
      sourceFileName: 'bh-ss.xlsx',
      date: '2026-08-10',
      platform: '스마트스토어',
      salesMethod: '일반배송',
      storeName: '베스트하임',
      dataSourceLabel: '베스트하임',
      uploadKind: 'platform_daily',
      sales: '300000',
      salesQty: '30',
      netProfit: '90000',
      totalCost: '',
    },
    {
      uploadId: 'c2',
      sourceFileName: 'sbn-cp.xlsx',
      date: '2026-08-10',
      platform: '쿠팡',
      salesMethod: '판매자배송',
      storeName: '사본느리',
      dataSourceLabel: '사본느리',
      uploadKind: 'company_b',
      uploadFormat: 'coupang_esser',
      sales: '200000',
      salesQty: '20',
      netProfit: '60000',
      totalCost: '140000',
    },
    {
      uploadId: 'c2',
      sourceFileName: 'sbn-cp.xlsx',
      date: '2026-08-10',
      platform: '쿠팡',
      salesMethod: '판매자배송',
      storeName: '사본느리',
      dataSourceLabel: '사본느리',
      uploadKind: 'company_b',
      uploadFormat: 'coupang_esser',
      sales: '200000',
      salesQty: '20',
      netProfit: '60000',
      totalCost: '140000',
      adSpend: '5000',
      adSales: '10000',
      isEsserSheetTotal: true,
      sheetTotalKind: 'header',
    },
    {
      uploadId: 's2',
      sourceFileName: 'sbn-ss.xlsx',
      date: '2026-08-10',
      platform: '스마트스토어',
      salesMethod: '일반배송',
      storeName: '사본느리',
      dataSourceLabel: '사본느리',
      uploadKind: 'company_b',
      sales: '150000',
      salesQty: '15',
      netProfit: '45000',
      totalCost: '',
    },
  ]
}

function findRow(aoa, pred) {
  return aoa.find((r) => pred(String(r?.[0] ?? ''), r))
}

function extractTable(aoa, startPred, { stopPred, headerPred } = {}) {
  const start = aoa.findIndex((r) => startPred(String(r?.[0] ?? ''), r))
  if (start < 0) return { header: null, body: [], total: null }
  let i = start + 1
  let header = null
  if (headerPred) {
    while (i < aoa.length && !headerPred(String(aoa[i]?.[0] ?? ''), aoa[i])) i += 1
    header = aoa[i] || null
    i += 1
  }
  const body = []
  let total = null
  for (; i < aoa.length; i += 1) {
    const r = aoa[i]
    const c0 = String(r?.[0] ?? '')
    if (!r?.length) continue
    if (stopPred && stopPred(c0, r)) break
    if (c0.includes('【') && c0.includes('합계')) {
      total = r
      break
    }
    if (c0 === '일별 요약' || c0.startsWith('■ ')) break
    body.push(r)
  }
  return { header, body, total }
}

function metricsFromTotalRow(row, map) {
  if (!row) return null
  const out = {}
  for (const [key, idx] of Object.entries(map)) {
    out[key] = parseAmount(row[idx])
  }
  return out
}

function checkIdentity(label, m, failures, { requireSalesCostMargin = false } = {}) {
  if (!m) {
    failures.push(`${label}: 합계 행 없음`)
    return
  }
  // 쿠팡 빅셀 순이익은 수수료 차감 후라 매출≠원가+마진이 정상.
  // 스마트스토어(원가 역산) 행만 항등식 검사.
  if (
    requireSalesCostMargin &&
    !nearly(m.sales, (m.totalCost || 0) + (m.netProfit || 0))
  ) {
    failures.push(
      `${label}: 매출(${m.sales}) ≠ 원가(${m.totalCost})+마진(${m.netProfit}) = ${(m.totalCost || 0) + (m.netProfit || 0)}`,
    )
  }
  if (m.organicSales != null && m.adSales != null) {
    const expectOrg = Math.max(0, (m.sales || 0) - (m.adSales || 0))
    if (!nearly(m.organicSales, expectOrg)) {
      failures.push(
        `${label}: 자연매출(${m.organicSales}) ≠ 매출-광고매출(${expectOrg})`,
      )
    }
  }
}

function compareToSot(label, m, sot, keys, failures) {
  if (!m) {
    failures.push(`${label}: 합계 없음`)
    return
  }
  for (const key of keys) {
    if (!nearly(m[key], sot[key])) {
      failures.push(`${label}.${key}=${m[key]} ≠ SoT.${key}=${sot[key]}`)
    }
  }
}

function sumBody(body, idx) {
  return body.reduce((s, r) => s + parseAmount(r[idx]), 0)
}

function main() {
  const records = sampleRecords()
  const manualFilterCtx = {
    dateFrom: '2026-08-10',
    dateTo: '2026-08-10',
    period: 'daily',
  }
  const splitRows = buildKpiSplitRowsForChannel('통합', records, [], manualFilterCtx)
  const total = segmentTotalKpiFromRows(splitRows)
  const sot = {
    sales: total.sales,
    totalCost: total.totalCost,
    netProfit: total.netProfit,
    salesQty: total.salesQty,
    adSpend: total.adSpend,
    adSales: total.adSales,
    organicSales: Math.max(0, (total.sales || 0) - (total.adSales || 0)),
  }

  const aoa = buildIntegratedProfitLossSummaryRows({
    saleRecords: records,
    channelGroups: [],
    manualFilterCtx,
    filters: manualFilterCtx,
    splitRows,
  })

  const failures = []
  const report = []

  const verLine = findRow(aoa, (c0) => c0.includes('양식 v'))
  if (!String(verLine?.[0] || '').includes(`v${INTEGRATED_REPORT_LAYOUT_VER}`)) {
    failures.push(`양식 버전 불일치 (기대 v${INTEGRATED_REPORT_LAYOUT_VER})`)
  }
  if (aoa.some((r) => String(r?.[0] || '') === '판매방식별 손익 계산')) {
    failures.push('판매방식별 손익 계산 섹션이 ①요약리포트에 남아 있음')
  }

  // —— 세그먼트 행합 vs 합계
  const segBody = splitRows.filter((r) => r.label !== '합계')
  const segSum = {
    sales: segBody.reduce((s, r) => s + (r.profit?.sales || 0), 0),
    totalCost: segBody.reduce((s, r) => s + (r.profit?.totalCost || 0), 0),
    netProfit: segBody.reduce((s, r) => s + (r.profit?.netProfit || 0), 0),
    salesQty: segBody.reduce((s, r) => s + (r.profit?.salesQty || 0), 0),
    adSpend: segBody.reduce((s, r) => s + (r.ad?.adSpend || 0), 0),
    adSales: segBody.reduce((s, r) => s + (r.ad?.adSales || 0), 0),
  }
  for (const key of Object.keys(segSum)) {
    if (!nearly(segSum[key], sot[key] ?? total[key])) {
      failures.push(`세그먼트 행합.${key}=${segSum[key]} ≠ 합계=${sot[key] ?? total[key]}`)
    }
  }
  for (const r of segBody) {
    const sales = r.profit?.sales || 0
    const cost = r.profit?.totalCost || 0
    const margin = r.profit?.netProfit || 0
    // 스스만 원가 역산 → 항등식 기대
    if (String(r.label).includes('스스') && sales > 0 && !nearly(sales, cost + margin)) {
      failures.push(`세그먼트[${r.label}] 매출≠원가+마진 (${sales}≠${cost}+${margin})`)
    }
  }
  report.push(`SoT 매출=${sot.sales} 원가=${sot.totalCost} 마진=${sot.netProfit} 수량=${sot.salesQty} 광고=${sot.adSpend}/${sot.adSales}`)

  // —— 손익요약
  const pnlSales = findRow(aoa, (c0) => c0.startsWith('①'))
  const pnlCost = findRow(aoa, (c0) => c0.startsWith('②'))
  const pnlGross = findRow(aoa, (c0) => c0.startsWith('③'))
  const pnlAd = findRow(aoa, (c0) => c0.startsWith('④') && c0.includes('광고'))
  const pnlNet = findRow(aoa, (c0) => c0.startsWith('⑥'))
  const pnl = {
    sales: parseAmount(pnlSales?.[1]),
    totalCost: parseAmount(pnlCost?.[1]),
    gross: parseAmount(pnlGross?.[1]),
    adSpend: parseAmount(pnlAd?.[1]),
    netProfit: parseAmount(pnlNet?.[1]),
  }
  compareToSot('손익요약', pnl, sot, ['sales', 'totalCost', 'netProfit', 'adSpend'], failures)
  if (!nearly(pnl.gross, pnl.sales - pnl.totalCost)) {
    failures.push(`손익요약 매출총이익(${pnl.gross}) ≠ 매출-원가(${pnl.sales - pnl.totalCost})`)
  }
  report.push(`손익 매출=${pnl.sales} 원가=${pnl.totalCost} 마진=${pnl.netProfit} 광고=${pnl.adSpend}`)

  // —— 판매방식별 섹션은 v34에서 통합 ①요약리포트에서 제거됨

  // —— 스토어
  const store = extractTable(
    aoa,
    (c0) => c0 === '스토어별 손익 현황',
    { headerPred: (c0) => c0 === '스토어명' },
  )
  const storeTot = metricsFromTotalRow(store.total, {
    sales: 1,
    totalCost: 2,
    salesQty: 3,
    netProfit: 4,
    adSpend: 6,
    adSales: 7,
    organicSales: 8,
  })
  checkIdentity('스토어합계', storeTot, failures)
  compareToSot(
    '스토어합계',
    storeTot,
    sot,
    ['sales', 'netProfit', 'salesQty', 'adSpend', 'adSales', 'organicSales'],
    failures,
  )
  if (storeTot && !nearly(storeTot.totalCost, sot.totalCost, 2)) {
    failures.push(`스토어합계.totalCost=${storeTot.totalCost} ≠ SoT.totalCost=${sot.totalCost}`)
  }
  if (storeTot && store.body.length) {
    if (!nearly(sumBody(store.body, 1), storeTot.sales)) failures.push('스토어 매출 행합 ≠ 합계')
    if (!nearly(sumBody(store.body, 2), storeTot.totalCost, 2)) failures.push('스토어 원가 행합 ≠ 합계')
    if (!nearly(sumBody(store.body, 4), storeTot.netProfit)) failures.push('스토어 마진 행합 ≠ 합계')
    for (const r of store.body) {
      if (String(r[0]) === '에쎄르') failures.push('스토어에 에쎄르 행 존재')
    }
  }
  report.push(
    `스토어 매출=${storeTot?.sales} 원가=${storeTot?.totalCost} 마진=${storeTot?.netProfit} 수량=${storeTot?.salesQty} 광고=${storeTot?.adSpend}/${storeTot?.adSales}`,
  )

  // —— 일별 (브랜드 합계 합산)
  const dailyBrandTotals = aoa.filter(
    (r) =>
      String(r?.[0] || '').includes('합계】') &&
      (String(r[0]).includes('베스트하임') ||
        String(r[0]).includes('사본느리') ||
        String(r[0]).includes('파워프라이스')),
  )
  const dailySum = {
    sales: 0,
    totalCost: 0,
    salesQty: 0,
    netProfit: 0,
    adSpend: 0,
    adSales: 0,
    organicSales: 0,
  }
  for (const r of dailyBrandTotals) {
    dailySum.sales += parseAmount(r[1])
    dailySum.totalCost += parseAmount(r[2])
    dailySum.salesQty += parseAmount(r[3])
    dailySum.netProfit += parseAmount(r[4])
    dailySum.adSpend += parseAmount(r[6])
    dailySum.adSales += parseAmount(r[7])
    dailySum.organicSales += parseAmount(r[10])
  }
  checkIdentity('일별브랜드합', dailySum, failures)
  compareToSot(
    '일별브랜드합',
    dailySum,
    sot,
    ['sales', 'netProfit', 'salesQty', 'adSpend', 'adSales', 'organicSales'],
    failures,
  )
  if (!nearly(dailySum.totalCost, sot.totalCost, 2)) {
    failures.push(`일별브랜드합.totalCost=${dailySum.totalCost} ≠ SoT.totalCost=${sot.totalCost}`)
  }
  report.push(
    `일별합 매출=${dailySum.sales} 원가=${dailySum.totalCost} 마진=${dailySum.netProfit} 수량=${dailySum.salesQty} 광고=${dailySum.adSpend}/${dailySum.adSales}`,
  )

  console.log('=== 통합 엑셀 섹션 교차 검증 ===')
  console.log(`양식 v${INTEGRATED_REPORT_LAYOUT_VER}`)
  for (const line of report) console.log(line)
  console.log('세그먼트:', splitRows.map((r) => r.label).join(' | '))

  if (failures.length) {
    console.error('FAIL')
    for (const f of failures) console.error(' -', f)
    process.exit(1)
  }
  console.log(
    'PASS — SoT=손익=스토어=일별 (매출·원가·마진·수량·광고비·광고매출·자연매출), 행 항등식 OK',
  )
}

main()
