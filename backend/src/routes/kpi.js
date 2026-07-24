import { Router } from 'express'
import {
  getKpiSummary,
  getKpiDaily,
  getKpiByPlatform,
  getKpiCompareYesterday,
} from '../services/kpiReadService.js'

export const kpiRouter = Router()

kpiRouter.get('/summary', async (req, res, next) => {
  try {
    const result = await getKpiSummary(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

kpiRouter.get('/daily', async (req, res, next) => {
  try {
    const result = await getKpiDaily(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

kpiRouter.get('/by-platform', async (req, res, next) => {
  try {
    const result = await getKpiByPlatform(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

kpiRouter.get('/compare-yesterday', async (req, res, next) => {
  try {
    const result = await getKpiCompareYesterday(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})
