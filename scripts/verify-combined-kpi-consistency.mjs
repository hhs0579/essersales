/**
 * 통합 매출·원가·마진 SoT 불변식 검증 (세그먼트 합계 = 행합 = 손익요약)
 * Usage: node scripts/verify-combined-kpi-consistency.mjs
 */
import { buildKpiSplitRowsForChannel } from '../src/utils/platformKpiSplit.js'
import {
  segmentTotalKpiFromRows,
  sumSegmentRowsExcludingTotal,
  buildIntegratedProfitLossSummaryRows,
  INTEGRATED_REPORT_LAYOUT_VER,
} from '../src/utils/profitLossReportExporter.js'
import { parseAmount } from '../src/utils/parseAmount.js'

function round2(n) {
  return Number(Number(n).toFixed(2))
}

function nearly(a, b, tol = 1) {
  return Math.abs(round2(a) - round2(b)) <= tol
}

function sampleRecords() {
  return [
    {
      date: '2026-07-01',
      platform: '쿠팡',
      salesMethod: '판매자',
      storeName: '베스트하임',
      dataSourceLabel: '베스트하임',
      uploadKind: 'platform_daily',
      sales: 1_000_000,
      salesQty: 10,
      netProfit: 200_000,
      totalCost: 800_000,
      adSpend: 50_000,
    },
    {
      date: '2026-07-01',
      platform: '스마트스토어',
      salesMethod: '일반배송',
      storeName: '베스트하임',
      dataSourceLabel: '베스트하임',
      uploadKind: 'platform_daily',
      sales: 500_000,
      salesQty: 5,
      netProfit: 100_000,
      totalCost: 0,
      adSpend: 0,
    },
    {
      date: '2026-07-01',
      platform: '쿠팡',
      salesMethod: '판매자',
      storeName: '주식회사 에쎄르',
      dataSourceLabel: '사본느리',
      uploadKind: 'company_b',
      sales: 300_000,
      salesQty: 3,
      netProfit: 60_000,
      totalCost: 240_000,
      adSpend: 10_000,
    },
    {
      date: '2026-07-01',
      platform: '스마트스토어',
      salesMethod: '일반배송',
      storeName: '사본느리',
      dataSourceLabel: '사본느리',
      uploadKind: 'company_b',
      sales: 200_000,
      salesQty: 2,
      netProfit: 40_000,
      totalCost: 0,
      adSpend: 0,
    },
  ]
}

