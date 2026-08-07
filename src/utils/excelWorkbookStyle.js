import ExcelJS from 'exceljs'
import { COMBINED_COMMENT_LABELS } from '../config/combinedComments.js'
import { DAY_OVER_DAY_BRAND_LABELS } from './recordSourceLabel.js'
import { DAY_OVER_DAY_PLATFORM_LABELS } from './dayOverDaySales.js'
import { COMBINED_BRAND_DAY_OVER_DAY_LABELS } from './dayOverDaySales.js'

const COMBINED_COMMENT_LABEL_SET = new Set(COMBINED_COMMENT_LABELS)

const INTEGRATED_DOD_ROW_LABELS = new Set([
  ...DAY_OVER_DAY_PLATFORM_LABELS,
  ...DAY_OVER_DAY_BRAND_LABELS,
  ...COMBINED_BRAND_DAY_OVER_DAY_LABELS,
])

/** 브랜드·표 스타일 팔레트 */
export const XL = {
  titleBg: 'FF0F172A',
  titleFg: 'FFFFFFFF',
  sectionBg: 'FFE2E8F0',
  sectionFg: 'FF0F172A',
  headerBg: 'FF1E3A5F',
  headerFg: 'FFFFFFFF',
  zebra: 'FFF8FAFC',
  totalBg: 'FFDBEAFE',
  totalFg: 'FF1E3A8A',
  border: 'FF94A3B8',
  borderLight: 'FFCBD5E1',
  /** 손익↔전일 구분선 (표 헤더와 동일 계열 네이비) */
  dualGap: 'FF203764',
  mutedFg: 'FF475569',
  negativeFg: 'FFDC2626',
  positiveFg: 'FF2563EB',
}

const KPI_BLOCK_COLS = 3

const HEADER_ROW_MARKERS = new Set([
  '기간',
  '날짜',
  '지표',
  '판매방식',
  '플랫폼',
  '파일명',
  '스토어명',
  '상품명',
  '노출상품ID',
  '매출',
  '판매수량',
  '순이익금',
  '순이익률(%)',
  '광고비',
  '광고비용',
  '전환매출액',
  '원가(단가)',
  '원가(합계)',
  '원가단가',
  '원가합계',
  '원가',
  '매출(판매금액)',
  '판매금액(할인전)',
  '판매금액',
  '광고매출',
  'ROAS(%)',
  '자연매출',
  '상품행수',
  '매출비중(%)',
  '값',
  '산출 기준',
  '옵션',
  '옵션명',
  '스토어',
  '판매방식(구분)',
  '판매가',
  '할인전매출',
  '구분',
  '금액',
  '매출대비',
  '순이익률',
  '매출비중',
  '마진',
  '마진율',
  '원가율',
  '총 원가',
  '객단가',
  'ROAS',
  'ROAS(광고)',
  'ROAS(전체)',
  '자연매출',
  '자연매출 비율',
  '판매 수량',
  '광고비',
  '상품행수',
  '기준일 매출',
  '기간 매출',
  '전일 매출',
  '전일 대비',
  '전주 대비',
  '추이',
  '기준일',
  '조회 기간',
  '전일',
  '전주 동기간',
])

const NUM_FMT_INT = '#,##0'
const NUM_FMT_COUNT = '#,##0"건"'
const NUM_FMT_PCT = '0.00%'
const NUM_FMT_RATIO = '0.00"배"'
const NUM_FMT_WON = '#,##0"원"'

function cellText(v) {
  if (v == null || v === '') return ''
  return String(v).trim()
}

function normalizeRows(rows) {
  return (rows || []).map((src) => (src || []).map((v) => (v == null ? '' : v)))
}

function displayWidth(text) {
  return [...cellText(text)].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)
}

export function widthForHeader(label) {
  const s = cellText(label)
  if (!s) return 12
  if (/상품명/.test(s)) return 36
  if (/옵션/.test(s)) return 24
  if (/파일명|원본/.test(s)) return 30
  if (/스토어/.test(s)) return 16
  if (/산출|기준/.test(s)) return 36
  if (/지표/.test(s)) return 16
  if (/값/.test(s)) return 18
  if (/날짜|기간/.test(s)) return 12
  if (/ID|코드/.test(s)) return 14
  if (/수량|건수|행수/.test(s)) return 10
  if (/률|ROAS|비중/.test(s)) return 12
  if (/매출|이익|원가|광고|판매가|집행/.test(s)) return 16
  return Math.min(24, Math.max(10, displayWidth(s) + 2))
}

export function colWidthsFromHeaders(headers) {
  return headers.map((h) => widthForHeader(h))
}

function isIntegratedWidthBannerRow(row) {
  const t = cellText(row?.[0])
  if (!t) return false
  if (t === '■ 통합 담당 코멘트') return false
  if (row.length <= 2 && /리포트|빌드|양식\s*v|기준|■/.test(t)) return true
  if (row.length <= 2 && /^(손익계산\s*요약|판매방식별|스토어별|일별\s*요약)/.test(t)) return true
  if (row.length <= 2 && /채널별\s*손익/.test(t)) return true
  return false
}

/** ①요약리포트 — 블록별 열 너비 (긴 제목 행이 전체 열을 넓히지 않음) */
export function colWidthsForIntegratedSummary(rows) {
  /** @type {number[]} */
  const widths = []
  /** @type {unknown[][]} */
  let block = []

  const flush = () => {
    if (!block.length) return
    const bw = colWidthsFromRows(block, { min: 6, max: 15, pad: 1 })
    for (let i = 0; i < bw.length; i += 1) {
      widths[i] = Math.max(widths[i] || 6, bw[i])
    }
    block = []
  }

  for (const row of rows || []) {
    if (!row?.length || row.every((c) => cellText(c) === '')) {
      flush()
      continue
    }
    if (isIntegratedWidthBannerRow(row)) continue
    block.push(row)
  }
  flush()
  for (let i = 0; i < widths.length; i += 1) {
    if (i === 0) widths[i] = Math.max(widths[i] || 14, 26)
    else if (i === 1) widths[i] = Math.max(widths[i] || 13, 14)
    else if (i === 2) widths[i] = Math.max(widths[i] || 9, 12)
    else if (i === 3) widths[i] = Math.max(widths[i] || 4, 4)
    // E~I — 손익계산 요약 옆 전일·전주 대비 매출
    else if (i === 4) widths[i] = Math.max(widths[i] || 12, 30)
    else if (i === 5 || i === 6) widths[i] = Math.max(widths[i] || 12, 18)
    else if (i === 7) widths[i] = Math.max(widths[i] || 10, 14)
    else if (i === 8) widths[i] = Math.max(widths[i] || 10, 12)
    else widths[i] = Math.max(widths[i] || 8, 9)
  }
  // D열 — 손익↔전일 구분선 + 판매수량·KPI 등 공용 (4로 고정 시 # 오류)
  if (widths[3] != null) widths[3] = Math.max(widths[3], 12)
  // G·L열(광고매출/광고비, 자연매출 비율 등) — 약간 여유
  for (const idx of [5, 6, 7, 8, 9, 11]) {
    if (widths[idx] != null) {
      const extra = idx === 6 || idx === 11 ? 3 : 2
      widths[idx] = Math.min(22, (widths[idx] || 9) + extra)
    }
  }
  return widths
}

