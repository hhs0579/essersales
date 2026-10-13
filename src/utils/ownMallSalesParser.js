import { loadXlsx } from './lazyXlsx.js'
import { parseAmount } from './parseAmount.js'
import { parseSalesDate, excelDateToYmd } from './dateParse.js'
import { formatYmd } from './recordFilters.js'
import { createOwnMallSaleEntry } from '../config/ownMallManual.js'

/** 아임웹 매출 — C=거래개시, 행별 X=품목 실결제가 */
export const OWN_MALL_SALES_ORDER_STATUS = '거래개시'

export const OWN_MALL_SALES_COL = {
  orderNo: 1,
  orderStatus: 2,
  /** D열 — 사용 안 함 (총 품목 합계금액, 매출 기준 아님) */
  lineTotal: 3,
  orderNetSales: 7,
  /** X열 — 품목 실결제가 (행별 매출 기준) */
  itemNetPay: 23,
  quantity: 16,
  productName: 17,
  salePrice: 19,
  orderDate: 36,
  productCode: 37,
  cancelReason: 32,
}

function cellStr(v) {
  if (v == null) return ''
  if (v instanceof Date && !isNaN(v.getTime())) {
    return excelDateToYmd(v)
  }
  return String(v).trim()
}

function cellAmount(v) {
  if (v == null || v === '') return 0
  return parseAmount(v)
}

function normalizeKey(s) {
  return cellStr(s).replace(/\s+/g, ' ')
}

function parseOrderDateYmd(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return excelDateToYmd(v)
  }
  const parsed = parseSalesDate(v)
  if (!parsed) return ''
  return formatYmd(parsed.year, parsed.month, parsed.day)
}

function headerNorm(cell) {
  return cellStr(cell).replace(/\s+/g, '').toLowerCase()
}

export const OWN_MALL_AIMWEB_UPLOAD_ERROR =
  '자사몰 주문·판매 엑셀(기본_양식)은 위 「일별 빅셀 업로드」가 아닙니다. 아래 「사본느리 자사몰 → ③ 판매내역 엑셀 업로드」를 사용하세요. 매출은 X열 품목 실결제가 기준입니다.'

/**
 * 아임웹 기본_양식 판매내역 여부 (일별 빅셀 업로드와 구분)
 * @param {string} [fileName]
 * @param {unknown[]} [headers]
 */
export function isOwnMallAimwebSalesFormat(fileName = '', headers = []) {
  if (/^기본[_\s-]?양식/i.test(String(fileName || '').trim())) return true
  const norms = (headers || []).map((h) => headerNorm(h)).filter(Boolean)
  if (!norms.length) return false
  const hasOrderStatus = norms.some((h) => /주문상태|orderstatus/.test(h))
  const hasItemNet = norms.some((h) => scoreItemNetPayHeader(h) >= 8)
  const hasProductCode = norms.some((h) => /상품고유|고유번호/.test(h))
  return hasOrderStatus && hasItemNet && hasProductCode
}

/** @param {string} h normalized header */
function scoreOrderNetSalesHeader(h) {
  if (!h) return 0
  if (/최종주문금액/.test(h)) return 10
  if (/최종결제금액/.test(h) && !/환불/.test(h)) return 8
  return 0
}

/** @param {string} h normalized header */
function scoreItemNetPayHeader(h) {
  if (!h) return 0
  if (/합계|총.*금액|배송비|할인/.test(h) && !/실결제/.test(h)) return 0
  if (/품목실결제가|품목실결제|품목별실결제/.test(h)) return 10
  if (/실결제가/.test(h) && !/최종|주문|배송/.test(h)) return 8
  return 0
}
/** @param {string} h normalized header — 주문단위 반복 열, 행 매출 합산에 사용하지 않음 */
function scoreLineTotalHeader(h) {
  return 0
}

/** @param {string} h normalized header */
function scoreSalePriceHeader(h) {
  if (!h || /합계|총|배송|할인/.test(h)) return 0
  if (/판매가|상품판매가|단가/.test(h)) return 3
  return 0
}

