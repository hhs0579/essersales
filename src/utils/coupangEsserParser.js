import {
  COUPANG_ESSER_COLUMN_MAP,
  COUPANG_ESSER_MARKERS,
  COUPANG_ESSER_DATE_HEADERS,
  COUPANG_AD_SPEND_LABELS,
} from '../config/coupangEsserColumnMap.js'
import { parseAmount } from './salesAggregation.js'
import {
  formatPeriodLabel,
  normalizeExcelDateValue,
  parseFilenameDateSpec,
  parseSalesDate,
} from './dateParse.js'
import {
  detectSalesMethodFromFileName,
  resolveSalesMethodForEsserRow,
  resolveDeliveryMethodForBiggerRow,
  inferUploadSalesMethodFromDetails,
} from './salesMethodDetect.js'
import {
  resolvePlatformForEsserRow,
  inferUploadPlatformFromDetails,
  detectPlatformFromChannelKind,
  detectPlatformFromFileName,
  applyPlatformsFromChannelKind,
  extractChannelKindFromRawRow,
  isChannelKindHeaderKey,
  cleanHeaderText,
} from './platformDetect.js'

function transactionTypeFromAmounts(sales, qty) {
  return sales < 0 || qty < 0 ? 'return' : 'sale'
}

function normHeader(h) {
  return cleanHeaderText(h)
}

/** 「광고집행비」 본열 1개만 (광고비 등 다른 열과 이중 합산 방지) */
function resolvePrimaryAdSpendHeader(lookup) {
  return (
    lookup['광고집행비'] ||
    lookup['광고비'] ||
    lookup['광고 비용'] ||
    lookup.__ad_spend_primary__ ||
    ''
  )
}

function adSpendFromRow(row, lookup) {
  const header = resolvePrimaryAdSpendHeader(lookup)
  if (!header) return 0
  return parseAmount(row[header])
}

/** 상품명 열 — 정확 일치 우선, 없으면 「…상품명」(옵션상품명 제외) */
function findProductNameHeader(list) {
  const exact = list.find((h) => {
    const n = h.norm.replace(/\s/g, '')
    return n === '상품명' || n === '노출상품명' || n === '등록상품명' || n === '상품이름'
  })
  if (exact) return exact.raw
  const fuzzy = list.find((h) => {
    const n = h.norm.replace(/\s/g, '')
    if (!n.includes('상품명')) return false
    if (n.includes('옵션')) return false
    return true
  })
  return fuzzy?.raw || ''
}

/** 실제 엑셀 헤더 → column_map 한글 키 */
export function buildCoupangEsserHeaderLookup(headers, sampleRows = []) {
  const lookup = {}
  const list = headers.map((h) => ({ raw: h, norm: normHeader(h) }))

  for (const korean of Object.keys(COUPANG_ESSER_COLUMN_MAP)) {
    const kn = normHeader(korean)
    const found =
      list.find((h) => h.norm === kn) ||
      list.find((h) => h.norm.replace(/\s/g, '') === kn.replace(/\s/g, ''))
    if (found) lookup[korean] = found.raw
  }

  if (!lookup['상품명']) {
    const productHeader = findProductNameHeader(list)
    if (productHeader) {
      lookup['상품명'] = productHeader
      lookup['노출상품명'] = productHeader
    }
  }

  for (const candidate of COUPANG_ESSER_DATE_HEADERS) {
    const cn = normHeader(candidate)
    const found = list.find((h) => h.norm === cn || h.norm.includes(cn))
    if (found) {
      lookup.__date__ = found.raw
      break
    }
  }

  if (!lookup.__date__) {
    const found = list.find((h) => /날짜|일자|집계|기준일|판매일|조회일/.test(h.norm))
    if (found) lookup.__date__ = found.raw
  }

  lookup.__ad_spend_primary__ = resolvePrimaryAdSpendHeader(lookup)

  if (!lookup['채널종류']) {
    const ch = list.find((h) => {
      const n = h.norm.replace(/\s/g, '').toLowerCase()
      return (
        isChannelKindHeaderKey(h.norm) ||
        /채널종류|채널구분|channeltype|channelkind|몰구분|판매채널종류/i.test(n) ||
        (n.includes('채널') && n.includes('종류'))
      )
    })
    if (ch) lookup['채널종류'] = ch.raw
  }

  if (!lookup['판매방식']) {
    const sm = list.find((h) => {
      const n = h.norm.replace(/\s/g, '')
      return /판매방식|배송구분|배송방식|배송유형|배송형태|배송타입|주문배송|상품배송|물류방식/i.test(
        n,
      )
    })
    if (sm) lookup['판매방식'] = sm.raw
  }

  if (!lookup['배송구분']) {
    const bg = list.find((h) => {
      const n = h.norm.replace(/\s/g, '')
      return n === '배송구분' || n.includes('배송구분')
    })
    if (bg) lookup['배송구분'] = bg.raw
  }

  lookup.__delivery_header__ = lookup['배송구분'] || lookup['판매방식'] || ''

  if (!lookup['배송구분']) {
    for (const row of sampleRows.slice(0, 20)) {
      if (row && Object.prototype.hasOwnProperty.call(row, '배송구분')) {
        lookup['배송구분'] = '배송구분'
        lookup.__delivery_header__ = '배송구분'
        break
      }
    }
  }

  return lookup
}

