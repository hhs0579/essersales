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
    max: Number(process.env.DB_POOL_MAX || 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  })

  pool.on('error', (err) => {
    console.error('[db] Unexpected pool error:', err.message)
  })

  return pool
}

export function getPool() {
  if (!pool) {
    const host = process.env.DB_HOST
    const user = process.env.DB_USER
    const database = process.env.DB_NAME
    const password = process.env.DB_PASSWORD ?? ''
    const port = process.env.DB_PORT || '5432'
    const fromUrl = process.env.DATABASE_URL
    const connectionString =
      fromUrl ||
      (host && user && database
        ? `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
        : '')
    if (connectionString) {
      return createPool({ connectionString })
    }
    throw new Error('Database pool is not initialized')
  }
  return pool
}

function formatDbError(err) {
  if (!err) return 'unknown'
  if (Array.isArray(err.errors) && err.errors.length) {
    return err.errors.map(formatDbError).join('; ')
  }
  const code = err.code || err.errno || ''
  const msg = err.message || ''
  const extra = err.cause ? formatDbError(err.cause) : ''
  return [code, msg, extra].filter(Boolean).join(' ').trim() || String(err)
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
      error: formatDbError(err),
    }
  }
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
