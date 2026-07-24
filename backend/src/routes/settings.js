import { Router } from 'express'
import { listSettings } from '../repositories/settingsRepository.js'
import { getAppSetting, putAppSetting } from '../services/settingsWriteService.js'

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
    const result = await getAppSetting(scope, kind)
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
    res.json(result)
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    next(err)
  }
})
