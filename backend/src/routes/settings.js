import { Router } from 'express'
import { listSettings } from '../repositories/settingsRepository.js'
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
    const { data } = req.body ?? {}
    const result = await putAppSetting(scope, kind, data)
    invalidateKpiCache()
    res.json(result)
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    next(err)
  }
})
