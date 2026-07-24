import * as XLSX from 'xlsx'
import { STANDARD_COLUMNS } from '../constants/standardColumns'

/**
 * 표준 행 배열을 통합 엑셀 파일로 다운로드
 */
export function downloadStandardExcel(rows, fileName = '통합_주문데이터.xlsx') {
  const headerLabels = STANDARD_COLUMNS.map((c) => c.label)
  const keys = STANDARD_COLUMNS.map((c) => c.key)
  const sheetData = [
    headerLabels,
    ...rows.map((row) => keys.map((k) => row[k] ?? '')),
  ]
  const ws = XLSX.utils.aoa_to_sheet(sheetData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '통합데이터')
  XLSX.writeFile(wb, fileName)
}
