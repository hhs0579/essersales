/** 업로드·레코드 플랫폼 판별 (파일명·채널종류 우선) */

export function detectPlatformFromChannelKind(channelKind) {
  const raw = String(channelKind ?? '').trim()
  if (!raw) return ''
  const n = raw.toLowerCase().replace(/\s/g, '')
  if (
    n === '스마트스토어' ||
    n === 'smartstore' ||
    n === '네이버' ||
    n === 'naver' ||
    n.includes('스마트스토어') ||
    n.includes('smartstore') ||
    n.includes('네이버')
  ) {
    return '스마트스토어'
  }
  if (
    n === '쿠팡' ||
    n === 'coupang' ||
    n.includes('쿠팡') ||
    n.includes('coupang') ||
    n.includes('로켓그로스') ||
    n.includes('판매자배송')
  ) {
    return '쿠팡'
  }
  return ''
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
    n.includes('판매자배송')
  ) {
    return '쿠팡'
  }
  return ''
}

export function resolveUploadPlatform(fileName, selectedPlatform = '', details = []) {
  const fromFile = detectPlatformFromFileName(fileName)
  if (fromFile) return fromFile

  const kindCounts = new Map()
  for (const row of details || []) {
    if (row?.isEsserSheetTotal) continue
    const fromKind = detectPlatformFromChannelKind(
      row?.channelKind || row?.channel_kind || '',
    )
    if (fromKind) kindCounts.set(fromKind, (kindCounts.get(fromKind) || 0) + 1)
  }
  let bestKind = ''
  let bestN = 0
  for (const [k, c] of kindCounts) {
    if (c > bestN) {
      bestN = c
      bestKind = k
    }
  }
  if (bestKind) return bestKind

  const p = String(selectedPlatform || '').trim()
  if (p === '네이버') return '스마트스토어'
  if (p) return p
  return '미지정'
}

export function inferUploadSalesMethodFromDetails(details, fileName, fallback = '') {
  const counts = new Map()
  for (const row of details || []) {
    if (row?.isEsserSheetTotal) continue
    const m = String(row?.salesMethod || '').trim()
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

  const n = String(fileName || '')
    .toLowerCase()
    .replace(/\s/g, '')
  if (n.includes('로켓그로스') || n.includes('rocketgrowth')) return '로켓그로스'
  if (n.includes('판매자배송') || n.includes('sellerdelivery')) return '판매자배송'
  if (n.includes('n배송') || n.includes('n_delivery')) return 'N배송'
  if (n.includes('일반배송')) return '일반배송'
  return fallback || ''
}

export function resolveRecordPlatform(row, uploadPlatform = '', fileName = '') {
  const fromKind = detectPlatformFromChannelKind(
    row?.channelKind || row?.channel_kind || '',
  )
  if (fromKind) return fromKind

  const fromFile = detectPlatformFromFileName(
    row?.sourceFileName || row?.source_file_name || fileName || '',
  )
  if (fromFile) return fromFile

  const p = String(row?.platform || '').trim()
  if (p === '네이버') return '스마트스토어'
  if (p && p !== '미지정') return p

  const fromUpload = String(uploadPlatform || '').trim()
  if (fromUpload === '네이버') return '스마트스토어'
  if (fromUpload) return fromUpload

  return p || '미지정'
}
