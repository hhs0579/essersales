import { join } from 'path'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { loadExportPayload } from './exportDataLoadService.js'
import { EXPORT_BUILD_ID } from '../constants/exportBuild.js'

export { EXPORT_BUILD_ID }

/** NAS — export 동시 1건만 (메모리 OOM 방지) */
let exportInFlight = false

/**
 * exceljs/xlsx는 export 시에만 동적 import (API 기동 RAM 절약)
 */
async function buildWorkbookFile(payload) {
  const { buildDashboardWorkbook } = await import('../../../src/utils/dashboardExporter.js')
  const { applyKoreanFontToWorkbook } = await import('../../../src/utils/excelWorkbookStyle.js')
  const result = buildDashboardWorkbook(payload)
  applyKoreanFontToWorkbook(result.wb)
  return result
}

/**
 * @param {Record<string, string | undefined>} query
 */
export async function buildIntegratedExport(query = {}) {
  if (exportInFlight) {
    const err = new Error('다른 엑셀 생성이 진행 중입니다. 잠시 후 다시 시도해 주세요.')
    err.status = 503
    err.code = 'EXPORT_BUSY'
    throw err
  }

  exportInFlight = true
  const t0 = performance.now()
  console.log('[export] start', {
    scope: query.scope,
    from: query.from,
    to: query.to,
    build: EXPORT_BUILD_ID,
  })

  try {
    const payload = await loadExportPayload(query)
    console.log('[export] payload rows', {
      records: payload.records?.length ?? 0,
      ms: Math.round(performance.now() - t0),
    })

    const result = await buildWorkbookFile(payload)

    const exportDir = process.env.EXPORT_DIR || './exports'
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true })
    }
    const filePath = join(exportDir, `${randomUUID()}.xlsx`)
    await result.wb.xlsx.writeFile(filePath)

    console.log('[export] done', {
      fileName: result.fileName,
      sheets: result.sheetCount,
      rows: result.rowCount,
      ms: Math.round(performance.now() - t0),
    })

    return {
      filePath,
      fileName: result.fileName,
      sheetCount: result.sheetCount,
      rowCount: result.rowCount,
      integratedSummary: result.integratedSummary,
    }
  } finally {
    exportInFlight = false
  }
}
