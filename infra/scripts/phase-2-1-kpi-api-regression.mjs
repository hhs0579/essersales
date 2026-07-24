#!/usr/bin/env node
/**
 * Phase 2-1 — client KPI vs server KPI API regression.
 * node infra/scripts/phase-2-1-kpi-api-regression.mjs
 */
import { adaptPgRecordList } from '../../src/services/adapters/recordsAdapter.js'
import { loadDotEnv } from './lib/migration-utils.mjs'
import { summarizeEsserKpis, aggregateEsserByDay } from '../../src/utils/esserMetrics.js'
import { isReturnRecord } from '../../src/utils/transactionType.js'
import { resolveRecordDateForAggregation } from '../../src/utils/recordFilters.js'

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const EPS = 1

function okLine(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

async function fetchJson(path) {
  const res = await fetch(`${PG}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

async function loadAllDetailRecords() {
  const items = []
  let page = 1
  let total = Infinity
  while (items.length < total) {
    const body = await fetchJson(
      `/records?page=${page}&limit=500&record_type=detail&include_data=true`,
    )
    items.push(...body.items)
    total = body.total
    if (!body.items.length || page * 500 >= total) break
    page += 1
  }
  return adaptPgRecordList(items)
}

function clientProductRows(records) {
  return records.filter((r) => !isReturnRecord(r) && r?.isEsserSheetTotal !== true)
}

function clientSummary(records) {
  const kpi = summarizeEsserKpis(records)
  return {
    salesTotal: Math.round(kpi.sales),
    quantityTotal: Math.round(kpi.salesQty),
    recordCount: records.length,
    netProfitTotal: Math.round(kpi.netProfit),
    adSpendTotal: Math.round(kpi.adSpend),
  }
}

function clientDailyMap(records) {
  const productRows = clientProductRows(records)
  const buckets = aggregateEsserByDay(productRows)
  const map = new Map()
  for (const b of buckets) {
    const date = b.label || b.date
    if (!date) continue
    map.set(date, {
      salesTotal: Math.round(b.sales),
      quantityTotal: Math.round(b.salesQty),
    })
  }
  return map
}

function nearlyEqual(a, b, eps = EPS) {
  return Math.abs(Number(a) - Number(b)) <= eps
}

async function main() {
  loadDotEnv()
  let allOk = true

  const records = await loadAllDetailRecords()
  const client = clientSummary(records)
  const clientDaily = clientDailyMap(records)

  const server = await fetchJson('/kpi/summary?include_manual_ads=false')
  const serverDaily = await fetchJson('/kpi/daily?include_manual_ads=false')

  allOk =
    okLine(
      'summary salesTotal',
      nearlyEqual(client.salesTotal, server.salesTotal),
      `client=${client.salesTotal} server=${server.salesTotal}`,
    ) && allOk

  allOk =
    okLine(
      'summary quantityTotal',
      nearlyEqual(client.quantityTotal, server.quantityTotal),
      `client=${client.quantityTotal} server=${server.quantityTotal}`,
    ) && allOk

  allOk =
    okLine(
      'summary recordCount (all rows)',
      server.recordCount === records.length,
      `server=${server.recordCount} rows=${records.length}`,
    ) && allOk

  allOk =
    okLine(
      'daily rows',
      serverDaily.items.length === clientDaily.size,
      `client=${clientDaily.size} server=${serverDaily.items.length}`,
    ) && allOk

  let dailySalesOk = true
  let dailyQtyOk = true
  const salesDiffs = []
  const qtyDiffs = []

  for (const [date, vals] of clientDaily) {
    const row = serverDaily.items.find((i) => i.date === date)
    if (!row) {
      dailySalesOk = false
      salesDiffs.push(`${date}: missing on server`)
      continue
    }
    if (!nearlyEqual(vals.salesTotal, row.salesTotal)) {
      dailySalesOk = false
      salesDiffs.push(`${date}: client=${vals.salesTotal} server=${row.salesTotal}`)
    }
    if (!nearlyEqual(vals.quantityTotal, row.quantityTotal)) {
      dailyQtyOk = false
      qtyDiffs.push(`${date}: client=${vals.quantityTotal} server=${row.quantityTotal}`)
    }
  }

  for (const row of serverDaily.items) {
    if (!clientDaily.has(row.date)) {
      dailySalesOk = false
      salesDiffs.push(`${row.date}: extra on server`)
    }
  }

  allOk = okLine('daily salesTotal by date', dailySalesOk, salesDiffs.slice(0, 5).join('; ')) && allOk
  allOk = okLine('daily quantityTotal by date', dailyQtyOk, qtyDiffs.slice(0, 5).join('; ')) && allOk

  if (serverDaily.items.length) {
    const sample = clientDaily.has('2026-06-01')
      ? '2026-06-01'
      : serverDaily.items[0].date
    const filtered = await fetchJson(`/kpi/daily?from=${sample}&to=${sample}&include_manual_ads=false`)
    const clientFiltered = clientDailyMap(
      records.filter((r) => {
        const adapted = clientProductRows([r])[0] || r
        return String(adapted.date || '').startsWith(sample.slice(0, 8)) || true
      }),
    )
    // client filter: re-aggregate product rows matching date bucket
    const productRows = clientProductRows(records)
    const clientBuckets = aggregateEsserByDay(productRows)
    const cf = clientBuckets.find((b) => b.label === sample)
    const sf = filtered.items.find((i) => i.date === sample)
    allOk =
      okLine(
        'filter daily salesTotal',
        cf && sf && nearlyEqual(Math.round(cf.sales), sf.salesTotal),
        cf && sf ? `date=${sample} client=${Math.round(cf.sales)} server=${sf.salesTotal}` : 'no data',
      ) && allOk
  }

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
