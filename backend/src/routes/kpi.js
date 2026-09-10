import { Router } from 'express'
import {
  getKpiSummary,
  getKpiDaily,
  getKpiByPlatform,
  getKpiBySegment,
  getKpiCompareYesterday,
} from '../services/kpiReadService.js'
import { createTtlCache } from '../utils/ttlCache.js'

export const kpiRouter = Router()

const KPI_CACHE_TTL_MS = 60_000
const kpiCache = createTtlCache(KPI_CACHE_TTL_MS)

/** 업로드·설정 변경 시 호출 */
export function invalidateKpiCache() {
  kpiCache.invalidate()
}

/**
 * @param {import('express').Request} req
 * @param {string} endpoint
 */
function cacheKeyFromRequest(req, endpoint) {
  const entries = Object.entries(req.query || {})
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')])
    .sort(([a], [b]) => a.localeCompare(b))
  return `${endpoint}?${new URLSearchParams(entries).toString()}`
}

function cachedKpiHandler(endpoint, loader) {
  return async (req, res, next) => {
    try {
      const key = cacheKeyFromRequest(req, endpoint)
      const result = await kpiCache.getOrLoad(key, () => loader(req.query), KPI_CACHE_TTL_MS)
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
}

kpiRouter.get('/summary', cachedKpiHandler('summary', getKpiSummary))
kpiRouter.get('/daily', cachedKpiHandler('daily', getKpiDaily))
kpiRouter.get('/by-platform', cachedKpiHandler('by-platform', getKpiByPlatform))
kpiRouter.get('/by-segment', cachedKpiHandler('by-segment', getKpiBySegment))
kpiRouter.get(
  '/compare-yesterday',
  cachedKpiHandler('compare-yesterday', getKpiCompareYesterday),
)

/** 검증 전용 — JS 골든 vs SQL. 운영 캐시 없음. */
kpiRouter.get('/golden-compare', async (req, res, next) => {
  try {
    const { runKpiGoldenCompare } = await import('../services/kpiGoldenCompareService.js')
    const result = await runKpiGoldenCompare(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})
