import { applySalesMethodsToDetails } from './salesMethodDetect.js'

/** 집계·필터에 쓰는 플랫폼 값 */
export const MARKETPLACE_PLATFORMS = ['쿠팡', '스마트스토어', '네이버', '자사몰', '특판 폐쇄몰']

/** UI·구데이터 호환: 네이버 선택 → 스마트스토어 */
export function normalizePlatformLabel(platform) {
  const p = String(platform ?? '').trim()
  if (p === '네이버') return '스마트스토어'
  return p
}

export function cleanHeaderText(s) {
  return String(s ?? '')
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, ' ')
}

/** 헤더명이 채널종류 열인지 */
export function isChannelKindHeaderKey(headerKey) {
  const n = cleanHeaderText(headerKey).replace(/\s/g, '').toLowerCase()
  if (!n) return false
  if (/채널종류|채널구분|channeltype|channelkind|몰구분|판매채널종류/i.test(n)) {
    return true
  }
  if (n.includes('채널') && n.includes('종류')) return true
  return n === '채널' || n === 'channel'
}

/** 빅셀 「채널종류」 셀 값 → 플랫폼 */
export function detectPlatformFromChannelKind(channelKind) {
  const raw = String(channelKind ?? '').trim()
  if (!raw) return ''

  const n = raw.toLowerCase().replace(/\s/g, '')

  if (
    n === '스마트스토어' ||
    n === 'smartstore' ||
    n === '네이버' ||
    n === 'naver' ||
    n === '스토어팜' ||
    n.includes('스마트스토어') ||
    n.includes('smartstore') ||
    n.includes('네이버') ||
    n.includes('naver')
  ) {
    return '스마트스토어'
  }

  if (
    n === '쿠팡' ||
    n === 'coupang' ||
    n.includes('쿠팡') ||
    n.includes('coupang') ||
    n.includes('로켓그로스') ||
    n.includes('로켓') ||
    n.includes('판매자배송')
  ) {
    return '쿠팡'
  }

  if (n.includes('자사몰') || n.includes('자체몰') || n.includes('ownmall')) {
    return '자사몰'
  }

  return ''
}

/**
 * 매핑 실패 대비: 행의 모든 셀·헤더에서 채널종류(스마트스토어 등) 추출
 */
export function extractChannelKindFromRawRow(rawRow) {
  if (!rawRow || typeof rawRow !== 'object') return ''

  for (const [key, val] of Object.entries(rawRow)) {
    const v = String(val ?? '').trim()
    if (!v) continue
    if (isChannelKindHeaderKey(key)) return v
    if (detectPlatformFromChannelKind(v)) return v
  }

  for (const [key, val] of Object.entries(rawRow)) {
    const v = String(val ?? '').trim()
    if (v && detectPlatformFromChannelKind(v)) return v
  }

  return ''
}

/** 빅셀 매출분석 파일명 (쿠팡·네이버 공통) */
export function isBigsellerFileName(fileName) {
  const n = String(fileName || '')
    .toLowerCase()
    .replace(/\s/g, '')
  return (
    n.includes('빅셀') ||
    n.includes('bigseller') ||
    n.includes('매출분석') ||
    n.includes('esser') ||
    n.includes('에쎄르')
  )
}

export function detectPlatformFromFileName(fileName) {
  const n = String(fileName || '')
    .toLowerCase()
    .replace(/\s/g, '')

  if (
    n.includes('네이버') ||
    n.includes('naver') ||
    n.includes('스마트스토어') ||
    n.includes('smartstore')
  ) {
    return '스마트스토어'
  }
  if (
    n.includes('쿠팡') ||
    n.includes('coupang') ||
    n.includes('로켓그로스') ||
    n.includes('rocketgrowth') ||
    n.includes('판매자배송')
  ) {
    return '쿠팡'
  }
  if (n.includes('자사몰') || n.includes('ownmall') || n.includes('자체몰')) {
    return '자사몰'
  }
  return ''
}

export function resolvePlatformForEsserRow(mapped, fallbackPlatform = '', fileName = '') {
  const fromKind = detectPlatformFromChannelKind(mapped?.channel_kind)
  if (fromKind) return fromKind

  const store = String(mapped?.store_name || '').trim()
  if (store.length <= 24) {
    const fromStore = detectPlatformFromChannelKind(store)
    if (fromStore) return fromStore
  }

  const fromFile = detectPlatformFromFileName(fileName)
  if (fromFile) return fromFile

  const fb = normalizePlatformLabel(fallbackPlatform)
  if (fb && fb !== '쿠팡') return fb
  if (fb === '스마트스토어' || fb === '자사몰') return fb

  return '미지정'
}

