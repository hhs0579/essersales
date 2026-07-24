import {
  cleanHeaderText,
  detectPlatformFromFileName,
  normalizePlatformLabel,
  resolvePlatformForEsserRow,
  resolveRecordPlatform,
} from './platformDetect.js'
import { isPowerPriceRecord, POWER_PRICE_DATA_SOURCE_LABEL } from '../config/powerPrice.js'
import { isCoupang1pRocketRecord, COUPANG_1P_SALES_METHOD } from '../config/coupang1pRocket.js'
import { isOwnMallRecord } from '../config/ownMall.js'

/** 쿠팡 빅셀 파일명 */
export const COUPANG_SALES_METHODS = ['로켓그로스', '판매자배송', COUPANG_1P_SALES_METHOD]

/** 스마트스토어(네이버) 빅셀 — 판매방식 열·파일명 */
export const SMARTSTORE_SALES_METHODS = ['일반배송', 'N배송']

/** 엑셀 헤더명이 배송구분·판매방식 열인지 */
export function isDeliveryMethodHeaderKey(headerKey) {
  const kn = cleanHeaderText(headerKey).replace(/\s/g, '').toLowerCase()
  if (!kn) return false
  return (
    kn === '배송구분' ||
    kn.includes('배송구분') ||
    /판매방식|배송방식|배송유형|배송형태|배송타입|주문배송|상품배송|물류방식/i.test(kn)
  )
}

/** 빅셀 원본 행(한글 헤더 키)에서 배송구분·판매방식 셀 추출 */
export function extractDeliveryFromRawRow(row) {
  if (!row || typeof row !== 'object') return ''
  for (const [key, val] of Object.entries(row)) {
    const v = String(val ?? '').trim()
    if (!v) continue
    if (isDeliveryMethodHeaderKey(key)) return v
  }
  return scanDeliveryLabelInValues(Object.values(row))
}

/** 행·열 셀 값 중 일반배송 / N배송 텍스트 탐색 (N배송 우선) */
export function scanDeliveryLabelInValues(values) {
  let general = ''
  for (const val of values || []) {
    const v = String(val ?? '').trim()
    if (!v) continue
    const m = detectSalesMethodFromDeliveryField(v)
    if (m === 'N배송') return v
    if (m === '일반배송' && !general) general = v
  }
  return general
}

export function detectSalesMethodFromFileName(fileName) {
  const n = String(fileName || '')
    .toLowerCase()
    .replace(/\s/g, '')

  if (
    n.includes('로켓그로스') ||
    n.includes('rocketgrowth') ||
    n.includes('rocket_growth')
  ) {
    return '로켓그로스'
  }
  if (
    n.includes('판매자배송') ||
    n.includes('sellerdelivery') ||
    n.includes('seller_delivery')
  ) {
    return '판매자배송'
  }

  if (n.includes('n배송') || n.includes('n배송') || n.includes('n_delivery')) {
    return 'N배송'
  }
  if (n.includes('일반배송') || n.includes('일반')) {
    return '일반배송'
  }

  return ''
}

/** 전각·특수문자 정리 후 비교용 */
function normDeliveryText(value) {
  return String(value ?? '')
    .trim()
    .replace(/[Ｎｎ]/g, 'N')
    .replace(/\s/g, '')
    .toLowerCase()
}

/** 엑셀 판매방식·배송구분·배송방식 셀 → 일반배송 / N배송 / 쿠팡 판매방식 */
export function detectSalesMethodFromDeliveryField(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const n = normDeliveryText(raw)

  if (
    n === 'n배송' ||
    n.includes('n배송') ||
    n.includes('n도착') ||
    n.includes('ndelivery') ||
    n.includes('n_delivery') ||
    n.includes('도착보장') ||
    n.includes('새벽배송') ||
    n.includes('내일배송') ||
    n.includes('희망일배송') ||
    n.includes('n희망') ||
    n.includes('네이버n')
  ) {
    return 'N배송'
  }

  if (
    n.includes('일반배송') ||
    n === '일반' ||
    n.includes('일반택배') ||
    n === '택배' ||
    n.includes('택배배송') ||
    n.includes('일반') ||
    n.includes('오늘출발') ||
    n.includes('판매자') ||
    (n.includes('일반') && !/^n/.test(n))
  ) {
    return '일반배송'
  }

  if (COUPANG_SALES_METHODS.includes(raw)) return raw

  return ''
}