export function isCoupangEsserFormat(headers) {
  const norms = headers.map(normHeader).filter(Boolean)
  const normSet = new Set(norms)
  const has = (label) => {
    const n = normHeader(label)
    if (normSet.has(n)) return true
    return norms.some((h) => h.includes(n) || n.includes(h))
  }

  const hasSales = has('매출')
  const hasProfit = has('순이익금') || has('마진')
  const hasQty = has('판매수량') || (has('수량') && !has('광고 판매수량'))
  const hasProduct = has('상품명')
  const hasStoreOrId =
    has('스토어명') ||
    has('스토어') ||
    has('채널종류') ||
    has('채널구분') ||
    has('노출상품ID') ||
    has('상품번호') ||
    has('상품ID')

  if (hasSales && hasProfit && hasQty && hasProduct && hasStoreOrId) return true

  let hits = 0
  for (const marker of COUPANG_ESSER_MARKERS) {
    if (has(marker)) hits += 1
  }
  return hits >= 4
}

/** 쿠팡·네이버 빅셀 매출분석 형식 (별칭) */
export const isBigsellerEsserFormat = isCoupangEsserFormat

function mapRow(row, lookup, carry = { lastChannelKind: '', lastDeliveryMethod: '' }) {
  const mapped = {}
  for (const [korean, field] of Object.entries(COUPANG_ESSER_COLUMN_MAP)) {
    if (field === 'ad_spend') continue
    const header = lookup[korean]
    if (!header) continue
    const val = row[header]
    mapped[field] = val == null || val === '' ? '' : String(val).trim()
  }

  if (!mapped.channel_kind) {
    mapped.channel_kind = extractChannelKindFromRawRow(row)
  }
  if (!mapped.channel_kind && carry.lastChannelKind) {
    mapped.channel_kind = carry.lastChannelKind
  }
  if (mapped.channel_kind) carry.lastChannelKind = mapped.channel_kind

  mapped.delivery_method = resolveDeliveryMethodForBiggerRow(row, lookup, carry)
  if (mapped.delivery_method) carry.lastDeliveryMethod = mapped.delivery_method

  const adSum = adSpendFromRow(row, lookup)
  if (adSum) mapped.ad_spend = String(adSum)
  if (lookup.__date__) {
    mapped.sale_date = normalizeExcelDateValue(row[lookup.__date__])
  }
  return mapped
}

/** 파일명의 하루치 날짜 (기간 파일이면 빈 문자열) */
export function guessBusinessDateFromFileName(fileName) {
  const spec = parseFilenameDateSpec(fileName)
  if (spec.type === 'day') return spec.date
  if (spec.type === 'range') return ''

  const m = fileName.match(/(\d{4})[.\-_년]?\s*(\d{1,2})[.\-_월]?\s*(\d{1,2})/)
  if (!m) return ''
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
}

/** 엑셀 하단 「합계」 행 — 상품 행과 함께 합산하면 숫자가 2배가 됨 */
/** 엑셀 하단 총합 행 — 광고비만 KPI에 더함 (표·매출 집계 제외) */
export function isEsserSheetTotalRecord(row) {
  return row?.isEsserSheetTotal === true
}

/** DB에 이미 저장된 상세 행이 합계 행인지 (구버전 — 표에서만 제외) */
export function isEsserDetailSummaryRecord(row) {
  if (isEsserSheetTotalRecord(row)) return false
  if (
    row?.uploadFormat !== 'coupang_esser' &&
    row?.uploadFormat !== 'coupang_esser_period' &&
    row?.uploadFormat !== 'coupang_esser_monthly'
  ) {
    return false
  }
  return isCoupangEsserSummaryRow({
    product_name: row.productName,
    store_name: row.brand || row.storeName,
    product_id: row.productId,
    option_id: row.optionId,
  })
}

