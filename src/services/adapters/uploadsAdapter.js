import { toLegacyDateString } from '../../utils/textEncoding.js'

function toDateString(val) {
  return toLegacyDateString(val)
}

/** PostgreSQL uploads item → legacy Vue 형식 */
export function adaptPgUpload(item) {
  if (!item) return null
  return {
    id: item.id,
    fileName: item.fileName || item.file_name || '',
    platform: item.platform || '',
    uploadKind: item.uploadKind || item.upload_kind || '',
    businessDate: toDateString(item.businessDate ?? item.business_date),
    detailCount: item.detailCount ?? item.detail_count ?? 0,
    dailyCount: item.dailyCount ?? item.daily_count ?? 0,
    channelCount: item.channelCount ?? item.channel_count ?? 0,
    productCount: item.productCount ?? item.product_count ?? 0,
    productOptionCount: item.productOptionCount ?? item.product_option_count ?? 0,
    totalCount: item.totalCount ?? item.total_count ?? 0,
    salesMethod: item.salesMethod || item.sales_method || '',
    createdAt: item.uploadedAt || item.createdAt || item.created_at || '',
  }
}

/** @param {unknown[]} items */
export function adaptPgUploadList(items) {
  return (items || []).map(adaptPgUpload).filter(Boolean)
}
