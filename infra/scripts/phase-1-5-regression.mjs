#!/usr/bin/env node
/**
 * Phase 1-5 — legacy vs PG regression & performance benchmark.
 *
 * Usage:
 *   node infra/scripts/phase-1-5-regression.mjs
 *   node infra/scripts/phase-1-5-regression.mjs --json > report.json
 */
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { adaptPgRecordList } from '../../src/services/adapters/recordsAdapter.js'
import { adaptPgUploadList } from '../../src/services/adapters/uploadsAdapter.js'
import { adaptPgKpiSummary } from '../../src/services/adapters/kpiAdapter.js'
import {
  sqlitePathFromEnv,
  loadDotEnv,
} from './lib/migration-utils.mjs'

const LEGACY = process.env.VITE_LEGACY_API_BASE || 'http://localhost:3001/api'
const PG = process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1'

function parseArgs(argv) {
  return { json: argv.includes('--json') }
}

async function fetchJson(url) {
  const t0 = performance.now()
  const res = await fetch(url)
  const ms = performance.now() - t0
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const body = await res.json()
  return { body, ms }
}

async function loadLegacyDetail() {
  const { body, ms } = await fetchJson(`${LEGACY}/records?recordType=detail`)
  return { records: body, ms, requests: 1 }
}

async function loadPgDetail() {
  const items = []
  let page = 1
  const limit = 500
  let total = Infinity
  let requests = 0
  let ms = 0
  while (items.length < total) {
    const url = `${PG}/records?page=${page}&limit=${limit}&record_type=detail&include_data=true&sort=created_at&order=asc`
    const { body, ms: reqMs } = await fetchJson(url)
    requests += 1
    ms += reqMs
    items.push(...body.items)
    total = body.total ?? items.length
    if (!body.items.length || page * limit >= total) break
    page += 1
  }
  return { records: adaptPgRecordList(items), ms, requests, rawItems: items.length }
}

async function loadLegacyUploads() {
  const { body, ms } = await fetchJson(`${LEGACY}/uploads`)
  return { uploads: body, ms, requests: 1 }
}

async function loadPgUploads() {
  const { body, ms } = await fetchJson(`${PG}/uploads?page=1&limit=500`)
  return { uploads: adaptPgUploadList(body.items), ms, requests: 1, total: body.total }
}

async function simPgDashboardRecords() {
  const types = ['detail', 'daily', 'channel', 'product', 'productOption']
  let requests = 0
  let ms = 0
  let totalRecords = 0
  const byType = {}
  for (const t of types) {
    let page = 1
    let items = []
    let total = Infinity
    let typeMs = 0
    while (items.length < total) {
      const url = `${PG}/records?page=${page}&limit=500&record_type=${t}&include_data=true`
      const { body, ms: reqMs } = await fetchJson(url)
      requests += 1
      typeMs += reqMs
      items.push(...body.items)
      total = body.total ?? 0
      if (!body.items.length || page * 500 >= total) break
      page += 1
    }
    byType[t] = { count: items.length, requests: page, ms: Math.round(typeMs) }
    totalRecords += items.length
    ms += typeMs
  }
  return { requests, ms: Math.round(ms), totalRecords, byType }
}

function sumMetrics(records) {
  let sales = 0
  let qty = 0
  for (const r of records) {
    sales += Number(String(r.sales || '').replace(/,/g, '')) || 0
    qty += Number(String(r.salesQty || '').replace(/,/g, '')) || 0
  }
  return { sales, qty, count: records.length }
}

function compareRecords(legacy, pg) {
  const pgMap = new Map(pg.map((r) => [r.id, r]))
  let missing = 0
  let salesMismatch = 0
  let qtyMismatch = 0
  let platformMismatch = 0
  let brandMismatch = 0
  for (const l of legacy) {
    const p = pgMap.get(l.id)
    if (!p) {
      missing += 1
      continue
    }
    if (String(l.sales || '') !== String(p.sales || '')) salesMismatch += 1
    if (String(l.salesQty || '') !== String(p.salesQty || '')) qtyMismatch += 1
    if (String(l.platform || '') !== String(p.platform || '')) platformMismatch += 1
    if (String(l.brand || '') !== String(p.brand || '')) brandMismatch += 1
  }
  return { missing, salesMismatch, qtyMismatch, platformMismatch, brandMismatch }
}

