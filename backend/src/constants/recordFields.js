/** 메타 필드 — PATCH body에서 무시 */
export const RECORD_PROTECTED_KEYS = new Set([
  'id',
  'uploadId',
  'upload_id',
  'recordType',
  'record_type',
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
  'orderDate',
  'order_date',
  'channel',
  'sourceFileName',
])

/** camelCase API 키 → DB 컬럼 */
export const RECORD_PATCH_FIELD_MAP = {
  platform: 'platform',
  salesMethod: 'sales_method',
  storeName: 'store_name',
  productCode: 'product_code',
  productName: 'product_name',
  optionName: 'option_name',
  sales: 'sales',
  salesQty: 'sales_qty',
  netProfit: 'net_profit',
  adSpend: 'ad_spend',
  businessDate: 'business_date',
  periodFrom: 'period_from',
  periodTo: 'period_to',
  transactionType: 'transaction_type',
  uploadKind: 'upload_kind',
  uploadFormat: 'upload_format',
}

export const RECORD_NUMERIC_COLUMNS = new Set([
  'sales',
  'sales_qty',
  'net_profit',
  'ad_spend',
])

export const RECORD_DATE_COLUMNS = new Set([
  'order_date',
  'business_date',
  'period_from',
  'period_to',
])
