import { parseSalesDate, WEEKDAY_LABELS } from './dateParse.js'
import { getRecordDate } from './recordFilters.js'
export { parseAmount, coalesceField, firstAmount } from './parseAmount.js'
import { parseAmount, firstAmount } from './parseAmount.js'
import { isReturnRecord } from './transactionType.js'
import { resolveRecordPlatform } from './platformDetect.js'
import { isEsserDetailRow } from '../constants/salesColumns.js'
import { esserBucketsToDailyTabRows, aggregateEsserByDay } from './esserMetrics.js'

function emptyBucket() {
  return {
    revenue: 0,
    settlement: 0,
    margin: 0,
    totalCost: 0,
    quantity: 0,
    shippingFee: 0,
    count: 0,
  }
}

/** 상세 거래 1행 → 차트용 지표 */
export function rowMetrics(row) {
  const isEsser =
    row.uploadFormat === 'coupang_esser' ||
    row.uploadFormat === 'coupang_esser_period' ||
    row.uploadFormat === 'coupang_esser_monthly' ||
    (row.sales != null && row.sales !== '') ||
    (row.netProfit != null && row.netProfit !== '') ||
    (row.revenue != null && row.revenue !== '')
  const revenue = isEsser
    ? firstAmount(row, 'sales', 'actualPayment', 'revenue', 'settlementPrice')
    : parseAmount(row.actualPayment) || parseAmount(row.settlementPrice) || parseAmount(row.revenue)
  const settlement = parseAmount(row.settlementPrice) || revenue
  const margin = isEsser
    ? firstAmount(row, 'netProfit', 'margin')
    : parseAmount(row.margin)
  let totalCost = parseAmount(row.totalCost)
  if (isEsser) {
    const direct = firstAmount(row, 'totalCost', 'sales_cost')
    if (direct) totalCost = direct
    else {
      const qty = firstAmount(row, 'salesQty', 'quantity')
      const unit = firstAmount(row, 'unitCost', 'cost_price')
      if (unit && qty) totalCost = unit * qty
    }
  }
  const quantity = isEsser
    ? firstAmount(row, 'salesQty', 'quantity')
    : parseAmount(row.quantity)
  const shippingFee = parseAmount(row.shippingFee)

  return {
    revenue,
    settlement,
    margin,
    totalCost,
    quantity,
    shippingFee,
    marginRate: revenue > 0 ? (margin / revenue) * 100 : 0,
    costRate: revenue > 0 ? (totalCost / revenue) * 100 : 0,
    aov: quantity > 0 ? revenue / quantity : 0,
    revenuePerCost: totalCost > 0 ? revenue / totalCost : 0,
    roi: totalCost > 0 ? (margin / totalCost) * 100 : 0,
  }
}

function addToBucket(bucket, m) {
  bucket.revenue += m.revenue
  bucket.settlement += m.settlement
  bucket.margin += m.margin
  bucket.totalCost += m.totalCost
  bucket.quantity += m.quantity
  bucket.shippingFee += m.shippingFee
  bucket.count += 1
}

/** 합산 후 비율·평균형 지표 재계산 */
export function finalizeBucket(bucket) {
  const r = bucket.revenue
  return {
    ...bucket,
    marginRate: r > 0 ? (bucket.margin / r) * 100 : 0,
    costRate: r > 0 ? (bucket.totalCost / r) * 100 : 0,
    aov: bucket.quantity > 0 ? r / bucket.quantity : 0,
    revenuePerCost: bucket.totalCost > 0 ? r / bucket.totalCost : 0,
    roi: bucket.totalCost > 0 ? (bucket.margin / bucket.totalCost) * 100 : 0,
  }
}

export function getMetricValue(bucket, metricKey) {
  const b = finalizeBucket(bucket)
  if (metricKey === 'salesQty') return b.quantity ?? 0
  return b[metricKey] ?? 0
}

import { storeLabelFromRow } from './storeLabel.js'
export { storeLabelFromRow } from './storeLabel.js'

export function aggregateDetailsByChannel(details) {
  const map = new Map()
  for (const row of details) {
    const label = resolveRecordPlatform(row)
    if (!label || label === '미지정') continue
    if (!map.has(label)) map.set(label, emptyBucket())
    addToBucket(map.get(label), rowMetrics(row))
  }
  return [...map.entries()]
    .map(([label, bucket]) => ({ label, ...finalizeBucket(bucket) }))
    .sort((a, b) => b.revenue - a.revenue)
}

