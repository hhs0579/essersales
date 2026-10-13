import { loadEnv, validateEnvForStartup } from './config/env.js'
import { createApp } from './app.js'
import { createPool, testConnection, closePool } from './db/pool.js'
import { runPendingMigrations } from './db/runMigrations.js'

const env = validateEnvForStartup(loadEnv())
const app = createApp(env)

const pool = createPool(env.db)

async function logDatabaseStatus() {
  const result = await testConnection()
  if (result.ok) {
    console.log(
      `[startup] PostgreSQL connected (server_time=${result.serverTime}, migration=${result.migrationVersion ?? 'n/a'})`,
    )
  } else {
    console.error('[startup] PostgreSQL connection FAILED:', result.error)
  }
}

async function startServer() {
  try {
    await runPendingMigrations(pool)
  } catch (err) {
    console.error('[startup] Migration failed:', err.message)
    process.exit(1)
  }

  return app.listen(env.apiPort, async () => {
    console.log(`[startup] essersales API listening on port ${env.apiPort} (${env.nodeEnv})`)
    console.log(`[startup] UPLOAD_DIR=${env.uploadDir}`)
    console.log(`[startup] EXPORT_DIR=${env.exportDir}`)
    await logDatabaseStatus()
  })
}

const server = await startServer()

async function shutdown(signal) {
  console.log(`[shutdown] Received ${signal}, closing...`)
  server.close(async () => {
    await closePool()
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Node 20은 처리되지 않은 rejection에서 프로세스를 종료함 — 로그만 남기고 API는 유지
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason?.stack || reason)
})
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.stack || err)
  process.exit(1)
})
