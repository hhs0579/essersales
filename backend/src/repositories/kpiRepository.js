import { parseOptionalDate, trimFilter } from '../utils/queryHelpers.js'
import { allowedUploadKindsForScope } from '../utils/scopeFilter.js'

/**
 * KPI 집계용 대표 날짜 (기간 필터·레거시 호환)
 * order_date 포함
 */
export const KPI_DATE_SQL = `kpi_date`

/** 일별 차트 집계일 — 컬럼은 JS resolveAggregationDate 와 동일하게 유지(006) */
export const KPI_AGGREGATION_DATE_SQL = `kpi_aggregation_date`

/** 조회 시 JSON 정규식 반복 대신 저장된 집계일 사용 */
export const KPI_AGG_DATE_EXPR = `kpi_aggregation_date`

/** JS parseSalesDate — ISO 및 2026. 6. 30 / 2026.6.30 (필터 날짜용) */
export function sqlParseSalesDate(textExpr) {
  return `(CASE
    WHEN ${textExpr} IS NULL OR BTRIM((${textExpr})::text) = '' THEN NULL
    WHEN BTRIM((${textExpr})::text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      THEN SUBSTRING(BTRIM((${textExpr})::text) FROM 1 FOR 10)::date
    WHEN BTRIM((${textExpr})::text) ~ '[0-9]{4}'
      THEN (
        SELECT make_date(m[1]::int, m[2]::int, m[3]::int)
        FROM regexp_match(
          BTRIM((${textExpr})::text),
          '([0-9]{4})[[:space:]]*[.\\-/년．][[:space:]]*([0-9]{1,2})[[:space:]]*[.\\-/월．]?[[:space:]]*([0-9]{1,2})'
        ) AS m
      )
    ELSE NULL
  END)`
}

/** JS resolveKpiFilterDate — order_date → business_date → 단일일 period → data.date */
export const KPI_FILTER_DATE_EXPR = `COALESCE(
  order_date,
  business_date,
  CASE WHEN period_from IS NOT NULL AND (period_to IS NULL OR period_from = period_to)
    THEN period_from END,
  ${sqlParseSalesDate("data->>'date'")}
)`

export const KPI_SHEET_TOTAL_SQL = `(
  COALESCE(data->>'isEsserSheetTotal', 'false') IN ('true', '1', 't')
)`

export const KPI_RETURN_SQL = `(
  transaction_type = 'return'
  OR COALESCE(sales, 0) < 0
  OR COALESCE(sales_qty, 0) < 0
)`

export const KPI_UPLOAD_KEY_SQL = `COALESCE(
  NULLIF(upload_id::text, ''),
  NULLIF(data->>'sourceFileName', ''),
  NULLIF(data->>'fileName', ''),
  '__single__'
)`

export const KPI_CLOSED_MALL_SQL = `(
  upload_kind IN ('bestheim_closed_mall', 'esser_closed_mall')
  OR COALESCE(upload_format, '') IN ('BESTHEIM_CLOSED_MALL', 'ESSER_CLOSED_MALL')
  OR COALESCE(platform, '') = '특판 폐쇄몰'
)`

/** sales_records 직접 WHERE — data JSON·platform (labeled CTE·구 DB 호환) */
export const KPI_CLOSED_MALL_RECORD_WHERE_SQL = `(
  COALESCE(data->>'uploadKind', '') IN ('bestheim_closed_mall', 'esser_closed_mall')
  OR COALESCE(data->>'uploadFormat', '') IN ('BESTHEIM_CLOSED_MALL', 'ESSER_CLOSED_MALL')
  OR COALESCE(platform, '') = '특판 폐쇄몰'
)`

export const KPI_CLOSED_BRAND_SQL = `CASE
  WHEN upload_kind = 'esser_closed_mall' OR COALESCE(upload_format, '') = 'ESSER_CLOSED_MALL' THEN '에쎄르'
  WHEN upload_kind = 'bestheim_closed_mall' OR COALESCE(upload_format, '') = 'BESTHEIM_CLOSED_MALL' THEN '베스트하임'
  WHEN COALESCE(data->>'dataSourceLabel', '') IN ('에쎄르', '베스트하임') THEN data->>'dataSourceLabel'
  ELSE '베스트하임'
END`

