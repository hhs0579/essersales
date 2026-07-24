import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function migrationsDir() {
  return (
    process.env.MIGRATIONS_DIR ||
    join(__dirname, '../../../infra/db')
  )
}

async function getAppliedVersions(pool) {
  const res = await pool.query(`SELECT version FROM schema_migrations ORDER BY version`)
  return new Set(res.rows.map((r) => Number(r.version)))
}

function listMigrationFiles() {
  const dir = migrationsDir()
  return readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/i.test(f))
    .map((f) => ({
      version: Number(f.slice(0, 3)),
      name: f,
      path: join(dir, f),
    }))
    .sort((a, b) => a.version - b.version)
}

/**
 * @param {import('pg').Pool} pool
 */
export async function runPendingMigrations(pool) {
  const applied = await getAppliedVersions(pool)
  const pending = listMigrationFiles().filter((f) => !applied.has(f.version))

  if (!pending.length) {
    console.log('[migrations] All migrations up to date.')
    return []
  }

  const done = []
  const client = await pool.connect()
  try {
    for (const file of pending) {
      const sql = readFileSync(file.path, 'utf8')
      console.log(`[migrations] Applying v${file.version}: ${file.name}`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('COMMIT')
        done.push(file.version)
        console.log(`[migrations] Applied v${file.version}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration v${file.version} failed: ${err.message}`)
      }
    }
  } finally {
    client.release()
  }

  return done
}
