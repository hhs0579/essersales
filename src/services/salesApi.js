import {
  pgPatchSalesRecord,
  pgDeleteSalesRecord,
  pgDeleteUpload,
  pgUploadExcel,
} from './pgApiClient.js'
import {
  fetchSalesRecords,
  fetchUploads,
  fetchRecordsByUploadIds,
  fetchDetailRecordsByUploadIds,
  fetchKpiSummary,
  fetchKpiDaily,
  fetchKpiByPlatform,
  fetchKpiCompareYesterday,
} from './apiClient.js'

export { fetchKpiSummary, fetchKpiDaily, fetchKpiByPlatform, fetchKpiCompareYesterday }

async function pgExcelUpload(file, fields) {
  const res = await pgUploadExcel(file, fields)
  if (res.duplicate) {
    throw new Error(res.message || '이미 업로드된 파일입니다.')
  }
  return {
    uploadId: res.uploadId,
    count: res.count,
    uploadKind: res.uploadKind,
    platform: res.platform,
  }
}

export async function saveSalesReportUpload({ file, fileName, parsed, platform = '' }) {
  if (!file) {
    throw new Error('엑셀 파일이 필요합니다.')
  }
  return pgExcelUpload(file, {
    upload_kind: 'sales_report',
    platform,
    replace_same_name: 'false',
  })
}

export async function savePlatformDailyUpload({
  file,
  fileName,
  platform,
  businessDate,
  details,
  salesMethod = '',
  uploadKind = 'platform_daily',
  uploadFormat = '',
}) {
  if (!file) {
    throw new Error('엑셀 파일이 필요합니다.')
  }
  return pgExcelUpload(file, {
    upload_kind: uploadKind,
    platform,
    sales_method: salesMethod,
    upload_format: uploadFormat,
    replace_same_name: 'true',
  })
}

export async function savePlatformMonthlyUpload({
  file,
  fileName,
  platform,
  businessDate,
  periodFrom,
  periodTo,
  details,
  salesMethod = '',
  uploadKind = 'platform_monthly',
  uploadFormat = '',
}) {
  if (!file) {
    throw new Error('엑셀 파일이 필요합니다.')
  }
  return pgExcelUpload(file, {
    upload_kind: uploadKind,
    platform,
    sales_method: salesMethod,
    upload_format: uploadFormat,
    replace_same_name: 'true',
  })
}

export async function savePlatformPeriodUpload({
  file,
  fileName,
  platform,
  businessDate,
  periodFrom,
  periodTo,
  details,
  salesMethod = '',
  uploadKind = 'platform_period',
  uploadFormat = '',
}) {
  if (!file) {
    throw new Error('엑셀 파일이 필요합니다.')
  }
  return pgExcelUpload(file, {
    upload_kind: uploadKind,
    platform,
    sales_method: salesMethod,
    upload_format: uploadFormat,
    replace_same_name: 'true',
  })
}

export { fetchSalesRecords, fetchUploads, fetchRecordsByUploadIds, fetchDetailRecordsByUploadIds }

export async function updateSalesRecord(id, fields) {
  return pgPatchSalesRecord(id, { fields })
}

export async function deleteSalesRecord(id) {
  return pgDeleteSalesRecord(id)
}

export async function deleteUploadAndRecords(uploadId) {
  return pgDeleteUpload(uploadId)
}