/** 스토어명(brand / storeName)별 집계 */
export function aggregateDetailsByStore(details) {
  const map = new Map()
  for (const row of details) {
    const label = storeLabelFromRow(row)
    if (!map.has(label)) map.set(label, emptyBucket())
    addToBucket(map.get(label), rowMetrics(row))
  }
  return [...map.entries()]
    .map(([label, bucket]) => ({ label, ...finalizeBucket(bucket) }))
    .sort((a, b) => b.revenue - a.revenue)
}

export function aggregateDetailsByProductOption(details) {
  const map = new Map()
  for (const row of details) {
    const name = row.productName || ''
    if (!name) continue
    const opt = row.option ? ` / ${row.option}` : ''
    const label = `${name}${opt}`
    if (!map.has(label)) map.set(label, emptyBucket())
    addToBucket(map.get(label), rowMetrics(row))
  }
  return [...map.entries()]
    .map(([label, bucket]) => ({ label, ...finalizeBucket(bucket) }))
    .sort((a, b) => b.revenue - a.revenue)
}

function summaryRowFromBucket(type, seed, bucket, index) {
  const b = finalizeBucket(bucket)
  const revenue = Math.round(b.revenue)
  const margin = Math.round(b.margin)
  const quantity = Math.round(b.quantity)
  const totalCost = Math.round(b.totalCost)
  return {
    id: `sum-${type}-${index}`,
    recordType: type,
    ...seed,
    ...b,
    revenue: String(revenue),
    margin: String(margin),
    totalCost: String(totalCost),
    sales: String(revenue),
    netProfit: String(margin),
    quantity: String(quantity),
    salesQty: String(quantity),
    marginRate: b.revenue > 0 ? `${b.marginRate.toFixed(2)}%` : '',
    sourceFileName: '상세거래 집계',
  }
}

/** 상세 거래 → 판매처/상품/옵션별 집계 (플랫폼 일일·에쎄르 호환) */
export function buildSummaryTabFromDetails(type, details) {
  if (type === 'daily') {
    if (details.some(isEsserDetailRow)) return esserBucketsToDailyTabRows(aggregateEsserByDay(details))
    return buildDailySummaryFromDetails(details)
  }

  const buckets = new Map()

  for (const row of details) {
    if (isReturnRecord(row)) continue
    const m = rowMetrics(row)
    let key = ''
    let seed = null

    if (type === 'channel') {
      key = resolveRecordPlatform(row)
      if (!key || key === '미지정') continue
      seed = { channel: key, platform: key }
    } else if (type === 'product') {
      key = (row.productName || '').trim()
      if (!key) continue
      seed = { productName: key }
    } else if (type === 'productOption') {
      const p = (row.productName || '').trim()
      const o = String(row.option || row.optionName || '').trim()
      if (!p) continue
      key = `${p}\0${o}`
      seed = { productName: p, option: o }
    } else {
      continue
    }

    if (!buckets.has(key)) buckets.set(key, { ...seed, ...emptyBucket() })
    addToBucket(buckets.get(key), m)
  }

  return [...buckets.values()]
    .map((agg, i) => {
      let seed
      if (type === 'channel') {
        seed = { channel: agg.channel, platform: agg.platform }
      } else if (type === 'product') {
        seed = { productName: agg.productName }
      } else {
        seed = { productName: agg.productName, option: agg.option }
      }
      return summaryRowFromBucket(type, seed, agg, i)
    })
    .sort((a, b) => parseAmount(b.revenue) - parseAmount(a.revenue))
}

