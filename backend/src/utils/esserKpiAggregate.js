/**
 * KPI 집계 — Vue esserMetrics / platformKpiSplit / dayOverDaySales 규칙 포팅
 */

const MARKETPLACE_PLATFORMS = ['쿠팡', '스마트스토어', '네이버', '자사몰', '특판 폐쇄몰']
const PLATFORM_SPLIT_LABELS = ['쿠팡', '스마트스토어', '자사몰']
const DAY_OVER_DAY_LABELS = ['쿠팡', '스마트스토어', '합계']

function isClosedMallRow(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {}
  const kind = String(row?.upload_kind || row?.uploadKind || data.uploadKind || '').trim()
  if (kind === 'bestheim_closed_mall' || kind === 'esser_closed_mall') return true
  const format = String(row?.upload_format || row?.uploadFormat || data.uploadFormat || '').trim()
  if (format === 'BESTHEIM_CLOSED_MALL' || format === 'ESSER_CLOSED_MALL') return true
  const platform = normalizePlatformLabel(row?.platform || data.platform || '')
  return platform === '특판 폐쇄몰'
}

function resolveClosedMallSeller(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {}
  return String(
    row?.store_name ||
      row?.storeName ||
      data.storeName ||
      data.closedMallSeller ||
      data.seller ||
      '',
  ).trim()
}

function resolveClosedMallBrandLabel(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {}
  const kind = String(row?.upload_kind || row?.uploadKind || data.uploadKind || '').trim()
  if (kind === 'esser_closed_mall' || data.uploadFormat === 'ESSER_CLOSED_MALL') return '에쎄르'
  if (kind === 'bestheim_closed_mall' || data.uploadFormat === 'BESTHEIM_CLOSED_MALL') {
    return '베스트하임'
  }
  const tagged = String(data.dataSourceLabel || '').trim()
  if (tagged === '에쎄르' || tagged === '베스트하임') return tagged
  return '베스트하임'
}

/** 대시보드 행 라벨: 브랜드(판매처) */
function formatClosedMallKpiLabel(brandLabel, seller) {
  const brand = String(brandLabel || '').trim() || '특판'
  const name = String(seller || '').trim() || '특판'
  return `${brand}(${name})`
}

function isClosedMallKpiLabel(label) {
  const s = String(label || '').trim()
  if (s === '특판 폐쇄몰' || s === '베스트하임(특판 폐쇄몰)') return true
  if (/^베스트하임 \(.+\)$/.test(s)) return true
  if (/^(베스트하임|사본느리|에쎄르)\((로켓|판매자\+그로스|스스|자사몰)\)$/.test(s)) return false
  if (s === '파워프라이스') return false
  return /^(에쎄르|베스트하임|사본느리)\(.+\)$/.test(s)
}

function closedMallSellerFromLabel(label) {
  const s = String(label || '').trim()
  const spaced = s.match(/^베스트하임 \((.+)\)$/)
  if (spaced) return spaced[1].trim()
  const m = s.match(/^(?:에쎄르|베스트하임)\((.+)\)$/)
  return m ? m[1].trim() : ''
}

function listClosedMallSellerLabels(rows, range = {}) {
  const labels = new Set()
  for (const row of productRows(rows)) {
    if (!isClosedMallRow(row)) continue
    if (!rowMatchesKpiDateRange(row, range)) continue
    const seller = resolveClosedMallSeller(row)
    const brand = resolveClosedMallBrandLabel(row)
    labels.add(formatClosedMallKpiLabel(brand, seller))
  }
  return [...labels].sort((a, b) => a.localeCompare(b, 'ko'))
}

