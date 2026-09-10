import { join } from 'path'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { buildLegacyFilteredTableRows } from './legacyTableQueryService.js'
import {
  RECORD_TYPES,
  resolveDetailColumns,
  resolveSummaryColumns,
  sanitizeDetailColumns,
  isEsserDetailRow,
} from '../../../src/constants/salesColumns.js'
import {
  getChannelByScope,
  usesEsserDashboard,
} from '../../../src/config/dataChannels.js'
import { buildTableWorkbook } from '../../../src/utils/dashboardExporter.js'
import { applyKoreanFontToWorkbook } from '../../../src/utils/excelWorkbookStyle.js'

function memSnap() {
  const m = process.memoryUsage()
  return {
    heapUsedMb: Math.round((m.heapUsed / 1024 / 1024) * 10) / 10,
    rssMb: Math.round((m.rss / 1024 / 1024) * 10) / 10,
  }
}

/**
 * 표 엑셀 — 개선 전 Vue downloadTableExcel 과 동일한 행·컬럼·정렬
 */
export async function buildTableExport(query = {}) {
  const profile = {
    memStart: memSnap(),
    ms: {},
  }
  const tAll = performance.now()

  const tRows = performance.now()
  const built = await buildLegacyFilteredTableRows({
    ...query,
    skip_return_total: true,
    use_pg_cursor: true,
  })
  profile.ms.rowsBuild = Math.round(performance.now() - tRows)
  Object.assign(profile.ms, built.timings || {})
  profile.pgCount = built.pgCount
  profile.manualCount = built.manualCount
  profile.rowCount = built.rows.length
  profile.memAfterRows = memSnap()

  const { rows, scope, tab, filters } = built

  if (!rows.length) {
    const err = new Error('다운로드할 표 데이터가 없습니다.')
    err.status = 404
    err.code = 'NO_DATA'
    throw err
  }

  const tCols = performance.now()
  let columns
  if (tab === 'detail' || tab === 'returns') {
    columns = sanitizeDetailColumns(resolveDetailColumns(rows))
  } else if (usesEsserDashboard(scope) || rows.some(isEsserDetailRow)) {
    columns = resolveSummaryColumns(tab, rows)
  } else {
    columns = sanitizeDetailColumns(RECORD_TYPES[tab]?.columns || [])
  }
  profile.ms.columns = Math.round(performance.now() - tCols)
  profile.colCount = columns.length

  const channel = getChannelByScope(scope)
  const tWb = performance.now()
  const { wb, fileName, rowCount, sheetCount } = buildTableWorkbook({
    rows,
    columns,
    sheetName: RECORD_TYPES[tab]?.label || tab,
    channelLabel: channel?.tabLabel || '매출',
    filters,
  })
  profile.ms.workbook = Math.round(performance.now() - tWb)
  Object.assign(profile.ms, buildTableWorkbook.lastTimings || {})
  profile.memAfterWorkbook = memSnap()

  const tFont = performance.now()
  applyKoreanFontToWorkbook(wb)
  profile.ms.koreanFont = Math.round(performance.now() - tFont)

  const exportDir = process.env.EXPORT_DIR || './exports'
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true })
  }
  const filePath = join(exportDir, `${randomUUID()}.xlsx`)
  const tWrite = performance.now()
  await wb.xlsx.writeFile(filePath)
  profile.ms.xlsxWrite = Math.round(performance.now() - tWrite)
  profile.memAfterWrite = memSnap()
  profile.ms.totalBuild = Math.round(performance.now() - tAll)
  profile.streamWriter = false
  profile.holdsFullWorkbook = true
  profile.holdsXlsxBuffer = false

  return { filePath, fileName, rowCount, sheetCount, profile }
}
