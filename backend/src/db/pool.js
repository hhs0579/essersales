import pg from 'pg'

const { Pool } = pg

/** @type {pg.Pool | null} */
let pool = null

/**
 * @param {{ connectionString: string }} dbConfig
 */
export function createPool(dbConfig) {
  if (pool) return pool

  pool = new Pool({
    connectionString: dbConfig.connectionString,
    client_encoding: 'UTF8',
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  pool.on('error', (err) => {
    console.error('[db] Unexpected pool error:', err.message)
  })

  return pool
}

export function getPool() {
  if (!pool) {
    throw new Error('Database pool is not initialized')
  }
  return pool
}

/**
 * @returns {Promise<{ ok: true, serverTime: string, migrationVersion: number | null } | { ok: false, error: string }>}
 */
export async function testConnection() {
  const client = getPool()
  try {
    const result = await client.query('SELECT NOW() AS server_time')
    let migrationVersion = null
    try {
      const mig = await client.query(
        `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`,
      )
      migrationVersion = mig.rows[0]?.version ?? null
    } catch {
      // schema not applied yet
    }
    return {
      ok: true,
      serverTime: result.rows[0]?.server_time,
      migrationVersion,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