export function isCoupangEsserSummaryRow(m) {
  const name = String(m.product_name || '').trim()
  const store = String(m.store_name || '').trim()
  if (!name && !store) return false

  const summaryPattern = /^(합계|소계|총계|전체|총합|합(\s*계)?|total|sum|subtotal)$/i
  const loosePattern = /합계|소계|총계|전체합/

  if (summaryPattern.test(name.replace(/\s/g, ''))) return true
  if (summaryPattern.test(store.replace(/\s/g, ''))) return true
  if (name && loosePattern.test(name) && name.length <= 12) return true
  if (!m.product_id && !m.option_id && loosePattern.test(name)) return true

  return false
}

/**
 * 헤더 바로 아래(첫 데이터 행): 각 열 제목 밑 칸 = 그 열 합계 (상품ID 없음)
 * @param {object} m
 */
export function isCoupangEsserHeaderTotalRow(m, options = {}) {
  if (m.product_id || m.option_id) return false
  const name = String(m.product_name || '').trim()
  if (name && !isCoupangEsserSummaryRow(m)) return false
  const allowZero = options.allowZeroSalesProducts === true
  return (
    parseAmount(m.sales) !== 0 ||
    parseAmount(m.sales_qty) !== 0 ||
    parseAmount(m.ad_spend) !== 0 ||
    parseAmount(m.ad_sales) !== 0 ||
    parseAmount(m.net_profit) !== 0 ||
    parseAmount(m.sales_cost) !== 0 ||
    isCoupangEsserSummaryRow(m) ||
    // 사본느리만: 상품명·ID 없는 헤더 직하 칸 — 매출 0이어도 열 합계
    (allowZero && !name)
  )
}

/** 헤더 직하 합계 행(0번) 또는 하단 합계/총합 행 */
export function isCoupangEsserColumnTotalRow(m, rowIndex = -1, options = {}) {
  if (rowIndex === 0 && isCoupangEsserHeaderTotalRow(m, options)) return true
  return isCoupangEsserSummaryRow(m)
}

function hasSheetLevelMetrics(m, options = {}) {
  const name = String(m.product_name || '').trim()
  const allowZero = options.allowZeroSalesProducts === true
  return (
    parseAmount(m.sales) !== 0 ||
    parseAmount(m.sales_qty) !== 0 ||
    parseAmount(m.ad_spend) !== 0 ||
    parseAmount(m.ad_sales) !== 0 ||
    parseAmount(m.net_profit) !== 0 ||
    isCoupangEsserSummaryRow(m) ||
    // 사본느리만: 매출 0 합계 행·헤더 직하 빈 칸 보존
    (allowZero && !name && !m.product_id && !m.option_id)
  )
}

/** 파일당 합계 행 1개 — 헤더 직하 우선, 하단 합계는 보조(이중 합산 방지) */
function mergeSheetTotalForFile(current, incoming) {
  if (!incoming) return current
  if (!current) return incoming
  if (current.sheetTotalKind === 'header') return current
  if (incoming.sheetTotalKind === 'header') return incoming
  return current
}

export function formatDisplayDate(ymd) {
  if (!ymd) return ''
  const p = parseSalesDate(ymd) || parseSalesDate(ymd.replace(/-/g, '.'))
  if (p) return `${p.year}. ${p.month}. ${p.day}`
  const parts = ymd.split('-').map((x) => parseInt(x, 10))
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return `${parts[0]}. ${parts[1]}. ${parts[2]}`
  }
  return ymd
}

function formatMarginRate(raw, sales, margin) {
  if (raw) {
    const s = String(raw).trim()
    if (s) return s.includes('%') ? s : `${parseAmount(s)}%`
  }
  if (sales > 0) return `${((margin / sales) * 100).toFixed(2)}%`
  return ''
}

function hasEsserProductIdentity(m) {
  return Boolean(
    String(m.product_name || '').trim() ||
      String(m.option_name || '').trim() ||
      String(m.product_id || '').trim() ||
      String(m.option_id || '').trim() ||
      String(m.product_code || '').trim(),
  )
}

/**
 * 사본느리 채널 + 로켓그로스 파일명일 때만 매출 0 상품행 허용.
 * (판매자배송·베스트하임에는 적용하지 않음)
 */
function resolveAllowZeroSalesProducts(fileName, options = {}) {
  if (options.allowZeroSalesProducts !== true) return false
  return detectSalesMethodFromFileName(fileName) === '로켓그로스'
}

function withResolvedZeroSalesOption(fileName, options = {}) {
  return {
    ...options,
    allowZeroSalesProducts: resolveAllowZeroSalesProducts(fileName, options),
  }
}

/**
 * 판매 0이어도 광고·원가 등이 있으면 저장.
 * allowZeroSalesProducts(사본느리·로켓그로스)일 때만 상품 식별만으로도 저장.
 */
