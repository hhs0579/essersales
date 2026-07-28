/** 특판 폐쇄몰 · 기타 판매처 (에쎄르 / 베스트하임) */

export const OTHER_SELLERS_SCOPE = 'other_sellers'
export const OTHER_SELLERS_CHANNEL_ID = 'channel_e'
export const OTHER_SELLERS_BRAND_LABEL = '기타 판매처'

export const CLOSED_MALL_PLATFORM = '특판 폐쇄몰'
export const CLOSED_MALL_SALES_METHOD = '특판 폐쇄몰'
export const CLOSED_MALL_BUSINESS_LINE = '영업(온라인)'

/** @typedef {'bestheim'|'esser'} ClosedMallBrandKey */

/**
 * @typedef {Object} ClosedMallBrandDef
 * @property {ClosedMallBrandKey} key
 * @property {string} tabLabel
 * @property {string} dataSourceLabel
 * @property {string} uploadKind
 * @property {string} uploadFormat
 */

/** @type {ClosedMallBrandDef[]} */
export const CLOSED_MALL_BRANDS = [
  {
    key: 'esser',
    tabLabel: '에쎄르',
    dataSourceLabel: '에쎄르',
    uploadKind: 'esser_closed_mall',
    uploadFormat: 'ESSER_CLOSED_MALL',
  },
  {
    key: 'bestheim',
    tabLabel: '베스트하임',
    dataSourceLabel: '베스트하임',
    uploadKind: 'bestheim_closed_mall',
    uploadFormat: 'BESTHEIM_CLOSED_MALL',
  },
]

export const CLOSED_MALL_UPLOAD_KINDS = CLOSED_MALL_BRANDS.map((b) => b.uploadKind)

/** 원본 엑셀 헤더 (앞에 a 포함) — a판매처 = 특판 판매처명 */
export const CLOSED_MALL_REQUIRED_HEADERS = [
  'a날짜',
  'a판매처',
  'a상품명',
  'a수량',
  'a결제가',
  'a배송비',
  'a수수료',
  'a원가',
]

/** 있으면 행에 반영 (없으면 빈값) */
export const CLOSED_MALL_OPTIONAL_HEADERS = ['a옵션', 'a브랜드']

/** 미리보기·안내용 전체 헤더 */
export const CLOSED_MALL_ALL_HEADERS = [
  ...CLOSED_MALL_REQUIRED_HEADERS.slice(0, 3),
  'a옵션',
  'a브랜드',
  ...CLOSED_MALL_REQUIRED_HEADERS.slice(3),
]

/** @deprecated use CLOSED_MALL_* */
export const BESTHEIM_CLOSED_MALL_UPLOAD_KIND = 'bestheim_closed_mall'
export const BESTHEIM_CLOSED_MALL_UPLOAD_FORMAT = 'BESTHEIM_CLOSED_MALL'
export const BESTHEIM_CLOSED_MALL_PLATFORM = CLOSED_MALL_PLATFORM
export const BESTHEIM_CLOSED_MALL_SALES_METHOD = CLOSED_MALL_SALES_METHOD
export const BESTHEIM_CLOSED_MALL_DATA_SOURCE = '베스트하임'
export const BESTHEIM_CLOSED_MALL_BUSINESS_LINE = CLOSED_MALL_BUSINESS_LINE
export const BESTHEIM_CLOSED_MALL_REQUIRED_HEADERS = CLOSED_MALL_REQUIRED_HEADERS

/** @param {ClosedMallBrandKey|string} key */
export function getClosedMallBrand(key) {
  return CLOSED_MALL_BRANDS.find((b) => b.key === key || b.uploadKind === key) || null
}

/** @param {string} uploadKind */
export function closedMallBrandFromUploadKind(uploadKind) {
  return CLOSED_MALL_BRANDS.find((b) => b.uploadKind === uploadKind) || null
}

/**
 * 판매처 정규화 — 공백·단순 띄어쓰기 무시 (중복 지문용)
 * @param {unknown} raw
 */