/** 스마트스토어 배송구분 값인지 (일반배송 / N배송) */
export function isSmartstoreDeliveryLabel(value) {
  const m = detectSalesMethodFromDeliveryField(value)
  return m === '일반배송' || m === 'N배송'
}

/**
 * 빅셀 AOA — 배송구분 열 인덱스 (헤더명 또는 F열 등 값 패턴)
 * @param {unknown[]} headerRow
 * @param {unknown[][]} dataRows
 */
export function findDeliveryColumnIndexInAoa(headerRow, dataRows) {
  const headers = (headerRow || []).map((h) => cleanHeaderText(h))
  for (let col = 0; col < headers.length; col += 1) {
    const hn = headers[col].replace(/\s/g, '')
    if (!hn) continue
    if (/배송구분|판매방식|배송방식|배송유형|배송형태/i.test(hn)) return col
  }

  let bestCol = -1
  let bestScore = 0
  const sample = (dataRows || []).slice(0, 500)
  for (let col = 0; col < headers.length; col += 1) {
    let nHits = 0
    let gHits = 0
    for (const row of sample) {
      const v = cleanHeaderText(row?.[col])
      if (!v) continue
      const m = detectSalesMethodFromDeliveryField(v)
      if (m === 'N배송') nHits += 1
      else if (m === '일반배송') gHits += 1
    }
    const hits = nHits + gHits
    if (hits < 1) continue
    const score = hits + (nHits > 0 && gHits > 0 ? 25 : 0) + (nHits > 0 ? 8 : 0)
    if (score > bestScore) {
      bestScore = score
      bestCol = col
    }
  }

  if (bestCol < 0) {
    const fCol = 5
    const fHits = sample.filter((row) =>
      isSmartstoreDeliveryLabel(cleanHeaderText(row?.[fCol])),
    ).length
    if (fHits >= 1) bestCol = fCol
  }

  return bestCol
}

/** 병합셀·빈 칸 보정용 — 배송구분 열에 표준 라벨 기록 */
export function normalizeDeliveryLabel(value) {
  const m = detectSalesMethodFromDeliveryField(value)
  if (m === 'N배송' || m === '일반배송') return m
  return String(value ?? '').trim()
}