/** @param {string} h normalized header */
function scoreQuantityHeader(h) {
  if (!h || /금액|가격|합계/.test(h)) return 0
  if (/구매수량|^수량$|주문수량/.test(h)) return 3
  if (/qty|quantity/.test(h)) return 2
  return 0
}

/** 헤더 행에서 열 위치 자동 탐지 (기본_양식 등 시트마다 열이 달라도 대응) */
export function detectOwnMallSalesColumns(aoa) {
  for (let i = 0; i < Math.min(25, aoa?.length || 0); i++) {
    const row = aoa[i] || []
    /** @type {Record<string, number>} */
    const cols = { ...OWN_MALL_SALES_COL }
    let score = 0
    let lineTotalScore = 0
    let itemNetPayScore = 0
    let orderNetSalesScore = 0
    let salePriceScore = 0
    let quantityScore = 0

    for (let c = 0; c < row.length; c++) {
      const h = headerNorm(row[c])
      if (!h) continue
      if (/주문일|주문일시|결제일|결제완료일|orderdate/.test(h)) {
        cols.orderDate = c
        score += 2
      } else if (/^주문번호|orderno|orderid/.test(h)) {
        cols.orderNo = c
        score += 2
      } else if (/^주문상태|orderstatus/.test(h)) {
        cols.orderStatus = c
        score += 1
      } else if (/상품고유|고유번호|상품고유번호/.test(h) && !/옵션/.test(h)) {
        cols.productCode = c
        score += 2
      } else if (/^상품명|제품명|productname/.test(h)) {
        cols.productName = c
        score += 1
      } else if (/취소\s*사유|cancel\s*reason/i.test(h)) {
        cols.cancelReason = c
        score += 1
      } else {
        const inp = scoreItemNetPayHeader(h)
        if (inp > itemNetPayScore) {
          itemNetPayScore = inp
          cols.itemNetPay = c
          score += 2
        }
        const ons = scoreOrderNetSalesHeader(h)
        if (ons > orderNetSalesScore) {
          orderNetSalesScore = ons
          cols.orderNetSales = c
          score += 2
        }
        const lt = scoreLineTotalHeader(h)
        if (lt > lineTotalScore) {
          lineTotalScore = lt
          cols.lineTotal = c
        }
        const sp = scoreSalePriceHeader(h)
        if (sp > salePriceScore) {
          salePriceScore = sp
          cols.salePrice = c
          score += 1
        }
        const q = scoreQuantityHeader(h)
        if (q > quantityScore) {
          quantityScore = q
          cols.quantity = c
          score += 1
        }
      }
    }

    if (score >= 4 && cols.orderDate != null) {
      return { headerRowIndex: i, cols }
    }
  }
  return { headerRowIndex: -1, cols: OWN_MALL_SALES_COL }
}

function isSalesHeaderRow(row, cols) {
  const dateCell = cellStr(row[cols.orderDate])
  const nameCell = cellStr(row[cols.productName])
  const codeCell = cellStr(row[cols.productCode])
  if (/주문\s*일|order\s*date|결제\s*일/i.test(dateCell)) return true
  if (/상품\s*명|제품\s*명|product\s*name/i.test(nameCell)) return true
  if (/상품\s*고유|상품\s*번호|product\s*(code|id)|품번/i.test(codeCell)) return true
  const cancelCell = cellStr(row[cols.cancelReason])
  if (/취소\s*사유|cancel\s*reason/i.test(cancelCell)) return true
  return false
}

function hasCancelReason(row, cols) {
  const reason = cellStr(row[cols.cancelReason])
  if (!reason) return false
  if (/취소\s*사유|cancel\s*reason/i.test(reason)) return false
  return true
}

function unitSaleFromRow(row, cols) {
  const itemNet =
    cols.itemNetPay != null ? cellAmount(row[cols.itemNetPay]) : 0
  const qty = Math.max(1, Math.round(cellAmount(row[cols.quantity])))
  if (itemNet > 0) return Math.round(itemNet / qty)
  const unitPrice = cellAmount(row[cols.salePrice])
  if (unitPrice > 0) return Math.round(unitPrice)
  return 0
}

