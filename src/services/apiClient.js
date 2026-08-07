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

/**
 * @param {string} [recordType]
 * @param {{
 *   includeData?: 'none' | 'lean' | 'full' | boolean,
 *   from?: string,
 *   to?: string,
 *   scope?: string,
 * }} [opts]
 */
export async function fetchSalesRecords(recordType = 'detail', opts = {}) {
  return pgFetchSalesRecords(recordType, opts)
}

export async function fetchUploads() {
  return pgFetchUploads()
}

/**
 * @param {string} scope
 * @param {string} kind
 * @param {{ omitSources?: boolean }} [opts]
 */
export async function fetchAppSetting(scope, kind, opts = {}) {
  return pgFetchAppSetting(scope, kind, opts)
}

/**
 * @param {Record<string, string>} [filters]
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function fetchKpiSummary(filters = {}, opts = {}) {
  return pgFetchKpiSummary(filters, opts)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function fetchKpiDaily(filters = {}, opts = {}) {
  return pgFetchKpiDaily(filters, opts)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function fetchKpiByPlatform(filters = {}, opts = {}) {
  return pgFetchKpiByPlatform(filters, opts)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function fetchKpiCompareYesterday(filters = {}, opts = {}) {
  return pgFetchKpiCompareYesterday(filters, opts)
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