function parseAmount(val) {
  if (val == null || val === '') return 0
  const n = Number(String(val).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function round2(n) {
  return Number(Number(n).toFixed(2))
}

function isReturnRow(row) {
  if (row.transaction_type === 'return' || row.transactionType === 'return') return true
  const sales = parseAmount(row.sales)
  const qty = parseAmount(row.sales_qty ?? row.salesQty)
  return sales < 0 || qty < 0
}

function isSheetTotal(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  return data.isEsserSheetTotal === true || row.isEsserSheetTotal === true
}

function parseSalesDate(str) {
  if (str == null || str === '') return null
  const s = String(str).trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dotted = s.match(/(\d{4})\s*[.\-/년．]\s*(\d{1,2})\s*[.\-/월．]?\s*(\d{1,2})/)
  if (dotted) {
    const m = String(parseInt(dotted[2], 10)).padStart(2, '0')
    const d = String(parseInt(dotted[3], 10)).padStart(2, '0')
    return `${dotted[1]}-${m}-${d}`
  }
  const naver = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/)
  if (naver) {
    const m = String(parseInt(naver[2], 10)).padStart(2, '0')
    const d = String(parseInt(naver[3], 10)).padStart(2, '0')
    return `${naver[1]}-${m}-${d}`
  }
  return null
}

/** recordsAdapter.toDateString 과 동일 — ISO만 10자 절단 (한글 날짜 "2026. 6. 30" 보존) */
function adapterStyleDateString(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'string') {
    const s = val.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    return s
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10)
  }
  return String(val)
}

function normalizePlatformLabel(platform) {
  const p = String(platform ?? '').trim()
  if (p === '네이버') return '스마트스토어'
  return p
}

function detectPlatformFromChannelKind(channelKind) {
  const raw = String(channelKind ?? '').trim()
  if (!raw) return ''
  const n = raw.toLowerCase().replace(/\s/g, '')
  if (
    n.includes('스마트스토어') ||
    n.includes('smartstore') ||
    n.includes('네이버') ||
    n.includes('naver')
  ) {
    return '스마트스토어'
  }
  if (n.includes('쿠팡') || n.includes('coupang') || n.includes('로켓')) {
    return '쿠팡'
  }
  if (n.includes('자사몰') || n.includes('자체몰') || n.includes('ownmall')) {
    return '자사몰'
  }
  return ''
}

export function resolvePlatformFromRow(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const fromKind = detectPlatformFromChannelKind(
    data.channelKind || data.channel_kind || data.channelType || data['채널종류'],
  )
  if (fromKind) return fromKind

  const fileName = String(data.sourceFileName || data.fileName || '').toLowerCase()
  if (fileName.includes('coupang') || fileName.includes('쿠팡')) return '쿠팡'
  if (fileName.includes('naver') || fileName.includes('스마트스토어') || fileName.includes('네이버')) {
    return '스마트스토어'
  }

  const fromRow = normalizePlatformLabel(row.platform || data.platform || '')
  if (fromRow && fromRow !== '미지정' && MARKETPLACE_PLATFORMS.includes(fromRow)) {
    return fromRow
  }

  const fromChannel = normalizePlatformLabel(row.channel || data.channel || data.channelKind || '')
  if (fromChannel && MARKETPLACE_PLATFORMS.includes(fromChannel)) return fromChannel

  return fromRow || fromChannel || '미지정'
}

function toYmd(val) {
  if (val == null || val === '') return null
  return parseSalesDate(adapterStyleDateString(val))
}

export function resolveAggregationDate(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  for (const raw of [data.date, data.contextDate, row.date]) {
    if (raw) {
      const parsed = toYmd(String(raw).trim())
      if (parsed) return parsed
    }
  }
  const order = row.order_date || row.orderDate
  if (order) {
    const p = toYmd(order)
    if (p) return p
  }
  const bd = row.business_date || row.businessDate
  if (bd) {
    const p = toYmd(bd)
    if (p) return p
  }
  const from = row.period_from || row.periodFrom
  const to = row.period_to || row.periodTo
  if (from) {
    const fromStr = toYmd(from)
    const toStr = to ? toYmd(to) : null
    if (fromStr && (!toStr || toStr === fromStr)) return fromStr
  }
  return null
}

/** kpiRepository.KPI_DATE_SQL 과 동일 우선순위 — summary·기간 필터용 */
export function resolveKpiFilterDate(row) {
  const order = row.order_date || row.orderDate
  if (order) {
    const p = toYmd(order)
    if (p) return p
  }
  const bd = row.business_date || row.businessDate
  if (bd) {
    const p = toYmd(bd)
    if (p) return p
  }
  const from = row.period_from || row.periodFrom
  const to = row.period_to || row.periodTo
  if (from) {
    const fromStr = toYmd(from)
    const toStr = to ? toYmd(to) : null
    if (fromStr && (!toStr || toStr === fromStr)) return fromStr
  }
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const rawDate = data.date
  if (rawDate) {
    const parsed = toYmd(String(rawDate).trim())
    if (parsed) return parsed
  }
  return null
}