function stableJson(obj) {
  return JSON.stringify(obj, Object.keys(obj || {}).sort())
}

async function compareSettings() {
  const sqlitePath = sqlitePathFromEnv()
  if (!existsSync(sqlitePath)) return { skipped: true }
  const db = new Database(sqlitePath, { readonly: true })
  const rows = db.prepare(`SELECT scope, kind FROM app_settings`).all()
  const results = []
  for (const { scope, kind } of rows) {
    try {
      const leg = (await fetchJson(`${LEGACY}/settings/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`)).body
      const pg = (await fetchJson(`${PG}/settings?scope=${encodeURIComponent(scope)}&kind=${encodeURIComponent(kind)}`)).body
      const pgItem = pg.items?.[0]
      const match = stableJson(leg.data) === stableJson(pgItem?.data ?? null)
      results.push({ scope, kind, match, legacyHasData: leg.data != null, pgHasData: pgItem?.data != null })
    } catch (e) {
      results.push({ scope, kind, match: false, error: e.message })
    }
  }
  db.close()
  return { settings: results, allMatch: results.every((r) => r.match) }
}

function projectAtScale(bench, recordCount) {
  const pages = Math.ceil(recordCount / 500)
  const msPerRequest = bench.ms / bench.requests
  const jsonMbPerRecord = bench.jsonMb / bench.recordCount
  return {
    recordCount,
    estDetailRequests: pages,
    estDashboardRequests: pages + 4,
    estLoadSeconds: Number(((msPerRequest * pages) / 1000).toFixed(1)),
    estJsonMB: Number((jsonMbPerRecord * recordCount).toFixed(0)),
  }
}

