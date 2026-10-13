import { Router } from 'express'
import {
  getSettingHistoryEntry,
  listSettingHistory,
  listSettings,
} from '../repositories/settingsRepository.js'
import { getAppSetting, putAppSetting } from '../services/settingsWriteService.js'
import { invalidateKpiCache } from './kpi.js'

export const settingsRouter = Router()

settingsRouter.get('/', async (req, res, next) => {
  try {
    const result = await listSettings(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/** 덮어쓰기 이력 — 복구용 (조회 전용) */
settingsRouter.get('/history/entry/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' })
    const entry = await getSettingHistoryEntry(id)
    if (!entry) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true, ...entry })
  } catch (err) {
    next(err)
  }
})

settingsRouter.get('/:scope/:kind/history', async (req, res, next) => {
  try {
    const items = await listSettingHistory(req.params.scope, req.params.kind)
    res.json({ ok: true, items, total: items.length })
  } catch (err) {
    next(err)
  }
})

settingsRouter.get('/:scope/:kind', async (req, res, next) => {
  try {
    const { scope, kind } = req.params
    const omitRaw = String(req.query.omit_sources ?? req.query.include_sources ?? '')
      .trim()
      .toLowerCase()
    const omitSources =
      omitRaw === '1' ||
      omitRaw === 'true' ||
      omitRaw === 'yes' ||
      (req.query.include_sources != null &&
        ['0', 'false', 'no'].includes(String(req.query.include_sources).trim().toLowerCase()))
    const result = await getAppSetting(scope, kind, { omitSources })
    res.json(result)
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    next(err)
  }
})

settingsRouter.put('/:scope/:kind', async (req, res, next) => {
  try {
    const { scope, kind } = req.params
    const body = req.body ?? {}
    const checkBase = Object.prototype.hasOwnProperty.call(body, 'baseUpdatedAt')
    const result = await putAppSetting(scope, kind, body.data, {
      checkBase,
      baseUpdatedAt: checkBase ? body.baseUpdatedAt : null,
    })
    invalidateKpiCache()
    res.json(result)
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    if (err.status === 409) {
      return res.status(409).json({ error: err.message, code: err.code, current: err.current })
    }
    next(err)
  }
})
