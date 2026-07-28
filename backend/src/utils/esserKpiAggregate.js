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
  return /^(에쎄르|베스트하임)\(.+\)$/.test(s)
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

  const periodFrom = row.period_from || row.periodFrom
  const periodTo = row.period_to || row.periodTo
  if (periodFrom && periodTo && from && to) {
    const pf = toYmd(periodFrom)
    const pt = toYmd(periodTo)
    if (pf && pt && pf <= to && pt >= from) return true
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

function rowMetrics(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  return {
    sales: parseAmount(row.sales ?? data.sales ?? data.actualPayment),
    salesQty: parseAmount(row.sales_qty ?? row.salesQty ?? data.salesQty ?? data.quantity),
    netProfit: parseAmount(row.net_profit ?? row.netProfit ?? data.netProfit ?? data.margin),
    adSpend: parseAmount(row.ad_spend ?? row.adSpend ?? data.adSpend),
  }
}

function sheetAdMetrics(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  return {
    adSpend: parseAmount(row.ad_spend ?? row.adSpend ?? data.adSpend),
    adSales: parseAmount(data.adSales ?? data.ad_sales),
  }
}

/** 엑셀 합계 행 — upload당 1행 (esserMetrics.dedupeSheetTotalMetrics) */
function dedupeSheetAdByUpload(sheetRows) {
  const byUpload = new Map()
  for (const row of sheetRows) {
    const data = row.data && typeof row.data === 'object' ? row.data : {}
    const key = row.upload_id || row.uploadId || data.sourceFileName || data.fileName || '__single__'
    const metrics = sheetAdMetrics(row)
    const kind = data.sheetTotalKind || row.sheetTotalKind || 'footer'
    const prev = byUpload.get(key)
    if (!prev) {
      byUpload.set(key, { metrics, kind })
      continue
    }
    if (prev.kind === 'header') continue
    if (kind === 'header') byUpload.set(key, { metrics, kind })
  }
  return [...byUpload.values()].map((x) => x.metrics)
}

function applySheetAdToBucket(bucket, sheetRows) {
  const deduped = dedupeSheetAdByUpload(sheetRows)
  if (!deduped.length) return
  let adSpend = 0
  let adSales = 0
  for (const m of deduped) {
    adSpend += m.adSpend
    adSales += m.adSales
  }
  bucket.adSpendTotal = adSpend
  bucket.adSalesTotal = adSales
}

function rowUploadId(row) {
  return row.upload_id || row.uploadId || ''
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

function finalizeBucket(bucket) {
  const sales = bucket.salesTotal || 0
  const qty = bucket.quantityTotal || 0
  const netProfit = bucket.netProfitTotal || 0
  const cost = bucket.costTotal || 0
  return {
    ...bucket,
    marginRate: sales > 0 ? round2((netProfit / sales) * 100) : 0,
    averageOrderValue: qty > 0 ? round2(sales / qty) : 0,
    costTotal: cost || Math.max(0, sales - netProfit),
  }
}

function addMetricsToBucket(bucket, m) {
  bucket.salesTotal += m.sales
  bucket.quantityTotal += m.salesQty
  bucket.netProfitTotal += m.netProfit
  bucket.adSpendTotal += m.adSpend
  bucket.costTotal += m.netProfit != null && m.sales != null ? Math.max(m.sales - m.netProfit, 0) : 0
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

function buildDailySalesMap(rows, platformLabel) {
  const map = new Map()
  for (const row of platformSubset(rows, platformLabel)) {
    const key = resolveDayOverDayKey(row)
    if (!key) continue
    const sales = rowMetrics(row).sales
    map.set(key, (map.get(key) || 0) + sales)
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
export function aggregateDailyKpiFromRows(rows, range = {}) {
  const map = new Map()

  for (const row of productRows(rows)) {
    const date = resolveAggregationDate(row)
    if (!date) continue
    if (range.from && date < range.from) continue
    if (range.to && date > range.to) continue

    if (!map.has(date)) {
      map.set(date, { date, ...emptyBucket() })
    }
    addMetricsToBucket(map.get(date), rowMetrics(row))
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

  for (const row of productRows(rows)) {
    if (!rowMatchesKpiDateRange(row, range)) continue

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
    applySheetAdToBucket(bucket, sheetRows)
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
    const currentSales = ref ? salesByDay.get(ref) ?? 0 : 0
    const previousSales = prev ? salesByDay.get(prev) ?? 0 : 0
    const salesDiff = currentSales - previousSales
    const quantityMap = new Map()
    for (const row of platformSubset(rows, label)) {
      const key = resolveDayOverDayKey(row)
      if (!key) continue
      const qty = rowMetrics(row).salesQty
      quantityMap.set(key, (quantityMap.get(key) || 0) + qty)
    }
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