export function normalizeClosedMallSeller(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * KPI·전일대비 행 라벨: 브랜드(판매처)
 * @param {string} brandLabel 에쎄르 | 베스트하임
 * @param {unknown} seller
 */
export function formatClosedMallKpiLabel(brandLabel, seller) {
  const brand = String(brandLabel || '').trim() || '특판'
  const name = String(seller ?? '').trim() || '특판'
  return `${brand}(${name})`
}

/** 레거시 공백 포맷 `베스트하임 (x)` 및 신규 `브랜드(x)` */
export function isClosedMallKpiLabel(label) {
  const s = String(label ?? '').trim()
  if (s === '특판 폐쇄몰' || s === '베스트하임(특판 폐쇄몰)') return true
  if (/^베스트하임 \(.+\)$/.test(s)) return true
  return /^(에쎄르|베스트하임)\(.+\)$/.test(s)
}

/** 라벨에서 판매처명 추출 */
export function closedMallSellerFromKpiLabel(label) {
  const s = String(label ?? '').trim()
  const spaced = s.match(/^베스트하임 \((.+)\)$/)
  if (spaced) return spaced[1].trim()
  const m = s.match(/^(?:에쎄르|베스트하임)\((.+)\)$/)
  return m ? m[1].trim() : ''
}

/** 라벨에서 브랜드(에쎄르|베스트하임) 추출 */
export function closedMallBrandFromKpiLabel(label) {
  const s = String(label ?? '').trim()
  if (/^베스트하임 \(.+\)$/.test(s) || /^베스트하임\(.+\)$/.test(s)) return '베스트하임'
  if (/^에쎄르\(.+\)$/.test(s)) return '에쎄르'
  return ''
}

/** @param {object} row */
export function isClosedMallRecord(row) {
  if (!row) return false
  const kind = String(row.uploadKind || row.upload_kind || '').trim()
  if (CLOSED_MALL_UPLOAD_KINDS.includes(kind)) return true
  const format = String(row.uploadFormat || row.upload_format || '').trim()
  if (format === 'BESTHEIM_CLOSED_MALL' || format === 'ESSER_CLOSED_MALL') return true
  const platform = String(row.platform || row.channel || '').trim()
  return platform === CLOSED_MALL_PLATFORM
}

/** @param {object} row @returns {'에쎄르'|'베스트하임'|''} */
export function resolveClosedMallBrand(row) {
  if (!row) return ''
  const kind = String(row.uploadKind || row.upload_kind || '').trim()
  const fromKind = closedMallBrandFromUploadKind(kind)
  if (fromKind) return fromKind.dataSourceLabel

  const format = String(row.uploadFormat || row.upload_format || '').trim()
  if (format === 'ESSER_CLOSED_MALL') return '에쎄르'
  if (format === 'BESTHEIM_CLOSED_MALL') return '베스트하임'

  const tagged = String(row.dataSourceLabel || '').trim()
  if (tagged === '에쎄르' || tagged === '베스트하임') {
    if (isClosedMallRecord(row) || String(row.platform || '').trim() === CLOSED_MALL_PLATFORM) {
      return tagged
    }
  }
  if (isClosedMallRecord(row)) return '베스트하임'
  return ''
}

/** 레코드에서 특판 판매처명 */
export function resolveClosedMallSeller(row) {
  if (!row) return ''
  return String(
    row.storeName ||
      row.store_name ||
      row.closedMallSeller ||
      row.seller ||
      '',
  ).trim()
}

/** 합계·총합계 행 */
export function isClosedMallSummaryLabel(raw) {
  const n = String(raw ?? '')
    .replace(/\s+/g, '')
    .trim()
  if (!n) return false
  return /^(합계|소계|총계|총합계|전체|총합|합|total|sum|subtotal)$/i.test(n)
}

/**
 * 행 지문 (참고용 — 업로드 시 중복 제외에는 사용하지 않음)
 */
export function closedMallDuplicateFingerprint(row) {
  return [
    row.dateYmd || '',
    normalizeClosedMallSeller(row.seller),
    String(row.productName || '').trim(),
    String(row.qty ?? ''),
    String(row.payment ?? ''),
    String(row.shippingFee ?? ''),
    String(row.commission ?? ''),
    String(row.unitCost ?? ''),
  ].join('|')
}

export function isOtherSellersScope(scope) {
  return scope === OTHER_SELLERS_SCOPE
}