function hasEsserMeasurableActivity(m, qty, sales, options = {}) {
  if (qty !== 0 || sales !== 0) return true
  if (
    parseAmount(m.ad_spend) !== 0 ||
    parseAmount(m.ad_sales) !== 0 ||
    parseAmount(m.ad_qty) !== 0 ||
    parseAmount(m.ad_profit) !== 0 ||
    parseAmount(m.ad_net_profit) !== 0 ||
    parseAmount(m.net_profit) !== 0 ||
    parseAmount(m.gross_sales) !== 0 ||
    parseAmount(m.sales_cost) !== 0 ||
    parseAmount(m.cost_price) !== 0
  ) {
    return true
  }
  if (options.allowZeroSalesProducts === true) {
    return hasEsserProductIdentity(m)
  }
  return false
}

/** 엑셀 합계 행 — 제목 밑·하단 합계 칸의 매출·광고·순이익 등 전체 저장 */
function coupangEsserSheetTotalToDetail(
  m,
  fallbackDate,
  fileName,
  platform,
  salesMethod,
  sheetTotalKind = 'footer',
  options = {},
) {
  if (!hasSheetLevelMetrics(m, options)) return null

  let date = ''
  if (m.sale_date) {
    const p = parseSalesDate(m.sale_date)
    date = p ? `${p.year}. ${p.month}. ${p.day}` : m.sale_date
  } else {
    date = formatDisplayDate(fallbackDate)
  }
  if (!date) return null

  const qty = parseAmount(m.sales_qty)
  const sales = parseAmount(m.sales)
  const margin = parseAmount(m.net_profit)
  const totalCost = parseAmount(m.sales_cost)
  const adSpend = parseAmount(m.ad_spend)
  const adSales = parseAmount(m.ad_sales)
  const rowPlatform = resolvePlatformForEsserRow(m, platform, fileName)
  const rowSalesMethod =
    resolveSalesMethodForEsserRow(m, fileName, salesMethod, rowPlatform) || salesMethod || ''
  const label =
    String(m.product_name || m.store_name || (sheetTotalKind === 'header' ? '열합계' : '총합')).trim() ||
    '총합'

  return {
    recordType: 'detail',
    transactionType: 'sale',
    isEsserSheetTotal: true,
    sheetTotalKind,
    date,
    channel: rowPlatform,
    platform: rowPlatform,
    salesMethod: rowSalesMethod,
    deliveryMethod: m.delivery_method || '',
    배송구분: m.delivery_method || '',
    brand: m.store_name || '',
    productName: label,
    option: '',
    quantity: String(qty || ''),
    sales: String(sales),
    salesQty: String(qty || ''),
    netProfit: String(margin),
    actualPayment: String(sales),
    settlementPrice: String(sales),
    unitCost: m.cost_price || '',
    totalCost: totalCost ? String(totalCost) : m.sales_cost || '',
    margin: String(margin),
    marginRate: formatMarginRate(m.net_profit_rate, sales, margin),
    shippingFee: '',
    channelFee: '',
    sourceFileName: fileName,
    uploadFormat: 'coupang_esser',
    adSpend: adSpend ? String(adSpend) : '',
    adSales: adSales ? String(adSales) : '',
  }
}

function coupangEsserSheetTotalToPeriodDetail(
  m,
  periodFrom,
  periodTo,
  periodLabel,
  fileName,
  platform,
  salesMethod,
  sheetTotalKind = 'footer',
  options = {},
) {
  const base = coupangEsserSheetTotalToDetail(
    m,
    '',
    fileName,
    platform,
    salesMethod,
    sheetTotalKind,
    options,
  )
  if (!base) return null
  return {
    ...base,
    date: periodLabel,
    periodFrom,
    periodTo,
    uploadFormat: 'coupang_esser_period',
  }
}