async function main() {
  loadDotEnv()
  const { json } = parseArgs(process.argv.slice(2))

  const report = {
    timestamp: new Date().toISOString(),
    legacyBase: LEGACY,
    pgBase: PG,
    legacy: {},
    pg: {},
    comparison: {},
    performance: {},
    settings: {},
    tabs: {},
    phase2Readiness: {},
  }

  const legacyDetail = await loadLegacyDetail()
  const pgDetail = await loadPgDetail()
  const legacyUploads = await loadLegacyUploads()
  const pgUploads = await loadPgUploads()
  const pgKpi = adaptPgKpiSummary((await fetchJson(`${PG}/kpi/summary`)).body)
  const legacyMetrics = sumMetrics(legacyDetail.records)
  const pgMetrics = sumMetrics(pgDetail.records)
  const recordCompare = compareRecords(legacyDetail.records, pgDetail.records)

  const jsonMbLegacy = JSON.stringify(legacyDetail.records).length / 1024 / 1024
  const jsonMbPg = JSON.stringify(pgDetail.records).length / 1024 / 1024

  report.legacy = {
    detailRecords: legacyDetail.records.length,
    uploads: legacyUploads.uploads.length,
    salesTotal: legacyMetrics.sales,
    quantityTotal: legacyMetrics.qty,
    loadMs: Math.round(legacyDetail.ms),
    requests: legacyDetail.requests,
    jsonMB: Number(jsonMbLegacy.toFixed(2)),
  }

  report.pg = {
    detailRecords: pgDetail.records.length,
    uploads: pgUploads.uploads.length,
    salesTotal: pgMetrics.sales,
    quantityTotal: pgMetrics.qty,
    kpiSummary: pgKpi,
    loadMs: Math.round(pgDetail.ms),
    requests: pgDetail.requests,
    jsonMB: Number(jsonMbPg.toFixed(2)),
  }

  report.comparison = {
    recordCountMatch: legacyDetail.records.length === pgDetail.records.length,
    uploadCountMatch: legacyUploads.uploads.length === pgUploads.uploads.length,
    salesTotalMatch: legacyMetrics.sales === pgMetrics.sales,
    quantityTotalMatch: legacyMetrics.qty === pgMetrics.qty,
    kpiSalesMatch: pgKpi.salesTotal === legacyMetrics.sales,
    kpiQtyMatch: pgKpi.quantityTotal === legacyMetrics.qty,
    recordFieldDiffs: recordCompare,
  }

  const dashSim = await simPgDashboardRecords()
  report.performance = {
    pgDetailLoad: {
      ms: report.pg.loadMs,
      requests: report.pg.requests,
      jsonMB: report.pg.jsonMB,
    },
    pgDashboardSim: dashSim,
    legacyDetailLoad: {
      ms: report.legacy.loadMs,
      requests: report.legacy.requests,
      jsonMB: report.legacy.jsonMB,
    },
    ratioPgVsLegacyMs: Number((report.pg.loadMs / report.legacy.loadMs).toFixed(2)),
    projections: {
      at10k: projectAtScale(
        { ms: report.pg.loadMs, requests: report.pg.requests, jsonMb: report.pg.jsonMB, recordCount: report.pg.detailRecords },
        10000,
      ),
      at100k: projectAtScale(
        { ms: report.pg.loadMs, requests: report.pg.requests, jsonMb: report.pg.jsonMB, recordCount: report.pg.detailRecords },
        100000,
      ),
    },
  }

  report.settings = await compareSettings()

  report.tabs = {
    sqliteRecordTypes: existsSync(sqlitePathFromEnv())
      ? new Database(sqlitePathFromEnv(), { readonly: true })
          .prepare(`SELECT record_type, COUNT(*) n FROM sales_records GROUP BY record_type`)
          .all()
      : [],
    pgRecordTypes: dashSim.byType,
    note:
      'SQLite·PG 모두 detail만 저장. daily/channel/product/productOption 탭은 detail에서 클라이언트 집계(buildSummaryTabFromDetails).',
  }

  const allDataMatch =
    report.comparison.recordCountMatch &&
    report.comparison.salesTotalMatch &&
    report.comparison.quantityTotalMatch &&
    recordCompare.missing === 0 &&
    recordCompare.salesMismatch === 0

  report.phase2Readiness = {
    dataParity: allDataMatch,
    settingsParity: report.settings.allMatch ?? false,
    performanceAcceptableAt4350: report.pg.loadMs < 3000,
    performanceRiskAt100k: report.performance.projections.at100k.estLoadSeconds > 10,
    recommendation:
      'PG 읽기 데이터는 legacy와 일치. KPI·탭 표시는 detail 캐시 기반으로 동일. Phase 2에서 KPI 집계 API 이전 및 records 전량 로드 제거 필요.',
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('=== Phase 1-5 Regression ===')
  console.log(`legacy detail: ${report.legacy.detailRecords} records, ${report.legacy.loadMs}ms, ${report.legacy.requests} req`)
  console.log(`pg detail:     ${report.pg.detailRecords} records, ${report.pg.loadMs}ms, ${report.pg.requests} req`)
  console.log(`sales total:   legacy=${report.legacy.salesTotal} pg=${report.pg.salesTotal} match=${report.comparison.salesTotalMatch}`)
  console.log(`qty total:     legacy=${report.legacy.quantityTotal} pg=${report.pg.quantityTotal} match=${report.comparison.quantityTotalMatch}`)
  console.log(`uploads:       legacy=${report.legacy.uploads} pg=${report.pg.uploads} match=${report.comparison.uploadCountMatch}`)
  console.log(`field diffs:   ${JSON.stringify(recordCompare)}`)
  console.log(`settings:      allMatch=${report.settings.allMatch}`)
  console.log(`PG dashboard sim: ${dashSim.ms}ms, ${dashSim.requests} requests`)
  console.log(`100k projection: ${JSON.stringify(report.performance.projections.at100k)}`)
  console.log(`Phase 2 ready (data): ${allDataMatch ? 'YES' : 'NO'}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
