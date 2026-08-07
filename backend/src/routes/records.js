import { Router } from 'express'
import { listRecords } from '../repositories/recordsRepository.js'
import { patchSalesRecord, deleteSalesRecord } from '../services/recordsWriteService.js'
import { invalidateKpiCache } from './kpi.js'

export const recordsRouter = Router()

recordsRouter.get('/', async (req, res, next) => {
  try {
    const result = await listRecords(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

recordsRouter.patch('/:id', async (req, res, next) => {
  try {
    const result = await patchSalesRecord(req.params.id, req.body)
    invalidateKpiCache()
    res.json(result)
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message, code: err.code })
    }
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    next(err)
  }
})

recordsRouter.delete('/:id', async (req, res, next) => {
  try {
    const result = await deleteSalesRecord(req.params.id)
    invalidateKpiCache()
    res.json(result)
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message, code: err.code })
    }
    next(err)
  }
})
