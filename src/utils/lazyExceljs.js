/** exceljs — 엑셀 다운로드 시에만 로드 */

let cached = null

export async function loadExceljs() {
  if (!cached) {
    cached = await import('exceljs')
  }
  return cached.default || cached
}
