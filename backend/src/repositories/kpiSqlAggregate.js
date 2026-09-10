/**
 * 2단계 — 일별·플랫폼·세그먼트 KPI를 SQL GROUP BY 로 집계.
 * 응답 숫자는 기존 JS(esserKpiAggregate)와 같은 규칙(합계행 우선·상품행 제외)을 따른다.
 */
import { getPool } from '../db/pool.js'
import {
  buildKpiWhere,
  KPI_AGG_DATE_EXPR,
  KPI_FILTER_DATE_EXPR,
  KPI_SHEET_TOTAL_SQL,
  KPI_RETURN_SQL,
  KPI_UPLOAD_KEY_SQL,
  KPI_CLOSED_MALL_SQL,
  KPI_CLOSED_LABEL_SQL,
  KPI_PLATFORM_SQL,
  KPI_SEGMENT_KEY_SQL,
  KPI_SEGMENT_LABEL_SQL,
  KPI_ROW_COST_SQL,
  KPI_AD_SALES_SQL,
} from './kpiRepository.js'

const PLATFORM_SPLIT_LABELS = ['쿠팡', '스마트스토어', '자사몰']

function round2(n) {
  return Number(Number(n).toFixed(2))
}

function num(v) {
  return Number(v || 0)
}

function finalizeBucket(bucket) {
  const sales = num(bucket.salesTotal)
  const qty = num(bucket.quantityTotal)
  const netProfit = num(bucket.netProfitTotal)
  const cost = num(bucket.costTotal)
  return {
    ...bucket,
    salesTotal: sales,
    quantityTotal: qty,
    recordCount: num(bucket.recordCount),
    netProfitTotal: netProfit,
    adSpendTotal: num(bucket.adSpendTotal),
    adSalesTotal: num(bucket.adSalesTotal),
    costTotal: cost,
    marginRate: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    averageOrderValue: qty > 0 ? round2(sales / qty) : 0,
  }
}

function emptyBucket(extra = {}) {
  return {
    salesTotal: 0,
    quantityTotal: 0,
    recordCount: 0,
    netProfitTotal: 0,
    adSpendTotal: 0,
    adSalesTotal: 0,
    costTotal: 0,
    marginRate: 0,
    averageOrderValue: 0,
    ...extra,
  }
}

function appendAggDateFilter(sqlDateCol, filters, params) {
  const next = [...params]
  const parts = []
  if (filters.from) {
    next.push(filters.from)
    parts.push(`${sqlDateCol} >= $${next.length}::date`)
  }
  if (filters.to) {
    next.push(filters.to)
    parts.push(`${sqlDateCol} <= $${next.length}::date`)
  }
  const clause = parts.length ? `AND ${parts.join(' AND ')}` : ''
  return { clause, params: next }
}

/** JS rowMatchesKpiDateRange — 점 날짜(resolveKpiFilterDate) 또는 period 겹침 */
function appendRowMatchesDateFilter(filters, params, dateCol = 'filter_date') {
  if (!filters.from && !filters.to) {
    return { clause: '', params: [...params], hasRange: false }
  }
  const next = [...params]
  const point = [`${dateCol} IS NOT NULL`]
  if (filters.from) {
    next.push(filters.from)
    point.push(`${dateCol} >= $${next.length}::date`)
  }
  if (filters.to) {
    next.push(filters.to)
    point.push(`${dateCol} <= $${next.length}::date`)
  }
  let sql = `(${point.join(' AND ')})`
  if (filters.from && filters.to) {
    next.push(filters.from)
    const fromIdx = next.length
    next.push(filters.to)
    const toIdx = next.length
    sql = `(${sql} OR (
      period_from IS NOT NULL AND period_to IS NOT NULL
      AND period_from <= $${toIdx}::date AND period_to >= $${fromIdx}::date
      AND NOT is_closed
    ))`
  }
  return { clause: `AND ${sql}`, params: next, hasRange: true }
}