/** 행 데이터 기준 컴팩트 열 너비 (①요약리포트 등) */
export function colWidthsFromRows(rows, { min = 4, max = 14, pad = 0 } = {}) {
  const maxCols = (rows || []).reduce((m, r) => Math.max(m, r?.length || 0), 0)
  const widths = Array.from({ length: maxCols }, () => min)
  for (const row of rows || []) {
    for (let c = 0; c < (row?.length || 0); c += 1) {
      const text = cellText(row[c])
      if (!text) continue
      let w = displayWidth(text) + pad
      if (typeof row[c] === 'number') {
        if (Math.abs(row[c]) >= 1_000_000) w = Math.max(w, 11)
        else if (Math.abs(row[c]) >= 100_000) w = Math.max(w, 9)
        else w = Math.max(w, 7)
      }
      widths[c] = Math.min(max, Math.max(widths[c], w))
    }
  }
  for (let c = 0; c < maxCols; c += 1) {
    const hasContent = (rows || []).some((row) => cellText(row?.[c]) !== '')
    if (!hasContent) widths[c] = 1.5
  }
  return widths
}

function isWrapColumn(headerLabel) {
  const h = cellText(headerLabel)
  if (/매출|이익|원가|광고|마진|ROAS/.test(h)) return false
  return /상품명|옵션|파일|스토어|산출\s*기준|산출 기준/.test(h)
}

function isEmptyRow(row) {
  return !row?.length || row.every((c) => cellText(c) === '')
}

function isTitleRow(row, rowIndex) {
  const t = cellText(row[0])
  return rowIndex === 0 && /리포트|매출.*대시보드|에쎄르/i.test(t)
}

function isSectionRow(row) {
  const t = cellText(row[0])
  if (t.startsWith('※') && cellText(row[1])) return false
  return t.startsWith('■') || t.startsWith('※')
}

/** 손익계산 요약(A~C) ↔ 전일 대비(E~I) 사이 구분 열 (D) — 세로 병합 직사각형 */
const INTEGRATED_DUAL_GAP_COL = 4
const INTEGRATED_DUAL_GAP_FILL = XL.dualGap

function isIntegratedDualBlockRow(row) {
  return (
    isIntegratedDualBlockTitleRow(row) ||
    isIntegratedDualBlockHeaderRow(row) ||
    isIntegratedDualBlockDataRow(row)
  )
}

function finalizeIntegratedDualGapMerge(ws, startRow, endRow) {
  if (!startRow || endRow < startRow) return
  const col = INTEGRATED_DUAL_GAP_COL
  const paintGapCell = (rowNum) => {
    const cell = ws.getRow(rowNum).getCell(col)
    cell.value = null
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: INTEGRATED_DUAL_GAP_FILL },
    }
    cell.border = {
      top: { style: 'thin', color: { argb: INTEGRATED_DUAL_GAP_FILL } },
      left: { style: 'thin', color: { argb: INTEGRATED_DUAL_GAP_FILL } },
      bottom: { style: 'thin', color: { argb: INTEGRATED_DUAL_GAP_FILL } },
      right: { style: 'thin', color: { argb: INTEGRATED_DUAL_GAP_FILL } },
    }
  }

  if (endRow > startRow) {
    try {
      ws.mergeCells(startRow, col, endRow, col)
      paintGapCell(startRow)
      return
    } catch {
      /* 병합 불가 시 행별 채우기 */
    }
  }

  for (let r = startRow; r <= endRow; r += 1) {
    paintGapCell(r)
  }
}

function isIntegratedDualBlockTitleRow(row) {
  const right = cellText(row?.[4])
  return cellText(row?.[0]) === '손익계산 요약' && /대비\s*매출/.test(right)
}

function isIntegratedDualBlockHeaderRow(row) {
  return (
    cellText(row?.[0]) === '구분' &&
    cellText(row?.[1]) === '금액' &&
    cellText(row?.[4]) === '구분' &&
    /매출/.test(cellText(row?.[5]))
  )
}

function isIntegratedDualBlockDataRow(row) {
  if (!row || row.length < 5) return false
  const left = cellText(row[0])
  const right = cellText(row[4])
  if (/^[①②③④⑤⑥⑦]/.test(left)) return true
  if (INTEGRATED_DOD_ROW_LABELS.has(right)) return true
  // 손익 행 수 < 전일대비 행 수 — 왼쪽만 비고 오른쪽에 세그먼트 데이터
  if (!left && right && (parseNumeric(row[5]) != null || cellText(row[6]))) return true
  return false
}

/** 월별: 오른쪽에 증감액 열 포함(6열). 일/주: 5열 */
function integratedDualBlockRightColCount(values) {
  const title = cellText(values?.[4])
  if (/전월\s*대비/.test(title)) return 6
  // 헤더: … | 전월 대비[ 증감액] | 전월 대비(%) | 추이
  const amountH = cellText(values?.[7])
  const pctH = cellText(values?.[8])
  if (/전월\s*대비/.test(amountH) && !/%/.test(amountH) && /%/.test(pctH)) return 6
  // 데이터: E열 이후 6칸 (구분·당월·전월·증감액·%·추이)
  const right = values?.slice(4) || []
  if (right.length >= 6) {
    const amount = right[3]
    const pctOrNa = right[4]
    if (
      parseNumeric(amount) != null &&
      !String(amount).includes('%') &&
      (String(pctOrNa).includes('%') || pctOrNa === 'N/A' || pctOrNa === '—')
    ) {
      return 6
    }
  }
  return 5
}

function paintIntegratedDualBlockTitleRow(ws, rowNum, row, values, fontSize = 12) {
  const rightCols = integratedDualBlockRightColCount(values)
  ws.mergeCells(rowNum, 1, rowNum, 3)
  ws.mergeCells(rowNum, 5, rowNum, 4 + rightCols)
  const leftCell = row.getCell(1)
  leftCell.value = '손익계산 요약'
  leftCell.font = { bold: true, size: fontSize, color: { argb: XL.headerFg } }
  leftCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } }
  leftCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  leftCell.border = thinBorder()

  const rightCell = row.getCell(5)
  rightCell.value = cellText(values?.[4]) || '전일 대비 매출'
  rightCell.font = { bold: true, size: fontSize, color: { argb: XL.headerFg } }
  rightCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } }
  rightCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  rightCell.border = thinBorder()
  row.height = 24
}

