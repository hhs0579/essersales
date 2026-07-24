/**
 * Apply pending SQL migrations from infra/db (version > already applied).
 * Skips files already recorded in schema_migrations.
 */
import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PROJECT_ROOT, loadDotEnv } from '../lib/migration-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function migrationsDir() {
  loadDotEnv()
  return process.env.MIGRATIONS_DIR || join(PROJECT_ROOT, 'infra/db')
}

/**
 * @param {import('pg').Pool | import('pg').Client} client
 */
export async function getAppliedVersions(client) {
  try {
    const res = await client.query(`SELECT version FROM schema_migrations ORDER BY version`)
    return new Set(res.rows.map((r) => Number(r.version)))
  } catch (err) {
    if (err.code === '42P01') return new Set()
    throw err
  }
}

export function listMigrationFiles(dir = migrationsDir()) {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/i.test(f))
    .map((f) => {
      const version = Number(f.slice(0, 3))
      return { version, name: f, path: join(dir, f) }
    })
    .sort((a, b) => a.version - b.version)
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ dryRun?: boolean, log?: (msg: string) => void }} [opts]
 */
export async function applyPendingMigrations(pool, opts = {}) {
  const dryRun = opts.dryRun ?? false
  const log = opts.log ?? console.log
  const dir = migrationsDir()
  const files = listMigrationFiles(dir)
  const applied = await getAppliedVersions(pool)
  const pending = files.filter((f) => !applied.has(f.version))

  if (!pending.length) {
    log('[migrations] No pending migrations.')
    return { applied: [], skipped: files.map((f) => f.version) }
  }

  const done = []
  const client = await pool.connect()
  try {
    for (const file of pending) {
      const sql = readFileSync(file.path, 'utf8')
      log(`[migrations] ${dryRun ? 'WOULD APPLY' : 'APPLYING'} v${file.version}: ${file.name}`)
      if (dryRun) {
        done.push(file.version)
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('COMMIT')
        done.push(file.version)
        log(`[migrations] Applied v${file.version}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration v${file.version} failed: ${err.message}`)
      }
    }
  } finally {
    client.release()
  }

  return { applied: done, skipped: [...applied] }
}
