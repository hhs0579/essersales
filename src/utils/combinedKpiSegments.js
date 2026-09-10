import { resolveRecordPlatform } from './platformDetect.js'
import { resolveRecordSourceLabel } from './recordSourceLabel.js'
import { getSalesMethod, isCoupangRocketGrowthMethod } from './salesMethodDetect.js'
import { isPowerPriceRecord } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord, COUPANG_1P_SALES_METHOD, isEsserCoupang1pRow } from '../config/coupang1pRocket.js'
import { isOwnMallRecord } from '../config/ownMall.js'
import {
  formatClosedMallKpiLabel,
  isClosedMallKpiLabel,
  isClosedMallRecord,
  resolveClosedMallSeller,
  resolveClosedMallBrand,
  closedMallSellerFromKpiLabel,
  closedMallBrandFromKpiLabel,
  OTHER_SELLERS_BRAND_LABEL,
} from '../config/closedMall.js'

/** @typedef {'bh_seller'|'bh_growth'|'bh_rocket'|'bh_ss'|'closed_mall'|'sbn_seller'|'sbn_growth'|'esser_rocket'|'sbn_ss'|'sbn_ownmall'|'power_price'} CombinedSegmentKey */

/** 통합 KPI·전일매출 고정 세그먼트 (특판 폐쇄몰은 판매처별 동적 행) */
export const COMBINED_SEGMENT_DEFS = [
  { key: 'bh_seller', label: '베스트하임(판매자)' },
  { key: 'bh_growth', label: '베스트하임(그로스)' },
  { key: 'bh_rocket', label: '베스트하임(로켓)' },
  { key: 'bh_ss', label: '베스트하임(스스)' },
  { key: 'sbn_seller', label: '사본느리(판매자)' },
  { key: 'sbn_growth', label: '사본느리(그로스)' },
  { key: 'esser_rocket', label: '에쎄르(로켓)' },
  { key: 'sbn_ss', label: '사본느리(스스)' },
  { key: 'sbn_ownmall', label: '사본느리(자사몰)' },
  { key: 'power_price', label: '파워프라이스' },
]

export const COMBINED_SEGMENT_LABELS = COMBINED_SEGMENT_DEFS.map((d) => d.label)

/**
 * 세그먼트 KPI 라벨 → 스토어 롤업
 * 베스트하임(판매자·폐쇄몰 등) → 베스트하임, 에쎄르/사본느리* → 에쎄르
 */
export function combinedBrandRollupKeyFromSegmentLabel(label) {
  const s = String(label || '').trim()
  if (!s || s === '합계') return ''
  if (s === '파워프라이스' || s.startsWith('파워프라이스')) return '파워프라이스'
  if (s.startsWith('베스트하임')) return '베스트하임'
  if (s.startsWith('에쎄르') || s.startsWith('사본느리')) return '에쎄르'
  return OTHER_SELLERS_BRAND_LABEL
}

/**
 * 세그먼트 KPI 라벨 → 전월대비·스토어·일별 브랜드
 * 베스트하임 폐쇄몰 → 베스트하임, 에쎄르 폐쇄몰 → 에쎄르
 */
export function combinedBrandDodKeyFromSegmentLabel(label) {
  const s = String(label || '').trim()
  if (!s || s === '합계') return ''
  if (s === '파워프라이스' || s.startsWith('파워프라이스')) return '파워프라이스'
  if (isClosedMallKpiLabel(s)) {
    const brand = closedMallBrandFromKpiLabel(s)
    if (brand === '베스트하임') return '베스트하임'
    if (brand === '에쎄르' || brand === '사본느리') return '에쎄르'
  }
  if (s.startsWith('베스트하임')) return '베스트하임'
  if (s.startsWith('에쎄르') || s.startsWith('사본느리')) return '에쎄르'
  return OTHER_SELLERS_BRAND_LABEL
}

/** 고정 세그먼트 + 합계 (동적 특판 행은 compute 시 records로 보강) */
export const COMBINED_DAY_OVER_DAY_LABELS = [...COMBINED_SEGMENT_LABELS, '합계']

const SEGMENT_KEY_BY_LABEL = Object.fromEntries(
  COMBINED_SEGMENT_DEFS.map((d) => [d.label, d.key]),
)