function main() {
  const records = sampleRecords()
  const channelGroups = []
  const manualFilterCtx = { dateFrom: '2026-07-01', dateTo: '2026-07-01', period: 'daily' }

  const splitRows = buildKpiSplitRowsForChannel('통합', records, channelGroups, manualFilterCtx)
  const total = segmentTotalKpiFromRows(splitRows)
  const rowSum = sumSegmentRowsExcludingTotal(splitRows)

  const failures = []
  if (!total) failures.push('세그먼트 합계 행 없음')

  if (total && !nearly(total.sales, rowSum.sales)) {
    failures.push(`매출 행합(${rowSum.sales}) ≠ 합계(${total.sales})`)
  }
  if (total && !nearly(total.totalCost, rowSum.totalCost)) {
    failures.push(`원가 행합(${rowSum.totalCost}) ≠ 합계(${total.totalCost})`)
  }
  if (total && !nearly(total.netProfit, rowSum.netProfit)) {
    failures.push(`마진 행합(${rowSum.netProfit}) ≠ 합계(${total.netProfit})`)
  }

  // 에쎄르 스토어명 → 사본느리로만 잡혀야 함
  const labels = splitRows.map((r) => r.label)
  if (labels.includes('에쎄르')) {
    failures.push('세그먼트에 에쎄르 라벨이 남아 있음')
  }

  const aoa = buildIntegratedProfitLossSummaryRows({
    saleRecords: records,
    channelGroups,
    manualFilterCtx,
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-01' },
    splitRows,
    totalKpi: total,
    costKpi: { totalCost: total?.totalCost ?? 0 },
  })

  const verLine = aoa.find((r) => String(r?.[0] || '').includes('양식 v'))
  if (!String(verLine?.[0] || '').includes(`v${INTEGRATED_REPORT_LAYOUT_VER}`)) {
    failures.push(`레이아웃 버전 미반영 (기대 v${INTEGRATED_REPORT_LAYOUT_VER})`)
  }

  // 손익요약 ①매출·②원가
  let pnlSales = null
  let pnlCost = null
  let inPnl = false
  for (const row of aoa) {
    const c0 = String(row?.[0] ?? '')
    if (c0 === '손익계산 요약') {
      inPnl = true
      continue
    }
    if (inPnl && c0.startsWith('①')) pnlSales = parseAmount(row[1])
    if (inPnl && c0.startsWith('②')) pnlCost = parseAmount(row[1])
    if (inPnl && c0.startsWith('스토어')) break
    if (inPnl && c0 === '스토어별 손익 현황') break
  }

  if (total && pnlSales != null && !nearly(pnlSales, total.sales)) {
    failures.push(`손익요약 매출(${pnlSales}) ≠ 세그먼트 합계(${total.sales})`)
  }
  if (total && pnlCost != null && !nearly(pnlCost, total.totalCost)) {
    failures.push(`손익요약 원가(${pnlCost}) ≠ 세그먼트 합계(${total.totalCost})`)
  }

  // 스토어별 — 에쎄르 행 없음, 합계=SoT=행합
  let inStore = false
  const storeBody = []
  for (const row of aoa) {
    const c0 = String(row?.[0] ?? '')
    if (c0 === '스토어별 손익 현황') {
      inStore = true
      continue
    }
    if (!inStore) continue
    if (c0 === '일별 요약' || c0.startsWith('■')) break
    if (!c0 || c0 === '스토어명') continue
    if (c0.startsWith('【전체 합계】')) {
      const bodySales = storeBody.reduce((s, r) => s + parseAmount(r[1]), 0)
      const bodyCost = storeBody.reduce((s, r) => s + parseAmount(r[2]), 0)
      const bodyNet = storeBody.reduce((s, r) => s + parseAmount(r[4]), 0)
      const totSales = parseAmount(row[1])
      const totCost = parseAmount(row[2])
      const totNet = parseAmount(row[4])
      if (!nearly(bodySales, totSales)) {
        failures.push(`스토어 매출 행합(${bodySales}) ≠ 합계(${totSales})`)
      }
      if (!nearly(bodyCost, totCost)) {
        failures.push(`스토어 원가 행합(${bodyCost}) ≠ 합계(${totCost})`)
      }
      if (total && !nearly(totSales, total.sales)) {
        failures.push(`스토어 합계 매출(${totSales}) ≠ SoT(${total.sales})`)
      }
      if (total && !nearly(totCost, total.totalCost)) {
        failures.push(`스토어 합계 원가(${totCost}) ≠ SoT(${total.totalCost})`)
      }
      if (total && !nearly(totNet, total.netProfit)) {
        failures.push(`스토어 합계 마진(${totNet}) ≠ SoT(${total.netProfit})`)
      }
      break
    }
    if (c0 === '에쎄르') failures.push('스토어별에 에쎄르 행이 남아 있음')
    storeBody.push(row)
  }

  console.log('=== 통합 KPI 일관성 검증 ===')
  console.log('세그먼트 라벨:', labels.join(' | '))
  if (total) {
    console.log(
      `합계 매출=${total.sales} 원가=${total.totalCost} 마진=${total.netProfit} 광고=${total.adSpend}`,
    )
  }
  console.log(`손익요약 매출=${pnlSales} 원가=${pnlCost}`)

  if (failures.length) {
    console.error('FAIL')
    for (const f of failures) console.error(' -', f)
    process.exit(1)
  }
  console.log('PASS — 세그먼트 행합 = 합계 = 손익요약(매출·원가), 에쎄르 스토어 없음')
}

main()
