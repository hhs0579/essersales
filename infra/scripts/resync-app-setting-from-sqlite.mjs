#!/usr/bin/env node
/**
 * SQLite app_settings → PostgreSQL app_settings 단일 key 재동기화
 *
 * node infra/scripts/resync-app-setting-from-sqlite.mjs --scope company_b --kind own_mall_manual --dry-run
 * node infra/scripts/resync-app-setting-from-sqlite.mjs --scope company_b --kind own_mall_manual --execute
 *
 * 기본값: --dry-run (PG에 쓰지 않음)
 */
import pg from 'pg'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import {
  loadDotEnv,
  pgConfigFromEnv,
  sqlitePathFromEnv,
} from './lib/migration-utils.mjs'

const { Pool } = pg

function parseArgs(argv) {
  const args = { dryRun: true, execute: false, scope: '', kind: '' }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--execute') {
      args.execute = true
      args.dryRun = false
    } else if (a === '--dry-run') {
      args.dryRun = true
      args.execute = false
    } else if (a === '--scope' && argv[i + 1]) {
      args.scope = argv[++i]
    } else if (a === '--kind' && argv[i + 1]) {
      args.kind = argv[++i]
    }
  }
  return args
}

function stableJson(val) {
  return JSON.stringify(sortKeys(val))
}

function sortKeys(val) {
  if (Array.isArray(val)) return val.map(sortKeys)
  if (val && typeof val === 'object') {
    return Object.keys(val)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(val[key])
        return acc
      }, {})
  }
  return val
}

async function main() {
  loadDotEnv()
  const args = parseArgs(process.argv)

  if (!args.scope || !args.kind) {
    console.error('Usage: --scope <scope> --kind <kind> [--dry-run|--execute]')
    process.exit(1)
  }

  const sqlitePath = sqlitePathFromEnv()
  if (!existsSync(sqlitePath)) {
    console.error(`SQLite not found: ${sqlitePath}`)
    process.exit(1)
  }

  const sqlite = new Database(sqlitePath, { readonly: true })
  const row = sqlite
    .prepare(`SELECT data, updated_at FROM app_settings WHERE scope = ? AND kind = ?`)
    .get(args.scope, args.kind)
  sqlite.close()

  if (!row) {
    console.error(`SQLite: ${args.scope}/${args.kind} not found`)
    process.exit(1)
  }

  let sqliteData
  try {
    sqliteData = JSON.parse(row.data)
  } catch {
    console.error('SQLite data is not valid JSON')
    process.exit(1)
  }

  const cfg = pgConfigFromEnv()
  const pool = new Pool({ connectionString: cfg.connectionString })

  const pgRes = await pool.query(
    `SELECT data, updated_at FROM app_settings WHERE scope = $1 AND kind = $2`,
    [args.scope, args.kind],
  )
  const pgRow = pgRes.rows[0]
  const pgData = pgRow?.data ?? null

  console.log(`[target] ${args.scope}/${args.kind}`)
  console.log(`[mode] ${args.execute ? 'EXECUTE' : 'DRY-RUN'}`)
  console.log(`[sqlite] updated_at=${row.updated_at} bytes=${row.data?.length ?? 0}`)
  console.log(
    `[pg backup] updated_at=${pgRow?.updated_at ?? 'null'} data=${pgData != null ? stableJson(pgData).slice(0, 200) + '…' : 'null'}`,
  )

  const match = stableJson(sqliteData) === stableJson(pgData)
  console.log(`[compare] sqlite vs pg: ${match ? 'MATCH' : 'MISMATCH'}`)

  if (match) {
    console.log('No resync needed.')
    await pool.end()
    return
  }

  if (args.dryRun) {
    console.log('[dry-run] Would upsert PG from SQLite (use --execute to apply)')
    await pool.end()
    return
  }

  const upsert = await pool.query(
    `INSERT INTO app_settings (scope, kind, data, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (scope, kind)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
     RETURNING updated_at`,
    [args.scope, args.kind, JSON.stringify(sqliteData)],
  )

  const verify = await pool.query(
    `SELECT data FROM app_settings WHERE scope = $1 AND kind = $2`,
    [args.scope, args.kind],
  )
  const after = verify.rows[0]?.data ?? null
  const ok = stableJson(sqliteData) === stableJson(after)
  console.log(`[execute] upserted updated_at=${upsert.rows[0].updated_at}`)
  console.log(`[verify] sqlite vs pg after resync: ${ok ? 'MATCH' : 'FAIL'}`)
  await pool.end()
  if (!ok) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