function paintIntegratedDualBlockHeaderRow(row, values, fontSize = 12) {
  const rightCols = integratedDualBlockRightColCount(values)
  const leftHeaders = values.slice(0, 3)
  const rightHeaders = values.slice(4, 4 + rightCols)
  leftHeaders.forEach((h, i) => {
    const cell = row.getCell(i + 1)
    cell.value = cellText(h)
    cell.font = { bold: true, size: fontSize, color: { argb: XL.headerFg } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = thinBorder()
  })
  rightHeaders.forEach((h, i) => {
    const cell = row.getCell(i + 5)
    cell.value = cellText(h)
    cell.font = { bold: true, size: fontSize, color: { argb: XL.headerFg } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = thinBorder()
  })
  row.height = 26
}

function paintIntegratedDualBlockEmptySide(row, colStart, colCount, fontSize = 12) {
  for (let i = 0; i < colCount; i += 1) {
    const cell = row.getCell(colStart + i)
    cell.value = null
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
    cell.border = thinBorder()
    cell.font = { size: fontSize, color: { argb: 'FF1E293B' } }
  }
}

function paintIntegratedDualBlockDataRow(row, values, fontSize = 12) {
  const rightCols = integratedDualBlockRightColCount(values)
  const left = values.slice(0, 3)
  const right = values.slice(4, 4 + rightCols)
  const hasLeft = /^[①②③④⑤⑥⑦]/.test(cellText(left[0]))
  const hasRight =
    INTEGRATED_DOD_ROW_LABELS.has(cellText(right[0])) ||
    (cellText(right[0]) &&
      !/^[①②③④⑤⑥⑦]/.test(cellText(right[0])) &&
      (parseNumeric(right[1]) != null || parseNumeric(right[2]) != null))

  if (hasLeft) {
    paintIntegratedPnlDataRow(row, left, fontSize)
  } else if (cellText(left[0]) === '' && cellText(left[1]) === '' && cellText(left[2]) === '') {
    paintIntegratedDualBlockEmptySide(row, 1, 3, fontSize)
  }

  if (hasRight) {
    // 일/주: [구분, 당기, 전기, %(3), 추이] / 월: [구분, 당월, 전월, 증감액(3), %(4), 추이]
    const pctCols = rightCols >= 6 ? new Set([4]) : new Set([3])
    const changeAmountCols = rightCols >= 6 ? new Set([3]) : new Set()
    right.forEach((val, ci) => {
      const cell = row.getCell(ci + 5)
      const pct = pctCols.has(ci) || String(val).includes('%')
      const n = pct ? toExcelPercent(val) : parseNumeric(val)
      if (ci === 0) {
        cell.value = val
        cell.font = { size: fontSize, bold: true, color: { argb: 'FF334155' } }
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
      } else if (Number.isFinite(n) && cellText(val) !== '') {
        cell.value = n
        cell.numFmt = pct ? NUM_FMT_PCT : NUM_FMT_INT
        cell.font = { size: fontSize, color: { argb: 'FF1E293B' } }
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        if ((pct || changeAmountCols.has(ci)) && n > 0) {
          cell.font = { size: fontSize, color: { argb: XL.positiveFg } }
        } else if ((pct || changeAmountCols.has(ci)) && n < 0) {
          cell.font = { size: fontSize, color: { argb: XL.negativeFg } }
        } else if (n < 0) {
          cell.font = { size: fontSize, color: { argb: XL.negativeFg } }
        }
      } else {
        cell.value = cellText(val) === '' ? null : val
        cell.font = { size: fontSize, color: { argb: 'FF1E293B' } }
        const trendCol = rightCols >= 6 ? 5 : 4
        cell.alignment = { horizontal: ci === trendCol ? 'left' : 'right', vertical: 'middle' }
        if (val === '상승') cell.font = { size: fontSize, color: { argb: XL.positiveFg } }
        else if (val === '하락') cell.font = { size: fontSize, color: { argb: XL.negativeFg } }
      }
      cell.border = thinBorder()
    })
  } else {
    paintIntegratedDualBlockEmptySide(row, 5, rightCols, fontSize)
  }

  row.height = 22
}

/** ①요약리포트 — 블록 제목 (손익·판매방식·스토어·일별) */
function isIntegratedBlockTitleRow(row, nextRow) {
  if (isIntegratedDualBlockTitleRow(row)) return false
  if (row.length > 1 && cellText(row[1])) return false
  const t = cellText(row[0])
  if (
    !/^(손익계산\s*요약|판매방식별\s*손익\s*계산|스토어별\s*손익\s*현황|일별\s*요약)$/.test(t)
  ) {
    return false
  }
  return Boolean(nextRow?.length && isTableHeaderRow(nextRow))
}

function paintIntegratedBlockTitleRow(ws, rowNum, row, title, colSpan, fontSize = 12) {
  paintFullRowBanner(ws, rowNum, row, title, colSpan, {
    font: { bold: true, size: fontSize, color: { argb: XL.headerFg } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  })
  row.height = 24
}

function isIntegratedSubtitleBannerRow(row, rowIndex) {
  if (rowIndex <= 0 || rowIndex > 3) return false
  if ((row?.length || 0) > 2) return false
  const t = cellText(row[0])
  if (!t) return false
  return /기준|양식\s*v|빌드|요약리포트/.test(t)
}

function isIntegratedPnlDataRow(row) {
  if (!row || row.length !== 3) return false
  return /^[①②③④⑤⑥⑦]/.test(cellText(row[0]))
}

function isIntegratedHorizontalKpiHeader(row) {
  return cellText(row?.[0]) === '총매출' && cellText(row?.[1]) === '총원가'
}

function isIntegratedHorizontalKpiValueRow(row, prevRow) {
  if (!isIntegratedHorizontalKpiHeader(prevRow)) return false
  return (row?.length || 0) >= 8
}

function paintIntegratedAmountCell(cell, val, { pct = false, bold = false, fontSize = 12 } = {}) {
  const n = pct ? toExcelPercent(val) : parseNumeric(val)
  if (Number.isFinite(n) && cellText(val) !== '') {
    cell.value = n
    cell.numFmt = pct ? NUM_FMT_PCT : NUM_FMT_INT
  } else {
    cell.value = cellText(val) === '' ? null : val
  }
  cell.font = { size: fontSize, bold, color: { argb: bold ? 'FF0F172A' : 'FF1E293B' } }
  cell.alignment = { horizontal: 'right', vertical: 'middle' }
  cell.border = thinBorder()
}

function paintIntegratedPnlDataRow(row, values, fontSize = 12) {
  const labelCell = row.getCell(1)
  labelCell.value = values[0]
  labelCell.font = { size: fontSize, bold: true, color: { argb: 'FF334155' } }
  labelCell.alignment = { vertical: 'middle', horizontal: 'left' }
  labelCell.border = thinBorder()

  const label = cellText(values[0])
  const col2Pct = label === '⑦ 최종 순이익률' || String(values[1]).includes('%')
  const col3Pct = /률|ROAS|비율|비중/.test(cellText(values[2])) || String(values[2]).includes('%')
  paintIntegratedAmountCell(row.getCell(2), values[1], { pct: col2Pct, fontSize })
  paintIntegratedAmountCell(row.getCell(3), values[2], { pct: col3Pct, fontSize })
  row.height = 22
}

function paintIntegratedHorizontalKpiValueRow(row, values, fontSize = 12) {
  // 0-based: 4=순이익률, 7=ROAS(광고), 9=자연매출비율 (3=최종 순이익은 금액)
  const pctCols = new Set([4, 7, 9])
  values.forEach((val, ci) => {
    const cell = row.getCell(ci + 1)
    const pct = pctCols.has(ci) || String(val).includes('%')
    paintIntegratedAmountCell(cell, val, { pct, bold: true, fontSize })
  })
  row.height = 22
}

function isSubsectionRow(row) {
  const t = cellText(row[0])
  return /^(판매|반품)\s+\d+건$/.test(t)
}

function isTotalRow(row) {
  const t = cellText(row[0])
  return t.startsWith('【') && t.endsWith('】')
}

function isCombinedCommentsSectionRow(row) {
  return /^■ 통합 담당 코멘트/.test(cellText(row[0]))
}

/** 통합 코멘트 — 일별 소제목 (■ 2026-07-13 / ■ 날짜 미지정…) */
function isCombinedCommentsDayHeader(row, inCombinedCommentsSection) {
  if (!inCombinedCommentsSection) return false
  return /^■ (\d{4}-\d{2}-\d{2}|날짜 미지정)/.test(cellText(row[0]))
}

/** 코멘트 블록만 — 2열(구분·본문). 스토어별 등 다열 표와 구분 */
function isCombinedCommentsDataRow(row, inCombinedCommentsSection) {
  if (!inCombinedCommentsSection) return false
  if (row.length !== 2) return false
  return COMBINED_COMMENT_LABEL_SET.has(cellText(row[0]))
}

/** 통합 코멘트 행 — 빈 칸도 기본 높이 150pt */
const COMBINED_COMMENT_ROW_HEIGHT = 150

function paintCombinedCommentsDataRow(ws, rowNum, row, values, contentColEnd) {
  const labelCell = row.getCell(1)
  labelCell.value = values[0]
  labelCell.font = { size: 11, bold: true, color: { argb: 'FF334155' } }
  labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.zebra } }
  labelCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  labelCell.border = thinBorder()

  const comment = values[1] != null ? String(values[1]) : ''
  const commentCell = row.getCell(2)
  commentCell.value = comment === '' ? '' : comment
  commentCell.font = { size: 11, color: { argb: 'FF0F172A' } }
  commentCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
  commentCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
  commentCell.border = thinBorder()

  for (let c = 3; c <= contentColEnd; c += 1) {
    const cell = row.getCell(c)
    cell.value = ''
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
    cell.border = thinBorder()
  }

  if (contentColEnd > 2) {
    try {
      ws.mergeCells(rowNum, 2, rowNum, contentColEnd)
    } catch {
      /* 병합 불가 시 2열만 사용 */
    }
  }

  const contentLines = comment
    ? Math.max(3, Math.ceil(displayWidth(comment) / 72))
    : 3
  row.height = Math.max(COMBINED_COMMENT_ROW_HEIGHT, 12 + contentLines * 16)
}

function isManualAdTableHeader(row) {
  const first = cellText(row[0])
  return (first === '일자' || first === '월') && cellText(row[1]) === '광고비용' && cellText(row[2]) === '전환매출액'
}

function isManualAdAppliedTotalRow(row) {
  return cellText(row[0]) === '총합광고비'
}

function paintManualAdAmountCell(cell, val, { bold = false, fillArgb = null } = {}) {
  const n = parseNumeric(val)
  if (Number.isFinite(n) && val !== '') {
    cell.value = n
    cell.numFmt = NUM_FMT_WON
    cell.font = { size: 11, bold, color: { argb: bold ? XL.totalFg : 'FF1E293B' } }
    cell.alignment = { horizontal: 'right', vertical: 'middle' }
  } else {
    cell.value = val
    cell.font = { size: 11, bold, color: { argb: 'FF1E293B' } }
    cell.alignment = { horizontal: 'right', vertical: 'middle' }
  }
  if (fillArgb) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
  }
  cell.border = thinBorder()
}

