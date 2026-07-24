/** @param {string | Date | null | undefined} val */
function toDateString(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'string') {
    const s = val.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    return s
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10)
  }
  return String(val)
}

function toStr(val) {
  if (val == null || val === '') return ''
  return String(val)
}

/** PostgreSQL records item → legacy rowToRecord 호환 형식 */
export function adaptPgRecord(item) {
  if (!item) return null
  const data = item.data && typeof item.data === 'object' ? item.data : {}

  const orderDate = toDateString(item.orderDate ?? item.order_date)
  const businessDate = toDateString(item.businessDate ?? item.business_date)
  const date = orderDate || businessDate || toDateString(data.date)

  return {
    ...data,
    id: item.id,
    uploadId: item.uploadId ?? item.upload_id,
    recordType: item.recordType ?? item.record_type,
    createdAt: item.createdAt ?? item.created_at,
    updatedAt: item.updatedAt ?? item.updated_at,
    date,
    orderDate,
    businessDate,
    platform: item.platform || data.platform || data.channel || '',
    channel: item.channel || data.channel || item.platform || '',
    salesMethod: item.salesMethod || data.salesMethod || '',
    brand: item.storeName || data.brand || data.storeName || '',
    storeName: item.storeName || data.storeName || data.brand || '',
    productCode: item.productCode || data.productCode || '',
    productName: item.productName || data.productName || '',
    option: item.optionName || data.option || '',
    sales: item.sales != null ? toStr(item.sales) : toStr(data.sales ?? data.actualPayment),
    salesQty:
      item.salesQty != null
        ? toStr(item.salesQty)
        : toStr(data.salesQty ?? data.quantity),
    netProfit:
      item.netProfit != null ? toStr(item.netProfit) : toStr(data.netProfit ?? data.margin),
    adSpend: item.adSpend != null ? toStr(item.adSpend) : toStr(data.adSpend),
    transactionType: item.transactionType || data.transactionType || '',
    uploadKind: item.uploadKind || data.uploadKind || '',
    uploadFormat: item.uploadFormat || data.uploadFormat || '',
    sourceFileName: data.sourceFileName || '',
  }
}

/** @param {unknown[]} items */
export function adaptPgRecordList(items) {
  return (items || []).map(adaptPgRecord).filter(Boolean)
}
