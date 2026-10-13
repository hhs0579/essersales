import { emptyStandardRow } from '../constants/standardColumns.js'
import { MAPPABLE_KEYS } from '../config/channelMappings.js'
import { excelDateToYmd } from './dateParse.js'

function formatCell(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date) {
    return excelDateToYmd(value)
  }
  return String(value).trim()
}

/**
 * 원본 행 배열을 표준 스키마로 변환
 */
export function transformRows({ channel, mapping, rows, fileName }) {
  const requiredForCheck = ['orderNo', 'productName']
  const results = []

  for (const row of rows) {
    const std = emptyStandardRow()
    std.channel = channel
    std.sourceFileName = fileName

    const missing = []
    for (const key of MAPPABLE_KEYS) {
      const sourceCol = mapping[key]
      if (!sourceCol) continue
      std[key] = formatCell(row[sourceCol])
    }

    for (const key of requiredForCheck) {
      if (!std[key]) missing.push(key)
    }

    const unmapped = MAPPABLE_KEYS.filter((k) => mapping[k] && std[k] === '' && row[mapping[k]] !== 0 && row[mapping[k]] !== '0')
    if (missing.length) {
      std.remarks = `필수값 누락: ${missing.join(', ')}`
    } else if (unmapped.length) {
      std.remarks = '일부 컬럼 값 비어 있음 — 확인 권장'
    }

    results.push(std)
  }
  return results
}
