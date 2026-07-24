import {
  getRecordById,
  patchRecordById,
  deleteRecordById,
} from '../repositories/recordsRepository.js'
import { assertPatchKeysAllowed, mergeRecordPatch } from '../utils/recordMerge.js'

function mapRecordResponse(row) {
  if (!row) return null
  return {
    id: row.id,
    uploadId: row.upload_id,
    recordType: row.record_type,
    platform: row.platform || '',
    salesMethod: row.sales_method || '',
    storeName: row.store_name || '',
    productCode: row.product_code || '',
    productName: row.product_name || '',
    optionName: row.option_name || '',
    sales: row.sales != null ? Number(row.sales) : null,
    salesQty: row.sales_qty != null ? Number(row.sales_qty) : null,
    netProfit: row.net_profit != null ? Number(row.net_profit) : null,
    adSpend: row.ad_spend != null ? Number(row.ad_spend) : null,
    businessDate: row.business_date,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    transactionType: row.transaction_type || '',
    uploadKind: row.upload_kind || '',
    uploadFormat: row.upload_format || '',
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} body
 */
export async function patchSalesRecord(id, body) {
  const row = await getRecordById(id)
  if (!row) {
    const err = new Error('not found')
    err.status = 404
    err.code = 'NOT_FOUND'
    throw err
  }

  const incoming = body?.fields && typeof body.fields === 'object' ? body.fields : body || {}
  assertPatchKeysAllowed(incoming)
  const { dataPayload, columns } = mergeRecordPatch(row, incoming)
  const updated = await patchRecordById(id, dataPayload, columns)
  return { ok: true, record: mapRecordResponse(updated) }
}

/**
 * @param {string} id
 */
export async function deleteSalesRecord(id) {
  const deleted = await deleteRecordById(id)
  if (!deleted) {
    const err = new Error('not found')
    err.status = 404
    err.code = 'NOT_FOUND'
    throw err
  }
  return { ok: true, id, deleted: true }
}