export const KPI_CLOSED_SELLER_SQL = `COALESCE(
  NULLIF(BTRIM(store_name), ''),
  NULLIF(BTRIM(data->>'storeName'), ''),
  NULLIF(BTRIM(data->>'closedMallSeller'), ''),
  NULLIF(BTRIM(data->>'seller'), ''),
  '특판'
)`

export const KPI_CLOSED_LABEL_SQL = `((${KPI_CLOSED_BRAND_SQL}) || '(' || (${KPI_CLOSED_SELLER_SQL}) || ')')`

/** 쿠팡 1P 로켓 — 에쎄르(사본느리) 직접입력·엑셀 */
export const KPI_ESSER_ROCKET_ROW_SQL = `(
  COALESCE(data->>'coupang1pBrandKey', '') = 'esser'
  OR COALESCE(data->>'brand', '') = '에쎄르'
  OR (
    upload_kind = 'coupang_1p_rocket_manual'
    AND COALESCE(data->>'dataSourceLabel', '') = '사본느리'
  )
  OR (
    upload_kind IN ('sales_daily_b', 'sales_period_b', 'sales_monthly_b')
    AND COALESCE(sales_method, '') = '1P 로켓'
  )
  OR (
    COALESCE(sales_method, '') = '1P 로켓'
    AND COALESCE(data->>'brand', '') ~ '에쎄르|사본느리'
  )
)`

/** JS parseAmount — JSON 텍스트 */
export function sqlParseAmount(textExpr) {
  return `COALESCE(CASE
    WHEN ${textExpr} IS NULL OR BTRIM((${textExpr})::text) = '' THEN 0
    WHEN REPLACE(REPLACE(BTRIM((${textExpr})::text), ',', ''), ' ', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      THEN REPLACE(REPLACE(BTRIM((${textExpr})::text), ',', ''), ' ', '')::numeric
    ELSE 0
  END, 0)`
}

export const KPI_ROW_COST_SQL = `COALESCE(
  NULLIF(${sqlParseAmount("data->>'totalCost'")}, 0),
  NULLIF(${sqlParseAmount("data->>'sales_cost'")}, 0),
  CASE
    WHEN ${sqlParseAmount("COALESCE(data->>'unitCost', data->>'cost_price')")} <> 0
     AND COALESCE(sales_qty, 0) <> 0
    THEN ${sqlParseAmount("COALESCE(data->>'unitCost', data->>'cost_price')")} * sales_qty
    ELSE 0
  END
)`

export const KPI_AD_SALES_SQL = sqlParseAmount("COALESCE(data->>'adSales', data->>'ad_sales')")

/** JS resolvePlatformFromRow */
export const KPI_PLATFORM_SQL = `CASE
  WHEN COALESCE(data->>'channelKind', data->>'channel_kind', data->>'channelType', data->>'채널종류', '')
    ~* '(스마트스토어|smartstore|네이버|naver)' THEN '스마트스토어'
  WHEN COALESCE(data->>'channelKind', data->>'channel_kind', data->>'channelType', data->>'채널종류', '')
    ~* '(쿠팡|coupang|로켓)' THEN '쿠팡'
  WHEN COALESCE(data->>'channelKind', data->>'channel_kind', data->>'channelType', data->>'채널종류', '')
    ~* '(자사몰|자체몰|ownmall)' THEN '자사몰'
  WHEN LOWER(COALESCE(data->>'sourceFileName', data->>'fileName', '')) ~ '(coupang|쿠팡)' THEN '쿠팡'
  WHEN LOWER(COALESCE(data->>'sourceFileName', data->>'fileName', '')) ~ '(naver|스마트스토어|네이버)' THEN '스마트스토어'
  WHEN CASE WHEN COALESCE(platform, '') = '네이버' THEN '스마트스토어' ELSE COALESCE(platform, '') END
    IN ('쿠팡', '스마트스토어', '자사몰', '특판 폐쇄몰')
    THEN CASE WHEN platform = '네이버' THEN '스마트스토어' ELSE platform END
  WHEN CASE WHEN COALESCE(channel, '') = '네이버' THEN '스마트스토어' ELSE COALESCE(channel, '') END
    IN ('쿠팡', '스마트스토어', '자사몰', '특판 폐쇄몰')
    THEN CASE WHEN channel = '네이버' THEN '스마트스토어' ELSE channel END
  ELSE COALESCE(
    NULLIF(CASE WHEN platform = '네이버' THEN '스마트스토어' ELSE platform END, ''),
    NULLIF(CASE WHEN channel = '네이버' THEN '스마트스토어' ELSE channel END, ''),
    '미지정'
  )
END`