function coupangEsserToDetail(m, fallbackDate, fileName, platform, salesMethod, options = {}) {
  if (isCoupangEsserColumnTotalRow(m, -1, options)) return null

  const qty = parseAmount(m.sales_qty)
  const sales = parseAmount(m.sales)
  if (!hasEsserMeasurableActivity(m, qty, sales, options)) return null

  const productName =
    String(m.product_name || '').trim() ||
    String(m.option_name || '').trim() ||
    (m.product_id ? `상품ID ${m.product_id}` : '') ||
    (m.option_id ? `옵션ID ${m.option_id}` : '')
  if (!productName) return null

  let date = ''
  if (m.sale_date) {
    const p = parseSalesDate(m.sale_date)
    date = p ? `${p.year}. ${p.month}. ${p.day}` : m.sale_date
  } else {
    date = formatDisplayDate(fallbackDate)
  }
  if (!date) return null

  const margin = parseAmount(m.net_profit)
  const totalCost = parseAmount(m.sales_cost)
  const rowPlatform = resolvePlatformForEsserRow(m, platform, fileName)
  const rowSalesMethod =
    resolveSalesMethodForEsserRow(m, fileName, salesMethod, rowPlatform) || salesMethod || ''

  return {
    recordType: 'detail',
    transactionType: transactionTypeFromAmounts(sales, qty),
    date,
    channel: rowPlatform,
    platform: rowPlatform,
    salesMethod: rowSalesMethod,
    deliveryMethod: m.delivery_method || '',
    배송구분: m.delivery_method || '',
    brand: m.store_name || '',
    productName,
    option: m.option_name || '',
    quantity: String(qty || ''),
    sales: String(sales),
    salesQty: String(qty || ''),
    netProfit: String(margin),
    actualPayment: String(sales),
    settlementPrice: String(sales),
    unitCost: m.cost_price || '',
    totalCost: totalCost ? String(totalCost) : m.sales_cost || '',
    margin: String(margin),
    marginRate: formatMarginRate(m.net_profit_rate, sales, margin),
    shippingFee: '',
    channelFee: '',
    sourceFileName: fileName,
    uploadFormat: 'coupang_esser',
    storeName: m.store_name,
    productId: m.product_id,
    optionId: m.option_id,
    productCode: m.product_code,
    salePrice: m.sale_price,
    grossSales: m.gross_sales,
    adQty: m.ad_qty,
    adQtyRate: m.ad_qty_rate,
    organicQty: m.organic_qty,
    organicQtyRate: m.organic_qty_rate,
    adSpend: m.ad_spend,
    adSpendRate: m.ad_spend_rate,
    adSales: m.ad_sales,
    adSalesRate: m.ad_sales_rate,
    adConversionRate: m.ad_conversion_rate || m.ad_conversion_rate_alt,
    adRoas: m.ad_roas,
    adProfit: m.ad_profit,
    adNetProfit: m.ad_net_profit,
    adNetProfitRate: m.ad_net_profit_rate || m.ad_net_profit_rate_alt,
  }
}

function coupangEsserToPeriodDetail(
  m,
  periodFrom,
  periodTo,
  periodLabel,
  fileName,
  platform,
  salesMethod,
  options = {},
) {
  if (isCoupangEsserColumnTotalRow(m, -1, options)) return null

  const productName = m.product_name || ''
  if (!productName) return null

  const qty = parseAmount(m.sales_qty)
  const sales = parseAmount(m.sales)
  if (!hasEsserMeasurableActivity(m, qty, sales, options)) return null

  const margin = parseAmount(m.net_profit)
  const totalCost = parseAmount(m.sales_cost)
  const rowPlatform = resolvePlatformForEsserRow(m, platform, fileName)
  const rowSalesMethod =
    resolveSalesMethodForEsserRow(m, fileName, salesMethod, rowPlatform) || salesMethod || ''

  return {
    recordType: 'detail',
    transactionType: transactionTypeFromAmounts(sales, qty),
    date: periodLabel,
    periodFrom,
    periodTo,
    channel: rowPlatform,
    platform: rowPlatform,
    salesMethod: rowSalesMethod,
    deliveryMethod: m.delivery_method || '',
    배송구분: m.delivery_method || '',
    brand: m.store_name || '',
    productName,
    option: m.option_name || '',
    quantity: String(qty || ''),
    sales: String(sales),
    salesQty: String(qty || ''),
    netProfit: String(margin),
    actualPayment: String(sales),
    settlementPrice: String(sales),
    unitCost: m.cost_price || '',
    totalCost: totalCost ? String(totalCost) : m.sales_cost || '',
    margin: String(margin),
    marginRate: formatMarginRate(m.net_profit_rate, sales, margin),
    shippingFee: '',
    channelFee: '',
    sourceFileName: fileName,
    uploadFormat: 'coupang_esser_period',
    storeName: m.store_name,
    productId: m.product_id,
    optionId: m.option_id,
    productCode: m.product_code,
    salePrice: m.sale_price,
    grossSales: m.gross_sales,
    adQty: m.ad_qty,
    adQtyRate: m.ad_qty_rate,
    organicQty: m.organic_qty,
    organicQtyRate: m.organic_qty_rate,
    adSpend: m.ad_spend,
    adSpendRate: m.ad_spend_rate,
    adSales: m.ad_sales,
    adSalesRate: m.ad_sales_rate,
    adConversionRate: m.ad_conversion_rate || m.ad_conversion_rate_alt,
    adRoas: m.ad_roas,
    adProfit: m.ad_profit,
    adNetProfit: m.ad_net_profit,
    adNetProfitRate: m.ad_net_profit_rate || m.ad_net_profit_rate_alt,
  }
}

