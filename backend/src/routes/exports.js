import { Router } from 'express'
import fs from 'fs'
import { buildIntegratedExport } from '../services/integratedExportService.js'
import { buildTableExport } from '../services/tableExportService.js'

export const exportsRouter = Router()

function exportErrorResponse(err) {
  if (err.status === 404 || err.code === 'NO_DATA') {
    return { status: 404, body: { error: err.message, code: err.code || 'NO_DATA' } }
  }
  if (err.status === 503 || err.code === 'EXPORT_BUSY') {
    return { status: 503, body: { error: err.message, code: err.code || 'EXPORT_BUSY' } }
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'EXPORT_FAILED',
        message: err.message || 'Export failed',
      },
    },
  }
}

function sendExportFile(res, next, filePath, fileName, extra = {}) {
  if (extra.sheetCount != null) res.setHeader('X-Sheet-Count', String(extra.sheetCount))
  if (extra.rowCount != null) res.setHeader('X-Row-Count', String(extra.rowCount))
  if (extra.profile) {
    res.setHeader('X-Export-Profile', Buffer.from(JSON.stringify(extra.profile)).toString('base64'))
  }
  const tSend = performance.now()
  res.download(filePath, fileName, (err) => {
    extra.profile && (extra.profile.ms = extra.profile.ms || {})
    if (extra.profile?.ms) extra.profile.ms.httpSendCallback = Math.round(performance.now() - tSend)
    fs.promises.unlink(filePath).catch(() => {})
    if (err && !res.headersSent) next(err)
  })
}

exportsRouter.get('/integrated', async (req, res, next) => {
  try {
    const { filePath, fileName } = await buildIntegratedExport(req.query)
    sendExportFile(res, next, filePath, fileName)
  } catch (err) {
    console.error('[export]', err.message)
    if (err.stack) console.error(err.stack)
    const mapped = exportErrorResponse(err)
    if (mapped.status === 404) return res.status(404).json(mapped.body)
    return res.status(mapped.status).json(mapped.body)
  }
})

exportsRouter.post('/integrated', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const { special_sale, combined_comments, profit_loss_template, ...bodyRest } = body
    const query = { ...req.query, ...bodyRest }
    if (special_sale != null) query.special_sale = special_sale
    if (combined_comments != null) query.combined_comments = combined_comments
    if (profit_loss_template != null) query.profit_loss_template = profit_loss_template
    const { filePath, fileName, sheetCount, rowCount } = await buildIntegratedExport(query)
    sendExportFile(res, next, filePath, fileName, { sheetCount, rowCount })
  } catch (err) {
    console.error('[export]', err.message)
    if (err.stack) console.error(err.stack)
    const mapped = exportErrorResponse(err)
    if (mapped.status === 404) return res.status(404).json(mapped.body)
    return res.status(mapped.status).json(mapped.body)
  }
})

async function handleTableExport(req, res, next) {
  try {
    const query = { ...req.query, ...req.body }
    const { filePath, fileName, sheetCount, rowCount, profile } = await buildTableExport(query)
    sendExportFile(res, next, filePath, fileName, { sheetCount, rowCount, profile })
  } catch (err) {
    if (err.status === 404 || err.code === 'NO_DATA') {
      return res.status(404).json({ error: err.message, code: err.code || 'NO_DATA' })
    }
    next(err)
  }
}

exportsRouter.get('/table', handleTableExport)
exportsRouter.post('/table', handleTableExport)
