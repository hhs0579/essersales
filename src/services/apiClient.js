import { isServerKpi } from './kpiSource.js'
import {
  pgFetchSalesRecords,
  pgFetchUploads,
  pgFetchAppSetting,
  pgFetchKpiSummary,
  pgFetchKpiDaily,
  pgFetchKpiByPlatform,
  pgFetchKpiBySegment,
  pgFetchKpiCompareYesterday,
  pgFetchSalesRecordsPage,
  pgDownloadTableExport,
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

/**
 * @param {string} [recordType]
 * @param {{
 *   includeData?: 'none' | 'lean' | 'full' | boolean,
 *   from?: string,
 *   to?: string,
 *   scope?: string,
 * }} [opts]
 */
export async function fetchSalesRecordsPage(recordType = 'detail', opts = {}) {
  return pgFetchSalesRecordsPage(recordType, opts)
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
export async function fetchKpiBySegment(filters = {}, opts = {}) {
  return pgFetchKpiBySegment(filters, opts)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function fetchKpiCompareYesterday(filters = {}, opts = {}) {
  return pgFetchKpiCompareYesterday(filters, opts)
}

export { isServerKpi, pgDownloadTableExport }

export async function fetchRecordsByUploadIds(recordType, uploadIds) {
  if (!uploadIds?.length) return []
  return fetchSalesRecords(recordType, {
    includeData: 'full',
    upload_ids: uploadIds.join(','),
  })
}

export async function fetchDetailRecordsByUploadIds(uploadIds) {
  return fetchRecordsByUploadIds('detail', uploadIds)
}
