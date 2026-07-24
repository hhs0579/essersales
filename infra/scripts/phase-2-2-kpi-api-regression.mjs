#!/usr/bin/env node
/**
 * Phase 2-2 — client platform split / day-over-day vs server KPI API regression.
 * node infra/scripts/phase-2-2-kpi-api-regression.mjs
 */
import { adaptPgRecordList } from '../../src/services/adapters/recordsAdapter.js'
import { loadDotEnv } from './lib/migration-utils.mjs'
import { buildPlatformKpiSplitRows } from '../../src/utils/platformKpiSplit.js'
import { computeDayOverDaySales } from '../../src/utils/dayOverDaySales.js'

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const EPS = 1
const PCT_EPS = 0.15
const PLATFORM_LABELS = ['쿠팡', '스마트스토어', '자사몰', '합계']
const DOD_LABELS = ['쿠팡', '스마트스토어', '합계']

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

function nearlyEqual(a, b, eps = EPS) {
  return Math.abs(Number(a) - Number(b)) <= eps
}

function roundPct(n) {
  return Number(Number(n).toFixed(2))
}

function clientPlatformRows(records) {
  return buildPlatformKpiSplitRows(records, [], {})
}

function clientDayOverDayRows(records) {
  return computeDayOverDaySales(records, {
    manualAdEntries: [],
    manualFilterCtx: {},
    lookupRows: records,
  })
}

function serverPlatformMap(body) {
  const map = new Map()
  for (const item of body.items || []) {
    map.set(item.platform, item)
  }
  if (body.totalRow) map.set('합계', body.totalRow)
  return map
}

function serverDodMap(body) {
  const map = new Map()
  for (const item of body.items || []) {
    map.set(item.label, item)
  }
  return map
}

