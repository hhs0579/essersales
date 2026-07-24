#!/usr/bin/env node
/**
 * SQLite → PostgreSQL data migration (Phase 1-2)
 * Default: --dry-run. Use --execute to write.
 *
 * node infra/scripts/migrate-sqlite-to-pg.mjs --dry-run
 * node infra/scripts/migrate-sqlite-to-pg.mjs --execute
 * node infra/scripts/migrate-sqlite-to-pg.mjs --execute --force
 */
import Database from 'better-sqlite3'
import pg from 'pg'
import { existsSync } from 'fs'
import {
  pgConfigFromEnv,
  sqlitePathFromEnv,
  loadDotEnv,
  mapUploadRow,
  mapSalesRecordBackfill,
  parseJsonObject,
  safeUuid,
  PROJECT_ROOT,
} from './lib/migration-utils.mjs'
import { applyPendingMigrations } from './lib/apply-pg-migrations.mjs'

const { Pool } = pg

function parseArgs(argv) {
  const execute = argv.includes('--execute')
  const dryRun = argv.includes('--dry-run') || !execute
  const force = argv.includes('--force')
  return { dryRun, execute, force }
}

function log(msg) {
  console.log(msg)
}

function warn(msg) {
  console.warn(`[warn] ${msg}`)
}