function paintManualAdTableHeader(row, labels) {
  labels.forEach((label, ci) => {
    const cell = row.getCell(ci + 1)
    cell.value = label
    cell.font = { bold: true, size: 11, color: { argb: XL.headerFg } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } }
    cell.alignment = {
      vertical: 'middle',
      horizontal: ci === 0 ? 'center' : 'right',
      wrapText: true,
    }
    cell.border = thinBorder()
  })
}

function paintManualAdAppliedTotalRow(row, values) {
  const labelCell = row.getCell(1)
  labelCell.value = values[0]
  labelCell.font = { size: 11, bold: true, color: { argb: XL.totalFg } }
  labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } }
  labelCell.alignment = { vertical: 'middle', horizontal: 'left' }
  labelCell.border = thinBorder()

  paintManualAdAmountCell(row.getCell(2), values[1], { bold: true, fillArgb: XL.totalBg })
  paintManualAdAmountCell(row.getCell(3), values[2], { bold: true, fillArgb: XL.totalBg })

  const hintCell = row.getCell(4)
  hintCell.value = values[3] || ''
  hintCell.font = { size: 10, color: { argb: 'FF334155' } }
  hintCell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'right' }
  hintCell.border = thinBorder()
  hintCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } }

  row.height = 22
}

function isKpiBlockHeader(row) {
  return cellText(row[0]) === '지표' && cellText(row[1]) === '값'
}

/** KPI 블록 전용 3열 행만 (표 데이터는 4열 이상) */
function isMetaKpiRow(row) {
  if (!row || row.length !== 3) return false
  const label = cellText(row[0])
  const hint = cellText(row[2])
  if (!hint || !label) return false
  if (label.startsWith('■') || label.startsWith('※') || label.startsWith('【')) return false
  if (isKpiBlockHeader(row)) return false
  return true
}

function isMetaPairRow(row) {
  if (isMetaKpiRow(row) || isKpiBlockHeader(row)) return false
  if (!row || row.length < 2 || row.length > 3) return false
  const label = cellText(row[0])
  if (!label || label.startsWith('■') || label.startsWith('※') || label.startsWith('【')) return false
  if (cellText(row[2])) return false
  const filled = row.filter((c) => cellText(c) !== '').length
  if (filled === 2) return !isNumericValue(label)
  if (HEADER_ROW_MARKERS.has(label)) return false
  return !isNumericValue(label)
}

