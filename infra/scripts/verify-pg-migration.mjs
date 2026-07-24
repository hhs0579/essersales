#!/usr/bin/env node
/**
 * Verify SQLite → PostgreSQL migration integrity.
 * node infra/scripts/verify-pg-migration.mjs
 */
import Database from 'better-sqlite3'
import pg from 'pg'
import { existsSync } from 'fs'
import {
  pgConfigFromEnv,
  sqlitePathFromEnv,
  loadDotEnv,
  parseNumeric,
  parseJsonObject,
  mapSalesRecordBackfill,
} from './lib/migration-utils.mjs'

const { Pool } = pg

function status(ok, label, detail = '') {
  const mark = ok ? 'OK' : 'FAIL'
  console.log(`${label}: ${mark}${detail ? ` ${detail}` : ''}`)
  return ok
}

function sumSqliteSales(sqlite) {
  const rows = sqlite.prepare(`SELECT data FROM sales_records`).all()
  let sales = 0
  let qty = 0
  for (const row of rows) {
    const data = parseJsonObject(row.data)
    const backfill = mapSalesRecordBackfill(data)
    sales += backfill.sales ?? 0
    qty += backfill.sales_qty ?? 0
  }
  return { sales, qty }
}

async function sumPgSales(pool) {
  const res = await pool.query(`
    SELECT
      COALESCE(SUM(sales), 0)::numeric AS sales,
      COALESCE(SUM(sales_qty), 0)::numeric AS qty
    FROM sales_records
  `)
  return {
    sales: Number(res.rows[0].sales),
    qty: Number(res.rows[0].qty),
  }
}

function nearlyEqual(a, b, epsilon = 0.01) {
  return Math.abs(a - b) <= epsilon
}

async function main() {
  loadDotEnv()
  const sqlitePath = sqlitePathFromEnv()
  if (!existsSync(sqlitePath)) {
    console.error(`SQLite DB not found: ${sqlitePath}`)
    process.exit(1)
  }

  const sqlite = new Database(sqlitePath, { readonly: true })
  const pool = new Pool({ connectionString: pgConfigFromEnv().connectionString })

  let allOk = true

  try {
    const su = sqlite.prepare(`SELECT COUNT(*) AS n FROM uploads`).get().n
    const sr = sqlite.prepare(`SELECT COUNT(*) AS n FROM sales_records`).get().n
    const ss = sqlite.prepare(`SELECT COUNT(*) AS n FROM app_settings`).get().n

    const pu = (await pool.query(`SELECT COUNT(*)::int AS n FROM uploads`)).rows[0].n
    const pr = (await pool.query(`SELECT COUNT(*)::int AS n FROM sales_records`)).rows[0].n
    const ps = (await pool.query(`SELECT COUNT(*)::int AS n FROM app_settings`)).rows[0].n

    console.log('=== Counts ===')
    allOk = status(su === pu, 'uploads', `${pu} / ${su}`) && allOk
    allOk = status(sr === pr, 'sales_records', `${pr} / ${sr}`) && allOk
    allOk = status(ss === ps, 'app_settings', `${ps} / ${ss}`) && allOk

    const sqliteSums = sumSqliteSales(sqlite)
    const pgSums = await sumPgSales(pool)

    console.log('\n=== Aggregates ===')
    allOk =
      status(
        nearlyEqual(sqliteSums.sales, pgSums.sales, 1),
        'sales total',
        `sqlite=${sqliteSums.sales.toFixed(2)} pg=${pgSums.sales.toFixed(2)}`,
      ) && allOk
    allOk =
      status(
        nearlyEqual(sqliteSums.qty, pgSums.qty, 1),
        'quantity total',
        `sqlite=${sqliteSums.qty.toFixed(4)} pg=${pgSums.qty.toFixed(4)}`,
      ) && allOk

    console.log('\n=== Sample uploads (5) ===')
    const sampleUploads = sqlite
      .prepare(`SELECT id, file_name, upload_kind, total_count FROM uploads ORDER BY created_at LIMIT 5`)
      .all()
    for (const u of sampleUploads) {
      const pgRow = (
        await pool.query(
          `SELECT file_name, upload_kind, total_count FROM uploads WHERE id = $1`,
          [u.id],
        )
      ).rows[0]
      const ok =
        pgRow &&
        pgRow.file_name === u.file_name &&
        pgRow.upload_kind === u.upload_kind &&
        Number(pgRow.total_count) === Number(u.total_count ?? 0)
      if (!ok) {
        console.log(`  FAIL id=${u.id}`)
        console.log(`    sqlite:`, u)
        console.log(`    pg:`, pgRow)
        allOk = false
      } else {
        console.log(`  OK id=${u.id} ${u.file_name}`)
      }
    }

    console.log('\n=== Sample sales_records (10) ===')
    const sampleRecords = sqlite
      .prepare(`SELECT id, upload_id, record_type, data FROM sales_records ORDER BY created_at LIMIT 10`)
      .all()
    for (const row of sampleRecords) {
      const data = parseJsonObject(row.data)
      const expected = mapSalesRecordBackfill(data)
      const pgRow = (
        await pool.query(
          `SELECT platform, sales, sales_qty, upload_format, order_date::text AS order_date
           FROM sales_records WHERE id = $1`,
          [row.id],
        )
      ).rows[0]
      const ok =
        pgRow &&
        (pgRow.platform || '') === (expected.platform || '') &&
        nearlyEqual(Number(pgRow.sales || 0), expected.sales || 0, 0.01) &&
        (pgRow.upload_format || '') === (expected.upload_format || '')
      if (!ok) {
        console.log(`  FAIL id=${row.id}`)
        console.log(`    expected platform=${expected.platform} sales=${expected.sales}`)
        console.log(`    pg`, pgRow)
        allOk = false
      } else {
        console.log(`  OK id=${row.id} platform=${pgRow.platform} sales=${pgRow.sales}`)
      }
    }

    console.log('\n=== app_settings keys ===')
    const sqliteKeys = sqlite
      .prepare(`SELECT scope, kind FROM app_settings ORDER BY scope, kind`)
      .all()
      .map((r) => `${r.scope}/${r.kind}`)
    const pgKeys = (
      await pool.query(`SELECT scope, kind FROM app_settings ORDER BY scope, kind`)
    ).rows.map((r) => `${r.scope}/${r.kind}`)

    const keysOk =
      sqliteKeys.length === pgKeys.length &&
      sqliteKeys.every((k, i) => k === pgKeys[i])
    allOk = status(keysOk, 'app_settings keys', `${pgKeys.length} keys`) && allOk
    if (!keysOk) {
      console.log('  sqlite:', sqliteKeys)
      console.log('  pg:', pgKeys)
    }

    const ownMall = (
      await pool.query(
        `SELECT length(data::text) AS len FROM app_settings WHERE scope = 'company_b' AND kind = 'own_mall_manual'`,
      )
    ).rows[0]
    if (ownMall) {
      console.log(`\n[info] own_mall_manual JSON size in PG: ${ownMall.len} chars (base64 preserved in JSONB)`)
    }

    console.log('\n=== Result ===')
    if (allOk) {
      console.log('sample diff: OK')
      console.log('OVERALL: PASS')
    } else {
      console.log('sample diff: FAIL')
      console.log('OVERALL: FAIL')
      process.exit(1)
    }
  } finally {
    sqlite.close()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[fatal]', err.message)
  process.exit(1)
})
