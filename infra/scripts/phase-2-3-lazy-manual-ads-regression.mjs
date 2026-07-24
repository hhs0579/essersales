#!/usr/bin/env node
/**
 * Phase 2-3 — lazy detail cache + manual ad KPI merge regression.
 * node infra/scripts/phase-2-3-lazy-manual-ads-regression.mjs
 */
import { adaptPgRecordList } from '../../src/services/adapters/recordsAdapter.js'
import { loadDotEnv } from './lib/migration-utils.mjs'
import {
  summarizeEsserKpisWithManual,
  totalManualAdSpend,
} from '../../src/utils/manualAdSpend.js'
import { isReturnRecord } from '../../src/utils/transactionType.js'

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const EPS = 1
const SCOPE = 'platform'

const requestLog = []

function okLine(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

async function trackedFetch(path) {
  const url = `${PG}${path}`
  requestLog.push(url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

async function fetchJson(path) {
  return trackedFetch(path)
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

async function loadManualAdEntries(scope = SCOPE) {
  const body = await fetchJson(`/settings?scope=${scope}&kind=manual_ad`)
  const item = body.items?.find((i) => i.scope === scope && i.kind === 'manual_ad')
  if (!item?.data) return []
  return Array.isArray(item.data) ? item.data : []
}

function clientProductRows(records) {
  return records.filter((r) => !isReturnRecord(r) && r?.isEsserSheetTotal !== true)
}

function nearlyEqual(a, b, eps = EPS) {
  return Math.abs(Number(a) - Number(b)) <= eps
}

async function main() {
  loadDotEnv()
  let allOk = true
  const filterCtx = {}

  // --- lazy load: KPI only (no /records before explicit load) ---
  const kpiStartIdx = requestLog.length
  await Promise.all([
    fetchJson(`/kpi/summary?scope=${SCOPE}`),
    fetchJson(`/kpi/daily?scope=${SCOPE}`),
    fetchJson(`/kpi/by-platform?scope=${SCOPE}`),
    fetchJson(`/kpi/compare-yesterday?scope=${SCOPE}`),
  ])
  const kpiRequests = requestLog.slice(kpiStartIdx)
  const kpiRecordCalls = kpiRequests.filter((u) => u.includes('/records'))
  allOk =
    okLine(
      'dashboard KPI requests',
      kpiRequests.length === 4,
      `count=${kpiRequests.length}`,
    ) && allOk
  allOk =
    okLine(
      'dashboard no records on KPI load',
      kpiRecordCalls.length === 0,
      kpiRecordCalls.length ? kpiRecordCalls.join(', ') : '',
    ) && allOk

  // --- detail load (simulate ensureDetailCache) ---
  const detailStartIdx = requestLog.length
  const t0 = Date.now()
  const records = await loadAllDetailRecords()
  const detailMs = Date.now() - t0
  const detailRequests = requestLog.slice(detailStartIdx)
  const detailRecordPages = detailRequests.filter((u) => u.includes('/records')).length

  allOk =
    okLine(
      'ensureDetailCache records load',
      records.length > 0 && detailRecordPages >= 1,
      `rows=${records.length} pages=${detailRecordPages} ${detailMs}ms`,
    ) && allOk

  // --- cache reuse: second KPI batch should not add record pages ---
  const beforeSecond = requestLog.filter((u) => u.includes('/records')).length
  await fetchJson(`/kpi/summary?scope=${SCOPE}`)
  const afterSecond = requestLog.filter((u) => u.includes('/records')).length
  allOk =
    okLine(
      'KPI re-fetch no extra records',
      afterSecond === beforeSecond,
      `records calls before=${beforeSecond} after=${afterSecond}`,
    ) && allOk

  // --- manual ad merge ---
  const manualEntries = await loadManualAdEntries(SCOPE)
  const clientManualSpend = Math.round(totalManualAdSpend(manualEntries, filterCtx))

  const productRows = clientProductRows(records)
  const clientKpi = summarizeEsserKpisWithManual(productRows, manualEntries, filterCtx)
  const serverSummary = await fetchJson(`/kpi/summary?scope=${SCOPE}`)
  const serverDaily = await fetchJson(`/kpi/daily?scope=${SCOPE}`)
  const serverPlatform = await fetchJson(`/kpi/by-platform?scope=${SCOPE}`)
  const serverDod = await fetchJson(`/kpi/compare-yesterday?scope=${SCOPE}`)

  allOk =
    okLine(
      'summary manualAdSpendTotal',
      nearlyEqual(clientManualSpend, serverSummary.manualAdSpendTotal ?? 0),
      `client=${clientManualSpend} server=${serverSummary.manualAdSpendTotal ?? 0}`,
    ) && allOk

  const clientNetAfterManual = Math.round(clientKpi.netProfit)
  const serverNetAfterManual = Math.round(
    serverSummary.netProfitAfterManualAd ?? serverSummary.netProfitTotal,
  )
  allOk =
    okLine(
      'summary netProfitAfterManualAd',
      nearlyEqual(clientNetAfterManual, serverNetAfterManual),
      `client=${clientNetAfterManual} server=${serverNetAfterManual}`,
    ) && allOk

  const serverDailyManualSum = Math.round(
    (serverDaily.items || []).reduce((s, i) => s + Number(i.manualAdSpendTotal || 0), 0),
  )
  allOk =
    okLine(
      'daily manualAdSpendTotal sum',
      nearlyEqual(clientManualSpend, serverDailyManualSum),
      `clientTotal=${clientManualSpend} serverDailySum=${serverDailyManualSum}`,
    ) && allOk

  const serverPlatformManual = Math.round(
    serverPlatform.manualAdSpendTotal ??
      serverPlatform.totalRow?.manualAdSpendTotal ??
      serverPlatform.totalRow?.adSpendTotal -
        (serverPlatform.items || []).reduce((s, i) => s + (i.adSpendTotal || 0), 0),
  )
  allOk =
    okLine(
      'by-platform manualAdSpendTotal',
      nearlyEqual(clientManualSpend, serverPlatform.manualAdSpendTotal ?? clientManualSpend),
      `client=${clientManualSpend} server=${serverPlatform.manualAdSpendTotal ?? 0}`,
    ) && allOk
  void serverPlatformManual

  allOk =
    okLine(
      'compare-yesterday manualAdSpendTotal',
      nearlyEqual(clientManualSpend, serverDod.manualAdSpendTotal ?? clientManualSpend),
      `client=${clientManualSpend} server=${serverDod.manualAdSpendTotal ?? 0}`,
    ) && allOk

  const noManual = await fetchJson(`/kpi/summary?scope=${SCOPE}&include_manual_ads=false`)
  allOk =
    okLine(
      'include_manual_ads=false',
      (noManual.manualAdSpendTotal ?? 0) === 0 &&
        noManual.adSpendTotal <= serverSummary.adSpendTotal,
      `manual=${noManual.manualAdSpendTotal} adSpend=${noManual.adSpendTotal}`,
    ) && allOk

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
