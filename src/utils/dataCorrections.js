/**
 * 로우데이터 오류 시 기간·채널별 임시 보정 (KPI·차트·엑셀 반영)
 * 광고비·광고매출은 엑셀 합계 행을 그대로 유지합니다.
 */

import { getRecordDate } from './recordFilters.js'
import { resolveRecordPlatform } from './platformDetect.js'
import { isReturnRecord } from './transactionType.js'
import {
  isEsserSheetTotalRecord,
  resolveEsserSalesQty,
} from './esserMetrics.js'
import { isCombinedScope } from '../config/dataChannels.js'
import { calcOwnMallCardFee } from '../config/ownMall.js'

/** @typedef {Object} SalesDataCorrection
 * @property {string} id
 * @property {string[]} scopes
 * @property {string} [sourceLabel] 통합 탭 출처 (사본느리)
 * @property {string} platform
 * @property {string} dateFrom YYYY-MM-DD
 * @property {string} dateTo YYYY-MM-DD
 * @property {number} sales 기간 합산 매출
 * @property {number} [costRate] 원가율 (%) — totalCost 없을 때
 * @property {number} [totalCost] 원가 합계 (직접 지정)
 * @property {number} [salesQty] inject 시 기본 수량
 * @property {boolean} [inject] 기존 행 없어도 1행 추가 (날짜 필터 없을 때도 반영)
 */

/** @type {SalesDataCorrection[]} */
export const ACTIVE_SALES_CORRECTIONS = [
  {
    id: 'sabonneuri_smart_20260601_07',
    scopes: ['company_b', 'combined_daily'],
    sourceLabel: '사본느리',
    platform: '스마트스토어',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-07',
    sales: 4030000,
    costRate: 35,
  },
]

/** @param {object} filterCtx */
function filterCoversCorrectionPeriod(filterCtx, fix) {
  const dateFrom = filterCtx?.dateFrom || ''
  const dateTo = filterCtx?.dateTo || ''
  if (!dateFrom && !dateTo) return Boolean(fix.inject)
  const from = dateFrom || '0000-00-00'
  const to = dateTo || '9999-99-99'
  return from <= fix.dateFrom && to >= fix.dateTo
}

function recordDateInFixWindow(row, fix) {
  const d = getRecordDate(row)
  if (!d) return false
  return d >= fix.dateFrom && d <= fix.dateTo
}

/** @param {object} row @param {string} scope */
function rowMatchesCorrectionSource(row, scope, fix) {
  if (isCombinedScope(scope)) {
    return row.dataSourceLabel === fix.sourceLabel
  }
  return scope === 'company_b' || scope === 'company_b_monthly'
}

function rowMatchesCorrection(row, scope, fix) {
  if (!rowMatchesCorrectionSource(row, scope, fix)) return false
  if (resolveRecordPlatform(row) !== fix.platform) return false
  if (!recordDateInFixWindow(row, fix)) return false
  return true
}

function buildCorrectionRow(fix, removedProductRows) {
  const totalCost =
    fix.totalCost != null
      ? Math.round(fix.totalCost)
      : Math.round((fix.sales * (fix.costRate || 0)) / 100)
  let netProfit = fix.sales - totalCost
  let channelFee = ''
  if (fix.platform === '자사몰') {
    const fee = calcOwnMallCardFee(fix.sales)
    netProfit -= fee
    channelFee = String(fee)
  }
  const salesQty = removedProductRows.length
    ? removedProductRows.reduce((sum, r) => sum + resolveEsserSalesQty(r), 0)
    : fix.salesQty ?? 1
  const dateLabel =
    fix.dateFrom === fix.dateTo ? fix.dateFrom : `${fix.dateFrom}~${fix.dateTo}`

  return {
    id: `data-correction:${fix.id}`,
    isDataCorrection: true,
    dataSourceLabel: fix.sourceLabel,
    platform: fix.platform,
    channel: fix.platform,
    salesMethod: fix.platform,
    date: fix.dateFrom,
    sales: fix.sales,
    totalCost,
    channelFee,
    netProfit,
    salesQty,
    uploadFormat: 'coupang_esser',
    correctionNote: `${dateLabel} ${fix.sourceLabel} ${fix.platform} 임시 보정`,
  }
}

/**
 * @param {object[]} records
 * @param {string} scope
 * @param {object} [filterCtx]
 */
export function applyDataCorrections(records, scope, filterCtx = {}) {
  const fixes = ACTIVE_SALES_CORRECTIONS.filter((f) => f.scopes.includes(scope))
  if (!fixes.length) return records || []

  let result = [...(records || [])]

  for (const fix of fixes) {
    if (!filterCoversCorrectionPeriod(filterCtx, fix)) continue

    const removeIds = new Set()
    const removedProductRows = []

    for (const row of result) {
      if (isReturnRecord(row)) continue
      if (!rowMatchesCorrection(row, scope, fix)) continue
      if (isEsserSheetTotalRecord(row)) continue
      removeIds.add(row.id)
      removedProductRows.push(row)
    }

    if (!removedProductRows.length && !fix.inject) continue

    result = result.filter((r) => !removeIds.has(r.id))
    result.push(buildCorrectionRow(fix, removedProductRows))
  }

  return result
}