/** buildKpiWhere 기간 조건과 동일 — 단일일 + period 겹침 */
export function rowMatchesKpiDateRange(row, range = {}) {
  const from = String(range.from || '').trim()
  const to = String(range.to || '').trim()
  if (!from && !to) return true

  const point = resolveKpiFilterDate(row)
  if (point) {
    if ((!from || point >= from) && (!to || point <= to)) return true
  }

  if (!isClosedMallRow(row)) {
    const periodFrom = row.period_from || row.periodFrom
    const periodTo = row.period_to || row.periodTo
    if (periodFrom && periodTo && from && to) {
      const pf = toYmd(periodFrom)
      const pt = toYmd(periodTo)
      if (pf && pt && pf <= to && pt >= from) return true
    }
  }

  return false
}

/** 전일 대비용 — recordsAdapter.date 와 동일 (data.date → order_date → business_date) */
function resolveDayOverDayKey(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const direct = String(data.date || data.contextDate || row.date || '').trim()
  if (direct) {
    const parsed = toYmd(direct)
    if (parsed) return parsed
  }
  const order = row.order_date || row.orderDate
  if (order) {
    const p = toYmd(order)
    if (p) return p
  }
  const bd = row.business_date || row.businessDate
  if (bd) {
    const p = toYmd(bd)
    if (p) return p
  }
  return null
}

/** 전일 대비용 — getRecordDate / adapter date 우선 */
function resolveDayKey(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const direct = String(data.date || data.contextDate || row.date || '').trim()
  if (direct) {
    const parsed = parseSalesDate(adapterStyleDateString(direct))
    if (parsed) return parsed
  }
  return resolveAggregationDate(row)
}

function rowCost(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const direct = parseAmount(
    row.total_cost ?? row.totalCost ?? data.totalCost ?? data.sales_cost ?? row.sales_cost,
  )
  if (direct) return direct
  const qty = parseAmount(row.sales_qty ?? row.salesQty ?? data.salesQty ?? data.quantity)
  const unit = parseAmount(row.unit_cost ?? row.unitCost ?? data.unitCost ?? data.cost_price)
  if (unit && qty) return unit * qty
  return 0
}

function rowMetrics(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const sales = parseAmount(row.sales ?? data.sales ?? data.actualPayment)
  const salesQty = parseAmount(row.sales_qty ?? row.salesQty ?? data.salesQty ?? data.quantity)
  const netProfit = parseAmount(row.net_profit ?? row.netProfit ?? data.netProfit ?? data.margin)
  // 클라 esserRowValues 와 동일 — 원가 칸 없으면 0. 매출−마진 역산은 스스 KPI 표시층에서만.
  const cost = rowCost(row)
  return {
    sales,
    salesQty,
    netProfit,
    cost,
    adSpend: parseAmount(row.ad_spend ?? row.adSpend ?? data.adSpend),
  }
}

function sheetFullMetrics(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const sales = parseAmount(row.sales ?? data.sales ?? data.actualPayment)
  const salesQty = parseAmount(row.sales_qty ?? row.salesQty ?? data.salesQty ?? data.quantity)
  const netProfit = parseAmount(row.net_profit ?? row.netProfit ?? data.netProfit ?? data.margin)
  // 합계 원가 칸만. 빈 칸을 매출−마진으로 채우지 않음(빅셀 순이익=수수료 차감 후).
  const costTotal = parseAmount(row.total_cost ?? data.totalCost ?? data.sales_cost)
  return {
    sales,
    salesQty,
    netProfit,
    costTotal,
    adSpend: parseAmount(row.ad_spend ?? row.adSpend ?? data.adSpend),
    adSales: parseAmount(data.adSales ?? data.ad_sales ?? row.adSales),
  }
}

/** 엑셀 합계 행 — upload당 1행 (esserMetrics.dedupeSheetTotalsByUpload) */
function dedupeSheetFullByUpload(sheetRows) {
  /** @type {Map<string, { metrics: ReturnType<typeof sheetFullMetrics>, kind: string }>} */
  const byUpload = new Map()
  for (const row of sheetRows) {
    const data = row.data && typeof row.data === 'object' ? row.data : {}
    const key = rowUploadKey(row)
    const metrics = sheetFullMetrics(row)
    const kind = data.sheetTotalKind || row.sheetTotalKind || 'footer'
    const prev = byUpload.get(key)
    if (!prev) {
      byUpload.set(key, { metrics, kind })
      continue
    }
    if (prev.kind === 'header') continue
    if (kind === 'header') byUpload.set(key, { metrics, kind })
  }
  return byUpload
}