/**
 * =SUM(XLOOKUP(UNIQUE(FILTER(B,C="거래개시")),B,H)) — 주문별 H를 품목 행에 비례 배분
 * @param {Array<{ orderNo?: string, itemNet?: number, lineTotal?: number }>} rawRows
 */
export function allocateOwnMallOrderNetSales(rawRows) {
  /** @type {Map<string, typeof rawRows>} */
  const byOrder = new Map()

  for (const row of rawRows || []) {
    const key = row.orderNo || ''
    if (!key) continue
    if (!byOrder.has(key)) byOrder.set(key, [])
    byOrder.get(key).push(row)
  }

  for (const lines of byOrder.values()) {
    const orderTotal = Math.round(cellAmount(lines[0]?.orderNetSales))
    if (!(orderTotal > 0)) {
      for (const line of lines) {
        if (!(line.lineTotal > 0) && (line.itemNet || 0) > 0) {
          line.lineTotal = Math.round(line.itemNet)
        }
      }
      continue
    }

    const itemSum = lines.reduce((s, l) => s + (l.itemNet > 0 ? l.itemNet : 0), 0)
    if (itemSum > 0) {
      let allocated = 0
      for (let i = 0; i < lines.length; i++) {
        if (i === lines.length - 1) {
          lines[i].lineTotal = orderTotal - allocated
        } else {
          const share = Math.round((orderTotal * lines[i].itemNet) / itemSum)
          lines[i].lineTotal = share
          allocated += share
        }
      }
    } else {
      const per = Math.round(orderTotal / lines.length)
      let allocated = 0
      for (let i = 0; i < lines.length; i++) {
        if (i === lines.length - 1) {
          lines[i].lineTotal = orderTotal - allocated
        } else {
          lines[i].lineTotal = per
          allocated += per
        }
      }
    }
  }
}

/**
 * 행별 매출 — X열 품목 실결제가 (총 품목 합계·H열 주문금액 배분 사용 안 함)
 * @param {unknown[]} row
 * @param {typeof OWN_MALL_SALES_COL} cols
 */