function baseCte(detailWhere, { includeAggDate = true } = {}) {
  const aggCol = includeAggDate ? `(${KPI_AGG_DATE_EXPR}) AS agg_date,` : ''
  return `base AS (
    SELECT
      sales_records.id,
      sales_records.data,
      sales_records.sales,
      sales_records.sales_qty,
      sales_records.net_profit,
      sales_records.ad_spend,
      sales_records.transaction_type,
      sales_records.upload_id,
      sales_records.upload_kind,
      sales_records.upload_format,
      sales_records.platform,
      sales_records.channel,
      sales_records.store_name,
      sales_records.sales_method,
      sales_records.order_date,
      sales_records.business_date,
      sales_records.period_from,
      sales_records.period_to,
      sales_records.record_type,
      sales_records.kpi_date,
      (${KPI_UPLOAD_KEY_SQL}) AS upload_key,
      ${aggCol}
      (${KPI_FILTER_DATE_EXPR}) AS filter_date,
      (${KPI_PLATFORM_SQL}) AS kpi_platform,
      (${KPI_CLOSED_MALL_SQL}) AS is_closed,
      (${KPI_SHEET_TOTAL_SQL}) AS is_sheet,
      (${KPI_RETURN_SQL}) AS is_return,
      (${KPI_ROW_COST_SQL}) AS row_cost,
      (${KPI_AD_SALES_SQL}) AS row_ad_sales
    FROM sales_records
    ${detailWhere}
  )`
}

const SHEET_HEADER_ORDER = `
      CASE WHEN COALESCE(data->>'sheetTotalKind', '') = 'header' THEN 0 ELSE 1 END,
      CASE WHEN COALESCE(data->>'sheetTotalKind', '') = 'header' THEN id END ASC NULLS LAST,
      id DESC`

function preferSheetCtes(rowMatchClause, hasRange = false) {
  const productDate = rowMatchClause || ''
  const sheetDateSql = hasRange && rowMatchClause
    ? rowMatchClause
        .replace(/^AND\s+/, '')
        .replaceAll('filter_date', 's.filter_date')
        .replaceAll('period_from', 's.period_from')
        .replaceAll('period_to', 's.period_to')
        .replaceAll('is_closed', 's.is_closed')
    : 'TRUE'
  return `
  sheet_raw AS (
    SELECT * FROM base WHERE is_sheet AND NOT is_return
  ),
  in_period_uploads AS (
    SELECT DISTINCT upload_id
    FROM base
    WHERE NOT is_sheet AND NOT is_return AND upload_id IS NOT NULL
      ${productDate}
  ),
  sheet_selected AS (
    SELECT s.*
    FROM sheet_raw s
    WHERE (${sheetDateSql})
       OR (s.upload_id IS NOT NULL AND s.upload_id IN (SELECT upload_id FROM in_period_uploads))
  ),
  prefer_keys AS (
    SELECT DISTINCT upload_key FROM sheet_selected
  ),
  sheet_ad_deduped AS (
    SELECT DISTINCT ON (upload_key) *
    FROM sheet_selected
    ORDER BY upload_key, ${SHEET_HEADER_ORDER}
  ),
  sheet_platform_deduped AS (
    SELECT DISTINCT ON (upload_key, kpi_platform) *
    FROM sheet_selected
    ORDER BY upload_key, kpi_platform, ${SHEET_HEADER_ORDER}
  )`
}

function detailWhereSql(filters) {
  const baseWhere = buildKpiWhere(filters)
  const where = baseWhere.where
    ? `${baseWhere.where} AND record_type = 'detail'`
    : `WHERE record_type = 'detail'`
  return { where, params: [...baseWhere.params] }
}

function dailyBaseCte(productWhereSql) {
  return `base AS (
    SELECT
      sales,
      sales_qty,
      net_profit,
      ad_spend,
      kpi_aggregation_date AS agg_date,
      (${KPI_ROW_COST_SQL}) AS row_cost
    FROM sales_records
    ${productWhereSql}
  )`
}