/**
 * 쿠팡 에쎄르 기간 매출 (파일명 시작·종료일, 행에 날짜 열 없음)
 */
export function parseCoupangEsserPeriod(fileName, headers, rows, platform = '쿠팡', options = {}) {
  options = withResolvedZeroSalesOption(fileName, options)
  const fallbackPlatform =
    detectPlatformFromFileName(fileName) || platform
  const spec = parseFilenameDateSpec(fileName)
  if (spec.type !== 'range') {
    throw new Error(
      '파일명에 기간이 필요합니다. 예: 빅셀_로켓그로스_매출분석_20260501_20260601.xlsx (하루치는 일별 업로드)',
    )
  }

  const lookup = buildCoupangEsserHeaderLookup(headers, rows)
  const salesMethod = detectSalesMethodFromFileName(fileName)
  const periodFrom = spec.from
  const periodTo = spec.to
  const periodLabel = formatPeriodLabel(periodFrom, periodTo)
  const businessDate = `${periodFrom}~${periodTo}`

  const details = []
  let skippedSummary = 0
  let sheetTotalForFile = null
  const rowCarry = { lastChannelKind: '', lastDeliveryMethod: '' }
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const mapped = mapRow(rows[rowIndex], lookup, rowCarry)
    if (isCoupangEsserColumnTotalRow(mapped, rowIndex, options)) {
      const kind = rowIndex === 0 ? 'header' : 'footer'
      const totalDetail = coupangEsserSheetTotalToPeriodDetail(
        mapped,
        periodFrom,
        periodTo,
        periodLabel,
        fileName,
        fallbackPlatform,
        salesMethod,
        kind,
        options,
      )
      if (totalDetail) sheetTotalForFile = mergeSheetTotalForFile(sheetTotalForFile, totalDetail)
      else skippedSummary += 1
      continue
    }
    const detail = coupangEsserToPeriodDetail(
      mapped,
      periodFrom,
      periodTo,
      periodLabel,
      fileName,
      fallbackPlatform,
      salesMethod,
      options,
    )
    if (detail) details.push(detail)
  }
  if (sheetTotalForFile) details.push(sheetTotalForFile)

  const uploadPlatform = applyPlatformsFromChannelKind(
    details,
    fileName,
    fallbackPlatform,
  )
  const uploadSalesMethod = inferUploadSalesMethodFromDetails(details, fileName, salesMethod)
  for (const d of details) {
    if (d.isEsserSheetTotal && !d.salesMethod && uploadSalesMethod) {
      d.salesMethod = uploadSalesMethod
    }
  }

  return {
    fileName,
    platform: uploadPlatform,
    salesMethod: uploadSalesMethod,
    businessDate,
    periodFrom,
    periodTo,
    periodLabel,
    details,
    mapping: lookup,
    skipped: rows.length - details.length,
    skippedSummary,
    format: 'coupang_esser_period',
    dateRangeHint: periodLabel.replace(/\s/g, ''),
  }
}

/**
 * 쿠팡 에쎄르 일일 상품별 매출 엑셀 → 상세 거래 레코드
 */
