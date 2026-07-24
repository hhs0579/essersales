import { loadXlsx } from './lazyXlsx.js'
import { parseAmount } from './parseAmount.js'

/** 자사몰 상품 엑셀 — A:상품번호 B:상품명 H:판매가 K:원가 (0-based index) */
export const OWN_MALL_CATALOG_COL = {
  productCode: 0,
  name: 1,
  salePrice: 7,
  unitCost: 10,
}

function cellStr(v) {
  if (v == null) return ''
  return String(v).trim()
}

function cellAmount(v) {
  if (v == null || v === '') return 0
  return parseAmount(v)
}

function isHeaderRow(row) {
  const name = cellStr(row[OWN_MALL_CATALOG_COL.name])
  const code = cellStr(row[OWN_MALL_CATALOG_COL.productCode])
  if (/상품명|제품명|product\s*name/i.test(name)) return true
  if (/상품번호|상품코드|product\s*code|품번|sku/i.test(code)) return true
  return false
}

/**
 * @param {Array<{ productCode?: string, name: string, salePrice?: string|number, unitCost?: string|number }>} candidates
 */
export function filterOwnMallCatalogItems(candidates) {
  const items = []
  let skippedZeroCost = 0
  let skippedEmpty = 0

  for (const c of candidates || []) {
    const name = cellStr(c.name)
    const unitCost = cellAmount(c.unitCost)
    const salePrice = cellAmount(c.salePrice)

    if (!name) {
      skippedEmpty += 1
      continue
    }
    if (!(unitCost > 0)) {
      skippedZeroCost += 1
      continue
    }

    items.push({
      productCode: cellStr(c.productCode),
      name,
      salePrice: String(Math.round(salePrice)),
      unitCost: String(Math.round(unitCost)),
    })
  }

  return { items, skippedZeroCost, skippedEmpty }
}

/**
 * @param {unknown[][]} aoa
 */
export function parseOwnMallCatalogFromAoa(aoa) {
  const candidates = []

  for (const row of aoa || []) {
    if (!row?.length) continue
    if (row.every((c) => cellStr(c) === '')) continue
    if (isHeaderRow(row)) continue

    candidates.push({
      productCode: cellStr(row[OWN_MALL_CATALOG_COL.productCode]),
      name: cellStr(row[OWN_MALL_CATALOG_COL.name]),
      salePrice: row[OWN_MALL_CATALOG_COL.salePrice],
      unitCost: row[OWN_MALL_CATALOG_COL.unitCost],
    })
  }

  return filterOwnMallCatalogItems(candidates)
}

/**
 * @param {string} text — 줄마다 상품명,판매가,원가 (또는 상품번호,상품명,판매가,원가)
 */
export function parseOwnMallCatalogText(text) {
  const candidates = []

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (/^(상품명|제품명|product|name)\b/i.test(line) && /판매|원가|price/i.test(line)) {
      continue
    }

    const parts = line.split(/[,|\t]/).map((s) => s.trim()).filter((s) => s !== '')
    if (parts.length < 3) continue

    if (parts.length >= 4) {
      candidates.push({
        productCode: parts[0],
        name: parts[1],
        salePrice: parts[2],
        unitCost: parts[3],
      })
    } else {
      candidates.push({
        name: parts[0],
        salePrice: parts[1],
        unitCost: parts[2],
      })
    }
  }

  return filterOwnMallCatalogItems(candidates)
}

/**
 * @param {File} file
 */
export async function parseOwnMallCatalogExcelFile(file) {
  const XLSX = await loadXlsx()
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  const parsed = parseOwnMallCatalogFromAoa(aoa)
  return { ...parsed, fileName: file.name, sheetName }
}

/** @param {{ items: unknown[], skippedZeroCost?: number, skippedEmpty?: number }} parsed */
export function formatOwnMallCatalogImportMessage(parsed, sourceLabel = '') {
  const n = parsed.items?.length || 0
  const skipCost = parsed.skippedZeroCost || 0
  const skipEmpty = parsed.skippedEmpty || 0
  const prefix = sourceLabel ? `「${sourceLabel}」` : ''
  if (!n) {
    return {
      ok: false,
      message: `${prefix}등록 가능한 상품이 없습니다. 원가(K열)가 0인 행은 제외됩니다.`,
    }
  }
  const parts = [`${prefix}${n}개 상품을 목록에 추가했습니다`]
  if (skipCost > 0) parts.push(`원가 0 제외 ${skipCost}건`)
  if (skipEmpty > 0) parts.push(`빈 행 제외 ${skipEmpty}건`)
  parts.push('하단 저장을 눌러 반영하세요.')
  return { ok: true, message: parts.join(' · ') }
}
