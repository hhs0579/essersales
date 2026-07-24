import { isPowerPriceRecord, POWER_PRICE_DATA_SOURCE_LABEL } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord } from '../config/coupang1pRocket.js'
import { recordMatchesScopeCore } from './scopeFilter.js'

/** 통합 전일 대비 · 브랜드별 KPI */
export const DAY_OVER_DAY_BRAND_LABELS = ['베스트하임', '사본느리', '파워프라이스', '합계']

/** @param {object} row */
export function resolveRecordSourceLabel(row) {
  if (!row) return ''
  const tagged = String(row.dataSourceLabel || '').trim()
  if (tagged) return tagged
  if (isPowerPriceRecord(row)) return POWER_PRICE_DATA_SOURCE_LABEL
  if (isCoupang1pRocketRecord(row)) return '베스트하임'
  if (recordMatchesScopeCore(row, 'company_b') || recordMatchesScopeCore(row, 'company_b_monthly')) {
    return '사본느리'
  }
  if (recordMatchesScopeCore(row, 'platform') || recordMatchesScopeCore(row, 'platform_monthly')) {
    return '베스트하임'
  }
  const kind = String(row.uploadKind || row.scope || '').toLowerCase()
  if (kind.includes('company_b')) return '사본느리'
  if (kind.includes('platform') || row.uploadFormat === 'coupang_esser') return '베스트하임'
  const brand = String(row.brand || '').trim()
  if (brand === '베스트하임' || brand === '사본느리' || brand === POWER_PRICE_DATA_SOURCE_LABEL) {
    return brand
  }
  return brand
}

/** @param {object} row */
export function withRecordSourceLabel(row) {
  if (!row) return row
  const label = resolveRecordSourceLabel(row)
  if (!label || row.dataSourceLabel === label) return row
  return { ...row, dataSourceLabel: label }
}