export async function queryDailyKpiSql(filters) {
  const pool = getPool()
  const productWhere = buildKpiWhere(filters, { productRowsOnly: true })
  const where = productWhere.where || 'WHERE TRUE'
  const { clause: aggClause, params } = appendAggDateFilter(
    'agg_date',
    filters,
    [...productWhere.params],
  )

  const sql = `
    WITH ${dailyBaseCte(where)}
    SELECT
      to_char(agg_date, 'YYYY-MM-DD') AS date,
      COALESCE(SUM(sales), 0) AS sales_total,
      COALESCE(SUM(sales_qty), 0) AS quantity_total,
      COUNT(*)::int AS record_count,
      COALESCE(SUM(net_profit), 0) AS net_profit_total,
      COALESCE(SUM(ad_spend), 0) AS ad_spend_total,
      0::numeric AS ad_sales_total,
      COALESCE(SUM(row_cost), 0) AS cost_total
    FROM base
    WHERE agg_date IS NOT NULL
      ${aggClause}
    GROUP BY agg_date
    ORDER BY date
  `

  const res = await pool.query(sql, params)
  return res.rows.map((row) =>
    finalizeBucket({
      date: row.date,
      salesTotal: row.sales_total,
      quantityTotal: row.quantity_total,
      recordCount: row.record_count,
      netProfitTotal: row.net_profit_total,
      adSpendTotal: row.ad_spend_total,
      adSalesTotal: row.ad_sales_total,
      costTotal: row.cost_total,
    }),
  )
}

export async function querySheetAdTotalsSql(filters) {
  const pool = getPool()
  const { where, params: baseParams } = detailWhereSql(filters)
  const { clause: matchClause, params, hasRange } = appendRowMatchesDateFilter(filters, baseParams)
  const sql = `
    WITH ${baseCte(where, { includeAggDate: false })},
    ${preferSheetCtes(matchClause, hasRange)}
    SELECT
      COALESCE(SUM(ad_spend), 0) AS ad_spend,
      COALESCE(SUM(row_ad_sales), 0) AS ad_sales
    FROM sheet_ad_deduped
  `
  const res = await pool.query(sql, params)
  return {
    adSpend: num(res.rows[0]?.ad_spend),
    adSales: num(res.rows[0]?.ad_sales),
  }
}