/** @param {object} row @returns {CombinedSegmentKey|null} */
export function classifyCombinedSegment(row) {
  if (!row) return null
  if (isPowerPriceRecord(row)) return 'power_price'
  if (isCoupang1pRocketRecord(row)) {
    return isEsserCoupang1pRow(row) ? 'esser_rocket' : 'bh_rocket'
  }
  if (isClosedMallRecord(row)) return 'closed_mall'

  const brand = resolveRecordSourceLabel(row)
  const platform = resolveRecordPlatform(row)
  const method = getSalesMethod(row)

  if (brand === '베스트하임' || brand === '에쎄르') {
    if (platform === '특판 폐쇄몰' || method === '특판 폐쇄몰') return 'closed_mall'
  }

  if (brand === '베스트하임') {
    if (platform === '쿠팡') {
      if (method === COUPANG_1P_SALES_METHOD) return 'bh_rocket'
      return isCoupangRocketGrowthMethod(method) ? 'bh_growth' : 'bh_seller'
    }
    if (platform === '스마트스토어') return 'bh_ss'
    return null
  }

  if (brand === '사본느리') {
    if (isOwnMallRecord(row) || platform === '자사몰') return 'sbn_ownmall'
    if (platform === '스마트스토어') return 'sbn_ss'
    if (platform === '쿠팡') {
      if (method === COUPANG_1P_SALES_METHOD) return 'esser_rocket'
      return isCoupangRocketGrowthMethod(method) ? 'sbn_growth' : 'sbn_seller'
    }
    return null
  }

  return null
}

/** @param {object[]} records */
export function closedMallKpiLabelsFromRecords(records) {
  const labels = new Set()
  for (const row of records || []) {
    if (!isClosedMallRecord(row) && classifyCombinedSegment(row) !== 'closed_mall') continue
    const brand = resolveClosedMallBrand(row) || '베스트하임'
    const seller = resolveClosedMallSeller(row)
    labels.add(formatClosedMallKpiLabel(brand, seller))
  }
  return [...labels].sort((a, b) => a.localeCompare(b, 'ko'))
}

/**
 * 통합 전일대비 라벨 — 고정 세그먼트 사이(베스트하임 스스 다음)에 특판 행 삽입
 * @param {object[]} [records]
 */
export function combinedDayOverDayLabelsForRecords(records = []) {
  const labels = []
  for (const def of COMBINED_SEGMENT_DEFS) {
    labels.push(def.label)
    if (def.key === 'bh_ss') {
      labels.push(...closedMallKpiLabelsFromRecords(records))
    }
  }
  labels.push('합계')
  return labels
}

/** @param {string} label */
export function combinedSegmentKeyFromLabel(label) {
  if (label === '베스트하임(판매자+그로스)') return 'bh_seller'
  if (label === '사본느리(판매자+그로스)') return 'sbn_seller'
  const fixed = SEGMENT_KEY_BY_LABEL[label]
  if (fixed) return fixed
  if (isClosedMallKpiLabel(label)) return 'closed_mall'
  return null
}

/** @param {object[]} records @param {CombinedSegmentKey} segmentKey */
export function recordsForCombinedSegment(records, segmentKey) {
  return (records || []).filter((r) => classifyCombinedSegment(r) === segmentKey)
}

/** @param {object[]} records @param {string} label — 세그먼트 라벨·특판 판매처 라벨·「합계」 */
export function recordsForCombinedSegmentLabel(records, label) {
  if (label === '합계') return records || []
  if (label === OTHER_SELLERS_BRAND_LABEL) {
    return (records || []).filter((r) => classifyCombinedSegment(r) === 'closed_mall')
  }
  if (isClosedMallKpiLabel(label)) {
    const seller = closedMallSellerFromKpiLabel(label)
    const brand = closedMallBrandFromKpiLabel(label)
    return (records || []).filter((r) => {
      if (classifyCombinedSegment(r) !== 'closed_mall') return false
      if (brand && resolveClosedMallBrand(r) !== brand) return false
      if (!seller) return true
      return resolveClosedMallSeller(r) === seller
    })
  }
  const key = combinedSegmentKeyFromLabel(label)
  if (!key) return []
  return recordsForCombinedSegment(records, key)
}

export { OTHER_SELLERS_BRAND_LABEL }
