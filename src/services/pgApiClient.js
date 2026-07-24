import { adaptPgUploadList } from './adapters/uploadsAdapter.js'
import { adaptPgRecordList } from './adapters/recordsAdapter.js'
import { adaptPgSettingResponse, adaptPgSettingPutResponse } from './adapters/settingsAdapter.js'
import { adaptPgKpiSummary, adaptPgKpiDaily } from './adapters/kpiAdapter.js'
import {
  adaptPgKpiByPlatform,
  adaptPgKpiCompareYesterday,
} from './adapters/platformKpiAdapter.js'
import { recordPgFetch } from './devApiStats.js'

const PG_BASE = (
  import.meta.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1'
).replace(/\/$/, '')

export function getPgApiBase() {
  return PG_BASE
}

/**
 * @param {string} path - e.g. `/records?page=1`
 */
export async function pgRequest(path, options = {}) {
  let res
  try {
    res = await fetch(`${PG_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    })
  } catch {
    throw new Error(
      `PostgreSQL API(${PG_BASE})에 연결할 수 없습니다. docker compose up 및 :3002 확인.`,
    )
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errMsg =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message || `PG API 요청 실패 (${res.status})`
    throw new Error(errMsg)
  }
  return body
}

async function fetchAllPages(buildPath, extractItems, label = 'fetch') {
  const items = []
  let page = 1
  const limit = 500
  let total = Infinity
  const t0 = performance.now()
  let requests = 0

  while (items.length < total) {
    const body = await pgRequest(buildPath(page, limit))
    requests += 1
    const batch = extractItems(body)
    items.push(...batch)
    total = body.total ?? items.length
    if (!batch.length || page * limit >= total) break
    page += 1
  }

  recordPgFetch({
    label,
    requests,
    ms: performance.now() - t0,
    records: items.length,
  })

  return items
}

export async function pgFetchUploads() {
  const items = await fetchAllPages(
    (page, limit) => `/uploads?page=${page}&limit=${limit}`,
    (body) => adaptPgUploadList(body.items),
    'uploads',
  )
  return items
}

export async function pgFetchSalesRecords(recordType = 'detail') {
  const items = await fetchAllPages(
    (page, limit) =>
      `/records?page=${page}&limit=${limit}&record_type=${encodeURIComponent(recordType)}&include_data=true&sort=created_at&order=asc`,
    (body) => adaptPgRecordList(body.items),
    `records:${recordType}`,
  )
  return items
}

export async function pgFetchAppSetting(scope, kind) {
  const qs = new URLSearchParams({ scope, kind })
  const body = await pgRequest(`/settings?${qs}`)
  return adaptPgSettingResponse(body.items)
}

export async function pgFetchAppSettingByPath(scope, kind) {
  const body = await pgRequest(
    `/settings/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`,
  )
  return adaptPgSettingPutResponse(body)
}

export async function pgPutAppSetting(scope, kind, data) {
  const body = await pgRequest(
    `/settings/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ data }),
    },
  )
  return adaptPgSettingPutResponse(body)
}

/**
 * @param {Record<string, string>} [filters]
 */
export async function pgFetchKpiSummary(filters = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && String(v).trim() !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const body = await pgRequest(`/kpi/summary${suffix}`)
  return adaptPgKpiSummary(body)
}

export async function pgFetchKpiDaily(filters = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && String(v).trim() !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const body = await pgRequest(`/kpi/daily${suffix}`)
  return adaptPgKpiDaily(body)
}

export async function pgFetchKpiByPlatform(filters = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && String(v).trim() !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const body = await pgRequest(`/kpi/by-platform${suffix}`)
  return adaptPgKpiByPlatform(body)
}

export async function pgFetchKpiCompareYesterday(filters = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && String(v).trim() !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const body = await pgRequest(`/kpi/compare-yesterday${suffix}`)
  return adaptPgKpiCompareYesterday(body)
}

export async function pgPatchSalesRecord(id, payload) {
  const body = await pgRequest(`/records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return body
}

export async function pgDeleteSalesRecord(id) {
  const body = await pgRequest(`/records/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  return body
}

export async function pgDeleteUpload(uploadId) {
  const body = await pgRequest(`/uploads/${encodeURIComponent(uploadId)}`, {
    method: 'DELETE',
  })
  return body
}

/**
 * multipart 엑셀 업로드 (Phase 3-1)
 * @param {File} file
 * @param {Record<string, string | boolean>} fields
 */
export async function pgUploadExcel(file, fields = {}) {
  const PG_BASE = getPgApiBase()
  const fd = new FormData()
  fd.append('file', file)
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') continue
    fd.append(k, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))
  }

  let res
  try {
    res = await fetch(`${PG_BASE}/uploads/excel`, {
      method: 'POST',
      body: fd,
    })
  } catch {
    throw new Error(
      `PostgreSQL API(${PG_BASE})에 연결할 수 없습니다. docker compose up 및 :3002 확인.`,
    )
  }

  const body = await res.json().catch(() => ({}))
  if (res.status === 409 && body.duplicate) {
    return body
  }
  if (!res.ok) {
    const errMsg =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message || body.message || `PG 업로드 실패 (${res.status})`
    throw new Error(errMsg)
  }
  return body
}