export async function queryPlatformKpiSql(filters) {
  const pool = getPool()
  const { where, params: baseParams } = detailWhereSql(filters)
  const { clause: matchClause, params, hasRange } = appendRowMatchesDateFilter(filters, baseParams)

  const sql = `
    WITH ${baseCte(where, { includeAggDate: false })},
    ${preferSheetCtes(matchClause, hasRange)},
    product_agg AS (
      SELECT
        kpi_platform AS platform,
        COALESCE(SUM(sales), 0) AS sales_total,
        COALESCE(SUM(sales_qty), 0) AS quantity_total,
        COALESCE(SUM(net_profit), 0) AS net_profit_total,
        COALESCE(SUM(ad_spend), 0) AS ad_spend_total,
        0::numeric AS ad_sales_total,
        COALESCE(SUM(row_cost), 0) AS cost_total
      FROM base
      WHERE NOT is_sheet AND NOT is_return
        ${matchClause}
        AND upload_key NOT IN (SELECT upload_key FROM prefer_keys)
      GROUP BY kpi_platform
    ),
    sheet_agg AS (
      SELECT
        kpi_platform AS platform,
        COALESCE(SUM(sales), 0) AS sales_total,
        COALESCE(SUM(sales_qty), 0) AS quantity_total,
        COALESCE(SUM(net_profit), 0) AS net_profit_total,
        COALESCE(SUM(ad_spend), 0) AS ad_spend_total,
        COALESCE(SUM(row_ad_sales), 0) AS ad_sales_total,
        COALESCE(SUM(row_cost), 0) AS cost_total
      FROM sheet_platform_deduped
      GROUP BY kpi_platform
    ),
    counts AS (
      SELECT kpi_platform AS platform, COUNT(*)::int AS record_count
      FROM base
      WHERE NOT is_sheet
        ${matchClause}
      GROUP BY kpi_platform
    ),
    closed_product AS (
      SELECT
        ${KPI_CLOSED_LABEL_SQL} AS platform,
        COALESCE(SUM(sales), 0) AS sales_total,
        COALESCE(SUM(sales_qty), 0) AS quantity_total,
        COALESCE(SUM(net_profit), 0) AS net_profit_total,
        COALESCE(SUM(ad_spend), 0) AS ad_spend_total,
        0::numeric AS ad_sales_total,
        COALESCE(SUM(row_cost), 0) AS cost_total
      FROM base
      WHERE is_closed AND NOT is_sheet AND NOT is_return
        ${matchClause}
      GROUP BY 1
    ),
    closed_counts AS (
      SELECT ${KPI_CLOSED_LABEL_SQL} AS platform, COUNT(*)::int AS record_count
      FROM base
      WHERE is_closed AND NOT is_sheet
        ${matchClause}
      GROUP BY 1
    )
    SELECT 'product' AS kind, p.platform, p.sales_total, p.quantity_total, p.net_profit_total,
           p.ad_spend_total, p.ad_sales_total, p.cost_total, COALESCE(c.record_count, 0) AS record_count,
           0::int AS has_sheet
    FROM product_agg p
    LEFT JOIN counts c ON c.platform = p.platform
    UNION ALL
    SELECT 'sheet', s.platform, s.sales_total, s.quantity_total, s.net_profit_total,
           s.ad_spend_total, s.ad_sales_total, s.cost_total, 0, 1
    FROM sheet_agg s
    UNION ALL
    SELECT 'count', c.platform, 0, 0, 0, 0, 0, 0, c.record_count, 0
    FROM counts c
    UNION ALL
    SELECT 'closed', cp.platform, cp.sales_total, cp.quantity_total, cp.net_profit_total,
           cp.ad_spend_total, cp.ad_sales_total, cp.cost_total, COALESCE(cc.record_count, 0), 0
    FROM closed_product cp
    LEFT JOIN closed_counts cc ON cc.platform = cp.platform
    UNION ALL
    SELECT 'flag', 'non_closed',
           COUNT(*) FILTER (WHERE NOT is_closed AND NOT is_sheet AND NOT is_return),
           0, 0, 0, 0, 0, 0, 0
    FROM base
  `

  const res = await pool.query(sql, params)
  return assemblePlatformResult(res.rows)
}

