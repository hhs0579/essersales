#!/usr/bin/env node
/**
 * Compare SQLite (legacy) data vs PostgreSQL read API (:3002).
 * node infra/scripts/compare-sqlite-pg-read-api.mjs
 * node infra/scripts/compare-sqlite-pg-read-api.mjs --base-url http://localhost:8080
 */
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import {
  sqlitePathFromEnv,
  loadDotEnv,
  mapSalesRecordBackfill,
  parseJsonObject,
} from './lib/migration-utils.mjs'

function parseArgs(argv) {
  const baseIdx = argv.indexOf('--base-url')
  const baseUrl =
    baseIdx >= 0 ? argv[baseIdx + 1] : process.env.PG_API_BASE || 'http://localhost:3002'
  return { baseUrl: baseUrl.replace(/\/$/, '') }
}

function okLine(label, pass, detail = '') {
  const mark = pass ? 'OK' : 'FAIL'
  console.log(`${label}: ${mark}${detail ? ` ${detail}` : ''}`)
  return pass
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${url} → ${res.status} ${body}`)
  }
  return res.json()
}

function sumSqliteSales(sqlite, whereFn = () => true) {
  const rows = sqlite.prepare(`SELECT data FROM sales_records`).all()
  let sales = 0
  let qty = 0
  let count = 0
  for (const row of rows) {
    const data = parseJsonObject(row.data)
    const bf = mapSalesRecordBackfill(data)
    if (!whereFn(data, bf)) continue
    count += 1
    sales += bf.sales ?? 0
    qty += bf.sales_qty ?? 0
  }
  return { sales, qty, count }
}

function nearlyEqual(a, b, eps = 1) {
  return Math.abs(Number(a) - Number(b)) <= eps
}

async function main() {
  loadDotEnv()
  const { baseUrl } = parseArgs(process.argv.slice(2))
  const sqlitePath = sqlitePathFromEnv()
  if (!existsSync(sqlitePath)) {
    console.error(`SQLite not found: ${sqlitePath}`)
    process.exit(1)
  }

  console.log(`[config] SQLite: ${sqlitePath}`)
  console.log(`[config] PG API: ${baseUrl}`)

  const sqlite = new Database(sqlitePath, { readonly: true })
  let allOk = true

  try {
    const su = sqlite.prepare(`SELECT COUNT(*) AS n FROM uploads`).get().n
    const sr = sqlite.prepare(`SELECT COUNT(*) AS n FROM sales_records`).get().n
    const ss = sqlite.prepare(`SELECT COUNT(*) AS n FROM app_settings`).get().n

    const pgUploads = await fetchJson(`${baseUrl}/api/v1/uploads?page=1&limit=1`)
    const pgRecords = await fetchJson(`${baseUrl}/api/v1/records?page=1&limit=1`)
    const pgKpi = await fetchJson(`${baseUrl}/api/v1/kpi/summary`)
    const pgSettings = await fetchJson(`${baseUrl}/api/v1/settings`)

    console.log('\n=== Counts ===')
    allOk = okLine('uploads count', su === pgUploads.total, `${pgUploads.total} / ${su}`) && allOk
    allOk =
      okLine('records count', sr === pgRecords.total, `${pgRecords.total} / ${sr}`) && allOk
    allOk =
      okLine(
        'settings keys',
        ss === pgSettings.items.length,
        `${pgSettings.items.length} / ${ss}`,
      ) && allOk

    const sqliteSums = sumSqliteSales(sqlite)
    console.log('\n=== Totals ===')
    allOk =
      okLine(
        'sales total',
        nearlyEqual(sqliteSums.sales, pgKpi.salesTotal, 1),
        `${Number(pgKpi.salesTotal).toLocaleString()} / ${Number(sqliteSums.sales).toLocaleString()}`,
      ) && allOk
    allOk =
      okLine(
        'quantity total',
        nearlyEqual(sqliteSums.qty, pgKpi.quantityTotal, 1),
        `${pgKpi.quantityTotal} / ${sqliteSums.qty}`,
      ) && allOk

    console.log('\n=== Filter: platform=쿠팡 ===')
    const sqliteCoupang = sumSqliteSales(sqlite, (_d, bf) => bf.platform === '쿠팡')
    const pgCoupang = await fetchJson(
      `${baseUrl}/api/v1/kpi/summary?platform=${encodeURIComponent('쿠팡')}`,
    )
    allOk =
      okLine(
        'platform sales total',
        nearlyEqual(sqliteCoupang.sales, pgCoupang.salesTotal, 1),
        `pg=${pgCoupang.salesTotal} sqlite=${sqliteCoupang.sales}`,
      ) && allOk

    console.log('\n=== Filter: upload_kind=platform_daily ===')
    const sqliteKind = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM sales_records sr
         JOIN uploads u ON u.id = sr.upload_id
         WHERE u.upload_kind = 'platform_daily'`,
      )
      .get().n
    const pgKind = await fetchJson(
      `${baseUrl}/api/v1/kpi/summary?upload_kind=platform_daily`,
    )
    allOk =
      okLine(
        'upload_kind record count',
        sqliteKind === pgKind.recordCount,
        `pg=${pgKind.recordCount} sqlite=${sqliteKind}`,
      ) && allOk

    console.log('\n=== Period filter (2026-06-01 ~ 2026-06-30) ===')
    const sqlitePeriod = sumSqliteSales(sqlite, (_d, bf) => {
      const d = bf.order_date || bf.business_date
      return d && d >= '2026-06-01' && d <= '2026-06-30'
    })
    const pgPeriod = await fetchJson(
      `${baseUrl}/api/v1/kpi/summary?from=2026-06-01&to=2026-06-30`,
    )
    allOk =
      okLine(
        'period sales total',
        nearlyEqual(sqlitePeriod.sales, pgPeriod.salesTotal, 1),
        `pg=${pgPeriod.salesTotal} sqlite=${sqlitePeriod.sales}`,
      ) && allOk

    console.log('\n=== Sample records (10) ===')
    const pgSample = await fetchJson(
      `${baseUrl}/api/v1/records?page=1&limit=10&sort=created_at&order=asc`,
    )
    let sampleOk = true
    for (const pgItem of pgSample.items) {
      const sqliteRow = sqlite
        .prepare(`SELECT data FROM sales_records WHERE id = ?`)
        .get(pgItem.id)
      if (!sqliteRow) {
        console.log(`  FAIL sqlite missing id=${pgItem.id}`)
        sampleOk = false
        continue
      }
      const expected = mapSalesRecordBackfill(parseJsonObject(sqliteRow.data))
      const match =
        (pgItem.platform || '') === (expected.platform || '') &&
        nearlyEqual(pgItem.sales || 0, expected.sales || 0, 0.01)
      if (!match) {
        console.log(`  FAIL id=${pgItem.id} platform/sales mismatch`)
        sampleOk = false
      } else {
        console.log(`  OK id=${pgItem.id} platform=${pgItem.platform} sales=${pgItem.sales}`)
      }
    }
    allOk = okLine('sample diff', sampleOk) && allOk

    const sqliteKeys = sqlite
      .prepare(`SELECT scope, kind FROM app_settings ORDER BY scope, kind`)
      .all()
      .map((r) => `${r.scope}/${r.kind}`)
    const pgKeys = pgSettings.items.map((r) => `${r.scope}/${r.kind}`).sort()
    const keysMatch =
      sqliteKeys.length === pgKeys.length &&
      sqliteKeys.every((k, i) => k === pgKeys[i])
    allOk = okLine('settings keys list', keysMatch) && allOk

    console.log('\n=== Result ===')
    if (allOk) {
      console.log('OVERALL: PASS')
    } else {
      console.log('OVERALL: FAIL')
      process.exit(1)
    }
  } finally {
    sqlite.close()
  }
}

main().catch((err) => {
  console.error('[fatal]', err.message)
  process.exit(1)
})
