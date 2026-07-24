import { Router } from 'express'
import fs from 'fs'
import { buildIntegratedExport } from '../services/integratedExportService.js'

export const exportsRouter = Router()

exportsRouter.get('/integrated', async (req, res, next) => {
  try {
    const { filePath, fileName } = await buildIntegratedExport(req.query)
    res.download(filePath, fileName, (err) => {
      fs.promises.unlink(filePath).catch(() => {})
      if (err && !res.headersSent) next(err)
    })
  } catch (err) {
    if (err.status === 404 || err.code === 'NO_DATA') {
      return res.status(404).json({ error: err.message, code: err.code || 'NO_DATA' })
    }
    next(err)
  }
})

exportsRouter.post('/integrated', async (req, res, next) => {
  try {
    const query = { ...req.query, ...req.body }
    const { filePath, fileName, sheetCount, rowCount } = await buildIntegratedExport(query)
    res.setHeader('X-Sheet-Count', String(sheetCount))
    res.setHeader('X-Row-Count', String(rowCount))
    res.download(filePath, fileName, (err) => {
      fs.promises.unlink(filePath).catch(() => {})
      if (err && !res.headersSent) next(err)
    })
  } catch (err) {
    if (err.status === 404 || err.code === 'NO_DATA') {
      return res.status(404).json({ error: err.message, code: err.code || 'NO_DATA' })
    }
    next(err)
  }
})
