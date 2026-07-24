/**
 * Phase 1-1 — SQLite read-only inspection (no DB writes)
 * Usage: node infra/scripts/inspect-sqlite-readonly.mjs
 */
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { sqlitePathFromEnv, loadDotEnv } from './lib/migration-utils.mjs'

loadDotEnv()
const dbPath = sqlitePathFromEnv()

if (!existsSync(dbPath)) {
  console.error('DB not found:', dbPath)
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })

const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all()
  .map((r) => r.name)

const schema = {}
for (const t of tables) {
  schema[t] = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => ({
    name: c.name,
    type: c.type,
    notnull: c.notnull,
    pk: c.pk,
  }))
}

const counts = {
  uploads: db.prepare(`SELECT COUNT(*) AS n FROM uploads`).get().n,
  sales_records: db.prepare(`SELECT COUNT(*) AS n FROM sales_records`).get().n,
  app_settings: db.prepare(`SELECT COUNT(*) AS n FROM app_settings`).get().n,
}

const recordTypes = db
  .prepare(`SELECT record_type, COUNT(*) AS n FROM sales_records GROUP BY record_type ORDER BY n DESC`)
  .all()

const uploadKinds = db
  .prepare(`SELECT upload_kind, COUNT(*) AS n FROM uploads GROUP BY upload_kind ORDER BY n DESC`)
  .all()

const settings = db
  .prepare(`SELECT scope, kind, length(data) AS data_len FROM app_settings ORDER BY scope, kind`)
  .all()

function collectJsonKeys(recordType, limit = 50) {
  const rows = db
    .prepare(
      `SELECT data FROM sales_records WHERE record_type = ? LIMIT ?`,
    )
    .all(recordType, limit)
  const keys = new Set()
  for (const row of rows) {
    try {
      for (const k of Object.keys(JSON.parse(row.data))) keys.add(k)
    } catch {
      /* skip */
    }
  }
  return [...keys].sort()
}

const detailKeys = collectJsonKeys('detail')
const dailyKeys = collectJsonKeys('daily')

db.close()

console.log(JSON.stringify({
  dbPath,
  tables,
  schema,
  counts,
  recordTypes,
  uploadKinds,
  settings,
  jsonKeys: { detail: detailKeys, daily: dailyKeys },
}, null, 2))
