import { parseOptionalDate, trimFilter } from '../utils/queryHelpers.js'
import { allowedUploadKindsForScope } from '../utils/scopeFilter.js'

/**
 * KPI 집계용 대표 날짜 (기간 필터·레거시 호환)
 * order_date 포함
 */
export const KPI_DATE_SQL = `kpi_date`

/**
 * 일별 차트 집계용 날짜 — 클라이언트 resolveRecordDateForAggregation 와 동일 우선순위
 * order_date 폴백 없음 (파싱 불가 행은 일별 버킷 제외, summary에는 포함)
 */
export const KPI_AGGREGATION_DATE_SQL = `kpi_aggregation_date`

/** 상품 KPI 집계 대상 행 (반품·엑셀 합계 행 제외) */
export const KPI_PRODUCT_ROW_SQL = `
  record_type = 'detail'
  AND (transaction_type IS NULL OR transaction_type <> 'return')
  AND NOT (COALESCE(sales, 0) < 0 OR COALESCE(sales_qty, 0) < 0)
  AND COALESCE(data->>'isEsserSheetTotal', 'false') NOT IN ('true', '1', 't')
`

/**
 * @param {Record<string, string | undefined>} query
 */
export function parseKpiQuery(query = {}) {
  const includeRaw = query.include_manual_ads
  const includeManualAds =
    includeRaw === undefined || includeRaw === ''
      ? true
      : !['false', '0', 'no'].includes(String(includeRaw).toLowerCase())

  return {
    from: parseOptionalDate(query.from),
    to: parseOptionalDate(query.to),
    platform: trimFilter(query.platform),
    salesMethod: trimFilter(query.sales_method),
    storeName: trimFilter(query.store_name),
    uploadKind: trimFilter(query.upload_kind),
    uploadFormat: trimFilter(query.upload_format),
    date: parseOptionalDate(query.date),
    compareFrom: parseOptionalDate(query.compare_from),
    compareTo: parseOptionalDate(query.compare_to),
    scope: trimFilter(query.scope),
    includeManualAds,
  }
}

/**
 * @param {ReturnType<typeof parseKpiQuery>} filters
 * @param {{ productRowsOnly?: boolean }} [options]
 */
export function buildKpiWhere(filters, options = {}) {
  const clauses = []
  const params = []
  let i = 1

  if (options.productRowsOnly) {
    clauses.push(KPI_PRODUCT_ROW_SQL)
  }

  if (filters.from && filters.to) {
    clauses.push(`(
      (${KPI_DATE_SQL}) IS NOT NULL AND (${KPI_DATE_SQL}) BETWEEN $${i}::date AND $${i + 1}::date
      OR (
        period_from IS NOT NULL AND period_to IS NOT NULL
        AND period_from <= $${i + 1}::date AND period_to >= $${i}::date
      )
    )`)
    params.push(filters.from, filters.to)
    i += 2
  } else if (filters.from) {
    clauses.push(`(
      (${KPI_DATE_SQL}) >= $${i}::date
      OR period_to >= $${i}::date
    )`)
    params.push(filters.from)
    i += 1
  } else if (filters.to) {
    clauses.push(`(
      (${KPI_DATE_SQL}) <= $${i}::date
      OR period_from <= $${i}::date
    )`)
    params.push(filters.to)
    i += 1
  }

  const eqFilters = [
    ['platform', filters.platform],
    ['sales_method', filters.salesMethod],
    ['store_name', filters.storeName],
    ['upload_kind', filters.uploadKind],
    ['upload_format', filters.uploadFormat],
  ]
  for (const [col, val] of eqFilters) {
    if (val) {
      clauses.push(`${col} = $${i++}`)
      params.push(val)
    }
  }

  if (filters.scope) {
    const kinds = allowedUploadKindsForScope(filters.scope)
    if (kinds.length) {
      clauses.push(`upload_kind = ANY($${i++}::text[])`)
      params.push(kinds)
    } else if (filters.scope === 'sales_report') {
      clauses.push(`(upload_kind IS NULL OR upload_kind = '' OR NOT (upload_kind = ANY($${i++}::text[])))`)
      params.push([
        'platform_daily',
        'platform_monthly',
        'sales_daily_b',
        'sales_monthly_b',
        'power_price_daily',
      ])
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}