export function parseCoupangEsserDaily(fileName, headers, rows, platform = '쿠팡', options = {}) {
  options = withResolvedZeroSalesOption(fileName, options)
  const fallbackPlatform =
    detectPlatformFromFileName(fileName) || platform
  const spec = parseFilenameDateSpec(fileName)
  if (spec.type === 'range') {
    throw new Error(
      '기간 합산 파일(파일명에 서로 다른 날짜 2개)은 지원하지 않습니다. 하루치 일별 파일로 나눠 업로드하세요. (예: …_20260531.xlsx)',
    )
  }

  const lookup = buildCoupangEsserHeaderLookup(headers, rows)
  const salesMethod = detectSalesMethodFromFileName(fileName)
  let businessDate = spec.type === 'day' ? spec.date : guessBusinessDateFromFileName(fileName)

  const details = []
  let skippedSummary = 0
  let skippedNoDate = 0
  let sheetTotalForFile = null
  const rowCarry = { lastChannelKind: '', lastDeliveryMethod: '' }
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const mapped = mapRow(rows[rowIndex], lookup, rowCarry)
    if (isCoupangEsserColumnTotalRow(mapped, rowIndex, options)) {
      const kind = rowIndex === 0 ? 'header' : 'footer'
      const totalDetail = coupangEsserSheetTotalToDetail(
        mapped,
        businessDate,
        fileName,
        fallbackPlatform,
        salesMethod,
        kind,
        options,
      )
      if (totalDetail) sheetTotalForFile = mergeSheetTotalForFile(sheetTotalForFile, totalDetail)
      else skippedSummary += 1
      continue
    }
    if (mapped.sale_date && !businessDate) {
      const p = parseSalesDate(mapped.sale_date)
      if (p) {
        businessDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
      }
    }
    const detail = coupangEsserToDetail(
      mapped,
      businessDate,
      fileName,
      fallbackPlatform,
      salesMethod,
      options,
    )
    if (detail) details.push(detail)
    else if (!isCoupangEsserSummaryRow(mapped) && mapped.product_name) {
      const hasMetrics = hasEsserMeasurableActivity(
        mapped,
        parseAmount(mapped.sales_qty),
        parseAmount(mapped.sales),
        options,
      )
      if (hasMetrics && !mapped.sale_date && !businessDate) {
        skippedNoDate += 1
      }
    }
  }
  if (sheetTotalForFile) details.push(sheetTotalForFile)

  const uploadPlatform = applyPlatformsFromChannelKind(
    details,
    fileName,
    fallbackPlatform,
  )
  const uploadSalesMethod = inferUploadSalesMethodFromDetails(details, fileName, salesMethod)
  for (const d of details) {
    if (d.isEsserSheetTotal && !d.salesMethod && uploadSalesMethod) {
      d.salesMethod = uploadSalesMethod
    }
  }

  if (!businessDate && details.length) {
    const p = parseSalesDate(details[0].date)
    if (p) {
      businessDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
    }
  }

  let dateRangeHint = businessDate || ''
  if (details.length > 1) {
    const parsed = details
      .map((d) => parseSalesDate(d.date))
      .filter(Boolean)
      .sort((a, b) => a.date - b.date)
    if (parsed.length) {
      const f = parsed[0]
      const l = parsed[parsed.length - 1]
      dateRangeHint = `${f.year}.${f.month}.${f.day}~${l.year}.${l.month}.${l.day}`
    }
  }

  let emptyHint = ''
  if (!details.length) {
    const headerPreview = (headers || []).slice(0, 12).join(', ')
    if (!lookup['상품명'] && !lookup['노출상품명']) {
      emptyHint = `상품명 열을 찾지 못했습니다. 감지된 헤더: ${headerPreview || '(없음)'}`
    } else if (!businessDate && skippedNoDate > 0) {
      emptyHint = `날짜를 읽지 못한 행 ${skippedNoDate}건. 파일명(…_20260721.xlsx) 또는 엑셀 날짜 열을 확인하세요.`
    } else if (rows.length === 0) {
      emptyHint = '데이터 행이 비어 있습니다. 시트가 여러 개면 상품별 매출 시트가 있는지 확인하세요.'
    } else if (skippedSummary >= rows.length) {
      emptyHint = '합계 행만 있고 상품 행이 없습니다. 빅셀 「상품별」 매출분석 파일인지 확인하세요.'
    } else {
      emptyHint = `상품 행 ${rows.length}건을 읽었으나 저장할 상품을 만들지 못했습니다. 헤더: ${headerPreview || '(없음)'}`
    }
  }

  return {
    fileName,
    platform: uploadPlatform,
    salesMethod: uploadSalesMethod,
    businessDate,
    details,
    mapping: lookup,
    skipped: rows.length - details.length,
    skippedSummary,
    skippedNoDate,
    dateRangeHint,
    emptyHint,
    format: 'coupang_esser',
  }
}

const MONTHLY_UPLOAD_FORMAT = 'coupang_esser_monthly'

function tagMonthlyDetail(detail, periodFrom, periodTo) {
  if (!detail) return null
  return {
    ...detail,
    periodFrom: detail.periodFrom || periodFrom,
    periodTo: detail.periodTo || periodTo,
    uploadFormat: MONTHLY_UPLOAD_FORMAT,
  }
}

function coupangEsserToMonthlyDetail(
  m,
  periodFrom,
  periodTo,
  periodLabel,
  fileName,
  platform,
  salesMethod,
  fallbackDate = '',
  options = {},
) {
  if (m.sale_date) {
    const detail = coupangEsserToDetail(m, fallbackDate, fileName, platform, salesMethod, options)
    return tagMonthlyDetail(detail, periodFrom, periodTo)
  }
  const detail = coupangEsserToPeriodDetail(
    m,
    periodFrom,
    periodTo,
    periodLabel,
    fileName,
    platform,
    salesMethod,
    options,
  )
  if (!detail) return null
  return { ...detail, uploadFormat: MONTHLY_UPLOAD_FORMAT }
}

