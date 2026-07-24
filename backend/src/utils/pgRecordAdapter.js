/** PostgreSQL row → legacy rowToRecord 호환 (recordsAdapter 와 동일) */
import { toLegacyDateString } from '../../../src/utils/textEncoding.js'

function toDateString(val) {
  return toLegacyDateString(val)
}

function toStr(val) {
  if (val == null || val === '') return ''
  return String(val)
}

export function adaptPgRecordFromRow(row) {
  if (!row) return null
  const data = row.data && typeof row.data === 'object' ? row.data : {}

  const orderDate = toDateString(row.order_date)
  const businessDate = toDateString(row.business_date)
  const date = orderDate || businessDate || toDateString(data.date)

  return {
    ...data,
    id: row.id,
    uploadId: row.upload_id,
    recordType: row.record_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date,
    orderDate,
    businessDate,
    platform: row.platform || data.platform || data.channel || '',
    channel: row.channel || data.channel || row.platform || '',
    salesMethod: row.sales_method || data.salesMethod || '',
    brand: row.store_name || data.brand || data.storeName || '',
    storeName: row.store_name || data.storeName || data.brand || '',
    productCode: row.product_code || data.productCode || '',
    productName: row.product_name || data.productName || '',
    option: row.option_name || data.option || data.optionName || '',
    sales: row.sales != null ? toStr(row.sales) : toStr(data.sales ?? data.actualPayment),
    salesQty:
      row.sales_qty != null
        ? toStr(row.sales_qty)
        : toStr(data.salesQty ?? data.quantity),
    netProfit:
      row.net_profit != null ? toStr(row.net_profit) : toStr(data.netProfit ?? data.margin),
    adSpend: row.ad_spend != null ? toStr(row.ad_spend) : toStr(data.adSpend),
    transactionType: row.transaction_type || data.transactionType || '',
    uploadKind: row.upload_kind || data.uploadKind || '',
    uploadFormat: row.upload_format || data.uploadFormat || '',
    sourceFileName: data.sourceFileName || '',
  }
}