async function pgCount(pool, table) {
  const res = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`)
  return res.rows[0].n
}

async function main() {
  const { dryRun, execute, force } = parseArgs(process.argv.slice(2))
  loadDotEnv()

  const sqlitePath = sqlitePathFromEnv()
  if (!existsSync(sqlitePath)) {
    console.error(`SQLite DB not found: ${sqlitePath}`)
    process.exit(1)
  }

  const pgCfg = pgConfigFromEnv()
  log(`[config] SQLite: ${sqlitePath}`)
  log(`[config] PostgreSQL: ${pgCfg.host}:${pgCfg.port}/${pgCfg.database}`)
  log(`[config] Mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}${force ? ' (force)' : ''}`)

  const sqlite = new Database(sqlitePath, { readonly: true })
  const pool = new Pool({ connectionString: pgCfg.connectionString })

  try {
    await pool.query('SELECT 1')
    log('[pg] Connected')

    const mig = await applyPendingMigrations(pool, { dryRun: false, log })
    if (mig.applied.length) {
      log(`[migrations] Schema applied: v${mig.applied.join(', v')}`)
    }

    const sqliteUploads = sqlite.prepare(`SELECT * FROM uploads ORDER BY created_at`).all()
    const sqliteRecords = sqlite.prepare(`SELECT * FROM sales_records ORDER BY created_at`).all()
    const sqliteSettings = sqlite.prepare(`SELECT * FROM app_settings ORDER BY scope, kind`).all()

    log(`[sqlite] uploads=${sqliteUploads.length} sales_records=${sqliteRecords.length} app_settings=${sqliteSettings.length}`)

    const uploadById = new Map(sqliteUploads.map((u) => [u.id, u]))

    const pgUploads = dryRun ? null : await pgCount(pool, 'uploads')
    const pgRecords = dryRun ? null : await pgCount(pool, 'sales_records')
    const pgSettings = dryRun ? null : await pgCount(pool, 'app_settings')

    if (!dryRun && (pgUploads > 0 || pgRecords > 0 || pgSettings > 0)) {
      if (!force) {
        console.error(
          `[abort] PostgreSQL already has data (uploads=${pgUploads}, sales_records=${pgRecords}, app_settings=${pgSettings}). Use --force to replace.`,
        )
        process.exit(1)
      }
      log('[force] Clearing existing PostgreSQL migration data...')
      await pool.query(`DELETE FROM sales_records`)
      await pool.query(`DELETE FROM upload_files`)
      await pool.query(`DELETE FROM uploads`)
      await pool.query(`DELETE FROM app_settings`)
    }

    const invalidUploadIds = sqliteUploads.filter((u) => !safeUuid(u.id))
    if (invalidUploadIds.length) {
      warn(`uploads with invalid UUID: ${invalidUploadIds.length}`)
    }

    const uploadRows = []
    for (const row of sqliteUploads) {
      const mapped = mapUploadRow(row)
      if (!mapped.id) {
        warn(`skip upload invalid id: ${row.file_name}`)
        continue
      }
      uploadRows.push(mapped)
    }

    const recordRows = []
    let dateWarnings = 0
    for (const row of sqliteRecords) {
      const id = safeUuid(row.id)
      const uploadId = safeUuid(row.upload_id)
      if (!id || !uploadId) {
        warn(`skip record invalid id/upload_id: ${row.id}`)
        continue
      }
      const data = parseJsonObject(row.data)
      const upload = uploadById.get(row.upload_id)
      const backfill = mapSalesRecordBackfill(data, upload)
      if (!backfill.order_date && data.date) {
        dateWarnings += 1
      }
      recordRows.push({
        id,
        upload_id: uploadId,
        record_type: row.record_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
        data,
        ...backfill,
      })
    }
    if (dateWarnings) {
      warn(`sales_records date parse warnings: ${dateWarnings} (raw kept in data JSONB)`)
    }

    const settingRows = sqliteSettings.map((row) => ({
      scope: row.scope,
      kind: row.kind,
      data: parseJsonObject(row.data),
      updated_at: row.updated_at,
    }))

    log(`[plan] INSERT uploads=${uploadRows.length}`)
    log(`[plan] INSERT sales_records=${recordRows.length}`)
    log(`[plan] INSERT app_settings=${settingRows.length}`)

    if (dryRun) {
      log('[dry-run] No data written.')
      log('[dry-run] Sample upload:', JSON.stringify(uploadRows[0], null, 2))
      log('[dry-run] Sample record backfill:', JSON.stringify({
        id: recordRows[0]?.id,
        upload_id: recordRows[0]?.upload_id,
        order_date: recordRows[0]?.order_date,
        platform: recordRows[0]?.platform,
        sales: recordRows[0]?.sales,
        upload_format: recordRows[0]?.upload_format,
      }, null, 2))
      return
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const uploadSql = `
        INSERT INTO uploads (
          id, file_name, file_type, platform, sales_method, upload_kind,
          business_date, period_from, period_to,
          detail_count, daily_count, channel_count, product_count, product_option_count,
          total_count, parse_status, parse_error, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
        )`

      for (const u of uploadRows) {
        await client.query(uploadSql, [
          u.id,
          u.file_name,
          u.file_type,
          u.platform,
          u.sales_method,
          u.upload_kind,
          u.business_date,
          u.period_from,
          u.period_to,
          u.detail_count,
          u.daily_count,
          u.channel_count,
          u.product_count,
          u.product_option_count,
          u.total_count,
          u.parse_status,
          u.parse_error,
          u.created_at,
        ])
      }

      const recordSql = `
        INSERT INTO sales_records (
          id, upload_id, record_type,
          order_date, business_date, period_from, period_to,
          platform, sales_method, channel, store_name,
          product_code, product_name, option_name,
          sales, sales_qty, net_profit, ad_spend,
          transaction_type, upload_kind, upload_format,
          data, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        )`

      for (const r of recordRows) {
        await client.query(recordSql, [
          r.id,
          r.upload_id,
          r.record_type,
          r.order_date,
          r.business_date,
          r.period_from,
          r.period_to,
          r.platform,
          r.sales_method,
          r.channel,
          r.store_name,
          r.product_code,
          r.product_name,
          r.option_name,
          r.sales,
          r.sales_qty,
          r.net_profit,
          r.ad_spend,
          r.transaction_type,
          r.upload_kind,
          r.upload_format,
          JSON.stringify(r.data),
          r.created_at,
          r.updated_at,
        ])
      }

      const settingsSql = `
        INSERT INTO app_settings (scope, kind, data, updated_at)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (scope, kind) DO UPDATE SET
          data = EXCLUDED.data,
          updated_at = EXCLUDED.updated_at`

      for (const s of settingRows) {
        await client.query(settingsSql, [s.scope, s.kind, JSON.stringify(s.data), s.updated_at])
      }

      await client.query('COMMIT')
      log('[execute] Migration committed successfully.')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const finalUploads = await pgCount(pool, 'uploads')
    const finalRecords = await pgCount(pool, 'sales_records')
    const finalSettings = await pgCount(pool, 'app_settings')
    log(`[pg] Final counts: uploads=${finalUploads} sales_records=${finalRecords} app_settings=${finalSettings}`)
  } finally {
    sqlite.close()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[fatal]', err.message)
  process.exit(1)
})
