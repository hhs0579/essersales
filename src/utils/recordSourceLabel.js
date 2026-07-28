import { isPowerPriceRecord, POWER_PRICE_DATA_SOURCE_LABEL } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord } from '../config/coupang1pRocket.js'
import { recordMatchesScopeCore } from './scopeFilter.js'
import {
  isClosedMallRecord,
  resolveClosedMallBrand,
  OTHER_SELLERS_BRAND_LABEL,
} from '../config/closedMall.js'

/** 통합 전일 대비 · 브랜드별 KPI (특판 폐쇄몰은 「기타 판매처」로 합산) */
export const DAY_OVER_DAY_BRAND_LABELS = [
  '베스트하임',
  '사본느리',
  '파워프라이스',
  OTHER_SELLERS_BRAND_LABEL,
  '합계',
]

/** @param {object} row */
export function resolveRecordSourceLabel(row) {
  if (!row) return ''
  if (isClosedMallRecord(row)) {
    return resolveClosedMallBrand(row) || '베스트하임'
  }
  const tagged = String(row.dataSourceLabel || '').trim()
  if (tagged && tagged !== OTHER_SELLERS_BRAND_LABEL) return tagged
  if (isPowerPriceRecord(row)) return POWER_PRICE_DATA_SOURCE_LABEL
  if (isCoupang1pRocketRecord(row)) return '베스트하임'
  if (recordMatchesScopeCore(row, 'company_b') || recordMatchesScopeCore(row, 'company_b_monthly')) {
    return '사본느리'
  }
  if (recordMatchesScopeCore(row, 'other_sellers')) {
    return resolveClosedMallBrand(row) || OTHER_SELLERS_BRAND_LABEL
  }
  if (recordMatchesScopeCore(row, 'platform') || recordMatchesScopeCore(row, 'platform_monthly')) {
    return '베스트하임'
  }
  const kind = String(row.uploadKind || row.scope || '').toLowerCase()
  if (kind.includes('company_b')) return '사본느리'
  if (kind === 'esser_closed_mall' || row.uploadFormat === 'ESSER_CLOSED_MALL') return '에쎄르'
  if (
    kind.includes('platform') ||
    kind === 'bestheim_closed_mall' ||
    row.uploadFormat === 'coupang_esser' ||
    row.uploadFormat === 'BESTHEIM_CLOSED_MALL'
  ) {
    return '베스트하임'
  }
  const brand = String(row.brand || '').trim()
  if (
    brand === '베스트하임' ||
    brand === '사본느리' ||
    brand === '에쎄르' ||
    brand === POWER_PRICE_DATA_SOURCE_LABEL
  ) {
    return brand
  }
  return brand
}

/** 통합 브랜드 롤업용 — 특판 폐쇄몰 → 기타 판매처 */
export function resolveCombinedBrandRollupLabel(row) {
  if (isClosedMallRecord(row)) return OTHER_SELLERS_BRAND_LABEL
  const label = resolveRecordSourceLabel(row)
  if (label === '에쎄르') return OTHER_SELLERS_BRAND_LABEL
  return label
}

/** @param {object} row */
export function withRecordSourceLabel(row) {
  if (!row) return row
  const label = resolveRecordSourceLabel(row)
  if (!label || row.dataSourceLabel === label) return row
  return { ...row, dataSourceLabel: label }
}
