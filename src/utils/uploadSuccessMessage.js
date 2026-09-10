/**
 * 서버 parseMeta만으로 업로드 성공 문구를 만든다. 브라우저 XLSX 파싱 금지.
 * @param {object} opts
 * @param {number} opts.fileCount
 * @param {string} opts.platform
 * @param {object | null} opts.parseMeta
 * @param {number} opts.total
 * @param {'daily' | 'monthly' | 'period'} opts.kind
 * @param {string} [opts.salesMethod]
 */
export function formatPlatformUploadSuccess({
  fileCount,
  platform,
  parseMeta,
  total,
  kind,
  salesMethod = '',
}) {
  const skipped = Number(parseMeta?.skipped || 0)
  const skippedSummary = Number(parseMeta?.skippedSummary || 0)
  const skippedNoDate = Number(parseMeta?.skippedNoDate || 0)
  const skipParts = []
  if (skipped > 0) skipParts.push(`미저장 ${skipped}행`)
  if (skippedSummary > 0) skipParts.push(`합계행 제외 ${skippedSummary}`)
  if (skippedNoDate > 0) skipParts.push(`날짜없음 ${skippedNoDate}행`)
  const skipNote = skipParts.length ? ` (${skipParts.join(', ')})` : ''

  const format = String(parseMeta?.format || '')
  let formatLabel = ''
  if (format === 'coupang_esser') formatLabel = ' · 빅셀 매출분석'
  else if (format === 'coupang_esser_monthly') formatLabel = ' · 빅셀 매출분석(월별)'
  else if (format === 'coupang_esser_period') formatLabel = ' · 빅셀 매출분석(기간)'

  const method = salesMethod || parseMeta?.salesMethod || ''
  const methodLabel = method ? ` · ${method}` : ''
  const rangeRaw = parseMeta?.dateRangeHint || parseMeta?.periodLabel || ''

  if (kind === 'daily') {
    const rangeLabel = rangeRaw ? ` · 기간 ${rangeRaw}` : ''
    return `${fileCount}개 파일 · ${platform}${formatLabel}${methodLabel}${rangeLabel} · 총 ${total}건 저장${skipNote}`
  }
  const rangeLabel = rangeRaw || ''
  return `${fileCount}개 파일 · ${platform}${formatLabel}${methodLabel} · 기간 ${rangeLabel} · 총 ${total}건 저장${skipNote}`
}
