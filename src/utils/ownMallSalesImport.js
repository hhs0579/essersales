import { loadXlsx } from './lazyXlsx.js'
import { createOwnMallSaleEntry } from '../config/ownMallManual.js'
import { buildOwnMallSalesImport } from './ownMallSalesParser.js'

function newId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** @param {ArrayBuffer} buffer */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** @param {string} base64 */
export function base64ToArrayBuffer(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * @param {File} file
 * @returns {Promise<import('../config/ownMallManual.js').OwnMallSalesSourceFile>}
 */
export async function fileToSalesSourceRecord(file) {
  const buffer = await file.arrayBuffer()
  return {
    id: newId('om-src'),
    fileName: file.name,
    dataBase64: arrayBufferToBase64(buffer),
    uploadedAt: new Date().toISOString(),
  }
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallSalesSourceFile} record
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 */
export async function parseSalesFromSourceRecord(record, products) {
  const buffer = base64ToArrayBuffer(record.dataBase64)
  const XLSX = await loadXlsx()
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
  const result = buildOwnMallSalesImport(products, aoa)
  return { ...result, fileName: record.fileName, sheetName, sourceId: record.id }
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallSaleEntry[]} sales
 */
export function partitionOwnMallSales(sales) {
  const manual = []
  const excel = []
  for (const entry of sales || []) {
    if (entry?.source === 'manual') manual.push(entry)
    else excel.push(entry)
  }
  return { manual, excel }
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallProduct[]} products
 * @param {import('../config/ownMallManual.js').OwnMallSalesSourceFile[]} salesSourceFiles
 */
export async function rebuildExcelSalesFromSources(products, salesSourceFiles) {
  /** @type {import('../config/ownMallManual.js').OwnMallSaleEntry[]} */
  const excelSales = []
  let skippedUnmatched = 0
  let skippedCanceled = 0
  let skippedNoDate = 0

  for (const record of salesSourceFiles || []) {
    if (!record?.dataBase64) continue
    try {
      const parsed = await parseSalesFromSourceRecord(record, products)
      skippedUnmatched += parsed.skippedUnmatched || 0
      skippedCanceled += parsed.skippedCanceled || 0
      skippedNoDate += parsed.skippedNoDate || 0
      for (const entry of parsed.sales || []) {
        entry.source = 'excel'
        entry.importSourceId = record.id
        excelSales.push(entry)
      }
    } catch {
      /* 손상된 원본은 건너뜀 */
    }
  }

  return { excelSales, skippedUnmatched, skippedCanceled, skippedNoDate }
}

/**
 * @param {import('../config/ownMallManual.js').OwnMallSalesSourceFile[]} files
 * @param {import('../config/ownMallManual.js').OwnMallSalesSourceFile} record
 */
export function upsertSalesSourceFile(files, record) {
  const list = Array.isArray(files) ? [...files] : []
  const idx = list.findIndex((f) => f.fileName === record.fileName)
  if (idx >= 0) list[idx] = record
  else list.push(record)
  return list
}

/** @param {import('../config/ownMallManual.js').OwnMallSaleEntry} entry */
export function markOwnMallSaleManual(entry) {
  entry.source = 'manual'
  delete entry.importSourceId
  return entry
}

/** @param {string} [defaultDate] */
export function createManualOwnMallSaleEntry(defaultDate = '') {
  return markOwnMallSaleManual(createOwnMallSaleEntry(defaultDate))
}
