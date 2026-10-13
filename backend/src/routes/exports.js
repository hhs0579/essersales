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
  if (err.code === 'CLIENT_GONE') {
    return { status: 499, body: { error: err.message, code: err.code } }
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

/** 응답 완료 전에 소켓이 닫히면 true — 브라우저 타임아웃·탭 닫힘 */
function trackClientAbort(res) {
  let aborted = false
  res.on('close', () => {
    if (!res.writableFinished) aborted = true
  })
  return () => aborted
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

function sendExportError(res, err, tag) {
  if (err.code === 'CLIENT_GONE') {
    console.warn(`[${tag}]`, err.message)
  } else if (err.code !== 'NO_DATA' && err.code !== 'EXPORT_BUSY') {
    console.error(`[${tag}]`, err.stack || err.message)
  }
  if (res.headersSent || res.writableEnded) return
  const mapped = exportErrorResponse(err)
  res.status(mapped.status).json(mapped.body)
}

exportsRouter.get('/integrated', async (req, res, next) => {
  const isAborted = trackClientAbort(res)
  try {
    const { filePath, fileName } = await buildIntegratedExport(req.query, { isAborted })
    sendExportFile(res, next, filePath, fileName)
  } catch (err) {
    sendExportError(res, err, 'export')
  }
})

exportsRouter.post('/integrated', async (req, res, next) => {
  const isAborted = trackClientAbort(res)
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const { special_sale, manual_expense, combined_comments: _ignored, profit_loss_template, ...bodyRest } = body
    const query = { ...req.query, ...bodyRest }
    if (special_sale != null) query.special_sale = special_sale
    if (manual_expense != null) query.manual_expense = manual_expense
    if (profit_loss_template != null) query.profit_loss_template = profit_loss_template
    const { filePath, fileName, sheetCount, rowCount } = await buildIntegratedExport(query, { isAborted })
    sendExportFile(res, next, filePath, fileName, { sheetCount, rowCount })
  } catch (err) {
    sendExportError(res, err, 'export')
  }
})

async function handleTableExport(req, res, next) {
  const isAborted = trackClientAbort(res)
  try {
    const query = { ...req.query, ...req.body }
    const { filePath, fileName, sheetCount, rowCount, profile } = await buildTableExport(query, { isAborted })
    sendExportFile(res, next, filePath, fileName, { sheetCount, rowCount, profile })
  } catch (err) {
    sendExportError(res, err, 'table-export')
  }
}

exportsRouter.get('/table', handleTableExport)
exportsRouter.post('/table', handleTableExport)
