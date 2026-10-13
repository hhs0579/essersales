import { Router } from 'express'
import { listUploads, getUploadById } from '../repositories/uploadsRepository.js'
import { deleteUpload } from '../services/uploadsWriteService.js'
import { processExcelUpload } from '../services/uploadExcelWriteService.js'
import {
  openUploadOriginalFile,
  pipeUploadOriginalToResponse,
} from '../services/uploadOriginalFileService.js'
import { excelUploadMiddleware } from '../middleware/uploadMulter.js'
import { decodeMultipartFilename } from '../../../src/utils/textEncoding.js'
import { invalidateKpiCache } from './kpi.js'

export const uploadsRouter = Router()

uploadsRouter.get('/', async (req, res, next) => {
  try {
    const result = await listUploads(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

uploadsRouter.post('/excel', (req, res, next) => {
  excelUploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' })
    }
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'file 필드 필요', code: 'MISSING_FILE' })
      }
      const fileName = decodeMultipartFilename(req.file.originalname)
      const result = await processExcelUpload({
        buffer: req.file.buffer,
        fileName,
        fields: req.body || {},
      })
      if (result.duplicate) {
        return res.status(409).json(result)
      }
      invalidateKpiCache()
      res.json(result)
    } catch (e) {
      if (e.status === 400) {
        return res.status(400).json({ error: e.message, code: e.code })
      }
      next(e)
    }
  })
})

/** 업로드 원본 엑셀 재다운로드 — `/:id` 보다 먼저 등록 */
uploadsRouter.get('/:id/file', async (req, res, next) => {
  try {
    const file = await openUploadOriginalFile(req.params.id)
    pipeUploadOriginalToResponse(res, file)
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message, code: err.code || 'NOT_FOUND' })
    }
    next(err)
  }
})

uploadsRouter.get('/:id', async (req, res, next) => {
  try {
    const row = await getUploadById(req.params.id)
    if (!row) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Upload not found' } })
    }
    res.json(row)
  } catch (err) {
    next(err)
  }
})

uploadsRouter.delete('/:id', async (req, res, next) => {
  try {
    const result = await deleteUpload(req.params.id)
    invalidateKpiCache()
    res.json(result)
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message, code: err.code })
    }
    next(err)
  }
})