/** 일별 집계: 상세 거래 실결제가 기준 */
export function buildDailySummaryFromDetails(details) {
  const map = new Map()

  for (const row of details) {
    // 기간 합산(상품별) 행은 일별 탭에 넣지 않음 — 날짜가 "5.1~6.1" 한 줄로만 잡힘
    if (row.uploadFormat === 'coupang_esser_period' || row.periodFrom) continue
    if (isReturnRecord(row)) continue

    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue

    const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
    if (!map.has(key)) {
      map.set(key, { date: row.date, sortTime: p.date.getTime(), ...emptyBucket() })
    }
    addToBucket(map.get(key), rowMetrics(row))
  }

  return [...map.values()]
    .sort((a, b) => a.sortTime - b.sortTime)
    .map((x, i) => {
      const b = finalizeBucket(x)
      const qty = Math.round(b.quantity)
      return {
        id: `daily-sum-${i}`,
        recordType: 'daily',
        date: x.date,
        sortTime: x.sortTime,
        ...b,
        revenue: String(Math.round(b.revenue)),
        margin: String(Math.round(b.margin)),
        totalCost: String(Math.round(b.totalCost)),
        marginRate: b.revenue > 0 ? `${b.marginRate.toFixed(2)}%` : '',
        quantity: String(qty),
        salesQty: String(qty),
        sourceFileName: '상세거래 집계',
      }
    })
}

export function recordHasDate(row) {
  return !!parseSalesDate(getRecordDate(row))
}

/** 년도별 집계 */
export function aggregateByYear(rows) {
  const map = new Map()
  for (const row of rows) {
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    const key = String(p.year)
    if (!map.has(key)) map.set(key, emptyBucket())
    addToBucket(map.get(key), rowMetrics(row))
  }
  return [...map.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([label, bucket]) => ({ label: `${label}년`, ...finalizeBucket(bucket) }))
}

/** 월별 집계 */
export function aggregateByMonth(rows, filterYear) {
  const map = new Map()
  for (let m = 1; m <= 12; m++) map.set(m, emptyBucket())

  for (const row of rows) {
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    if (filterYear && String(p.year) !== String(filterYear)) continue
    addToBucket(map.get(p.month), rowMetrics(row))
  }

  return [...map.entries()].map(([m, bucket]) => ({
    label: `${m}월`,
    month: m,
    ...finalizeBucket(bucket),
  }))
}

/** ISO 주차 정보 (월요일 시작) */
export function getIsoWeekInfo(date) {
  const d = new Date(date.getTime())
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() || 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - day + 1)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const weekYear = thursday.getFullYear()
  const yearStart = new Date(weekYear, 0, 1)
  const weekNo = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7)

  return {
    key: `${weekYear}-W${String(weekNo).padStart(2, '0')}`,
    weekNo,
    weekYear,
    monday,
    sunday,
    sortTime: monday.getTime(),
  }
}

function formatWeekLabel(info) {
  const fmt = (dt) => `${dt.getMonth() + 1}/${dt.getDate()}`
  return `${info.key} (${fmt(info.monday)}~${fmt(info.sunday)})`
}

/** 주간 집계 (ISO 주차) */
export function aggregateByWeek(rows, filterYear) {
  const map = new Map()

  for (const row of rows) {
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    const w = getIsoWeekInfo(p.date)
    if (filterYear && String(w.weekYear) !== String(filterYear)) continue

    if (!map.has(w.key)) {
      map.set(w.key, {
        label: formatWeekLabel(w),
        sortTime: w.sortTime,
        weekYear: w.weekYear,
        weekNo: w.weekNo,
        ...emptyBucket(),
      })
    }
    addToBucket(map.get(w.key), rowMetrics(row))
  }

  return [...map.values()]
    .sort((a, b) => a.sortTime - b.sortTime)
    .map((x) => {
      const b = finalizeBucket(x)
      return { label: x.label, sortTime: x.sortTime, ...b }
    })
}

/** 요일별 집계 */
export function aggregateByWeekday(rows) {
  const map = new Map()
  for (let d = 0; d < 7; d++) map.set(d, emptyBucket())

  for (const row of rows) {
    const p = parseSalesDate(getRecordDate(row))
    if (!p) continue
    addToBucket(map.get(p.dayOfWeek), rowMetrics(row))
  }

  return [...map.entries()].map(([d, bucket]) => ({
    label: WEEKDAY_LABELS[d],
    dayOfWeek: d,
    ...finalizeBucket(bucket),
  }))
}

/** KPI 요약 (상단 카드용) */
export function summarizeKpis(details) {
  const bucket = emptyBucket()
  for (const row of details) {
    if (isReturnRecord(row)) continue
    addToBucket(bucket, rowMetrics(row))
  }
  return finalizeBucket(bucket)
}