async function main() {
  loadDotEnv()
  let allOk = true

  const records = await loadAllDetailRecords()
  const clientPlatforms = clientPlatformRows(records)
  const clientDod = clientDayOverDayRows(records)

  const serverPlatform = await fetchJson('/kpi/by-platform?include_manual_ads=false')
  const serverDod = await fetchJson('/kpi/compare-yesterday?include_manual_ads=false')

  const spMap = serverPlatformMap(serverPlatform)
  const sdMap = serverDodMap(serverDod)

  const expectedPlatformRows = PLATFORM_LABELS.length
  const serverPlatformRows = (serverPlatform.items?.length || 0) + (serverPlatform.totalRow ? 1 : 0)
  allOk =
    okLine(
      'by-platform rows',
      serverPlatformRows >= PLATFORM_LABELS.length &&
        (serverPlatform.items?.length || 0) === PLATFORM_LABELS.length - 1,
      `client=${expectedPlatformRows} serverItems=${serverPlatform.items?.length} totalRow=${serverPlatform.totalRow ? 1 : 0}`,
    ) && allOk

  let platformSalesOk = true
  let platformQtyOk = true
  let platformCountOk = true
  const platformDiffs = []

  for (const label of PLATFORM_LABELS) {
    const clientRow = clientPlatforms.find((r) => r.label === label)
    const serverRow = spMap.get(label)
    if (!clientRow || !serverRow) {
      platformSalesOk = false
      platformDiffs.push(`${label}: missing row`)
      continue
    }
    const cSales = Math.round(clientRow.profit?.sales ?? 0)
    const sSales = Math.round(serverRow.salesTotal ?? 0)
    const cQty = Math.round(clientRow.profit?.salesQty ?? 0)
    const sQty = Math.round(serverRow.quantityTotal ?? 0)
    const cCount = clientRow.rowCount ?? 0
    const sCount = serverRow.recordCount ?? 0

    if (!nearlyEqual(cSales, sSales)) {
      platformSalesOk = false
      platformDiffs.push(`${label} sales: client=${cSales} server=${sSales}`)
    }
    if (!nearlyEqual(cQty, sQty)) {
      platformQtyOk = false
      platformDiffs.push(`${label} qty: client=${cQty} server=${sQty}`)
    }
    if (!nearlyEqual(cCount, sCount)) {
      platformCountOk = false
      platformDiffs.push(`${label} count: client=${cCount} server=${sCount}`)
    }
  }

  allOk =
    okLine('by-platform salesTotal', platformSalesOk, platformDiffs.slice(0, 4).join('; ')) && allOk
  allOk =
    okLine('by-platform quantityTotal', platformQtyOk, platformDiffs.slice(0, 4).join('; ')) && allOk
  allOk =
    okLine('by-platform recordCount', platformCountOk, platformDiffs.slice(0, 4).join('; ')) && allOk

  let dodSalesOk = true
  let dodPctOk = true
  const dodDiffs = []

  for (const label of DOD_LABELS) {
    const clientRow = clientDod.find((r) => r.platform === label)
    const serverRow = sdMap.get(label)
    if (!clientRow || !serverRow) {
      dodSalesOk = false
      dodDiffs.push(`${label}: missing`)
      continue
    }
    const cCur = Math.round(clientRow.currentSales ?? 0)
    const sCur = Math.round(serverRow.current?.salesTotal ?? 0)
    const cPrev = Math.round(clientRow.prevSales ?? 0)
    const sPrev = Math.round(serverRow.previous?.salesTotal ?? 0)
    const cDiff = cCur - cPrev
    const sDiff = Math.round(serverRow.diff?.salesDiff ?? 0)

    if (!nearlyEqual(cCur, sCur)) {
      dodSalesOk = false
      dodDiffs.push(`${label} current@${clientRow.referenceDate}: client=${cCur} server=${sCur}`)
    }
    if (!nearlyEqual(cPrev, sPrev)) {
      dodSalesOk = false
      dodDiffs.push(`${label} prev@${clientRow.prevDate}: client=${cPrev} server=${sPrev}`)
    }
    if (!nearlyEqual(cDiff, sDiff)) {
      dodSalesOk = false
      dodDiffs.push(`${label} salesDiff: client=${cDiff} server=${sDiff}`)
    }

    const cPct = clientRow.changePct == null ? null : roundPct(clientRow.changePct)
    const sPct =
      serverRow.diff?.salesDiffRate == null ? null : roundPct(serverRow.diff.salesDiffRate)
    if (cPct == null && sPct == null) continue
    if (cPct == null || sPct == null || !nearlyEqual(cPct, sPct, PCT_EPS)) {
      dodPctOk = false
      dodDiffs.push(`${label} salesDiffRate: client=${cPct} server=${sPct}`)
    }
  }

  allOk =
    okLine(
      'compare-yesterday salesDiff',
      dodSalesOk,
      dodDiffs.filter((d) => !d.includes('salesDiffRate')).slice(0, 4).join('; '),
    ) && allOk
  allOk =
    okLine(
      'compare-yesterday salesDiffRate',
      dodPctOk,
      dodDiffs.filter((d) => d.includes('salesDiffRate')).slice(0, 4).join('; '),
    ) && allOk

  if (serverPlatform.items?.length) {
    const sample = serverPlatform.items[0]
    const platform = encodeURIComponent(sample.platform)
    const filtered = await fetchJson(`/kpi/by-platform?platform=${platform}&include_manual_ads=false`)
    const clientFiltered = buildPlatformKpiSplitRows(
      records.filter((r) => {
        const p = sample.platform
        if (p === '합계') return true
        return String(r.platform || '').includes(p) || true
      }),
      [],
      {},
    )
    const clientRow = clientPlatformRows(records).find((r) => r.label === sample.platform)
    const serverRow = filtered.items?.[0]
    allOk =
      okLine(
        'by-platform filter salesTotal',
        clientRow &&
          serverRow &&
          nearlyEqual(Math.round(clientRow.profit?.sales ?? 0), serverRow.salesTotal),
        clientRow && serverRow
          ? `platform=${sample.platform} client=${Math.round(clientRow.profit.sales)} server=${serverRow.salesTotal}`
          : 'skip',
      ) && allOk
    void clientFiltered
  }

  if (clientDod[0]?.referenceDate) {
    const ref = clientDod[0].referenceDate
    const filtered = await fetchJson(`/kpi/compare-yesterday?date=${ref}&include_manual_ads=false`)
    const clientFiltered = computeDayOverDaySales(records, {
      manualAdEntries: [],
      manualFilterCtx: { dateTo: ref },
      lookupRows: records,
    })
    const label = '합계'
    const cr = clientFiltered.find((r) => r.platform === label)
    const sr = (filtered.items || []).find((i) => i.label === label)
    allOk =
      okLine(
        'compare-yesterday filter salesDiff',
        cr &&
          sr &&
          nearlyEqual(Math.round(cr.currentSales ?? 0), sr.current?.salesTotal ?? 0) &&
          nearlyEqual(Math.round(cr.prevSales ?? 0), sr.previous?.salesTotal ?? 0),
        cr && sr
          ? `date=${ref} current client=${Math.round(cr.currentSales)} server=${sr.current?.salesTotal}`
          : 'skip',
      ) && allOk
  }

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