function dedupeSheetAdByUpload(sheetRows) {
  return [...dedupeSheetFullByUpload(sheetRows).values()].map((x) => ({
    adSpend: x.metrics.adSpend,
    adSales: x.metrics.adSales,
  }))
}

/** 합계 행이 있으면 그 값만 버킷에 반영 (상품 원가 보완 없음) */
function applySheetPreferToBucket(bucket, sheetRows, { replaceAds = true } = {}) {
  const byUpload = dedupeSheetFullByUpload(sheetRows)
  if (!byUpload.size) return
  let adSpend = 0
  let adSales = 0
  for (const [, { metrics: m }] of byUpload) {
    bucket.salesTotal += m.sales
    bucket.quantityTotal += m.salesQty
    bucket.netProfitTotal += m.netProfit
    bucket.costTotal += m.costTotal || 0
    bucket.recordCount += 1
    adSpend += m.adSpend
    adSales += m.adSales
  }
  if (replaceAds) {
    bucket.adSpendTotal = adSpend
    bucket.adSalesTotal = adSales
  } else {
    bucket.adSpendTotal += adSpend
    bucket.adSalesTotal += adSales
  }
}

function rowUploadId(row) {
  return row.upload_id || row.uploadId || ''
}

function rowUploadKey(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {}
  return (
    rowUploadId(row) ||
    data.sourceFileName ||
    data.fileName ||
    row.sourceFileName ||
    '__single__'
  )
}

/** 합계 행이 있는 업로드 — 상품 행 이중 합산 방지 */
function collectUploadsPreferringSheetSales(rows, range = {}, platformLabel = null) {
  const sheetRows = selectSheetRowsForKpiAd(rows, range, platformLabel)
  return new Set(dedupeSheetFullByUpload(sheetRows).keys())
}

/** 기간 내 상품이 있는 업로드 ID (엑셀 합계 광고 행 연동) */
export function collectInPeriodUploadIds(rows, range = {}) {
  const set = new Set()
  for (const row of productRows(rows)) {
    if (!rowMatchesKpiDateRange(row, range)) continue
    const uk = rowUploadId(row)
    if (uk) set.add(uk)
  }
  return set
}

/** KPI 광고 집계용 엑셀 합계 행 — 날짜 일치 또는 동일 업로드 내 기간 상품 존재 */
export function selectSheetRowsForKpiAd(rows, range = {}, platformLabel = null) {
  const uploadIds = collectInPeriodUploadIds(rows, range)
  const hasRange = Boolean(String(range.from || '').trim() || String(range.to || '').trim())

  return (rows || []).filter((row) => {
    if (isReturnRow(row) || !isSheetTotal(row)) return false
    if (platformLabel && resolvePlatformFromRow(row) !== platformLabel) return false
    if (!hasRange) return true
    if (rowMatchesKpiDateRange(row, range)) return true
    const uk = rowUploadId(row)
    return Boolean(uk && uploadIds.has(uk))
  })
}

export function sumSheetAdMetricsFromDetailRows(rows, range = {}, platformLabel = null) {
  const sheetRows = selectSheetRowsForKpiAd(rows, range, platformLabel)
  const deduped = dedupeSheetAdByUpload(sheetRows)
  let adSpend = 0
  let adSales = 0
  for (const m of deduped) {
    adSpend += m.adSpend
    adSales += m.adSales
  }
  return { adSpend, adSales }
}

function winningSheetRowsByUpload(sheetRows) {
  const byUpload = new Map()
  for (const row of sheetRows || []) {
    const data = row.data && typeof row.data === 'object' ? row.data : {}
    const key = rowUploadKey(row)
    const kind = data.sheetTotalKind || row.sheetTotalKind || 'footer'
    const prev = byUpload.get(key)
    if (!prev) {
      byUpload.set(key, row)
      continue
    }
    const prevData = prev.data && typeof prev.data === 'object' ? prev.data : {}
    const prevKind = prevData.sheetTotalKind || prev.sheetTotalKind || 'footer'
    if (prevKind === 'header') continue
    if (kind === 'header') byUpload.set(key, row)
  }
  return [...byUpload.values()]
}