/** 채널종류 기준 다수결 (platform 필드가 쿠팡으로 잘못 들어간 경우 대비) */
export function inferUploadPlatformFromDetails(details, fileName, fallbackPlatform = '') {
  const kindCounts = new Map()
  const platformCounts = new Map()

  for (const row of details || []) {
    if (row?.isEsserSheetTotal) continue

    const kind = row?.channelKind || row?.channel_kind || ''
    const fromKind = detectPlatformFromChannelKind(kind)
    if (fromKind) {
      kindCounts.set(fromKind, (kindCounts.get(fromKind) || 0) + 1)
    }

    const p = normalizePlatformLabel(row?.platform || '')
    if (p && p !== '미지정' && MARKETPLACE_PLATFORMS.includes(p)) {
      platformCounts.set(p, (platformCounts.get(p) || 0) + 1)
    }
  }

  const pickMax = (map) => {
    let best = ''
    let max = 0
    for (const [k, n] of map) {
      if (n > max) {
        max = n
        best = k
      }
    }
    return best
  }

  const fromFile = detectPlatformFromFileName(fileName)
  if (fromFile) return fromFile

  const fromKinds = pickMax(kindCounts)
  if (fromKinds) return fromKinds

  const fromPlatforms = pickMax(platformCounts)
  if (fromPlatforms) return fromPlatforms

  const fb = normalizePlatformLabel(fallbackPlatform)
  if (fb) return fb

  return '미지정'
}

export function resolveUploadPlatform(fileName, selectedPlatform = '', details = []) {
  const fromFile = detectPlatformFromFileName(fileName)
  if (fromFile) return fromFile

  const fromDetails = inferUploadPlatformFromDetails(
    details,
    fileName,
    selectedPlatform,
  )
  if (fromDetails && fromDetails !== '미지정') return fromDetails

  return normalizePlatformLabel(selectedPlatform) || '미지정'
}

/** 파싱 결과 저장 직전: 플랫폼·채널·판매방식 일괄 보정 */
export function finalizeParsedDailyUpload(parsed) {
  if (!parsed?.details?.length) return parsed

  const filePlatform = detectPlatformFromFileName(parsed.fileName)
  const fallback =
    filePlatform || normalizePlatformLabel(parsed.platform) || '미지정'

  applyPlatformsFromChannelKind(parsed.details, parsed.fileName, fallback)
  const platform = resolveUploadPlatform(
    parsed.fileName,
    fallback,
    parsed.details,
  )

  for (const d of parsed.details) {
    if (platform && platform !== '미지정') {
      d.platform = platform
      d.channel = platform
    }
  }

  const uploadSalesMethod = applySalesMethodsToDetails(parsed.details, parsed.fileName)

  return {
    ...parsed,
    platform,
    salesMethod: uploadSalesMethod || parsed.salesMethod || '',
  }
}

/** 파싱 직후: 채널종류·병합셀 반영해 모든 행 platform/channel 재설정 */
export function applyPlatformsFromChannelKind(details, fileName, fallbackPlatform = '') {
  let lastKind = ''

  for (const d of details || []) {
    if (d.channelKind) lastKind = d.channelKind
    else if (lastKind) d.channelKind = lastKind

    const fromKind = detectPlatformFromChannelKind(d.channelKind)
    if (fromKind) {
      d.platform = fromKind
      d.channel = fromKind
    }
  }

  const filePlatform = inferUploadPlatformFromDetails(
    details,
    fileName,
    fallbackPlatform,
  )

  for (const d of details || []) {
    const fromKind = detectPlatformFromChannelKind(d.channelKind)
    const p =
      fromKind ||
      (filePlatform && filePlatform !== '미지정' ? filePlatform : '') ||
      resolvePlatformForEsserRow(
        { channel_kind: d.channelKind },
        fallbackPlatform,
        fileName,
      )

    if (p && p !== '미지정') {
      d.platform = p
      d.channel = p
    }
  }

  return filePlatform
}

export function resolveRecordPlatform(row, uploadPlatform = '') {
  const fromKind = detectPlatformFromChannelKind(
    row?.channelKind || row?.channel_kind || row?.channelType || row?.channel_type,
  )
  if (fromKind) return fromKind

  const fromFile = detectPlatformFromFileName(
    row?.sourceFileName || row?.source_file_name || row?.fileName || '',
  )
  if (fromFile) return fromFile

  const fromRow = normalizePlatformLabel(row?.platform || '')
  if (fromRow === '네이버') return '스마트스토어'
  if (fromRow && fromRow !== '미지정' && MARKETPLACE_PLATFORMS.includes(fromRow)) {
    return fromRow
  }

  const fromUpload = normalizePlatformLabel(uploadPlatform)
  if (fromUpload && fromUpload !== '미지정') return fromUpload

  const store = String(row?.storeName || row?.brand || '').trim()
  if (store.length <= 24) {
    const fromStore = detectPlatformFromChannelKind(store)
    if (fromStore) return fromStore
  }

  const fromChannel = normalizePlatformLabel(row?.channel || '')
  if (fromChannel === '네이버') return '스마트스토어'
  if (fromChannel && MARKETPLACE_PLATFORMS.includes(fromChannel)) return fromChannel

  return fromRow || fromChannel || '미지정'
}