function assemblePlatformResult(rows) {
  const metricsMap = new Map()
  const countMap = new Map()
  const sheetMap = new Map()
  const closedMetrics = new Map()
  const closedCounts = new Map()
  let nonClosed = 0

  for (const row of rows) {
    const kind = row.kind
    const platform = String(row.platform || '')
    if (kind === 'flag') {
      nonClosed = num(row.sales_total)
      continue
    }
    if (kind === 'count') {
      countMap.set(platform, (countMap.get(platform) || 0) + num(row.record_count))
      continue
    }
    if (kind === 'sheet') {
      sheetMap.set(platform, {
        salesTotal: num(row.sales_total),
        quantityTotal: num(row.quantity_total),
        netProfitTotal: num(row.net_profit_total),
        adSpendTotal: num(row.ad_spend_total),
        adSalesTotal: num(row.ad_sales_total),
        costTotal: num(row.cost_total),
      })
      continue
    }
    if (kind === 'closed') {
      closedMetrics.set(platform, {
        platform,
        salesTotal: num(row.sales_total),
        quantityTotal: num(row.quantity_total),
        netProfitTotal: num(row.net_profit_total),
        adSpendTotal: num(row.ad_spend_total),
        adSalesTotal: num(row.ad_sales_total),
        costTotal: num(row.cost_total),
      })
      closedCounts.set(platform, num(row.record_count))
      continue
    }
    if (kind === 'product') {
      metricsMap.set(platform, {
        platform,
        salesTotal: num(row.sales_total),
        quantityTotal: num(row.quantity_total),
        netProfitTotal: num(row.net_profit_total),
        adSpendTotal: num(row.ad_spend_total),
        adSalesTotal: num(row.ad_sales_total),
        costTotal: num(row.cost_total),
      })
    }
  }

  for (const [platform, sheet] of sheetMap) {
    const bucket = metricsMap.get(platform) || emptyBucket({ platform })
    bucket.salesTotal += sheet.salesTotal
    bucket.quantityTotal += sheet.quantityTotal
    bucket.netProfitTotal += sheet.netProfitTotal
    bucket.costTotal += sheet.costTotal
    bucket.recordCount = (bucket.recordCount || 0) + 1
    bucket.adSpendTotal = sheet.adSpendTotal
    bucket.adSalesTotal = sheet.adSalesTotal
    metricsMap.set(platform, bucket)
  }

  const items = [...metricsMap.values()].map((item) =>
    finalizeBucket({ ...item, recordCount: countMap.get(item.platform) || item.recordCount || 0 }),
  )

  const main = PLATFORM_SPLIT_LABELS.map((label) => {
    const found = items.find((i) => i.platform === label)
    const count = countMap.get(label) || 0
    if (found) return found
    return finalizeBucket({ platform: label, ...emptyBucket(), recordCount: count })
  })

  const closedItems = [...closedMetrics.keys()]
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map((label) =>
      finalizeBucket({
        ...closedMetrics.get(label),
        recordCount: closedCounts.get(label) || 0,
      }),
    )

  const resultItems = nonClosed > 0 ? main : closedItems.length ? closedItems : main

  const total = emptyBucket({ platform: '합계' })
  for (const item of resultItems) {
    total.salesTotal += item.salesTotal
    total.quantityTotal += item.quantityTotal
    total.recordCount += item.recordCount
    total.netProfitTotal += item.netProfitTotal
    total.adSpendTotal += item.adSpendTotal
    total.adSalesTotal += item.adSalesTotal || 0
    total.costTotal += item.costTotal
  }

  return {
    items: resultItems,
    total: finalizeBucket(total),
    allItems: items,
  }
}

export async function querySegmentKpiSql(filters) {
  const pool = getPool()
  const { where, params: baseParams } = detailWhereSql(filters)
  const { clause: matchClause, params, hasRange } = appendRowMatchesDateFilter(filters, baseParams)

  const sql = `
    WITH ${baseCte(where, { includeAggDate: false })},
    ${preferSheetCtes(matchClause, hasRange)},
    labeled AS (
      SELECT
        (${KPI_SEGMENT_KEY_SQL}) AS segment_key,
        (${KPI_SEGMENT_LABEL_SQL}) AS label,
        sales, sales_qty, net_profit, ad_spend, row_cost, row_ad_sales,
        is_sheet, is_return, is_closed, upload_key, filter_date, period_from, period_to
      FROM base
    ),
    product_agg AS (
      SELECT
        segment_key,
        label,
        COALESCE(SUM(sales), 0) AS sales_total,
        COALESCE(SUM(sales_qty), 0) AS quantity_total,
        COUNT(*)::int AS record_count,
        COALESCE(SUM(net_profit), 0) AS net_profit_total,
        COALESCE(SUM(ad_spend), 0) AS ad_spend_total,
        0::numeric AS ad_sales_total,
        COALESCE(SUM(row_cost), 0) AS cost_total
      FROM labeled
      WHERE NOT is_sheet AND NOT is_return
        AND label IS NOT NULL
        ${matchClause}
        AND upload_key NOT IN (SELECT upload_key FROM prefer_keys)
      GROUP BY segment_key, label
    ),
    sheet_agg AS (
      SELECT
        (${KPI_SEGMENT_KEY_SQL}) AS segment_key,
        (${KPI_SEGMENT_LABEL_SQL}) AS label,
        COALESCE(SUM(sales), 0) AS sales_total,
        COALESCE(SUM(sales_qty), 0) AS quantity_total,
        COUNT(*)::int AS record_count,
        COALESCE(SUM(net_profit), 0) AS net_profit_total,
        COALESCE(SUM(ad_spend), 0) AS ad_spend_total,
        COALESCE(SUM(row_ad_sales), 0) AS ad_sales_total,
        COALESCE(SUM(row_cost), 0) AS cost_total
      FROM sheet_platform_deduped
      WHERE (${KPI_SEGMENT_LABEL_SQL}) IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT 'product' AS kind, * FROM product_agg
    UNION ALL
    SELECT 'sheet', * FROM sheet_agg
  `

  const res = await pool.query(sql, params)
  const byLabel = new Map()
  for (const row of res.rows) {
    const label = String(row.label || '').trim()
    if (!label) continue
    const prev = byLabel.get(label) || emptyBucket({
      platform: label,
      segment: label,
      segmentKey: row.segment_key || null,
    })
    if (row.kind === 'sheet') {
      prev.salesTotal += num(row.sales_total)
      prev.quantityTotal += num(row.quantity_total)
      prev.netProfitTotal += num(row.net_profit_total)
      prev.costTotal += num(row.cost_total)
      prev.recordCount += num(row.record_count)
      prev.adSpendTotal = num(row.ad_spend_total)
      prev.adSalesTotal = num(row.ad_sales_total)
    } else {
      prev.salesTotal += num(row.sales_total)
      prev.quantityTotal += num(row.quantity_total)
      prev.netProfitTotal += num(row.net_profit_total)
      prev.costTotal += num(row.cost_total)
      prev.recordCount += num(row.record_count)
      prev.adSpendTotal += num(row.ad_spend_total)
      prev.adSalesTotal += num(row.ad_sales_total)
    }
    prev.segmentKey = row.segment_key || prev.segmentKey
    prev.estimateCostFromMargin = prev.segmentKey === 'bh_ss' || prev.segmentKey === 'sbn_ss'
    byLabel.set(label, prev)
  }

  return [...byLabel.values()]
    .filter((item) => item.salesTotal || item.quantityTotal || item.recordCount || item.adSpendTotal)
    .map((item) => finalizeBucket(item))
}