function uniqueDeliveryTexts(...parts) {
  const out = []
  const seen = new Set()
  for (const part of parts) {
    const text = String(part ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/** 스마트스토어 — 여러 셀 값 중 N배송 우선 */
export function pickSmartstoreSalesMethodFromTexts(...parts) {
  const list = uniqueDeliveryTexts(...parts)
  for (const text of list) {
    if (detectSalesMethodFromDeliveryField(text) === 'N배송') return 'N배송'
  }
  for (const text of list) {
    const m = detectSalesMethodFromDeliveryField(text)
    if (m) return m
  }
  return ''
}

/**
 * 빅셀 행 — 배송구분·판매방식 열을 모두 보고 N배송 우선 (한 열만 읽으면 일반배송으로 묶이는 문제 방지)
 * @param {Record<string, unknown>} row
 * @param {Record<string, string>} lookup
 * @param {{ lastDeliveryMethod?: string }} [carry]
 */
export function resolveDeliveryMethodForBiggerRow(row, lookup, carry = null) {
  const headers = []
  const seen = new Set()
  for (const h of [
    lookup?.['배송구분'],
    lookup?.['판매방식'],
    lookup?.__delivery_header__,
  ]) {
    if (h && !seen.has(h)) {
      seen.add(h)
      headers.push(h)
    }
  }

  const values = []
  for (const header of headers) {
    const v = row?.[header]
    if (v == null || String(v).trim() === '') continue
    values.push(String(v).trim())
  }

  const fromScan = extractDeliveryFromRawRow(row)
  if (fromScan) values.push(fromScan)

  const fromAnyCell = scanDeliveryLabelInValues(Object.values(row || {}))
  if (fromAnyCell) values.push(fromAnyCell)

  for (const text of values) {
    if (detectSalesMethodFromDeliveryField(text) === 'N배송') return text
  }
  for (const text of values) {
    if (detectSalesMethodFromDeliveryField(text) === '일반배송') return text
  }
  for (const text of values) {
    const m = detectSalesMethodFromDeliveryField(text)
    if (COUPANG_SALES_METHODS.includes(m)) return text
  }
  if (values.length) return values[0]

  const carried = carry?.lastDeliveryMethod ? String(carry.lastDeliveryMethod).trim() : ''
  return carried
}

/** 플랫폼별 표준 판매방식 (쿠팡: 로켓·판매자 / 스마트스토어: 일반·N) */
export function normalizeSalesMethod(platform = '', salesMethod = '', deliveryMethod = '') {
  const p = normalizePlatformLabel(platform)
  let raw = String(salesMethod || '').trim()
  if (!raw) raw = detectSalesMethodFromDeliveryField(deliveryMethod)

  if (p === '스마트스토어') {
    return (
      pickSmartstoreSalesMethodFromTexts(deliveryMethod, raw, salesMethod) ||
      pickSmartstoreSalesMethodFromTexts(raw, deliveryMethod) ||
      ''
    )
  }

  if (p === '쿠팡') {
    if (COUPANG_SALES_METHODS.includes(raw)) return raw
    const fromDel = detectSalesMethodFromDeliveryField(deliveryMethod)
    if (COUPANG_SALES_METHODS.includes(fromDel)) return fromDel
    return COUPANG_SALES_METHODS.includes(raw) ? raw : ''
  }

  const smart = pickSmartstoreSalesMethodFromTexts(deliveryMethod, raw, salesMethod)
  if (smart) return smart

  return raw
}

/** 파싱·저장 직후: 병합셀 배송방식 반영, 플랫폼별 판매방식 정규화 */
export function applySalesMethodsToDetails(details, fileName = '') {
  const filePlatform = detectPlatformFromFileName(fileName)
  let lastDelivery = ''

  for (const d of details || []) {
    delete d.channelKind
    delete d.channel_kind

    const platform = normalizePlatformLabel(
      d.platform || d.channel || filePlatform || '',
    )

    const texts = uniqueDeliveryTexts(
      d.deliveryMethod,
      d.delivery_method,
      d['배송구분'],
      d.salesMethod,
    )
    let delivery =
      texts.find((t) => detectSalesMethodFromDeliveryField(t) === 'N배송') ||
      texts.find((t) => detectSalesMethodFromDeliveryField(t)) ||
      texts[0] ||
      ''
    if (!delivery && lastDelivery) delivery = lastDelivery
    if (delivery) {
      d.deliveryMethod = delivery
      d['배송구분'] = delivery
      lastDelivery = delivery
    }

    const method = normalizeSalesMethod(platform, d.salesMethod, delivery || lastDelivery)
    if (method) d.salesMethod = method
  }

  return inferUploadSalesMethodFromDetails(details, fileName, '')
}

/** 빅셀 행 + 파일명 → 판매방식 */
export function resolveSalesMethodForEsserRow(mapped, fileName, fileFallback = '', platform = '') {
  const p = normalizePlatformLabel(
    platform || resolvePlatformForEsserRow(mapped, '', fileName),
  )

  const fromField = detectSalesMethodFromDeliveryField(mapped?.delivery_method)
  const fromFile = detectSalesMethodFromFileName(fileName)
  const normalized = normalizeSalesMethod(
    p,
    fromField || fromFile || fileFallback,
    mapped?.delivery_method,
  )
  if (normalized) return normalized

  if (fileFallback) {
    return normalizeSalesMethod(p, fileFallback, mapped?.delivery_method) || ''
  }
  return ''
}

export function inferUploadSalesMethodFromDetails(details, fileName, fallback = '') {
  const filePlatform = detectPlatformFromFileName(fileName)
  const counts = new Map()
  for (const row of details || []) {
    if (row?.isEsserSheetTotal) continue
    const m = normalizeSalesMethod(
      row?.platform || row?.channel || filePlatform,
      row?.salesMethod,
      row?.deliveryMethod || row?.delivery_method,
    )
    if (!m) continue
    counts.set(m, (counts.get(m) || 0) + 1)
  }
  let best = ''
  let max = 0
  for (const [m, n] of counts) {
    if (n > max) {
      max = n
      best = m
    }
  }
  if (best) return best
  return detectSalesMethodFromFileName(fileName) || fallback || ''
}

export function getSalesMethod(row) {
  const platform = normalizePlatformLabel(row?.platform || row?.channel || '')
  const texts = uniqueDeliveryTexts(
    row?.deliveryMethod,
    row?.delivery_method,
    row?.['배송구분'],
    row?.salesMethod,
  )

  const fromDelivery = pickSmartstoreSalesMethodFromTexts(...texts)
  if (fromDelivery) return fromDelivery

  const delivery = texts[0] || ''
  const direct = String(row?.salesMethod || '').trim()
  const normalized = normalizeSalesMethod(platform, direct, delivery)
  if (normalized) return normalized

  const fromFile = detectSalesMethodFromFileName(row?.sourceFileName || '')
  if (fromFile) {
    return normalizeSalesMethod(
      platform || detectPlatformFromFileName(row?.sourceFileName),
      fromFile,
      delivery,
    )
  }
  return ''
}

/** 자사몰 — 판매방식 표 단일 행 라벨 */
export const OWN_MALL_SALES_METHOD_LABEL = '자사몰'

/** '스마트스토어 일반배송' → '일반배송' (원가 역산·필터용) */
export function baseSalesMethodFromGroupLabel(label) {
  const s = String(label || '').trim()
  if (!s) return ''
  if (s === POWER_PRICE_DATA_SOURCE_LABEL) return s
  if (s === COUPANG_1P_SALES_METHOD) return s
  if (s === OWN_MALL_SALES_METHOD_LABEL) return s
  for (const m of [...SMARTSTORE_SALES_METHODS, ...COUPANG_SALES_METHODS]) {
    if (s === m) return m
    if (s.endsWith(` ${m}`)) return m
  }
  return s
}

/**
 * 판매방식별 손익·집계표 라벨 — 플랫폼 + 판매방식
 * 예) 스마트스토어 일반배송, 쿠팡 로켓그로스, 쿠팡 판매자배송, 스마트스토어 N배송, 자사몰
 */
export function salesMethodGroupLabel(row) {
  if (isPowerPriceRecord(row)) return POWER_PRICE_DATA_SOURCE_LABEL
  if (isCoupang1pRocketRecord(row)) return `쿠팡 ${COUPANG_1P_SALES_METHOD}`
  const platform = normalizePlatformLabel(
    resolveRecordPlatform(row) || row?.platform || row?.channel || '',
  )
  if (platform === OWN_MALL_SALES_METHOD_LABEL || isOwnMallRecord(row)) {
    return OWN_MALL_SALES_METHOD_LABEL
  }
  const method = getSalesMethod(row)
  if (!method) return ''
  if (platform && platform !== '미지정' && platform !== '미분류') {
    return `${platform} ${method}`
  }
  return method
}