function isTableHeaderRow(row) {
  if (isKpiBlockHeader(row)) return false
  const nonEmpty = row.filter((c) => cellText(c) !== '')
  if (nonEmpty.length <= 2) return false
  const first = cellText(row[0])
  if (HEADER_ROW_MARKERS.has(first) && nonEmpty.length >= 3) return true
  const hits = row.filter((c) => HEADER_ROW_MARKERS.has(cellText(c))).length
  return hits >= 2
}

function headerImpliesPercent(label) {
  const h = cellText(label)
  if (/매출\s*\/\s*원가/.test(h)) return false
  return /%|률|ROAS|비율|비중|마진율|원가율/.test(h)
}

function headerImpliesInteger(label) {
  return /수량|건수|행수/.test(cellText(label))
}

function isNumericValue(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return true
  const s = cellText(val).replace(/,/g, '')
  if (!s || s === '-') return false
  return /^-?\d+(\.\d+)?$/.test(s)
}

function parseNumeric(val) {
  if (typeof val === 'number') return val
  const s = cellText(val).replace(/,/g, '').replace(/원|개/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Excel % 서식용 소수 변환.
 * 입력은 퍼센트 포인트(237.5 → 237.5%, 15 → 15%). 이미 0~1 소수면 그대로 둠.
 */
function toExcelPercent(val) {
  const n = parseNumeric(val)
  if (n == null) return null
  if (String(val).includes('%')) {
    const raw = parseNumeric(String(val).replace('%', ''))
    return raw != null ? raw / 100 : null
  }
  if (Math.abs(n) > 1) return n / 100
  if (Math.abs(n) <= 1) return n
  return n / 100
}

function headerImpliesWon(label) {
  const h = cellText(label)
  if (headerImpliesPercent(h)) return false
  if (/마진율|원가율|ROAS|비율|비중/.test(h)) return false
  return /매출|마진|이익|원가|광고|판매가|집행/.test(h)
}

function inferNumFormat(headerLabel, value, compact = false) {
  if (headerLabel && headerImpliesPercent(headerLabel)) return NUM_FMT_PCT
  if (headerLabel && headerImpliesInteger(headerLabel)) return NUM_FMT_COUNT
  if (headerLabel && headerImpliesWon(headerLabel)) return compact ? NUM_FMT_INT : NUM_FMT_WON
  const n = parseNumeric(value)
  if (n == null) return null
  if (Math.abs(n) <= 100 && String(value).includes('%')) return NUM_FMT_PCT
  return NUM_FMT_INT
}

function thinBorder() {
  return {
    top: { style: 'thin', color: { argb: XL.borderLight } },
    left: { style: 'thin', color: { argb: XL.borderLight } },
    bottom: { style: 'thin', color: { argb: XL.borderLight } },
    right: { style: 'thin', color: { argb: XL.borderLight } },
  }
}

function isCountMetaLabel(label) {
  return /행\s*수|건\s*수|건수|개수|데이터\s*건|판매\s*수량|수량/.test(cellText(label))
}

function kpiValueUsesCountFormat(label) {
  return isCountMetaLabel(label) || headerImpliesInteger(label)
}

function isTextMetaLabel(label) {
  return /시각|기간|형식|플랫폼|월|요일|판매방식|리포트|건수/.test(cellText(label))
}

function closeTableBox(ws, startRow, endRow, colCount) {
  if (!startRow || !endRow || colCount < 1) return
  for (let r = startRow; r <= endRow; r += 1) {
    for (let c = 1; c <= colCount; c += 1) {
      const cell = ws.getRow(r).getCell(c)
      const b = thinBorder()
      if (r === startRow) b.top = { style: 'medium', color: { argb: XL.border } }
      if (r === endRow) b.bottom = { style: 'medium', color: { argb: XL.border } }
      if (c === 1) b.left = { style: 'medium', color: { argb: XL.border } }
      if (c === colCount) b.right = { style: 'medium', color: { argb: XL.border } }
      cell.border = b
    }
  }
}

/** 행 전체 배경 + 가로 셀 병합 */
function paintFullRowBanner(ws, rowNum, row, title, colSpan, style) {
  for (let c = 1; c <= colSpan; c += 1) {
    const cell = row.getCell(c)
    cell.value = c === 1 ? title : ''
    if (style.font) cell.font = style.font
    if (style.fill) cell.fill = style.fill
    cell.alignment = style.alignment || { vertical: 'middle', horizontal: 'left', wrapText: true }
    cell.border = thinBorder()
  }
  if (ws && colSpan > 1) {
    try {
      ws.mergeCells(rowNum, 1, rowNum, colSpan)
    } catch {
      /* 이미 병합된 영역과 겹치면 무시 */
    }
  }
}

function paintMetaPairRow(row, label, rawValue, clearThroughCol = 0) {
  const labelCell = row.getCell(1)
  const valueCell = row.getCell(2)

  labelCell.value = label
  labelCell.font = { size: 11, bold: true, color: { argb: 'FF334155' } }
  labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.zebra } }
  labelCell.alignment = { vertical: 'middle', horizontal: 'left' }
  labelCell.border = thinBorder()

  if (typeof rawValue === 'string' && rawValue.includes('%')) {
    valueCell.value = rawValue
    valueCell.font = { size: 11, bold: true, color: { argb: 'FF0F172A' } }
    valueCell.alignment = { vertical: 'middle', horizontal: 'right' }
  } else {
    const n = parseNumeric(rawValue)
    if (Number.isFinite(n) && typeof rawValue === 'number' && !isTextMetaLabel(label)) {
      valueCell.value = n
      if (isCountMetaLabel(label)) valueCell.numFmt = NUM_FMT_INT
      else if (kpiLabelImpliesRatio(label)) valueCell.numFmt = NUM_FMT_RATIO
      else if (kpiLabelImpliesPercent(label)) valueCell.numFmt = NUM_FMT_PCT
      else if (/률|ROAS|비율|율$/.test(label)) valueCell.numFmt = NUM_FMT_PCT
      else valueCell.numFmt = NUM_FMT_WON
      valueCell.font = { size: 11, bold: true, color: { argb: 'FF0F172A' } }
      valueCell.alignment = { vertical: 'middle', horizontal: 'right' }
    } else {
      valueCell.value = rawValue
      valueCell.font = { size: 11, color: { argb: 'FF0F172A' } }
      valueCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    }
  }
  valueCell.border = thinBorder()
  if (clearThroughCol > 2) {
    for (let c = 3; c <= clearThroughCol; c += 1) {
      const cell = row.getCell(c)
      cell.value = null
    }
  }
  row.height = 22
}

