import { recordMatchesScopeCore } from './scopeFilter.js'
import { isCombinedScope, combinedIncludesPowerPrice } from '../config/combinedChannel.js'
import {
  isPowerPriceRecord,
  POWER_PRICE_DATA_SOURCE_LABEL,
} from '../config/powerPrice.js'
import { isCoupang1pRocketRecord } from '../config/coupang1pRocket.js'
import { buildPowerPriceDetailRows } from './powerPriceRecords.js'
import { buildOwnMallManualDetailRows } from './ownMallRecords.js'
import { buildCoupang1pDetailRows } from './coupang1pRocketRecords.js'

const BESTHEIM_SOURCE_LABEL = '베스트하임'

export function shouldMergeCoupang1pForExport(scope) {
  return scope === 'platform' || scope === 'platform_monthly' || isCombinedScope(scope)
}

/** @param {object} row */
export function dataSourceLabelForCombinedRow(row) {
  if (isPowerPriceRecord(row)) return POWER_PRICE_DATA_SOURCE_LABEL
  if (isCoupang1pRocketRecord(row)) return BESTHEIM_SOURCE_LABEL
  if (recordMatchesScopeCore(row, 'platform') || recordMatchesScopeCore(row, 'platform_monthly')) {
    return BESTHEIM_SOURCE_LABEL
  }
  if (recordMatchesScopeCore(row, 'company_b') || recordMatchesScopeCore(row, 'company_b_monthly')) {
    return '사본느리'
  }
  return ''
}

/** @param {object[]} records */
export function tagCombinedExportRecords(records) {
  return (records || []).map((r) => {
    if (r.dataSourceLabel) return r
    const label = dataSourceLabelForCombinedRow(r)
    return label ? { ...r, dataSourceLabel: label } : r
  })
}

function mergeCoupang1pExportRows(records, coupang1pStore) {
  if (!coupang1pStore) return records
  const c1pRows = buildCoupang1pDetailRows(
    coupang1pStore.products || [],
    coupang1pStore.orders || coupang1pStore.sales || [],
  ).map((r) => ({
    ...r,
    dataSourceLabel: BESTHEIM_SOURCE_LABEL,
  }))
  if (!c1pRows.length) return records
  return [...records, ...c1pRows]
}

/**
 * PG export — 프론트 useSalesData와 동일하게 직접입력·브랜드 라벨 병합
 * @param {object[]} records
 * @param {string} scope
 * @param {{ powerPriceStore?: object | null, ownMallStore?: object | null, coupang1pStore?: object | null }} [options]
 */
export function enrichExportRecords(records, scope, options = {}) {
  let list = [...(records || [])]
  const { powerPriceStore, ownMallStore, coupang1pStore } = options

  if (shouldMergeCoupang1pForExport(scope)) {
    list = mergeCoupang1pExportRows(list, coupang1pStore)
  }

  if (isCombinedScope(scope)) {
    if (combinedIncludesPowerPrice(scope) && powerPriceStore) {
      const ppRows = buildPowerPriceDetailRows(
        powerPriceStore.products || [],
        powerPriceStore.sales || [],
      ).map((r) => ({
        ...r,
        dataSourceLabel: POWER_PRICE_DATA_SOURCE_LABEL,
      }))
      list = [...list, ...ppRows]
    }

    if (ownMallStore) {
      const omRows = buildOwnMallManualDetailRows(
        ownMallStore.products || [],
        ownMallStore.sales || [],
      )
      list = [...list, ...omRows]
    }

    return tagCombinedExportRecords(list)
  }

  return list
}

/** @deprecated enrichExportRecords 사용 */
export function enrichCombinedExportRecords(records, scope, options = {}) {
  return enrichExportRecords(records, scope, options)
}
