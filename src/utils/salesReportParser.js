import * as XLSX from 'xlsx'

function cellStr(v) {
  if (v == null) return ''
  return String(v).trim()
}

function hasAnyValue(row, indices) {
  return indices.some((i) => cellStr(row[i]) !== '')
}

function findHeaderRow(aoa) {
  return aoa.findIndex((row) => {
    const cells = row.map(cellStr)
    return (
      cells.includes('날짜') &&
      cells.includes('판매처') &&
      cells.includes('브랜드') &&
      cells.includes('상품명')
    )
  })
}

/** 연속된 비어있지 않은 헤더 블록들을 섹션으로 분리 */
function splitHeaderSections(headerRow) {
  const sections = []
  let i = 0
  while (i < headerRow.length) {
    while (i < headerRow.length && !cellStr(headerRow[i])) i++
    if (i >= headerRow.length) break
    const labels = []
    const indices = []
    while (i < headerRow.length && cellStr(headerRow[i])) {
      labels.push(cellStr(headerRow[i]))
      indices.push(i)
      i++
    }
    sections.push({ labels, indices })
  }
  return sections
}

function classifySection(labels) {
  if (labels[0] === '날짜' && labels.includes('브랜드')) return 'detail'
  if (labels[0] === '날짜' && labels.includes('매출') && !labels.includes('판매처')) return 'daily'
  if (labels[0] === '판매처') return 'channel'
  if (labels[0] === '상품명' && labels.includes('매출')) return 'product'
  if (labels[0] === '상품명' && labels.includes('옵션')) return 'productOption'
  return null
}

function mapRowByLabels(row, labels, indices) {
  const obj = {}
  labels.forEach((label, j) => {
    obj[label] = cellStr(row[indices[j]])
  })
  return obj
}

function toDetailRecord(raw, sourceFileName) {
  if (!cellStr(raw['날짜']) || !cellStr(raw['판매처'])) return null
  return {
    recordType: 'detail',
    date: cellStr(raw['날짜']),
    channel: cellStr(raw['판매처']),
    brand: cellStr(raw['브랜드']),
    productName: cellStr(raw['상품명']),
    option: cellStr(raw['옵션']),
    quantity: cellStr(raw['수량']),
    actualPayment: cellStr(raw['실결제가']),
    shippingFee: cellStr(raw['배송비']),
    channelFee: cellStr(raw['채널 수수료']),
    settlementPrice: cellStr(raw['정산가']),
    unitCost: cellStr(raw['원가']),
    totalCost: cellStr(raw['총 원가']),
    margin: cellStr(raw['마진']),
    marginRate: cellStr(raw['마진율']),
    sourceFileName,
  }
}

function toDailyRecord(raw, sourceFileName) {
  if (!cellStr(raw['날짜'])) return null
  return {
    recordType: 'daily',
    date: cellStr(raw['날짜']),
    revenue: cellStr(raw['매출']),
    margin: cellStr(raw['마진']),
    marginRate: cellStr(raw['마진율']),
    sourceFileName,
  }
}

/** 같은 엑셀 행에서 날짜 추출 (상세 → 일별 순) */
function extractRowDate(row, sections) {
  const detailSec = sections.find((s) => s.type === 'detail')
  if (detailSec) {
    const raw = mapRowByLabels(row, detailSec.labels, detailSec.indices)
    const d = cellStr(raw['날짜'])
    if (d) return d
  }
  const dailySec = sections.find((s) => s.type === 'daily')
  if (dailySec) {
    const raw = mapRowByLabels(row, dailySec.labels, dailySec.indices)
    const d = cellStr(raw['날짜'])
    if (d) return d
  }
  return ''
}

function rowContextFromDetail(raw) {
  return {
    date: cellStr(raw['날짜']),
    contextDate: cellStr(raw['날짜']),
    contextChannel: cellStr(raw['판매처']),
    contextBrand: cellStr(raw['브랜드']),
  }
}

