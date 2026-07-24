import * as XLSX from 'xlsx'
import {
  PROFIT_LOSS_TEMPLATE_VERSION,
  PROFIT_LOSS_FIELD_KEYS,
  PROFIT_LOSS_BRAND_HEADERS,
  PROFIT_LOSS_META_KEYS,
} from '../config/profitLossReport.js'

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g

/** @param {unknown} v */
function cellText(v) {
  if (v == null) return ''
  return String(v).trim()
}

/** @param {string} label */
function normalizeLabel(label) {
  return cellText(label).replace(/\s+/g, '').replace(/[()（）%％]/g, '')
}

const LABEL_FIELD_RULES = [
  [/^(총)?매출(액|금)?$/, 'sales'],
  [/^(매출)?원가(합계|총|금)?$|^원가$/, 'totalCost'],
  [/^(순이익|영업이익)(금)?$/, 'netProfit'],
  [/^(순이익|영업이익)률$/, 'netProfitRate'],
  [/^광고비(합계|총)?$/, 'adSpend'],
  [/^(광고매출|전환매출|광고전환매출)$/, 'adSales'],
  [/^자연매출$/, 'organicSales'],
  [/^자연매출(비율|률)$/, 'organicSalesRate'],
  [/^(판매)?수량$|^판매수량$/, 'salesQty'],
  [/^roas\(광고\)$|^roas광고$/, 'roas'],
  [/^roas\(전체\)$|^roas전체$/, 'salesRoas'],
  [/^객단가$|^aov$/, 'aov'],
]

/** @param {string} label */
export function inferFieldKeyFromLabel(label) {
  const norm = normalizeLabel(label)
  if (!norm) return ''
  for (const [re, key] of LABEL_FIELD_RULES) {
    if (re.test(norm)) return key
  }
  return ''
}

/** @param {string} token — `sales` | `brand:베스트하임.sales` | `period` */
export function parsePlaceholderToken(token) {
  const raw = cellText(token)
  if (!raw) return null
  if (PROFIT_LOSS_META_KEYS.includes(raw)) {
    return { type: 'meta', key: raw }
  }
  const brandMatch = raw.match(/^brand:([^.\s]+)\.(.+)$/)
  if (brandMatch) {
    return { type: 'brand', brand: brandMatch[1], fieldKey: brandMatch[2] }
  }
  if (PROFIT_LOSS_FIELD_KEYS.includes(raw)) {
    return { type: 'field', fieldKey: raw }
  }
  return { type: 'unknown', raw }
}

/**
 * @param {string[][]} aoa
 * @returns {{ row: number, col: number, token: string, parsed: ReturnType<typeof parsePlaceholderToken> }[]}
 */
function findPlaceholders(aoa) {
  /** @type {ReturnType<typeof findPlaceholders>} */
  const list = []
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || []
    for (let c = 0; c < row.length; c++) {
      const text = cellText(row[c])
      if (!text.includes('{{')) continue
      let match
      PLACEHOLDER_RE.lastIndex = 0
      while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
        list.push({
          row: r,
          col: c,
          token: match[1],
          parsed: parsePlaceholderToken(match[1]),
        })
      }
    }
  }
  return list
}

/**
 * @param {string[][]} aoa
 * @returns {{ row: number, brands: { col: number, label: string }[] } | null}
 */
function detectBrandHeaderRow(aoa) {
  for (let r = 0; r < Math.min(25, aoa.length); r++) {
    const row = aoa[r] || []
    const brands = []
    for (let c = 0; c < row.length; c++) {
      const text = cellText(row[c])
      if (!text) continue
      const hit = PROFIT_LOSS_BRAND_HEADERS.find((h) => text.includes(h))
      if (hit) brands.push({ col: c, label: hit === '전체' || hit === '종합' ? '합계' : hit })
    }
    if (brands.length >= 2) return { row: r, brands }
  }
  return null
}

/**
 * @param {string[][]} aoa
 * @param {{ row: number, brands: { col: number, label: string }[] }} header
 */
function detectLabelRowBindings(aoa, header) {
  /** @type {{ sheetRow: number, col: number, brand: string, fieldKey: string, label: string }[]} */
  const bindings = []
  const labelCols = [0, 1, 2]

  for (let r = header.row + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    let label = ''
    let labelCol = 0
    for (const lc of labelCols) {
      const t = cellText(row[lc])
      if (t) {
        label = t
        labelCol = lc
        break
      }
    }
    if (!label) continue
    const fieldKey = inferFieldKeyFromLabel(label)
    if (!fieldKey) continue
    for (const b of header.brands) {
      if (b.col <= labelCol) continue
      bindings.push({
        sheetRow: r,
        col: b.col,
        brand: b.label,
        fieldKey,
        label,
      })
    }
  }
  return bindings
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @param {string} fileName
 */
export function parseProfitLossTemplateFromBuffer(data, fileName = '') {
  const wb = XLSX.read(data, { type: 'array', cellDates: true })
  /** @type {import('../config/profitLossReport.js').ProfitLossTemplate['sheets']} */
  const sheets = []

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
    const colCount = aoa.reduce((m, row) => Math.max(m, (row || []).length), 0)
    const placeholders = findPlaceholders(aoa)
    const brandHeader = detectBrandHeaderRow(aoa)
    const labelBindings = brandHeader ? detectLabelRowBindings(aoa, brandHeader) : []

    sheets.push({
      name,
      rowCount: aoa.length,
      colCount,
      aoa,
      placeholders,
      brandHeader,
      labelBindings,
    })
  }

  const primary = sheets[0] || null
  const allPlaceholders = sheets.flatMap((s) =>
    s.placeholders.map((p) => ({ ...p, sheet: s.name })),
  )
  const allLabelBindings = sheets.flatMap((s) =>
    s.labelBindings.map((b) => ({ ...b, sheet: s.name })),
  )

  return {
    version: PROFIT_LOSS_TEMPLATE_VERSION,
    fileName: fileName || 'template.xlsx',
    uploadedAt: new Date().toISOString(),
    sheetNames: wb.SheetNames,
    sheets,
    summary: {
      sheetCount: sheets.length,
      placeholderCount: allPlaceholders.length,
      labelBindingCount: allLabelBindings.length,
      detectedBrands: [...new Set(allLabelBindings.map((b) => b.brand))],
      detectedFields: [...new Set(allLabelBindings.map((b) => b.fieldKey))],
      primarySheet: primary?.name || '',
      hasBrandHeader: Boolean(primary?.brandHeader),
    },
  }
}

/** @param {File} file */
export function parseProfitLossTemplateFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buf = e.target?.result
        if (!buf) throw new Error('파일을 읽을 수 없습니다.')
        resolve(parseProfitLossTemplateFromBuffer(buf, file.name))
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'))
    reader.readAsArrayBuffer(file)
  })
}

/** @param {unknown} raw */
export function normalizeStoredProfitLossTemplate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  if (!Array.isArray(o.sheets) || !o.sheets.length) return null
  if (o.version !== PROFIT_LOSS_TEMPLATE_VERSION) return null
  return /** @type {import('../config/profitLossReport.js').ProfitLossTemplate} */ (o)
}