export const KPI_COUPANG_GROWTH_SQL = `(
  COALESCE(sales_method, '') IN ('로켓그로스')
  OR REPLACE(COALESCE(sales_method, ''), ' ', '') ILIKE '%로켓그로스%'
  OR REPLACE(LOWER(COALESCE(data->>'sourceFileName', data->>'fileName', '')), ' ', '')
    ~ '로켓그로스|rocketgrowth|rocket_growth'
)`

export const KPI_SEGMENT_KEY_SQL = `CASE
  WHEN ${KPI_CLOSED_MALL_SQL} THEN 'closed_mall'
  WHEN upload_kind IN ('power_price_manual', 'power_price_daily') THEN 'power_price'
  WHEN ${KPI_ESSER_ROCKET_ROW_SQL} THEN 'esser_rocket'
  WHEN upload_kind = 'coupang_1p_rocket_manual' OR COALESCE(sales_method, '') = '1P 로켓' THEN 'bh_rocket'
  WHEN upload_kind IN ('sales_daily_b', 'sales_period_b', 'sales_monthly_b') THEN
    CASE
      WHEN (${KPI_PLATFORM_SQL}) = '자사몰' THEN 'sbn_ownmall'
      WHEN (${KPI_PLATFORM_SQL}) = '스마트스토어' THEN 'sbn_ss'
      WHEN (${KPI_PLATFORM_SQL}) = '쿠팡' AND ${KPI_COUPANG_GROWTH_SQL} THEN 'sbn_growth'
      WHEN (${KPI_PLATFORM_SQL}) = '쿠팡' THEN 'sbn_seller'
      ELSE NULL
    END
  ELSE
    CASE
      WHEN (${KPI_PLATFORM_SQL}) = '쿠팡' AND ${KPI_COUPANG_GROWTH_SQL} THEN 'bh_growth'
      WHEN (${KPI_PLATFORM_SQL}) = '쿠팡' THEN 'bh_seller'
      WHEN (${KPI_PLATFORM_SQL}) = '스마트스토어' THEN 'bh_ss'
      ELSE NULL
    END
END`

export const KPI_SEGMENT_LABEL_SQL = `CASE
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'closed_mall' THEN ${KPI_CLOSED_LABEL_SQL}
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'bh_seller' THEN '베스트하임(판매자)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'bh_growth' THEN '베스트하임(그로스)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'bh_rocket' THEN '베스트하임(로켓)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'bh_ss' THEN '베스트하임(스스)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'sbn_seller' THEN '사본느리(판매자)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'sbn_growth' THEN '사본느리(그로스)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'esser_rocket' THEN '에쎄르(로켓)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'sbn_ss' THEN '사본느리(스스)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'sbn_ownmall' THEN '사본느리(자사몰)'
  WHEN (${KPI_SEGMENT_KEY_SQL}) = 'power_price' THEN '파워프라이스'
  ELSE NULL
END`

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
        AND NOT (${KPI_CLOSED_MALL_RECORD_WHERE_SQL})
      )
    )`)
    params.push(filters.from, filters.to)
    i += 2
  } else if (filters.from) {
    clauses.push(`(
      (${KPI_DATE_SQL}) >= $${i}::date
      OR (period_to >= $${i}::date AND NOT (${KPI_CLOSED_MALL_RECORD_WHERE_SQL}))
    )`)
    params.push(filters.from)
    i += 1
  } else if (filters.to) {
    clauses.push(`(
      (${KPI_DATE_SQL}) <= $${i}::date
      OR (period_from <= $${i}::date AND NOT (${KPI_CLOSED_MALL_RECORD_WHERE_SQL}))
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
