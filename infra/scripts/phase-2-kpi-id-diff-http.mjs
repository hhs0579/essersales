/**
 * NAS records API + 로컬 JS로
 * (구 SQL 필터 시뮬) vs JS 골든 선택 ID 차집합을 출력한다.
 */
import {
  aggregatePlatformKpiFromRows,
  collectPlatformKpiSelectedIds,
  kpiRecordDump,
  resolveAggregationDate,
  resolveKpiFilterDate,
  rowMatchesKpiDateRange,
  resolvePlatformFromRow,
} from '../../backend/src/utils/esserKpiAggregate.js'

const RAW_BASE = process.env.VITE_PG_API_BASE || 'http://192.168.0.245:8080/api/v1'
const BASE = (RAW_BASE.startsWith('http')
  ? RAW_BASE
  : `http://192.168.0.245:8080${RAW_BASE.startsWith('/') ? RAW_BASE : `/${RAW_BASE}`}`
).replace(/\/$/, '')
const FROM = process.env.KPI_FROM || '2026-01-01'
const TO = process.env.KPI_TO || '2026-08-19'

function toPgLike(item) {
  const data = item.data && typeof item.data === 'object' ? item.data : item
  return {
    ...item,
    id: item.id,
    record_type: item.recordType || item.record_type || 'detail',
    platform: item.platform,
    channel: item.channel,
    sales_method: item.salesMethod || item.sales_method,
    store_name: item.storeName || item.store_name,
    upload_kind: item.uploadKind || item.upload_kind,
    upload_format: item.uploadFormat || item.upload_format,
    upload_id: item.uploadId || item.upload_id,
    order_date: item.orderDate || item.order_date,
    kpi_date: item.kpiDate || item.kpi_date,
    business_date: item.businessDate || item.business_date,
    period_from: item.periodFrom || item.period_from,
    period_to: item.periodTo || item.period_to,
    sales: item.sales,
    sales_qty: item.salesQty ?? item.sales_qty,
    net_profit: item.netProfit ?? item.net_profit,
    ad_spend: item.adSpend ?? item.ad_spend,
    transaction_type: item.transactionType || item.transaction_type,
    product_name: item.productName || item.product_name,
    data,
  }
}

async function loadRows() {
  const items = []
  let page = 1
  for (;;) {
    const u = new URLSearchParams({
      page: String(page),
      limit: '500',
      record_type: 'detail',
      include_data: 'full',
      sort: 'created_at',
      order: 'asc',
      from: FROM,
      to: TO,
      scope: 'platform',
      include_manual_ads: 'true',
    })
    const res = await fetch(`${BASE}/records?${u}`)
    const body = await res.json()
    if (!res.ok) throw new Error(JSON.stringify(body).slice(0, 300))
    const batch = body.items || []
    items.push(...batch)
    const total = body.total ?? items.length
    console.error(`loaded page ${page} n=${items.length}/${total}`)
    if (!batch.length || page * 500 >= total) break
    page += 1
  }
  return items.map(toPgLike)
}

function printRows(title, rows) {
  console.log(`\n========== ${title} (${rows.length}) ==========`)
  for (const row of rows) {
    const d = kpiRecordDump(row)
    console.log(
      JSON.stringify({
        id: d.id,
        record_type: d.record_type,
        upload_kind: d.upload_kind,
        platform: d.platform,
        resolved_platform: d.resolved_platform,
        sales_method: d.sales_method,
        order_date: d.order_date,
        kpi_date: d.kpi_date,
        business_date: d.business_date,
        period_from: d.period_from,
        period_to: d.period_to,
        sales: d.sales,
        sales_qty: d.sales_qty,
        ad_spend: d.ad_spend,
        ad_sales: d.ad_sales,
        transaction_type: d.transaction_type,
        product_name: d.product_name,
        data_date: d.data_date,
        filter_date: d.filter_date,
        agg_date: d.agg_date,
        sheetTotalKind: d.sheetTotalKind,
        isEsserSheetTotal: d.isEsserSheetTotal,
      }),
    )
  }
}

const rows = await loadRows()
const range = { from: FROM, to: TO }
const jsIds = new Set(collectPlatformKpiSelectedIds(rows, range).productIds.map(String))

const oldSqlProduct = []
for (const row of rows) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const isSheet = data.isEsserSheetTotal === true
  const isReturn =
    row.transaction_type === 'return' || Number(row.sales || 0) < 0 || Number(row.sales_qty || 0) < 0
  if (isSheet || isReturn) continue
  const agg = resolveAggregationDate(row)
  if (!agg || agg < FROM || agg > TO) continue
  oldSqlProduct.push(row)
}
const oldSqlIds = new Set(oldSqlProduct.map((r) => String(r.id)))

const jsOnly = rows.filter((r) => jsIds.has(String(r.id)) && !oldSqlIds.has(String(r.id)))
const sqlOnly = oldSqlProduct.filter((r) => !jsIds.has(String(r.id)))

const coupangJs = jsOnly.filter((r) => resolvePlatformFromRow(r) === '쿠팡')
const coupangSql = sqlOnly.filter((r) => resolvePlatformFromRow(r) === '쿠팡')

console.log(`rows=${rows.length} JS product ids=${jsIds.size} oldSQL-sim product ids=${oldSqlIds.size}`)
console.log(`JS-only product=${jsOnly.length} SQL-sim-only product=${sqlOnly.length}`)
console.log(
  `쿠팡 JS-only ${coupangJs.length} qty=${coupangJs.reduce((s, r) => s + Number(r.sales_qty || 0), 0)} sales=${coupangJs.reduce((s, r) => s + Number(r.sales || 0), 0)}`,
)
console.log(
  `쿠팡 SQL-sim-only ${coupangSql.length} qty=${coupangSql.reduce((s, r) => s + Number(r.sales_qty || 0), 0)} sales=${coupangSql.reduce((s, r) => s + Number(r.sales || 0), 0)}`,
)

const plat = aggregatePlatformKpiFromRows(rows, range)
const coupang = plat.items.find((x) => x.platform === '쿠팡')
console.log(`JS platform 쿠팡 sales=${coupang?.salesTotal} qty=${coupang?.quantityTotal}`)

printRows('[JS에는 포함되고 구SQL(agg_date 추가필터)에는 제외된 records]', jsOnly)
printRows('[구SQL에는 포함되고 JS에는 제외된 records]', sqlOnly)
printRows('[쿠팡] JS only', coupangJs)
printRows('[쿠팡] SQL-sim only', coupangSql)
