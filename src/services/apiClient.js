import { isServerKpi } from './kpiSource.js'
import {
  pgFetchSalesRecords,
  pgFetchUploads,
  pgFetchAppSetting,
  pgFetchKpiSummary,
  pgFetchKpiDaily,
  pgFetchKpiByPlatform,
  pgFetchKpiCompareYesterday,
} from './pgApiClient.js'

export async function fetchSalesRecords(recordType = 'detail') {
  return pgFetchSalesRecords(recordType)
}

export async function fetchUploads() {
  return pgFetchUploads()
}

export async function fetchAppSetting(scope, kind) {
  return pgFetchAppSetting(scope, kind)
}

/**
 * @param {Record<string, string>} [filters]
 */
export async function fetchKpiSummary(filters = {}) {
  return pgFetchKpiSummary(filters)
}

export async function fetchKpiDaily(filters = {}) {
  return pgFetchKpiDaily(filters)
}

export async function fetchKpiByPlatform(filters = {}) {
  return pgFetchKpiByPlatform(filters)
}

export async function fetchKpiCompareYesterday(filters = {}) {
  return pgFetchKpiCompareYesterday(filters)
}

export { isServerKpi }

export async function fetchRecordsByUploadIds(recordType, uploadIds) {
  if (!uploadIds?.length) return []
  const idSet = new Set(uploadIds)
  const all = await fetchSalesRecords(recordType)
  return all.filter((r) => idSet.has(r.uploadId))
}

export async function fetchDetailRecordsByUploadIds(uploadIds) {
  return fetchRecordsByUploadIds('detail', uploadIds)
}