function paintTableHeaderRow(row, labels, fontSize = 11) {
  labels.forEach((label, ci) => {
    const cell = row.getCell(ci + 1)
    cell.value = label
    cell.font = { bold: true, size: fontSize, color: { argb: XL.headerFg } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = thinBorder()
  })
}

function kpiLabelImpliesRatio(label) {
  return /매출\s*\/\s*원가/.test(cellText(label))
}

function kpiLabelImpliesPercent(label) {
  if (kpiLabelImpliesRatio(label)) return false
  const h = cellText(label)
  return /ROAS|순이익률|마진율|원가율|비율|비중|율$|률$|률\(%\)/.test(h)
}

function kpiNumFmtForLabel(label) {
  const h = cellText(label)
  if (/건수|개수|판매 수량|수량\(/.test(h)) return NUM_FMT_COUNT
  if (kpiLabelImpliesRatio(h)) return NUM_FMT_RATIO
  if (kpiLabelImpliesPercent(h)) return NUM_FMT_PCT
  if (/객단가/.test(h)) return NUM_FMT_WON
  if (/시각|기간|형식|플랫폼|월|요일|판매방식|리포트/.test(h)) return null
  if (/매출\/원가/.test(h)) return NUM_FMT_RATIO
  return NUM_FMT_WON
}

function paintMetaKpiRow(row, values) {
  const label = cellText(values[0])
  const labelCell = row.getCell(1)
  const valueCell = row.getCell(2)
  const hintCell = row.getCell(3)

  labelCell.value = values[0]
  labelCell.font = { size: 11, bold: true, color: { argb: 'FF334155' } }
  labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.zebra } }
  labelCell.alignment = { vertical: 'middle', horizontal: 'left' }
  labelCell.border = thinBorder()

  const rawVal = values[1]
  const n = parseNumeric(rawVal)
  if (Number.isFinite(n)) {
    const ratio = kpiLabelImpliesRatio(label)
    const pct = !ratio && kpiLabelImpliesPercent(label)
    const fmt = kpiNumFmtForLabel(label)

    if (ratio) {
      valueCell.value = n
      valueCell.numFmt = NUM_FMT_RATIO
    } else if (pct) {
      valueCell.value = toExcelPercent(rawVal)
      valueCell.numFmt = NUM_FMT_PCT
    } else {
      valueCell.value = n
      const fmt = kpiNumFmtForLabel(label)
      if (fmt) valueCell.numFmt = fmt
    }
    valueCell.font = { size: 11, bold: true, color: { argb: 'FF0F172A' } }
    valueCell.alignment = { vertical: 'middle', horizontal: 'right' }
  } else {
    valueCell.value = rawVal
    valueCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  }
  valueCell.border = thinBorder()

  hintCell.value = values[2]
  hintCell.font = { size: 10, color: { argb: 'FF334155' } }
  hintCell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'right' }
  hintCell.border = thinBorder()

  row.height = Math.min(44, Math.max(20, 16 + Math.ceil(displayWidth(values[2]) / 36) * 12))
}

function writePlainRow(row, values) {
  values.forEach((val, ci) => {
    row.getCell(ci + 1).value = val
  })
}

function setColWidths(ws, rows, colHeaderBest, opts) {
  const sheetMaxCols = rows.reduce((m, r) => Math.max(m, r?.length || 0), 0)
  const hasKpi = rows.some((r) => isMetaKpiRow(r))

  const minColW = opts.minColWidth ?? 10

  if (opts.colWidths?.length) {
    opts.colWidths.forEach((w, i) => {
      ws.getColumn(i + 1).width = opts.exactColWidths ? w : Math.max(w, minColW)
    })
  } else {
    for (let c = 1; c <= sheetMaxCols; c += 1) {
      const header = colHeaderBest[c - 1] || ''
      let w = widthForHeader(header)
      for (const row of rows) {
        if (c > (row?.length || 0)) continue
        const text = cellText(row[c - 1])
        if (!text) continue
        const val = row[c - 1]
        if (typeof val === 'number' && Math.abs(val) >= 1_000_000) {
          w = Math.max(w, 17)
        } else {
          w = Math.max(w, Math.min(40, displayWidth(text) + 2))
        }
      }
      ws.getColumn(c).width = Math.min(48, Math.max(10, w))
    }
  }

  if (hasKpi && !opts.exactColWidths) {
    ws.getColumn(1).width = Math.max(ws.getColumn(1).width || 10, 20)
    ws.getColumn(2).width = Math.max(ws.getColumn(2).width || 10, 18)
    ws.getColumn(3).width = Math.max(ws.getColumn(3).width || 10, 42)
  }
}

/**
 * @param {import('exceljs').Workbook} workbook
 * @param {string} sheetName
 * @param {unknown[][]} rows
 * @param {{ freezeHeader?: boolean, colWidths?: number[], autoFilter?: boolean }} [opts]
 */
function tableMaxColumns(rows) {
  return rows.reduce((m, r) => {
    if (!isTableHeaderRow(r)) return m
    const n = r.filter((c) => cellText(c) !== '').length
    return Math.max(m, n)
  }, 0)
}

/** ■ 섹션 제목 — 바로 다음 표 헤더 열 수 (없으면 0) */
function nextTableColumnSpan(sheetRows, rowIndex) {
  for (let i = rowIndex + 1; i < sheetRows.length; i += 1) {
    const row = sheetRows[i]
    if (isEmptyRow(row)) continue
    if (isSectionRow(row) || isSubsectionRow(row)) break
    if (isIntegratedBlockTitleRow(row)) break
    if (isTableHeaderRow(row) || isKpiBlockHeader(row)) {
      return row.filter((c) => cellText(c) !== '').length || 1
    }
  }
  return 0
}

function sectionBannerColumnSpan(sheetRows, rowIndex, fallbackCols) {
  return nextTableColumnSpan(sheetRows, rowIndex) || fallbackCols
}