export function kpiRecordDump(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {}
  return {
    id: row?.id ?? null,
    record_type: row?.record_type ?? row?.recordType ?? null,
    upload_kind: row?.upload_kind ?? row?.uploadKind ?? null,
    platform: row?.platform ?? null,
    resolved_platform: resolvePlatformFromRow(row),
    sales_method: row?.sales_method ?? row?.salesMethod ?? null,
    order_date: row?.order_date ?? row?.orderDate ?? null,
    kpi_date: row?.kpi_date ?? null,
    business_date: row?.business_date ?? row?.businessDate ?? null,
    period_from: row?.period_from ?? row?.periodFrom ?? null,
    period_to: row?.period_to ?? row?.periodTo ?? null,
    sales: row?.sales ?? null,
    sales_qty: row?.sales_qty ?? row?.salesQty ?? null,
    ad_spend: row?.ad_spend ?? row?.adSpend ?? data.adSpend ?? null,
    ad_sales: data.adSales ?? data.ad_sales ?? row?.adSales ?? null,
    transaction_type: row?.transaction_type ?? row?.transactionType ?? null,
    product_name:
      row?.product_name ||
      data.productName ||
      data.product_name ||
      data['상품명'] ||
      data.optionName ||
      null,
    upload_id: row?.upload_id ?? row?.uploadId ?? null,
    upload_key:
      row?.upload_id ||
      row?.uploadId ||
      data.sourceFileName ||
      data.fileName ||
      row?.sourceFileName ||
      null,
    sheetTotalKind: data.sheetTotalKind || null,
    isEsserSheetTotal: data.isEsserSheetTotal === true,
    data_date: data.date ?? null,
    filter_date: resolveKpiFilterDate(row),
    agg_date: resolveAggregationDate(row),
  }
}

/** JS 플랫폼 집계에 실제로 들어가는 record id */
export function collectPlatformKpiSelectedIds(rows, range = {}) {
  const preferSheet = collectUploadsPreferringSheetSales(rows, range, null)
  const productIds = []
  for (const row of productRows(rows)) {
    if (!rowMatchesKpiDateRange(row, range)) continue
    if (preferSheet.has(rowUploadKey(row))) continue
    if (row.id != null) productIds.push(row.id)
  }
  const sheetIds = []
  for (const label of PLATFORM_SPLIT_LABELS) {
    const sheetRows = selectSheetRowsForKpiAd(rows, range, label)
    for (const row of winningSheetRowsByUpload(sheetRows)) {
      if (row.id != null) sheetIds.push(row.id)
    }
  }
  const adIds = winningSheetRowsByUpload(selectSheetRowsForKpiAd(rows, range, null))
    .map((row) => row.id)
    .filter((id) => id != null)
  return {
    productIds: [...new Set(productIds)],
    sheetIds: [...new Set(sheetIds)],
    adIds: [...new Set(adIds)],
  }
}

export function collectDailyKpiSelectedIds(rows, range = {}) {
  const ids = []
  for (const row of productRows(rows)) {
    const date = resolveAggregationDate(row)
    if (!date) continue
    if (range.from && date < range.from) continue
    if (range.to && date > range.to) continue
    if (row.id != null) ids.push(row.id)
  }
  return [...new Set(ids)]
}

function finalizeBucket(bucket) {
  const sales = bucket.salesTotal || 0
  const qty = bucket.quantityTotal || 0
  const netProfit = bucket.netProfitTotal || 0
  // 원가 0을 매출−마진으로 채우지 않음 — 음수 마진 시 원가율 100%+ 왜곡 방지
  const cost = bucket.costTotal || 0
  return {
    ...bucket,
    marginRate: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    averageOrderValue: qty > 0 ? round2(sales / qty) : 0,
    costTotal: cost,
  }
}

function addMetricsToBucket(bucket, m) {
  bucket.salesTotal += m.sales
  bucket.quantityTotal += m.salesQty
  bucket.netProfitTotal += m.netProfit
  bucket.adSpendTotal += m.adSpend
  bucket.costTotal += m.cost || 0
  bucket.recordCount += 1
}

function emptyBucket() {
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
  }
}

function productRows(rows) {
  return (rows || []).filter((r) => !isReturnRow(r) && !isSheetTotal(r))
}

