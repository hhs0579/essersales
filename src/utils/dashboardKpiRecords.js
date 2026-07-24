import { isCombinedScope, combinedIncludesPowerPrice } from '../config/combinedChannel.js'
import {
  applyRecordFilters,
  excludeEsserSheetTotalsForPeriodKpi,
} from './recordFilters.js'
import { tagCombinedExportRecords } from './combinedExportRecords.js'

/**
 * 대시보드 KPI 표 — PG 상세 캐시와 무관하게 직접입력(쿠팡 1P·파워프라이스·자사몰) 행 보장
 * @param {object[]} records
 * @param {string} scope
 * @param {object} filterCtx
 * @param {{ coupang1p?: object[], powerPrice?: object[], ownMall?: object[] }} manualInputs
 */
export function mergeDashboardManualInputRecords(records, scope, filterCtx = {}, manualInputs = {}) {
  const { coupang1p = [], powerPrice = [], ownMall = [] } = manualInputs
  const ids = new Set((records || []).map((r) => r.id))
  let out = [...(records || [])]

  const f = {
    ...filterCtx,
    platform: '',
    salesMethod: '',
    year: '',
    month: '',
    dayOfWeek: '',
    date: '',
    channel: '',
    brand: '',
    productName: '',
  }

  const appendFiltered = (list) => {
    const filtered = excludeEsserSheetTotalsForPeriodKpi(
      applyRecordFilters(list || [], 'detail', f),
      f,
    )
    for (const row of filtered) {
      if (!row?.id || ids.has(row.id)) continue
      ids.add(row.id)
      out.push(row)
    }
  }

  appendFiltered(coupang1p)
  if (isCombinedScope(scope) && combinedIncludesPowerPrice(scope)) {
    appendFiltered(powerPrice)
  }
  if (scope === 'company_b' || scope === 'company_b_monthly' || isCombinedScope(scope)) {
    appendFiltered(ownMall)
  }

  if (isCombinedScope(scope)) {
    out = tagCombinedExportRecords(out)
  }

  return out
}
