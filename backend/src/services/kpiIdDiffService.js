/**
 * JS 골든 vs SQL 이 실제로 고른 record ID 차집합
 */
import { parseKpiQuery } from '../repositories/kpiRepository.js'
import {
  queryPlatformContributionIds,
  queryRecordsDumpByIds,
} from '../repositories/kpiSqlAggregate.js'
import { loadDetailRowsJs, loadProductRowsJs } from './kpiJsGoldenService.js'
import {
  collectPlatformKpiSelectedIds,
  collectDailyKpiSelectedIds,
  kpiRecordDump,
  resolvePlatformFromRow,
} from '../utils/esserKpiAggregate.js'

function toSet(ids) {
  return new Set((ids || []).map((id) => String(id)).filter(Boolean))
}

function minus(a, b) {
  return [...a].filter((id) => !b.has(id))
}

/**
 * @param {Record<string, string>} query
 */
export async function runKpiIdDiff(query = {}) {
  const filters = parseKpiQuery(query)
  const range = { from: filters.from, to: filters.to }

  const [detail, product, sqlIds] = await Promise.all([
    loadDetailRowsJs(filters),
    loadProductRowsJs(filters),
    queryPlatformContributionIds(filters),
  ])

  const jsPlat = collectPlatformKpiSelectedIds(detail.rows, range)
  const jsDaily = collectDailyKpiSelectedIds(product.rows, range)

  const jsProduct = toSet(jsPlat.productIds)
  const sqlProduct = toSet(sqlIds.productIds)
  const jsSheet = toSet(jsPlat.sheetIds)
  const sqlSheet = toSet(sqlIds.sheetIds)
  const jsAd = toSet(jsPlat.adIds)
  const sqlAd = toSet(sqlIds.adIds)

  const jsOnlyProduct = minus(jsProduct, sqlProduct)
  const sqlOnlyProduct = minus(sqlProduct, jsProduct)
  const jsOnlySheet = minus(jsSheet, sqlSheet)
  const sqlOnlySheet = minus(sqlSheet, jsSheet)
  const jsOnlyAd = minus(jsAd, sqlAd)
  const sqlOnlyAd = minus(sqlAd, jsAd)

  const dumpIds = [
    ...jsOnlyProduct,
    ...sqlOnlyProduct,
    ...jsOnlySheet,
    ...sqlOnlySheet,
    ...jsOnlyAd,
    ...sqlOnlyAd,
  ]
  const dumps = await queryRecordsDumpByIds([...new Set(dumpIds)])
  const dumpMap = new Map(dumps.map((row) => [String(row.id), row]))

  const jsRowMap = new Map()
  for (const row of detail.rows) {
    if (row.id != null) jsRowMap.set(String(row.id), row)
  }

  function list(ids) {
    return ids.map((id) => dumpMap.get(String(id)) || kpiRecordDump(jsRowMap.get(String(id)) || { id }))
  }

  const coupangJsOnly = []
  const coupangSqlOnly = []
  for (const row of list(jsOnlyProduct)) {
    const src = jsRowMap.get(String(row.id))
    const platform = src ? resolvePlatformFromRow(src) : row.platform
    if (platform === '쿠팡') coupangJsOnly.push(row)
  }
  for (const row of list(sqlOnlyProduct)) {
    const src = jsRowMap.get(String(row.id))
    const platform = src ? resolvePlatformFromRow(src) : row.platform
    if (platform === '쿠팡') coupangSqlOnly.push(row)
  }

  const coupangJsSales = coupangJsOnly.reduce((s, r) => s + Number(r.sales || 0), 0)
  const coupangJsQty = coupangJsOnly.reduce((s, r) => s + Number(r.sales_qty || 0), 0)
  const coupangSqlSales = coupangSqlOnly.reduce((s, r) => s + Number(r.sales || 0), 0)
  const coupangSqlQty = coupangSqlOnly.reduce((s, r) => s + Number(r.sales_qty || 0), 0)

  return {
    filters,
    counts: {
      jsProduct: jsProduct.size,
      sqlProduct: sqlProduct.size,
      jsSheet: jsSheet.size,
      sqlSheet: sqlSheet.size,
      jsAd: jsAd.size,
      sqlAd: sqlAd.size,
      jsDaily: jsDaily.length,
    },
    jsOnly: {
      product: list(jsOnlyProduct),
      sheet: list(jsOnlySheet),
      ad: list(jsOnlyAd),
    },
    sqlOnly: {
      product: list(sqlOnlyProduct),
      sheet: list(sqlOnlySheet),
      ad: list(sqlOnlyAd),
    },
    coupang: {
      jsOnly: coupangJsOnly,
      sqlOnly: coupangSqlOnly,
      jsOnlySalesSum: coupangJsSales,
      jsOnlyQtySum: coupangJsQty,
      sqlOnlySalesSum: coupangSqlSales,
      sqlOnlyQtySum: coupangSqlQty,
      netSalesDeltaSqlMinusJs: coupangSqlSales - coupangJsSales,
      netQtyDeltaSqlMinusJs: coupangSqlQty - coupangJsQty,
    },
  }
}