/** platformKpiSplit.buildPlatformRow rowCount — 반품 포함, 합계 행만 제외 */
function platformRowCountRows(rows) {
  return (rows || []).filter((r) => !isSheetTotal(r))
}

function closedMallBrandFromLabel(label) {
  const s = String(label || '').trim()
  if (/^베스트하임 \(.+\)$/.test(s) || /^베스트하임\(.+\)$/.test(s)) return '베스트하임'
  if (/^에쎄르\(.+\)$/.test(s)) return '에쎄르'
  return ''
}

function saleRowsIncludingSheet(rows) {
  return (rows || []).filter((r) => !isReturnRow(r))
}

function platformSubset(rows, label) {
  const list = productRows(rows)
  if (label === '합계') return list
  if (isClosedMallKpiLabel(label)) {
    const seller = closedMallSellerFromLabel(label)
    const brand = closedMallBrandFromLabel(label)
    return list.filter((r) => {
      if (!isClosedMallRow(r)) return false
      if (brand && resolveClosedMallBrandLabel(r) !== brand) return false
      if (!seller) return true
      return resolveClosedMallSeller(r) === seller
    })
  }
  return list.filter((r) => resolvePlatformFromRow(r) === label)
}

/** 전일대비 — 엑셀 합계 행 포함 (KPI 합계 행 우선과 동일) */
function platformSubsetForDod(rows, label) {
  const list = saleRowsIncludingSheet(rows)
  if (label === '합계') return list
  if (isClosedMallKpiLabel(label)) {
    const seller = closedMallSellerFromLabel(label)
    const brand = closedMallBrandFromLabel(label)
    return list.filter((r) => {
      if (!isClosedMallRow(r)) return false
      if (brand && resolveClosedMallBrandLabel(r) !== brand) return false
      if (!seller) return true
      return resolveClosedMallSeller(r) === seller
    })
  }
  return list.filter((r) => resolvePlatformFromRow(r) === label)
}

export function addDaysToYmd(ymd, deltaDays) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return ''
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  dt.setDate(dt.getDate() + deltaDays)
  const pad = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function resolveReferenceDate(rows, range = {}) {
  const to = String(range.to || range.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to
  const from = String(range.from || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && !to) return from
  let maxKey = ''
  for (const row of productRows(rows)) {
    const key = resolveDayOverDayKey(row)
    if (!key) continue
    if (!maxKey || key > maxKey) maxKey = key
  }
  return maxKey
}

/**
 * 일자별 매출 — 업로드에 합계 행이 있으면 합계 행, 없으면 상품 행 합
 * (esserMetrics.accumulateEsserPreferSheetTotals / aggregateDailyKpiFromRows 와 동일)
 */
function buildDailySalesMap(rows, platformLabel) {
  const subset = platformSubsetForDod(rows, platformLabel)
  /** @type {Map<string, object[]>} */
  const byDay = new Map()
  for (const row of subset) {
    const key = resolveDayOverDayKey(row) || resolveAggregationDate(row)
    if (!key) continue
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(row)
  }

  const map = new Map()
  for (const [day, dayRows] of byDay) {
    const sheetByUpload = dedupeSheetFullByUpload(dayRows.filter((r) => isSheetTotal(r)))
    const preferSheet = new Set(sheetByUpload.keys())
    let sales = 0
    for (const row of dayRows) {
      if (isSheetTotal(row)) continue
      if (preferSheet.has(rowUploadKey(row))) continue
      sales += rowMetrics(row).sales
    }
    for (const [, { metrics }] of sheetByUpload) {
      sales += metrics.sales
    }
    map.set(day, sales)
  }
  return map
}

function buildDailyQuantityMap(rows, platformLabel) {
  const subset = platformSubsetForDod(rows, platformLabel)
  /** @type {Map<string, object[]>} */
  const byDay = new Map()
  for (const row of subset) {
    const key = resolveDayOverDayKey(row) || resolveAggregationDate(row)
    if (!key) continue
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(row)
  }

  const map = new Map()
  for (const [day, dayRows] of byDay) {
    const sheetByUpload = dedupeSheetFullByUpload(dayRows.filter((r) => isSheetTotal(r)))
    const preferSheet = new Set(sheetByUpload.keys())
    let qty = 0
    for (const row of dayRows) {
      if (isSheetTotal(row)) continue
      if (preferSheet.has(rowUploadKey(row))) continue
      qty += rowMetrics(row).salesQty
    }
    for (const [, { metrics }] of sheetByUpload) {
      qty += metrics.salesQty
    }
    map.set(day, qty)
  }
  return map
}

function calcDiffRate(current, previous) {
  if (previous > 0) return round2(((current - previous) / previous) * 100)
  if (current > 0) return 100
  return 0
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ from?: string, to?: string }} [range]
 */
