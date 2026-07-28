/**
 * scope ↔ upload_kind 매칭 (프론트·백엔드 공통)
 */

import {
  uploadKindsForScope,
  LEGACY_BESTHEIM_UPLOAD_KINDS,
  DEPRECATED_PERIOD_UPLOAD_KINDS,
  isCombinedScope,
  isMonthlyScope,
  dailyScopeForMonthly,
} from '../config/dataChannels.js'
import { POWER_PRICE_SCOPE } from '../config/powerPrice.js'
import { COUPANG_1P_ROCKET_SCOPE } from '../config/coupang1pRocket.js'
import { CLOSED_MALL_UPLOAD_KINDS, OTHER_SELLERS_SCOPE } from '../config/closedMall.js'

/** @param {object} row @param {{ uploadKind?: string }} [opts] */
export function resolveRowUploadKind(row, opts = {}) {
  const fromOpt = opts.uploadKind != null ? String(opts.uploadKind) : ''
  if (fromOpt) return fromOpt
  return String(row?.uploadKind || row?.upload_kind || '').trim()
}

/**
 * @param {string} scope
 * @returns {string[]}
 */
export function allowedUploadKindsForScope(scope) {
  if (!scope) return []

  if (isCombinedScope(scope)) {
    return uploadKindsForScope(scope)
  }

  if (isMonthlyScope(scope)) {
    return allowedUploadKindsForScope(dailyScopeForMonthly(scope))
  }

  if (scope === 'platform') {
    return ['platform_daily', 'platform_period', 'platform_monthly', 'sales_report', '']
  }

  if (scope === OTHER_SELLERS_SCOPE || scope === 'other_sellers') {
    return [...CLOSED_MALL_UPLOAD_KINDS]
  }

  if (scope === 'company_b') {
    return ['sales_daily_b', 'sales_period_b', 'sales_monthly_b']
  }

  if (scope === POWER_PRICE_SCOPE || scope === 'power_price') {
    return ['power_price_manual', 'power_price_daily']
  }

  if (scope === COUPANG_1P_ROCKET_SCOPE || scope === 'coupang_1p_rocket') {
    return ['coupang_1p_rocket_manual']
  }

  if (scope === 'sales_report') {
    return ['sales_report', '']
  }

  const fromChannels = uploadKindsForScope(scope)
  if (fromChannels.length) return fromChannels

  return []
}

/**
 * @param {object} row
 * @param {string} scope
 * @param {{ uploadKind?: string, isMisroutedOwnMall?: (row: object) => boolean }} [opts]
 */
export function recordMatchesScopeCore(row, scope, opts = {}) {
  if (!row || !scope) return false

  if (typeof opts.isMisroutedOwnMall === 'function' && opts.isMisroutedOwnMall(row)) {
    return false
  }

  if (isCombinedScope(scope)) {
    return (
      recordMatchesScopeCore(row, 'platform', opts) ||
      recordMatchesScopeCore(row, 'company_b', opts) ||
      recordMatchesScopeCore(row, 'power_price', opts) ||
      recordMatchesScopeCore(row, OTHER_SELLERS_SCOPE, opts)
    )
  }

  if (isMonthlyScope(scope)) {
    return recordMatchesScopeCore(row, dailyScopeForMonthly(scope), opts)
  }

  const kind = resolveRowUploadKind(row, opts)
  const allowed = new Set(allowedUploadKindsForScope(scope))

  if (allowed.has(kind)) return true

  if (scope === 'platform' || scope === 'platform_monthly') {
    if (LEGACY_BESTHEIM_UPLOAD_KINDS.has(kind)) return true
    if (DEPRECATED_PERIOD_UPLOAD_KINDS.has(kind) && kind === 'platform_period') return true
    // 특판 폐쇄몰은 기타 판매처 scope 전용
    return false
  }

  if (scope === OTHER_SELLERS_SCOPE || scope === 'other_sellers') {
    if (CLOSED_MALL_UPLOAD_KINDS.includes(kind)) return true
  }

  if (scope === 'company_b' || scope === 'company_b_monthly') {
    if (kind === 'sales_period_b' || kind === 'sales_monthly_b') return true
  }

  if ((scope === 'power_price' || scope === POWER_PRICE_SCOPE) && row?.isPowerPriceManual) {
    return true
  }

  if (
    (scope === 'coupang_1p_rocket' || scope === COUPANG_1P_ROCKET_SCOPE) &&
    row?.isCoupang1pRocketManual
  ) {
    return true
  }

  return false
}

/** @param {object[]} list @param {string} scope @param {object} [opts] */
export function filterByScopeCore(list, scope, opts = {}) {
  return (list || []).filter((r) => recordMatchesScopeCore(r, scope, opts))
}
