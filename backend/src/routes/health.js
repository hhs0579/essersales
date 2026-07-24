import { Router } from 'express'
import { testConnection } from '../db/pool.js'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  const db = await testConnection()

  const payload = {
    ok: db.ok,
    service: 'essersales-api',
    apiVersion: 'v1',
    phase: 0,
    timestamp: new Date().toISOString(),
    db: db.ok
      ? {
          connected: true,
          serverTime: db.serverTime,
          migrationVersion: db.migrationVersion,
        }
      : {
          connected: false,
          error: db.error,
        },
  }

  if (!db.ok) {
    console.error('[health] Database connection failed:', db.error)
    return res.status(503).json(payload)
  }

  console.log('[health] Database connection OK, migrationVersion=', db.migrationVersion)
  res.json(payload)
})