function withRowDate(fields, rowDate) {
  const date = rowDate || fields.date || fields.contextDate || ''
  return { ...fields, date, contextDate: date }
}

function toChannelRecord(raw, sourceFileName, rowDate = '') {
  if (!cellStr(raw['판매처'])) return null
  return withRowDate(
    {
      recordType: 'channel',
      channel: cellStr(raw['판매처']),
      revenue: cellStr(raw['매출']),
      margin: cellStr(raw['마진']),
      marginRate: cellStr(raw['마진율']),
      sourceFileName,
    },
    rowDate,
  )
}

function toProductRecord(raw, sourceFileName, rowDate = '') {
  if (!cellStr(raw['상품명'])) return null
  return withRowDate(
    {
      recordType: 'product',
      productName: cellStr(raw['상품명']),
      revenue: cellStr(raw['매출']),
      quantity: cellStr(raw['수량']),
      marginRate: cellStr(raw['마진율']),
      sourceFileName,
    },
    rowDate,
  )
}

function toProductOptionRecord(raw, sourceFileName, rowDate = '') {
  if (!cellStr(raw['상품명'])) return null
  return withRowDate(
    {
      recordType: 'productOption',
      productName: cellStr(raw['상품명']),
      option: cellStr(raw['옵션']),
      quantity: cellStr(raw['수량']),
      sourceFileName,
    },
    rowDate,
  )
}

/**
 * 2D 시트 배열에서 매출 리포트(다중 표) 파싱
 */
export function parseSalesReportSheet(aoa, sourceFileName) {
  const headerIdx = findHeaderRow(aoa)
  if (headerIdx < 0) {
    throw new Error('매출 리포트 형식이 아닙니다. (날짜·판매처·브랜드·상품명 헤더 필요)')
  }

  const sections = splitHeaderSections(aoa[headerIdx]).map((s) => ({
    ...s,
    type: classifySection(s.labels),
  }))

  const detailSec = sections.find((s) => s.type === 'detail')
  if (!detailSec) {
    throw new Error('상세 거래 표(날짜·판매처·브랜드…)를 찾을 수 없습니다.')
  }

  const result = {
    details: [],
    daily: [],
    channel: [],
    product: [],
    productOption: [],
  }

  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    if (!hasAnyValue(row, detailSec.indices) && !sections.some((s) => hasAnyValue(row, s.indices))) {
      continue
    }

    const rowDate = extractRowDate(row, sections)

    for (const sec of sections) {
      if (!sec.type) continue
      const raw = mapRowByLabels(row, sec.labels, sec.indices)
      let rec = null
      switch (sec.type) {
        case 'detail':
          rec = toDetailRecord(raw, sourceFileName)
          if (rec) result.details.push(rec)
          break
        case 'daily':
          rec = toDailyRecord(raw, sourceFileName)
          if (rec) result.daily.push(rec)
          break
        case 'channel':
          rec = toChannelRecord(raw, sourceFileName, rowDate)
          if (rec) result.channel.push(rec)
          break
        case 'product':
          rec = toProductRecord(raw, sourceFileName, rowDate)
          if (rec) result.product.push(rec)
          break
        case 'productOption':
          rec = toProductOptionRecord(raw, sourceFileName, rowDate)
          if (rec) result.productOption.push(rec)
          break
        default:
          break
      }
    }
  }

  const total =
    result.details.length +
    result.daily.length +
    result.channel.length +
    result.product.length +
    result.productOption.length

  if (total === 0) {
    throw new Error('저장할 데이터 행이 없습니다.')
  }

  return result
}

/**
 * @param {ArrayBuffer | Uint8Array | Buffer} buffer
 * @param {string} fileName
 */
export async function readSalesReportBuffer(buffer, fileName) {
  const data =
    buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const workbook = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  const parsed = parseSalesReportSheet(aoa, fileName)
  return { fileName, sheetName, parsed }
}

export function readSalesReportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const result = await readSalesReportBuffer(e.target.result, file.name)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}
