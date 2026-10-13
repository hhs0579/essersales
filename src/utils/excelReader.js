import { loadXlsx } from './lazyXlsx.js'
import { isCoupangEsserFormat } from './coupangEsserParser.js'
import { cleanHeaderText } from './platformDetect.js'
import { findDeliveryColumnIndexInAoa, normalizeDeliveryLabel, scanDeliveryLabelInValues } from './salesMethodDetect.js'

function cellStr(v) {
  if (v == null) return ''
  return cleanHeaderText(v)
}

function scoreEsserHeaderRow(headerRow) {
  const headers = headerRow.map(cellStr).filter((h) => h !== '')
  if (!isCoupangEsserFormat(headers)) return 0

  let score = 1
  const norms = headers.map((h) => h.replace(/\s/g, ''))
  if (norms.some((h) => /채널종류|채널구분/i.test(h))) score += 12
  if (norms.some((h) => h === '상품명' || h.includes('상품명'))) score += 4
  if (norms.some((h) => h === '매출' || (h.includes('매출') && !h.includes('광고')))) score += 3
  if (norms.some((h) => /배송구분/i.test(h))) score += 15
  else if (norms.some((h) => /판매방식|배송방식|배송유형/i.test(h))) score += 6
  if (norms.some((h) => /순이익|마진/.test(h))) score += 2
  if (norms.some((h) => /판매수량|^수량$/.test(h))) score += 2
  return score
}

/** AOA 배송구분 열 — 병합셀·타 열에 있는 라벨까지 반영 후 forward-fill */
function forwardFillDeliveryInAoa(dataAoa, deliveryCol) {
  if (deliveryCol < 0 || !dataAoa?.length) return

  let last = ''
  for (const row of dataAoa) {
    let label = normalizeDeliveryLabel(row?.[deliveryCol])
    if (!label) label = normalizeDeliveryLabel(scanDeliveryLabelInValues(row))
    if (label) {
      row[deliveryCol] = label
      last = label
    } else if (last) {
      row[deliveryCol] = last
    }
  }
}

/**
 * 헤더 점수·데이터 행 수로 후보 비교 (동점이면 행 많은 쪽)
 * @param {{ score: number, rows: object[] } | null} current
 * @param {{ score: number, rows: object[] }} next
 */
function isBetterEsserCandidate(current, next) {
  if (!current) return true
  if (next.score !== current.score) return next.score > current.score
  return (next.rows?.length || 0) > (current.rows?.length || 0)
}

/** 빅셀 매출분석: 제목 행 아래에 헤더가 있는 경우 상단 N행을 스캔 (가장 적합한 헤더 행 선택) */
function extractEsserTableFromSheet(sheet, XLSX) {
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  let best = null

  for (let i = 0; i < Math.min(30, aoa.length); i++) {
    const headerRow = (aoa[i] || []).map(cellStr)
    const score = scoreEsserHeaderRow(headerRow)
    if (score <= 0) continue

    const dataAoa = []
    for (let j = i + 1; j < aoa.length; j += 1) {
      const dataRow = aoa[j] || []
      if (dataRow.every((c) => cellStr(c) === '')) continue
      dataAoa.push(dataRow)
    }

    const deliveryCol = findDeliveryColumnIndexInAoa(headerRow, dataAoa)
    if (deliveryCol >= 0) forwardFillDeliveryInAoa(dataAoa, deliveryCol)

    const patchedHeaderRow = [...headerRow]
    if (deliveryCol >= 0) {
      patchedHeaderRow[deliveryCol] = '배송구분'
    }

    const rows = []
    for (const dataRow of dataAoa) {
      const obj = {}
      patchedHeaderRow.forEach((h, col) => {
        let key = cellStr(h)
        if (!key && col === deliveryCol) key = '배송구분'
        if (key) obj[key] = dataRow[col] ?? ''
      })
      rows.push(obj)
    }

    const headers = patchedHeaderRow.map(cellStr).filter((h) => h !== '')
    if (deliveryCol >= 0 && !headers.includes('배송구분')) {
      headers.push('배송구분')
    }

    const candidate = { headers, rows, headerRowIndex: i, deliveryCol, score }
    if (isBetterEsserCandidate(best, candidate)) best = candidate
  }

  if (best) forwardFillDeliveryColumn(best.headers, best.rows)
  return best
}

/** 워크북 전체 시트에서 빅셀 매출분석 표가 가장 뚜렷한 시트 선택 */
function extractBestEsserTableFromWorkbook(workbook, XLSX) {
  let best = null
  let bestSheetName = ''

  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const table = extractEsserTableFromSheet(sheet, XLSX)
    if (!table) continue
    if (isBetterEsserCandidate(best, table)) {
      best = table
      bestSheetName = name
    }
  }

  if (!best) return null
  return { ...best, sheetName: bestSheetName }
}

/** 배송구분·판매방식 열 병합셀 — 빈 행에 위 값 전파 */
function forwardFillDeliveryColumn(headers, rows) {
  const col = (headers || []).find((h) => {
    const n = String(h).replace(/\s/g, '')
    return /배송구분|판매방식|배송방식|배송유형/i.test(n)
  })
  if (!col || !rows?.length) return

  let last = ''
  for (const row of rows) {
    let v = normalizeDeliveryLabel(row[col])
    if (!v) v = normalizeDeliveryLabel(scanDeliveryLabelInValues(Object.values(row)))
    if (v) {
      row[col] = v
      last = v
    } else if (last) row[col] = last
  }
}

/**
 * ArrayBuffer/Buffer → 헤더·행 (브라우저·Node 공용)
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer
 * @param {string} fileName
 */
export async function readExcelBuffer(buffer, fileName) {
  const XLSX = await loadXlsx()
  const data =
    buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const lower = String(fileName || '').toLowerCase()
  // dateNF: 엑셀 기본 짧은 날짜(서식 14)가 raw:false 문자열에서 "9/21/26"로 나와 날짜 인식 실패하는 것 방지
  const readOpts = { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' }
  if (lower.endsWith('.xls') && !lower.endsWith('.xlsx')) {
    readOpts.codepage = 949
  }

  const workbook = XLSX.read(data, readOpts)
  const esserTable = extractBestEsserTableFromWorkbook(workbook, XLSX)
  if (esserTable) {
    return {
      fileName,
      sheetName: esserTable.sheetName,
      headers: esserTable.headers,
      rows: esserTable.rows,
      esserHeaderRow: esserTable.headerRowIndex,
    }
  }

  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const headers =
    rows.length > 0
      ? Object.keys(rows[0])
      : (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })[0] || [])
  return {
    fileName,
    sheetName,
    headers: headers.filter((h) => h !== ''),
    rows,
  }
}

/**
 * 엑셀 파일을 읽어 헤더·행 데이터 반환
 * 빅셀 매출분석 형식이면 모든 시트·상단 행에서 헤더를 자동 탐지
 */
export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const result = await readExcelBuffer(e.target.result, file.name)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}
