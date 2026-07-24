import { parentPort } from 'worker_threads'
import { join } from 'path'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { buildDashboardWorkbook } from '../../../src/utils/dashboardExporter.js'
import { loadExportPayload } from './exportDataLoadService.js'
import { applyKoreanFontToWorkbook } from '../../../src/utils/excelWorkbookStyle.js'

parentPort.on('message', async ({ query }) => {
  try {
    const payload = await loadExportPayload(query)
    const result = buildDashboardWorkbook(payload)
    applyKoreanFontToWorkbook(result.wb)

    const exportDir = process.env.EXPORT_DIR || './exports'
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true })
    }
    const filePath = join(exportDir, `${randomUUID()}.xlsx`)
    await result.wb.xlsx.writeFile(filePath)

    parentPort.postMessage({
      filePath,
      fileName: result.fileName,
      sheetCount: result.sheetCount,
      rowCount: result.rowCount,
      integratedSummary: result.integratedSummary,
    })
  } catch (error) {
    parentPort.postMessage({ error: error.message, stack: error.stack })
  }
})
