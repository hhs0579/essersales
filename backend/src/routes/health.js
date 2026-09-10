import { Router } from 'express'
import { testConnection } from '../db/pool.js'
import { EXPORT_BUILD_ID } from '../constants/exportBuild.js'

/** 2단계 KPI SQL 배포 확인용 — NAS health 로 구 SQL 여부 판별 */
export const KPI_SQL_REVISION = 3

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  const db = await testConnection()

  const payload = {
    ok: db.ok,
    service: 'essersales-api',
    apiVersion: 'v1',
    phase: 0,
    kpiSqlRevision: KPI_SQL_REVISION,
    exportBuildId: EXPORT_BUILD_ID,
    stage3DirectUpload: true,
    codeStamp: 'stage3-direct-upload-20260820',
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