export function addStyledSheet(workbook, sheetName, rows, opts = {}) {
  const cellFontSize = opts.fontSize || 11
  const headerFontSize = opts.headerFontSize || cellFontSize
  const sheetRows = normalizeRows(rows)
  const globalMaxCols = Math.max(
    sheetRows.reduce((m, r) => Math.max(m, r?.length || 0), 0),
    KPI_BLOCK_COLS,
    1,
  )
  const bannerCols = Math.max(tableMaxColumns(sheetRows), globalMaxCols, KPI_BLOCK_COLS, 10)

  const ws = workbook.addWorksheet(sheetName.slice(0, 31), {
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: true }],
  })

  const colHeaderBest = []
  let tableHeaderLabels = []
  let lastTableHeaderLabels = []
  let dataRowIndex = 0
  let headerRowNum = 0
  let inTable = false
  let tableBoxStart = 0
  let tableBoxCols = 0
  let dualGapStart = 0
  let dualGapEnd = 0
  let combinedCommentsBoxStart = 0
  let combinedCommentsBoxEnd = 0
  let combinedCommentsColEnd = 0
  let inCombinedCommentsSection = false

  const closeCombinedCommentsBox = (endRow = combinedCommentsBoxEnd) => {
    if (combinedCommentsBoxStart > 0 && combinedCommentsColEnd > 0) {
      closeTableBox(ws, combinedCommentsBoxStart, endRow, combinedCommentsColEnd)
    }
    combinedCommentsBoxStart = 0
    combinedCommentsBoxEnd = 0
    combinedCommentsColEnd = 0
  }

  const closeDualGapMerge = () => {
    if (dualGapStart > 0) {
      finalizeIntegratedDualGapMerge(ws, dualGapStart, dualGapEnd)
      dualGapStart = 0
      dualGapEnd = 0
    }
  }

  const noteDualGapRow = (rowNum) => {
    if (!dualGapStart) dualGapStart = rowNum
    dualGapEnd = rowNum
  }

  const endTableBox = (endRow) => {
    if (tableBoxStart > 0 && tableBoxCols > 0) {
      closeTableBox(ws, tableBoxStart, endRow, tableBoxCols)
    }
    tableBoxStart = 0
    tableBoxCols = 0
  }

  sheetRows.forEach((values, ri) => {
    const rowNum = ri + 1
    const row = ws.getRow(rowNum)

    if (isEmptyRow(values)) {
      closeCombinedCommentsBox(rowNum - 1)
      // 일별 코멘트 사이 빈 행에서 섹션을 끊으면 둘째 날부터 day header/본문 스타일이 빠짐
      const next = sheetRows[ri + 1]
      const stayInCombinedComments =
        inCombinedCommentsSection &&
        next &&
        !isEmptyRow(next) &&
        (isCombinedCommentsDayHeader(next, true) || isCombinedCommentsDataRow(next, true))
      if (!stayInCombinedComments) inCombinedCommentsSection = false
      closeDualGapMerge()
      inTable = false
      tableHeaderLabels = []
      row.height = 6
      return
    }

    if (!isIntegratedDualBlockRow(values)) {
      closeDualGapMerge()
    }

    const headerLabelAt = (ci) =>
      tableHeaderLabels[ci] || lastTableHeaderLabels[ci] || colHeaderBest[ci] || ''

    if (isTitleRow(values, ri)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      paintFullRowBanner(ws, rowNum, row, cellText(values[0]), bannerCols, {
        font: { bold: true, size: 13, color: { argb: XL.titleFg } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.titleBg } },
        alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      })
      row.height = 28
      return
    }

    if (isIntegratedSubtitleBannerRow(values, ri)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      paintFullRowBanner(ws, rowNum, row, cellText(values[0]), bannerCols, {
        font: { bold: /양식\s*v|빌드/.test(cellText(values[0])), size: cellFontSize, color: { argb: 'FF334155' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.zebra } },
        alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      })
      row.height = 22
      return
    }

    if (isCombinedCommentsSectionRow(values)) {
      closeCombinedCommentsBox(rowNum - 1)
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      inCombinedCommentsSection = true
      paintFullRowBanner(ws, rowNum, row, cellText(values[0]), bannerCols, {
        font: { bold: true, size: 12, color: { argb: XL.sectionFg } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } },
        alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      })
      row.height = 24
      return
    }

    if (isCombinedCommentsDayHeader(values, inCombinedCommentsSection)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      paintFullRowBanner(ws, rowNum, row, cellText(values[0]), bannerCols, {
        font: { bold: true, size: 11, color: { argb: XL.sectionFg } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
        alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      })
      row.height = 22
      return
    }

    if (isCombinedCommentsDataRow(values, inCombinedCommentsSection)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      if (!combinedCommentsBoxStart) combinedCommentsBoxStart = rowNum
      combinedCommentsBoxEnd = rowNum
      combinedCommentsColEnd = bannerCols
      paintCombinedCommentsDataRow(ws, rowNum, row, values, bannerCols)
      return
    }

    if (isManualAdTableHeader(values)) {
      endTableBox(rowNum - 1)
      inTable = true
      dataRowIndex = 0
      headerRowNum = rowNum
      tableHeaderLabels = values.map((c) => cellText(c))
      lastTableHeaderLabels = [...tableHeaderLabels]
      tableBoxCols = tableHeaderLabels.length
      tableBoxStart = rowNum
      tableHeaderLabels.forEach((h, i) => {
        const prev = colHeaderBest[i]
        if (!prev || widthForHeader(h) > widthForHeader(prev)) {
          colHeaderBest[i] = h
        }
      })
      paintManualAdTableHeader(row, tableHeaderLabels)
      row.height = 26
      return
    }

    if (isManualAdAppliedTotalRow(values)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      paintManualAdAppliedTotalRow(row, values)
      return
    }

    if (isIntegratedDualBlockTitleRow(values)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      paintIntegratedDualBlockTitleRow(ws, rowNum, row, values, headerFontSize)
      noteDualGapRow(rowNum)
      return
    }

    if (isIntegratedDualBlockHeaderRow(values)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = values.map((c) => cellText(c))
      lastTableHeaderLabels = [...tableHeaderLabels]
      paintIntegratedDualBlockHeaderRow(row, values, headerFontSize)
      noteDualGapRow(rowNum)
      return
    }

    if (isIntegratedDualBlockDataRow(values)) {
      inTable = false
      paintIntegratedDualBlockDataRow(row, values, cellFontSize)
      noteDualGapRow(rowNum)
      return
    }

    if (isIntegratedBlockTitleRow(values, sheetRows[ri + 1])) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      const span = sheetRows[ri + 1]?.filter((c) => cellText(c) !== '').length || 10
      paintIntegratedBlockTitleRow(ws, rowNum, row, cellText(values[0]), span, headerFontSize)
      return
    }

    if (isIntegratedPnlDataRow(values)) {
      inTable = false
      paintIntegratedPnlDataRow(row, values, cellFontSize)
      return
    }

    if (isIntegratedHorizontalKpiValueRow(values, sheetRows[ri - 1])) {
      inTable = false
      paintIntegratedHorizontalKpiValueRow(row, values, cellFontSize)
      return
    }

    if (isSectionRow(values) || isSubsectionRow(values)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      const span = sectionBannerColumnSpan(sheetRows, ri, tableBoxCols || bannerCols)
      paintFullRowBanner(ws, rowNum, row, cellText(values[0]), span, {
        font: { bold: true, size: 12, color: { argb: XL.sectionFg } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.sectionBg } },
        alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      })
      row.height = 24
      return
    }

    if (isMetaPairRow(values)) {
      endTableBox(rowNum - 1)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      paintMetaPairRow(row, cellText(values[0]), values[1], bannerCols)
      return
    }

    if (isKpiBlockHeader(values)) {
      endTableBox(rowNum - 1)
      inTable = false
      lastTableHeaderLabels = []
      paintTableHeaderRow(row, values.map((c) => cellText(c)))
      row.getCell(3).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      row.height = 26
      return
    }

    if (isMetaKpiRow(values)) {
      inTable = false
      paintMetaKpiRow(row, values)
      return
    }

    if (isTableHeaderRow(values)) {
      endTableBox(rowNum - 1)
      inTable = true
      dataRowIndex = 0
      headerRowNum = rowNum
      tableHeaderLabels = values.map((c) => cellText(c))
      lastTableHeaderLabels = [...tableHeaderLabels]
      const activeHeaders = tableHeaderLabels.filter((h) => cellText(h) !== '')
      tableBoxCols = activeHeaders.length
      tableBoxStart = rowNum
      tableHeaderLabels.forEach((h, i) => {
        if (!cellText(h)) return
        const prev = colHeaderBest[i]
        if (!prev || widthForHeader(h) > widthForHeader(prev)) {
          colHeaderBest[i] = h
        }
      })
      paintTableHeaderRow(row, tableHeaderLabels, headerFontSize)
      row.height = opts.fontSize ? 24 : 22
      return
    }

    if (isTotalRow(values)) {
      const fmtHeaders =
        tableHeaderLabels.length > 0 ? tableHeaderLabels : lastTableHeaderLabels
      const totalCols = Math.max(values.length, fmtHeaders.length, tableBoxCols)
      tableBoxCols = Math.max(tableBoxCols, totalCols)
      for (let ci = 0; ci < totalCols; ci += 1) {
        const val = ci < values.length ? values[ci] : ''
        const cell = row.getCell(ci + 1)
        const headerLabel = headerLabelAt(ci)
        const pct = headerImpliesPercent(headerLabel)
        const n = pct ? toExcelPercent(val) : parseNumeric(val)
        const fmt = inferNumFormat(headerLabel, val, opts.compactNumbers)
        if (ci === 0) {
          cell.value = val
          cell.font = { bold: true, size: cellFontSize, color: { argb: XL.totalFg } }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } }
          cell.alignment = { horizontal: 'left', vertical: 'middle' }
        } else if (Number.isFinite(n) && cellText(val) !== '') {
          cell.value = n
          if (fmt) cell.numFmt = fmt
          cell.font = { bold: true, size: cellFontSize, color: { argb: XL.totalFg } }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } }
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
        } else {
          cell.value = cellText(val) === '' ? null : val
          cell.font = { bold: true, size: cellFontSize, color: { argb: XL.totalFg } }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } }
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
        }
        cell.border = thinBorder()
      }
      row.height = 22
      endTableBox(rowNum)
      inTable = false
      tableHeaderLabels = []
      lastTableHeaderLabels = []
      return
    }

    if (inTable) {
      const colCount = Math.max(values.length, tableHeaderLabels.length)
      const stripe = dataRowIndex % 2 === 1
      dataRowIndex += 1
      tableBoxCols = Math.max(tableBoxCols, colCount)

      for (let ci = 0; ci < colCount; ci += 1) {
        const val = ci < values.length ? values[ci] : ''
        const cell = row.getCell(ci + 1)
        const headerLabel = headerLabelAt(ci)
        const wrap = isWrapColumn(headerLabel)
        const pct = headerImpliesPercent(headerLabel)
        const fmt = !wrap ? inferNumFormat(headerLabel, val, opts.compactNumbers) : null
        const n = pct ? toExcelPercent(val) : parseNumeric(val)

        if (ci > 0 && Number.isFinite(n) && !wrap && cellText(val) !== '' && n !== 0) {
          cell.value = n
          if (fmt) cell.numFmt = fmt
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          cell.font = { size: cellFontSize, color: { argb: 'FF1E293B' } }
          const h = cellText(headerLabel)
          if (pct && /(?:전일|전주|전월)\s*대비/.test(h)) {
            if (n > 0) cell.font = { size: cellFontSize, color: { argb: XL.positiveFg } }
            else if (n < 0) cell.font = { size: cellFontSize, color: { argb: XL.negativeFg } }
          } else if (n < 0) {
            cell.font = { size: cellFontSize, color: { argb: XL.negativeFg } }
          }
        } else {
          cell.value = cellText(val) === '' ? null : val
          cell.font = { size: cellFontSize, color: { argb: 'FF1E293B' } }
          cell.alignment = {
            horizontal: ci === 0 || wrap ? 'left' : 'right',
            vertical: wrap ? 'top' : 'middle',
            wrapText: wrap,
          }
          const h = cellText(headerLabel)
          if (/추이/.test(h)) {
            const t = cellText(val)
            if (t === '상승') cell.font = { size: cellFontSize, color: { argb: XL.positiveFg } }
            else if (t === '하락') cell.font = { size: cellFontSize, color: { argb: XL.negativeFg } }
          }
        }

        if (stripe) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.zebra } }
        }
        cell.border = thinBorder()
      }
      row.height = opts.fontSize ? 22 : 20
      return
    }

    writePlainRow(row, values)
  })

  closeCombinedCommentsBox(sheetRows.length)
  closeDualGapMerge()
  endTableBox(sheetRows.length)

  setColWidths(ws, sheetRows, colHeaderBest, opts)

  if (opts.freezeHeader && headerRowNum > 0 && opts.autoFilter !== false) {
    const lastRow = sheetRows.length
    const filterCols = tableBoxCols || globalMaxCols
    ws.views = [
      {
        state: 'frozen',
        ySplit: headerRowNum,
        topLeftCell: `A${headerRowNum + 1}`,
        activeCell: `A${headerRowNum + 1}`,
        showGridLines: true,
      },
    ]
    if (filterCols > 0 && lastRow > headerRowNum) {
      ws.autoFilter = {
        from: { row: headerRowNum, column: 1 },
        to: { row: lastRow, column: filterCols },
      }
    }
  }

  return ws
}

export function createBrandedWorkbook() {
  const wb = new ExcelJS.Workbook()
  wb.creator = '에쎄르 영업팀'
  wb.lastModifiedBy = 'essersales'
  wb.created = new Date()
  wb.modified = new Date()
  return wb
}

/** 엑셀 다운로드 — 한글 글꼴(맑은 고딕) 일괄 적용 */
export function applyKoreanFontToWorkbook(workbook, fontName = '맑은 고딕') {
  if (!workbook?.eachSheet) return workbook
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const prev = cell.font || {}
        cell.font = { ...prev, name: fontName, charset: 129 }
      })
    })
  })
  return workbook
}

export async function workbookToBuffer(workbook) {
  applyKoreanFontToWorkbook(workbook)
  return workbook.xlsx.writeBuffer()
}

export async function downloadExcelWorkbook(workbook, fileName) {
  const buffer = await workbookToBuffer(workbook)
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function padRowsUniform(rows) {
  return normalizeRows(rows)
}