export async function queryDailyByPlatformSql(filters) {
  const pool = getPool()
  const { where, params: baseParams } = detailWhereSql(filters)
  const { clause: aggClause, params: afterAgg } = appendAggDateFilter('agg_date', filters, baseParams)
  const { clause: matchClause, params, hasRange } = appendRowMatchesDateFilter(filters, afterAgg)

  const sql = `
    WITH ${baseCte(where, { includeAggDate: true })},
    ${preferSheetCtes(matchClause, hasRange)},
    product_agg AS (
      SELECT
        to_char(agg_date, 'YYYY-MM-DD') AS date,
        kpi_platform AS platform,
        COALESCE(SUM(sales), 0) AS sales_total,
        COALESCE(SUM(sales_qty), 0) AS quantity_total
      FROM base
      WHERE NOT is_sheet AND NOT is_return
        AND agg_date IS NOT NULL
        ${aggClause}
        AND upload_key NOT IN (SELECT upload_key FROM prefer_keys)
      GROUP BY agg_date, kpi_platform
    ),
    sheet_agg AS (
      SELECT
        to_char(COALESCE(
          s.agg_date,
          (SELECT MIN(p.agg_date) FROM base p
            WHERE p.upload_key = s.upload_key AND NOT p.is_sheet AND NOT p.is_return)
        ), 'YYYY-MM-DD') AS date,
        s.kpi_platform AS platform,
        COALESCE(SUM(s.sales), 0) AS sales_total,
        COALESCE(SUM(s.sales_qty), 0) AS quantity_total
      FROM sheet_platform_deduped s
      GROUP BY 1, 2
    ),
    closed_product AS (
      SELECT
        to_char(agg_date, 'YYYY-MM-DD') AS date,
        ${KPI_CLOSED_LABEL_SQL} AS platform,
        COALESCE(SUM(sales), 0) AS sales_total,
        COALESCE(SUM(sales_qty), 0) AS quantity_total
      FROM base
      WHERE is_closed AND NOT is_sheet AND NOT is_return AND agg_date IS NOT NULL
        ${aggClause}
        AND upload_key NOT IN (SELECT upload_key FROM prefer_keys)
      GROUP BY 1, 2
    )
    SELECT date, platform, SUM(sales_total) AS sales_total, SUM(quantity_total) AS quantity_total
    FROM (
      SELECT * FROM product_agg
      UNION ALL
      SELECT * FROM sheet_agg
      UNION ALL
      SELECT * FROM closed_product
    ) u
    WHERE date IS NOT NULL
    GROUP BY date, platform
  `

  const res = await pool.query(sql, params)
  return res.rows.map((row) => ({
    date: row.date,
    platform: row.platform,
    salesTotal: num(row.sales_total),
    quantityTotal: num(row.quantity_total),
  }))
}