function resolveSheetUploadDate(uploadKey, sheetRows, allRows) {
  const sample = (sheetRows || []).find((r) => rowUploadKey(r) === uploadKey)
  let date = sample ? resolveAggregationDate(sample) || '' : ''
  if (date) return date
  for (const row of productRows(allRows)) {
    if (rowUploadKey(row) !== uploadKey) continue
    date = resolveAggregationDate(row) || ''
    if (date) return date
  }
  return ''
}

export function aggregateDailyKpiFromRows(rows, range = {}) {
  const map = new Map()
  const sheetRows = selectSheetRowsForKpiAd(rows, range, null)
  const sheetByUpload = dedupeSheetFullByUpload(sheetRows)
  const preferSheet = new Set(sheetByUpload.keys())

  for (const row of productRows(rows)) {
    const date = resolveAggregationDate(row)
    if (!date) continue
    if (range.from && date < range.from) continue
    if (range.to && date > range.to) continue
    const uploadKey = rowUploadKey(row)
    if (preferSheet.has(uploadKey)) continue

    if (!map.has(date)) {
      map.set(date, { date, ...emptyBucket() })
    }
    addMetricsToBucket(map.get(date), rowMetrics(row))
  }

  for (const [uploadKey, { metrics: m }] of sheetByUpload) {
    const date = resolveSheetUploadDate(uploadKey, sheetRows, rows)
    if (!date) continue
    if (range.from && date < range.from) continue
    if (range.to && date > range.to) continue
    if (!map.has(date)) {
      map.set(date, { date, ...emptyBucket() })
    }
    const bucket = map.get(date)
    bucket.salesTotal += m.sales
    bucket.quantityTotal += m.salesQty
    bucket.netProfitTotal += m.netProfit
    bucket.costTotal += m.costTotal || 0
    bucket.recordCount += 1
    bucket.adSpendTotal += m.adSpend
    bucket.adSalesTotal += m.adSales
  }

  return [...map.values()]
    .map(finalizeBucket)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ from?: string, to?: string }} [range]
 */