export function resolveOwnMallRowSalesAmount(row, cols) {
  const itemNet = cols.itemNetPay != null ? cellAmount(row[cols.itemNetPay]) : 0
  if (itemNet > 0) return Math.round(itemNet)

  const qty = Math.max(1, Math.round(cellAmount(row[cols.quantity])))
  const unitPrice = cellAmount(row[cols.salePrice])
  const fromUnit = unitPrice > 0 ? Math.round(unitPrice * qty) : 0
  return fromUnit > 0 ? fromUnit : 0
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 * @param {string} productCode
 * @param {string} productName
 */
export function findOwnMallProductForSale(products, productCode, productName) {
  const codeKey = normalizeKey(productCode)
  const nameKey = normalizeKey(productName)

  if (codeKey) {
    const byCode = (products || []).find((p) => normalizeKey(p.productCode) === codeKey)
    if (byCode) return byCode
  }
  if (nameKey) {
    const byName = (products || []).find((p) => normalizeKey(p.name) === nameKey)
    if (byName) return byName
  }
  return null
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallProduct} product
 * @param {number} unitSaleFromExcel
 */
export function resolveOwnMallSaleOptionPrice(product, unitSaleFromExcel) {
  const catalogSale = cellAmount(product?.salePrice)
  const unit = unitSaleFromExcel > 0 ? unitSaleFromExcel : catalogSale
  if (unit <= 0) return { optionPrice: 0, fillCatalogSalePrice: 0 }
  if (catalogSale <= 0) {
    return { optionPrice: 0, fillCatalogSalePrice: unit }
  }
  return { optionPrice: Math.round(unit - catalogSale), fillCatalogSalePrice: 0 }
}

/**
 * @param {unknown[][]} aoa
 * @param {{ headerRowIndex?: number, cols?: typeof OWN_MALL_SALES_COL }} [layout]
 */
export function parseOwnMallSalesFromAoa(aoa, layout) {
  const detected = layout?.cols ? layout : detectOwnMallSalesColumns(aoa)
  const cols = detected.cols || OWN_MALL_SALES_COL
  const startRow = detected.headerRowIndex >= 0 ? detected.headerRowIndex + 1 : 0

  const rawRows = []
  let skippedEmpty = 0
  let skippedNoDate = 0
  let skippedZeroQty = 0
  let skippedCanceled = 0
  let skippedOrderStatus = 0

  for (let ri = startRow; ri < (aoa || []).length; ri++) {
    const row = aoa[ri]
    if (!row?.length) continue
    if (row.every((c) => cellStr(c) === '')) continue
    if (isSalesHeaderRow(row, cols)) continue

    const orderStatus = cols.orderStatus != null ? cellStr(row[cols.orderStatus]) : ''
    if (
      orderStatus &&
      orderStatus !== OWN_MALL_SALES_ORDER_STATUS &&
      !/주문\s*상태|order\s*status/i.test(orderStatus)
    ) {
      skippedOrderStatus += 1
      continue
    }

    if (hasCancelReason(row, cols)) {
      skippedCanceled += 1
      continue
    }

    const orderNo = cols.orderNo != null ? cellStr(row[cols.orderNo]) : ''
    const orderNetSales =
      cols.orderNetSales != null ? cellAmount(row[cols.orderNetSales]) : 0
    const itemNet = cols.itemNetPay != null ? cellAmount(row[cols.itemNetPay]) : 0

    const productCode = cellStr(row[cols.productCode])
    const productName = cellStr(row[cols.productName])
    const date = parseOrderDateYmd(row[cols.orderDate])
    const quantity = Math.max(0, Math.round(cellAmount(row[cols.quantity])))

    if (!productCode && !productName) {
      skippedEmpty += 1
      continue
    }
    if (!date) {
      skippedNoDate += 1
      continue
    }
    if (!(quantity > 0)) {
      skippedZeroQty += 1
      continue
    }

    rawRows.push({
      date,
      orderNo,
      orderNetSales,
      itemNet,
      productCode,
      productName,
      quantity,
      unitSale: unitSaleFromRow(row, cols),
      lineTotal: itemNet > 0 ? Math.round(itemNet) : 0,
    })
  }

  return {
    rawRows,
    skippedEmpty,
    skippedNoDate,
    skippedZeroQty,
    skippedCanceled,
    skippedOrderStatus,
    cols,
    headerRowIndex: detected.headerRowIndex,
  }
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 * @param {ReturnType<typeof parseOwnMallSalesFromAoa>['rawRows']} rawRows
 */
export function resolveOwnMallSalesImport(products, rawRows) {
  const sales = []
  let skippedUnmatched = 0
  let filledCatalogPrice = 0

  for (const row of rawRows || []) {
    const product = findOwnMallProductForSale(products, row.productCode, row.productName)
    if (!product) {
      skippedUnmatched += 1
      continue
    }

    const { optionPrice, fillCatalogSalePrice } = resolveOwnMallSaleOptionPrice(
      product,
      row.unitSale,
    )
    if (fillCatalogSalePrice > 0 && cellAmount(product.salePrice) <= 0) {
      product.salePrice = String(fillCatalogSalePrice)
      filledCatalogPrice += 1
    }

    const entry = createOwnMallSaleEntry(row.date)
    entry.productId = product.id
    entry.quantity = String(row.quantity)
    entry.optionPrice = optionPrice !== 0 ? String(optionPrice) : ''
    const pay =
      row.itemNet > 0 ? Math.round(row.itemNet) : Math.round(row.lineTotal || 0)
    if (pay > 0) entry.lineTotal = String(pay)
    sales.push(entry)
  }

  return { sales, skippedUnmatched, filledCatalogPrice }
}

function summarizeSaleDates(sales) {
  const dates = [...new Set((sales || []).map((s) => s.date).filter(Boolean))].sort()
  if (!dates.length) return ''
  if (dates.length === 1) return dates[0]
  return `${dates[0]} ~ ${dates[dates.length - 1]}`
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 * @param {unknown[][]} aoa
 */
export function buildOwnMallSalesImport(products, aoa) {
  const layout = detectOwnMallSalesColumns(aoa)
  const parsed = parseOwnMallSalesFromAoa(aoa, layout)
  const resolved = resolveOwnMallSalesImport(products, parsed.rawRows)
  const dateRange = summarizeSaleDates(resolved.sales)
  return { ...parsed, ...resolved, dateRange }
}

/**
 * @param {File} file
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 */
/**
 * @param {ArrayBuffer} buffer
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 * @param {string} [fileName]
 */
export async function parseOwnMallSalesFromArrayBuffer(buffer, products = [], fileName = '') {
  const XLSX = await loadXlsx()
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
  const result = buildOwnMallSalesImport(products, aoa)
  return { ...result, fileName, sheetName }
}

export async function parseOwnMallSalesExcelFile(file, products = []) {
  const buffer = await file.arrayBuffer()
  return parseOwnMallSalesFromArrayBuffer(buffer, products, file.name)
}

/** @param {{ sales?: unknown[], skippedUnmatched?: number, skippedNoDate?: number, skippedEmpty?: number, skippedZeroQty?: number, skippedCanceled?: number, filledCatalogPrice?: number, dateRange?: string }} parsed */
export function formatOwnMallSalesImportMessage(parsed, sourceLabel = '') {
  const n = parsed.sales?.length || 0
  const prefix = sourceLabel ? `「${sourceLabel}」` : ''
  if (!n) {
    const hints = []
    if ((parsed.skippedUnmatched || 0) > 0) {
      hints.push(`상품 미매칭 ${parsed.skippedUnmatched}건`)
    }
    if ((parsed.skippedNoDate || 0) > 0) {
      hints.push(`주문일(AK열) 인식 실패 ${parsed.skippedNoDate}건`)
    }
    if ((parsed.skippedCanceled || 0) > 0) {
      hints.push(`취소사유(AG열) ${parsed.skippedCanceled}건`)
    }
    if ((parsed.skippedOrderStatus || 0) > 0) {
      hints.push(`주문상태 ${OWN_MALL_SALES_ORDER_STATUS} 외 ${parsed.skippedOrderStatus}건`)
    }
    if ((parsed.skippedZeroQty || 0) > 0) hints.push(`수량 0 ${parsed.skippedZeroQty}건`)
    const detail = hints.length ? ` (${hints.join(', ')})` : ''
    return {
      ok: false,
      message: `${prefix}반영할 판매 행이 없습니다.${detail} ① 상품 카탈로그 등록 후 AL·R열과 매칭되는지 확인하세요. 파일명은 주문일이 아닙니다.`,
    }
  }
  const parts = [`${prefix}${n}건 판매를 반영했습니다`]
  if (parsed.dateRange) parts.push(`주문일 ${parsed.dateRange}`)
  if ((parsed.skippedUnmatched || 0) > 0) {
    parts.push(`상품 미매칭 ${parsed.skippedUnmatched}건 제외`)
  }
  if ((parsed.skippedNoDate || 0) > 0) parts.push(`주문일 없음 ${parsed.skippedNoDate}건 제외`)
  if ((parsed.skippedOrderStatus || 0) > 0) {
    parts.push(`주문상태 ${OWN_MALL_SALES_ORDER_STATUS} 외 ${parsed.skippedOrderStatus}건 제외`)
  }
  if ((parsed.skippedCanceled || 0) > 0) {
    parts.push(`취소사유(AG열) ${parsed.skippedCanceled}건 매출 제외`)
  }
  if ((parsed.skippedZeroQty || 0) > 0) parts.push(`수량 0 ${parsed.skippedZeroQty}건 제외`)
  if ((parsed.skippedEmpty || 0) > 0) parts.push(`빈 행 ${parsed.skippedEmpty}건 제외`)
  if ((parsed.filledCatalogPrice || 0) > 0) {
    parts.push(`판매가 미입력 상품 ${parsed.filledCatalogPrice}건에 엑셀 판매가 반영`)
  }
  parts.push('서버 저장 후 대시보드에 반영됩니다.')
  return { ok: true, message: parts.join(' · ') }
}