export async function queryMaxAggDateSql(filters) {
  const pool = getPool()
  const { where, params } = detailWhereSql(filters)
  const sql = `
    WITH ${baseCte(where, { includeAggDate: true })}
    SELECT to_char(MAX(agg_date), 'YYYY-MM-DD') AS date
    FROM base
    WHERE NOT is_sheet AND NOT is_return AND agg_date IS NOT NULL
  `
  const res = await pool.query(sql, params)
  return res.rows[0]?.date || ''
}

const DUMP_SQL = `
  id, record_type, upload_kind, platform, sales_method,
  order_date, kpi_date, business_date, period_from, period_to,
  sales, sales_qty, ad_spend, transaction_type, upload_id,
  COALESCE(product_name, data->>'productName') AS product_name,
  COALESCE(upload_id::text, data->>'sourceFileName', data->>'fileName') AS upload_key,
  data->>'date' AS data_date,
  COALESCE(data->>'adSales', data->>'ad_sales') AS ad_sales,
  data->>'isEsserSheetTotal' AS is_sheet_total,
  data->>'sheetTotalKind' AS sheet_total_kind,
  data->>'sourceFileName' AS source_file_name
`

export async function queryPlatformContributionIds(filters) {
  const pool = getPool()
  const { where, params: baseParams } = detailWhereSql(filters)
  const { clause: matchClause, params, hasRange } = appendRowMatchesDateFilter(filters, baseParams)
  const sql = `
    WITH ${baseCte(where, { includeAggDate: false })},
    ${preferSheetCtes(matchClause, hasRange)}
    SELECT 'product' AS kind, id FROM base
    WHERE NOT is_sheet AND NOT is_return
      ${matchClause}
      AND upload_key NOT IN (SELECT upload_key FROM prefer_keys)
    UNION ALL
    SELECT 'sheet', id FROM sheet_platform_deduped
    UNION ALL
    SELECT 'ad', id FROM sheet_ad_deduped
  `
  const res = await pool.query(sql, params)
  const productIds = []
  const sheetIds = []
  const adIds = []
  for (const row of res.rows) {
    if (row.kind === 'product') productIds.push(row.id)
    else if (row.kind === 'sheet') sheetIds.push(row.id)
    else adIds.push(row.id)
  }
  return { productIds, sheetIds, adIds }
}

export async function queryRecordsDumpByIds(ids) {
  const pool = getPool()
  if (!ids.length) return []
  const res = await pool.query(
    `SELECT ${DUMP_SQL} FROM sales_records WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  return res.rows
}

export async function explainDailyKpiSql(filters) {
  const pool = getPool()
  const productWhere = buildKpiWhere(filters, { productRowsOnly: true })
  const where = productWhere.where || 'WHERE TRUE'
  const { clause: aggClause, params } = appendAggDateFilter(
    'agg_date',
    filters,
    [...productWhere.params],
  )
  const sql = `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    WITH ${dailyBaseCte(where)}
    SELECT
      to_char(agg_date, 'YYYY-MM-DD') AS date,
      COALESCE(SUM(sales), 0) AS sales_total,
      COALESCE(SUM(sales_qty), 0) AS quantity_total
    FROM base
    WHERE agg_date IS NOT NULL
      ${aggClause}
    GROUP BY agg_date
    ORDER BY date
  `
  const res = await pool.query(sql, params)
  return res.rows.map((row) => row['QUERY PLAN'])
}
