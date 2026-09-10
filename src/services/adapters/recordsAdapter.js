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


/** PostgreSQL records item → legacy rowToRecord 호환 형식 */export function adaptPgRecord(item) {
  if (!item) return null
  const data = item.data && typeof item.data === 'object' ? item.data : {}

  const orderDate = toDateString(item.orderDate ?? item.order_date)
  const businessDate = toDateString(item.businessDate ?? item.business_date)
  const date = orderDate || businessDate || toDateString(data.date)

  const uploadKind = item.uploadKind || item.upload_kind || data.uploadKind || ''
  const uploadFormat = item.uploadFormat || item.upload_format || data.uploadFormat || ''
  const closedMall =
    uploadKind === 'bestheim_closed_mall' ||
    uploadKind === 'esser_closed_mall' ||
    uploadFormat === 'BESTHEIM_CLOSED_MALL' ||
    uploadFormat === 'ESSER_CLOSED_MALL'

  const storeName = toStr(item.storeName || item.store_name || data.storeName || data.closedMallSeller)
  const productBrand = closedMall
    ? toStr(data.productBrand || data.brand)
    : toStr(data.productBrand || '')

  const row = {
    ...data,
    id: item.id,
    uploadId: item.uploadId ?? item.upload_id,
    recordType: item.recordType ?? item.record_type,
    createdAt: item.createdAt ?? item.created_at,
    updatedAt: item.updatedAt ?? item.updated_at,
    date,
    orderDate,
    order_date: orderDate,
    businessDate,
    periodFrom: toDateString(item.periodFrom ?? item.period_from ?? data.periodFrom),
    periodTo: toDateString(item.periodTo ?? item.period_to ?? data.periodTo),
    platform: item.platform || data.platform || data.channel || '',
    channel: item.channel || data.channel || item.platform || '',
    salesMethod: item.salesMethod || item.sales_method || data.salesMethod || '',
    productCode: item.productCode || item.product_code || data.productCode || '',
    productName: item.productName || item.product_name || data.productName || '',
    option: item.optionName || item.option_name || data.option || '',
    sales: item.sales != null ? toStr(item.sales) : toStr(data.sales ?? data.actualPayment),
    salesQty:
      item.salesQty != null
        ? toStr(item.salesQty)
        : toStr(item.sales_qty ?? data.salesQty ?? data.quantity),
    netProfit:
      item.netProfit != null ? toStr(item.netProfit) : toStr(data.netProfit ?? data.margin),
    adSpend: item.adSpend != null ? toStr(item.adSpend) : toStr(data.adSpend),
    transactionType: item.transactionType || item.transaction_type || data.transactionType || '',
    uploadKind,
    upload_kind: uploadKind,
    uploadFormat,
    upload_format: uploadFormat,
    sourceFileName: data.sourceFileName || '',
    dataSourceLabel: data.dataSourceLabel || '',
    closedMallSeller: data.closedMallSeller || storeName,
    productBrand,
    brand: closedMall ? productBrand : storeName || data.brand || data.storeName || '',
    storeName: closedMall ? storeName : storeName || data.storeName || data.brand || '',
  }

  return row
}

/** @param {unknown[]} items */
export function adaptPgRecordList(items) {
  return (items || []).map(adaptPgRecord).filter(Boolean)
}
