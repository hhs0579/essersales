import { parseSalesDate } from './dateParse.js'
import { getRecordDate } from './recordFilters.js'
import { parseAmount } from './salesAggregation.js'

function dateTime(row) {
  const p = parseSalesDate(getRecordDate(row))
  return p ? p.date.getTime() : null
}

function textCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ko')
}

function amountCompare(a, b) {
  return parseAmount(b) - parseAmount(a)
}

/** 상세·일별: 날짜 오름차순 → 같은 날이면 판매처·상품명 */
function sortByDateRows(list) {
  return [...list].sort((a, b) => {
    const ta = dateTime(a)
    const tb = dateTime(b)
    if (ta != null && tb != null && ta !== tb) return ta - tb
    if (ta != null && tb == null) return -1
    if (ta == null && tb != null) return 1
    const ch = textCompare(a.channel, b.channel)
    if (ch) return ch
    return textCompare(a.productName, b.productName)
  })
}

/** 판매처·상품: 매출(또는 수량) 내림차순 → 이름순 */
function sortByMetricDesc(list, amountKey, nameKey) {
  return [...list].sort((a, b) => {
    const diff = amountCompare(a[amountKey], b[amountKey])
    if (diff) return diff
    return textCompare(a[nameKey], b[nameKey])
  })
}

export function sortRecordsForTab(list, tab) {
  switch (tab) {
    case 'detail':
    case 'returns':
    case 'daily':
      return sortByDateRows(list)
    case 'channel':
      return sortByMetricDesc(list, 'revenue', 'channel')
    case 'product':
      return sortByMetricDesc(list, 'revenue', 'productName')
    case 'productOption':
      return sortByMetricDesc(list, 'quantity', 'productName')
    default:
      return [...list]
  }
}