function coupangEsserSheetTotalToMonthlyDetail(
  m,
  periodFrom,
  periodTo,
  periodLabel,
  fileName,
  platform,
  salesMethod,
  sheetTotalKind = 'footer',
  options = {},
) {
  const base = coupangEsserSheetTotalToPeriodDetail(
    m,
    periodFrom,
    periodTo,
    periodLabel,
    fileName,
    platform,
    salesMethod,
    sheetTotalKind,
    options,
  )
  if (!base) return null
  return { ...base, uploadFormat: MONTHLY_UPLOAD_FORMAT }
}

function countDistinctSaleDates(rows, lookup) {
  const dates = new Set()
  const carry = { lastChannelKind: '', lastDeliveryMethod: '' }
  for (const row of rows) {
    const mapped = mapRow(row, lookup, carry)
    if (!mapped.sale_date || !mapped.product_name) continue
    if (isCoupangEsserColumnTotalRow(mapped)) continue
    const p = parseSalesDate(mapped.sale_date)
    if (p) dates.add(`${p.year}-${p.month}-${p.day}`)
  }
  return dates.size
}

/**
 * 쿠팡 에쎄르 월별 매출 (파일명 1일~말일, 날짜 열 있으면 일자별·없으면 기간 합산)
 */
export function parseCoupangEsserMonthly(fileName, headers, rows, platform = '쿠팡', options = {}) {
  options = withResolvedZeroSalesOption(fileName, options)
  const fallbackPlatform = detectPlatformFromFileName(fileName) || platform
  const spec = parseFilenameDateSpec(fileName)
  if (spec.type !== 'range') {
    throw new Error(
      '월별 파일은 파일명에 시작·종료일이 필요합니다. 예: 빅셀_로켓그로스_매출분석_20260601_20260630.xlsx',
    )
  }

  const lookup = buildCoupangEsserHeaderLookup(headers, rows)
  const salesMethod = detectSalesMethodFromFileName(fileName)
  const periodFrom = spec.from
  const periodTo = spec.to
  const periodLabel = formatPeriodLabel(periodFrom, periodTo)
  const businessDate = `${periodFrom}~${periodTo}`
  const usePerDayRows = Boolean(lookup.__date__) && countDistinctSaleDates(rows, lookup) > 1

  const details = []
  let skippedSummary = 0
  let skippedNoDate = 0
  let sheetTotalForFile = null
  const rowCarry = { lastChannelKind: '', lastDeliveryMethod: '' }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const mapped = mapRow(rows[rowIndex], lookup, rowCarry)
    if (isCoupangEsserColumnTotalRow(mapped, rowIndex, options)) {
      const kind = rowIndex === 0 ? 'header' : 'footer'
      const totalDetail = coupangEsserSheetTotalToMonthlyDetail(
        mapped,
        periodFrom,
        periodTo,
        periodLabel,
        fileName,
        fallbackPlatform,
        salesMethod,
        kind,
        options,
      )
      if (totalDetail) sheetTotalForFile = mergeSheetTotalForFile(sheetTotalForFile, totalDetail)
      else skippedSummary += 1
      continue
    }

    const detail = coupangEsserToMonthlyDetail(
      mapped,
      periodFrom,
      periodTo,
      periodLabel,
      fileName,
      fallbackPlatform,
      salesMethod,
      periodFrom,
      options,
    )
    if (detail) details.push(detail)
    else if (!isCoupangEsserSummaryRow(mapped) && mapped.product_name) {
      const hasMetrics = hasEsserMeasurableActivity(
        mapped,
        parseAmount(mapped.sales_qty),
        parseAmount(mapped.sales),
        options,
      )
      if (hasMetrics && !mapped.sale_date && !usePerDayRows) {
        skippedNoDate += 1
      }
    }
  }
  if (sheetTotalForFile) details.push(sheetTotalForFile)

  const uploadPlatform = applyPlatformsFromChannelKind(details, fileName, fallbackPlatform)
  const uploadSalesMethod = inferUploadSalesMethodFromDetails(details, fileName, salesMethod)
  for (const d of details) {
    if (d.isEsserSheetTotal && !d.salesMethod && uploadSalesMethod) {
      d.salesMethod = uploadSalesMethod
    }
  }

  return {
    fileName,
    platform: uploadPlatform,
    salesMethod: uploadSalesMethod,
    businessDate,
    periodFrom,
    periodTo,
    periodLabel,
    details,
    mapping: lookup,
    skipped: rows.length - details.length,
    skippedSummary,
    skippedNoDate,
    dateRangeHint: periodLabel.replace(/\s/g, ''),
    format: MONTHLY_UPLOAD_FORMAT,
  }
}