export function aggregatePlatformKpiFromRows(rows, range = {}) {
  const metricsMap = new Map()
  const countMap = new Map()
  const preferSheet = collectUploadsPreferringSheetSales(rows, range, null)

  for (const row of productRows(rows)) {
    if (!rowMatchesKpiDateRange(row, range)) continue
    const uk = rowUploadKey(row)
    if (preferSheet.has(uk)) continue

    const platform = resolvePlatformFromRow(row)
    if (!metricsMap.has(platform)) {
      metricsMap.set(platform, { platform, ...emptyBucket() })
    }
    addMetricsToBucket(metricsMap.get(platform), rowMetrics(row))
  }

  for (const row of platformRowCountRows(rows)) {
    if (!rowMatchesKpiDateRange(row, range)) continue
    const platform = resolvePlatformFromRow(row)
    countMap.set(platform, (countMap.get(platform) || 0) + 1)
  }

  for (const label of PLATFORM_SPLIT_LABELS) {
    const sheetRows = selectSheetRowsForKpiAd(rows, range, label)
    if (!sheetRows.length) continue
    const bucket = metricsMap.get(label) || { platform: label, ...emptyBucket() }
    applySheetPreferToBucket(bucket, sheetRows, { replaceAds: true })
    metricsMap.set(label, bucket)
  }

  const items = [...metricsMap.values()].map((item) => {
    const count = countMap.get(item.platform) || 0
    return finalizeBucket({ ...item, recordCount: count })
  })
  const main = PLATFORM_SPLIT_LABELS.map((label) => {
    const found = items.find((i) => i.platform === label)
    const count = countMap.get(label) || 0
    if (found) return found
    return finalizeBucket({ platform: label, ...emptyBucket(), recordCount: count })
  })

  // 특판 폐쇄몰 → 판매처별 「브랜드(판매처)」 행
  const closedMetrics = new Map()
  const closedCounts = new Map()
  for (const row of productRows(rows)) {
    if (!isClosedMallRow(row)) continue
    if (!rowMatchesKpiDateRange(row, range)) continue
    const label = formatClosedMallKpiLabel(
      resolveClosedMallBrandLabel(row),
      resolveClosedMallSeller(row),
    )
    if (!closedMetrics.has(label)) {
      closedMetrics.set(label, { platform: label, ...emptyBucket() })
    }
    addMetricsToBucket(closedMetrics.get(label), rowMetrics(row))
  }
  for (const row of platformRowCountRows(rows)) {
    if (!isClosedMallRow(row)) continue
    if (!rowMatchesKpiDateRange(row, range)) continue
    const label = formatClosedMallKpiLabel(
      resolveClosedMallBrandLabel(row),
      resolveClosedMallSeller(row),
    )
    closedCounts.set(label, (closedCounts.get(label) || 0) + 1)
  }
  const closedItems = [...closedMetrics.keys()]
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map((label) =>
      finalizeBucket({
        ...closedMetrics.get(label),
        recordCount: closedCounts.get(label) || 0,
      }),
    )

  // 베스트하임(플랫폼): 특판 제외 / 기타 판매처: 특판만
  const hasNonClosedInRange = productRows(rows).some(
    (r) => rowMatchesKpiDateRange(r, range) && !isClosedMallRow(r),
  )
  const resultItems = hasNonClosedInRange
    ? main
    : closedItems.length
      ? closedItems
      : main

  const total = emptyBucket()
  for (const item of resultItems) {
    total.salesTotal += item.salesTotal
    total.quantityTotal += item.quantityTotal
    total.recordCount += item.recordCount
    total.netProfitTotal += item.netProfitTotal
    total.adSpendTotal += item.adSpendTotal
    total.adSalesTotal += item.adSalesTotal || 0
    total.costTotal += item.costTotal
  }
  finalizeBucket(total)

  return {
    items: resultItems,
    total: finalizeBucket({ platform: '합계', ...total }),
    allItems: items,
  }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ date?: string, from?: string, to?: string, platform?: string }} [opts]
 */
export function compareYesterdayFromRows(rows, opts = {}) {
  const ref = resolveReferenceDate(rows, opts)
  const prev = ref ? addDaysToYmd(ref, -1) : ''
  const labels = opts.platform
    ? [opts.platform === '합계' ? '합계' : normalizePlatformLabel(opts.platform)]
    : (() => {
        const closed = listClosedMallSellerLabels(rows, {})
        const products = productRows(rows)
        const onlyClosed =
          products.length > 0 && products.every((r) => isClosedMallRow(r))
        if (onlyClosed) return [...closed, '합계']
        return ['쿠팡', '스마트스토어', '합계']
      })()

  const items = labels.map((label) => {
    const salesByDay = buildDailySalesMap(rows, label)
    const quantityMap = buildDailyQuantityMap(rows, label)
    const currentSales = ref ? salesByDay.get(ref) ?? 0 : 0
    const previousSales = prev ? salesByDay.get(prev) ?? 0 : 0
    const salesDiff = currentSales - previousSales
    const currentQty = ref ? quantityMap.get(ref) ?? 0 : 0
    const previousQty = prev ? quantityMap.get(prev) ?? 0 : 0

    return {
      label,
      current: {
        date: ref || null,
        salesTotal: Math.round(currentSales),
        quantityTotal: Math.round(currentQty),
        recordCount: null,
      },
      previous: {
        date: prev || null,
        salesTotal: Math.round(previousSales),
        quantityTotal: Math.round(previousQty),
        recordCount: null,
      },
      diff: {
        salesDiff: Math.round(salesDiff),
        salesDiffRate: calcDiffRate(currentSales, previousSales),
        quantityDiff: Math.round(currentQty - previousQty),
        quantityDiffRate: calcDiffRate(currentQty, previousQty),
      },
    }
  })

  if (opts.platform && items.length === 1) {
    const one = items[0]
    return {
      current: one.current,
      previous: one.previous,
      diff: one.diff,
      items,
    }
  }

  return { items, current: items.find((i) => i.label === '합계')?.current ?? null,
    previous: items.find((i) => i.label === '합계')?.previous ?? null,
    diff: items.find((i) => i.label === '합계')?.diff ?? null }
}

export { PLATFORM_SPLIT_LABELS, DAY_OVER_DAY_LABELS }
