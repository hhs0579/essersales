import { resolveRecordPlatform } from './platformDetect.js'
import { resolveRecordSourceLabel } from './recordSourceLabel.js'
import { getSalesMethod } from './salesMethodDetect.js'
import { isPowerPriceRecord } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord, COUPANG_1P_SALES_METHOD } from '../config/coupang1pRocket.js'
import { isOwnMallRecord } from '../config/ownMall.js'

/** @typedef {'bh_seller_growth'|'bh_rocket'|'bh_ss'|'sbn_seller'|'sbn_ss'|'sbn_ownmall'|'power_price'} CombinedSegmentKey */

/** 통합 KPI·전일매출 행 정의 (순서 고정) */
export const COMBINED_SEGMENT_DEFS = [
  { key: 'bh_seller_growth', label: '베스트하임(판매자+그로스)' },
  { key: 'bh_rocket', label: '베스트하임(로켓)' },
  { key: 'bh_ss', label: '베스트하임(스스)' },
  { key: 'sbn_seller', label: '사본느리(판매자)' },
  { key: 'sbn_ss', label: '사본느리(스스)' },
  { key: 'sbn_ownmall', label: '사본느리(자사몰)' },
  { key: 'power_price', label: '파워프라이스' },
]

export const COMBINED_SEGMENT_LABELS = COMBINED_SEGMENT_DEFS.map((d) => d.label)

/** 전일·전주 대비 — 광고 행 제외, 합계 포함 */
export const COMBINED_DAY_OVER_DAY_LABELS = [...COMBINED_SEGMENT_LABELS, '합계']

const SEGMENT_KEY_BY_LABEL = Object.fromEntries(
  COMBINED_SEGMENT_DEFS.map((d) => [d.label, d.key]),
)

/** @param {object} row @returns {CombinedSegmentKey|null} */
export function classifyCombinedSegment(row) {
  if (!row) return null
  if (isPowerPriceRecord(row)) return 'power_price'
  if (isCoupang1pRocketRecord(row)) return 'bh_rocket'

  const brand = resolveRecordSourceLabel(row)
  const platform = resolveRecordPlatform(row)
  const method = getSalesMethod(row)

  if (brand === '베스트하임') {
    if (platform === '쿠팡') {
      if (method === COUPANG_1P_SALES_METHOD) return 'bh_rocket'
      return 'bh_seller_growth'
    }
    if (platform === '스마트스토어') return 'bh_ss'
    return null
  }

  if (brand === '사본느리') {
    if (isOwnMallRecord(row) || platform === '자사몰') return 'sbn_ownmall'
    if (platform === '스마트스토어') return 'sbn_ss'
    if (platform === '쿠팡') return 'sbn_seller'
    return null
  }

  return null
}

/** @param {string} label */
export function combinedSegmentKeyFromLabel(label) {
  return SEGMENT_KEY_BY_LABEL[label] || null
}

/** @param {object[]} records @param {CombinedSegmentKey} segmentKey */
export function recordsForCombinedSegment(records, segmentKey) {
  return (records || []).filter((r) => classifyCombinedSegment(r) === segmentKey)
}

/** @param {object[]} records @param {string} label — 세그먼트 라벨 또는 「합계」 */
export function recordsForCombinedSegmentLabel(records, label) {
  if (label === '합계') return records || []
  const key = combinedSegmentKeyFromLabel(label)
  if (!key) return []
  return recordsForCombinedSegment(records, key)
}
