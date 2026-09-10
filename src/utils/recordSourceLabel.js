import { isPowerPriceRecord, POWER_PRICE_DATA_SOURCE_LABEL } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord } from '../config/coupang1pRocket.js'
import { recordMatchesScopeCore } from './scopeFilter.js'
import {
  isClosedMallRecord,
  resolveClosedMallBrand,
  resolveClosedMallProductBrand,
  OTHER_SELLERS_BRAND_LABEL,
} from '../config/closedMall.js'

/** 통합 전일 대비 · 브랜드별 KPI (베스트하임 폐쇄몰 → 베스트하임) */
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
    const closedBrand = resolveClosedMallBrand(row) || '베스트하임'
    // 에쎄르 특판 폐쇄몰 → 사본느리 합산
    return closedBrand === '에쎄르' ? '사본느리' : closedBrand
  }
  const tagged = String(row.dataSourceLabel || '').trim()
  if (tagged && tagged !== OTHER_SELLERS_BRAND_LABEL) return tagged
  if (isPowerPriceRecord(row)) return POWER_PRICE_DATA_SOURCE_LABEL
  if (isCoupang1pRocketRecord(row)) {
    const tagged = String(row.dataSourceLabel || '').trim()
    if (tagged === '사본느리' || row.coupang1pBrandKey === 'esser' || row.brand === '에쎄르') {
      return '사본느리'
    }
    return '베스트하임'
  }
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
  // 에쎄르 특판·브랜드는 사본느리로 합산 (스토어별·일별 브랜드와 동일)
  if (kind === 'esser_closed_mall' || row.uploadFormat === 'ESSER_CLOSED_MALL') return '사본느리'
  if (
    kind.includes('platform') ||
    kind === 'bestheim_closed_mall' ||
    row.uploadFormat === 'coupang_esser' ||
    row.uploadFormat === 'BESTHEIM_CLOSED_MALL'
  ) {
    return '베스트하임'
  }
  const brand = resolveClosedMallProductBrand(row) || String(row.brand || '').trim()
  if (/에쎄르/i.test(brand)) return '사본느리'
  if (/사본느리/i.test(brand)) return '사본느리'
  if (/베스트하임/i.test(brand)) return '베스트하임'
  if (brand === POWER_PRICE_DATA_SOURCE_LABEL) return brand
  return brand
}

/** 에쎄르 매출 행 (로켓 1P·특판·브랜드) — 전월대비 사본느리에서 제외 */
export function isEsserBrandSalesRow(row) {
  if (!row) return false
  if (row.coupang1pBrandKey === 'esser') return true
  if (isClosedMallRecord(row) && resolveClosedMallBrand(row) === '에쎄르') return true
  const kind = String(row.uploadKind || row.scope || '').toLowerCase()
  if (kind === 'esser_closed_mall' || row.uploadFormat === 'ESSER_CLOSED_MALL') return true
  if (/에쎄르/i.test(String(row.brand || ''))) return true
  if (String(row.dataSourceLabel || '').trim() === '에쎄르') return true
  return false
}

/** 통합 브랜드 롤업용 — 에쎄르 폐쇄몰→사본느리, 베스트하임 폐쇄몰→베스트하임 */
export function resolveCombinedBrandRollupLabel(row) {
  if (isClosedMallRecord(row)) {
    if (resolveClosedMallBrand(row) === '에쎄르') return '사본느리'
    return '베스트하임'
  }
  const label = resolveRecordSourceLabel(row)
  if (label === '에쎄르') return '사본느리'
  return label
}

/** 전월대비·스토어·일별 — 에쎄르 행에 사본느리 매출 합산 */
export function resolveCombinedBrandDodLabel(row) {
  const label = resolveCombinedBrandRollupLabel(row)
  if (label === '에쎄르' || label === '사본느리') return '에쎄르'
  if (isEsserBrandSalesRow(row)) return '에쎄르'
  return label
}

/** 일별·브랜드 시트 필터 — 에쎄르 = 사본느리 롤업 포함 */
export function matchesCombinedReportBrand(row, brandLabel) {
  const rollup = resolveCombinedBrandRollupLabel(row)
  if (brandLabel === '에쎄르') return rollup === '에쎄르' || rollup === '사본느리'
  return rollup === brandLabel
}

/** 광고 채널 라벨 — 사본느리를 에쎄르 일별에 포함 */
export function isEsserReportBrandChannel(label) {
  return label === '에쎄르' || label === '사본느리'
}

/** @param {object} row */
export function withRecordSourceLabel(row) {
  if (!row) return row
  const label = resolveRecordSourceLabel(row)
  if (!label || row.dataSourceLabel === label) return row
  return { ...row, dataSourceLabel: label }
}
