import { adaptPgUploadList } from './adapters/uploadsAdapter.js'
import { adaptPgRecordList } from './adapters/recordsAdapter.js'
import { adaptPgSettingResponse, adaptPgSettingPutResponse } from './adapters/settingsAdapter.js'
import { adaptPgKpiSummary, adaptPgKpiDaily } from './adapters/kpiAdapter.js'
import {
  adaptPgKpiByPlatform,
  adaptPgKpiBySegment,
  adaptPgKpiCompareYesterday,
} from './adapters/platformKpiAdapter.js'
import { recordPgFetch } from './devApiStats.js'

/**
 * NAS(예: 192.168.0.245:8080)에서는 빌드에 localhost:3002가 들어가 있어도
 * nginx same-origin `/api/v1`을 쓴다. 로컬 Vite는 .env / 프록시를 따른다.
 */
function resolvePgApiBase() {
  const envBase = String(import.meta.env.VITE_PG_API_BASE || '').replace(/\/$/, '')
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return '/api/v1'
    }
  }
  return envBase || '/api/v1'
}

const PG_BASE = resolvePgApiBase()

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
      `PostgreSQL API(${PG_BASE})에 연결할 수 없습니다. NAS 주소 또는 API 서버를 확인하세요.`,
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

/**
 * @param {string} [recordType]
 * @param {{
 *   includeData?: 'none' | 'lean' | 'full' | boolean,
 *   from?: string,
 *   to?: string,
 *   scope?: string,
 * }} [opts]
 */
export async function pgFetchSalesRecords(recordType = 'detail', opts = {}) {
  const includeRaw = opts.includeData
  let includeData = 'lean'
  if (includeRaw === true || includeRaw === 'full') includeData = 'full'
  else if (includeRaw === false || includeRaw === 'none') includeData = 'none'
  else if (includeRaw === 'lean') includeData = 'lean'

  const items = await fetchAllPages(
    (page, limit) => {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        record_type: recordType,
        include_data: includeData === 'none' ? 'false' : includeData,
        sort: 'created_at',
        order: 'asc',
      })
      if (opts.from) qs.set('from', opts.from)
      if (opts.to) qs.set('to', opts.to)
      if (opts.scope) qs.set('scope', opts.scope)
      const uploadIds = opts.upload_ids || opts.uploadIds
      if (uploadIds) {
        qs.set(
          'upload_ids',
          Array.isArray(uploadIds) ? uploadIds.join(',') : String(uploadIds),
        )
      }
      return `/records?${qs}`
    },
    (body) => adaptPgRecordList(body.items),
  )
  return items
}

/**
 * 판매내역 표 — 한 페이지(기본 100건). 전량 fetchAllPages 를 쓰지 않는다.
 * @param {string} [recordType]
 * @param {Record<string, string | number | undefined>} [opts]
 */
export async function pgFetchSalesRecordsPage(recordType = 'detail', opts = {}) {
  const includeRaw = opts.includeData
  let includeData = 'full'
  if (includeRaw === true || includeRaw === 'full') includeData = 'full'
  else if (includeRaw === false || includeRaw === 'none') includeData = 'none'
  else if (includeRaw === 'lean') includeData = 'lean'

  const page = Math.max(1, Number(opts.page) || 1)
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 100))
  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    record_type: recordType,
    include_data: includeData === 'none' ? 'false' : includeData,
    sort: String(opts.sort || 'order_date'),
    order: String(opts.order || 'asc'),
  })

  const pass = [
    'scope',
    'from',
    'to',
    'start_date',
    'end_date',
    'platform',
    'sales_method',
    'store_name',
    'brand',
    'channel',
    'product_name',
    'product_code',
    'option',
    'option_name',
    'date',
    'year',
    'month',
    'day_of_week',
    'transaction_type',
    'row_kind',
    'upload_kind',
    'upload_format',
    'upload_ids',
    'tab',
    'view',
  ]
  for (const key of pass) {
    const v = opts[key]
    if (v != null && String(v).trim() !== '') qs.set(key, String(v).trim())
  }

  const t0 = performance.now()
  const body = await pgRequest(`/records?${qs}`)
  recordPgFetch({
    label: `records-page:${recordType}`,
    requests: 1,
    ms: performance.now() - t0,
    records: (body.items || body.data || []).length,
  })

  const rawItems = body.items || body.data || []
  const items =
    body.shape === 'legacy' ? rawItems : adaptPgRecordList(rawItems)
  const pagination = body.pagination || {
    page: body.page || page,
    limit: body.limit || limit,
    total: body.total || items.length,
    totalPages: Math.max(
      1,
      Math.ceil((body.total || items.length) / (body.limit || limit)),
    ),
  }
  return {
    items,
    pagination,
    summary: body.summary || null,
    total: pagination.total,
  }
}

/**
 * 표 엑셀 — 서버가 조회 조건 전체를 파일로 생성 (Vue 전량 로드 없음)
 * @param {Record<string, string>} params
 */
export async function pgDownloadTableExport(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim() !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const PG_BASE = getPgApiBase()
  let res
  try {
    res = await fetch(`${PG_BASE}/exports/table${suffix}`, { method: 'GET' })
  } catch {
    throw new Error('PostgreSQL export API에 연결할 수 없습니다.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message || body.message || `표 엑셀 실패 (${res.status})`
    throw new Error(msg)
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i)
  const fileName = decodeURIComponent(m?.[1] || m?.[2] || 'table.xlsx')
  const rowCount = Number(res.headers.get('X-Row-Count') || 0)
  return { blob, fileName, rowCount }
}

/**
 * @param {string} scope
 * @param {string} kind
 * @param {{ omitSources?: boolean }} [opts]
 */
export async function pgFetchAppSetting(scope, kind, opts = {}) {
  const qs = new URLSearchParams({ scope, kind })
  if (opts.omitSources) qs.set('omit_sources', '1')
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

function kpiQuerySuffix(filters = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && String(v).trim() !== '') qs.set(k, String(v))
  }
  return qs.toString() ? `?${qs}` : ''
}

/**
 * @param {Record<string, string>} [filters]
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function pgFetchKpiSummary(filters = {}, opts = {}) {
  const body = await pgRequest(`/kpi/summary${kpiQuerySuffix(filters)}`, {
    signal: opts.signal,
  })
  return adaptPgKpiSummary(body)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function pgFetchKpiDaily(filters = {}, opts = {}) {
  const body = await pgRequest(`/kpi/daily${kpiQuerySuffix(filters)}`, {
    signal: opts.signal,
  })
  return adaptPgKpiDaily(body)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function pgFetchKpiByPlatform(filters = {}, opts = {}) {
  const body = await pgRequest(`/kpi/by-platform${kpiQuerySuffix(filters)}`, {
    signal: opts.signal,
  })
  return adaptPgKpiByPlatform(body)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function pgFetchKpiBySegment(filters = {}, opts = {}) {
  const body = await pgRequest(`/kpi/by-segment${kpiQuerySuffix(filters)}`, {
    signal: opts.signal,
  })
  return adaptPgKpiBySegment(body)
}

/** @param {Record<string, string>} [filters] @param {{ signal?: AbortSignal }} [opts] */
export async function pgFetchKpiCompareYesterday(filters = {}, opts = {}) {
  const body = await pgRequest(`/kpi/compare-yesterday${kpiQuerySuffix(filters)}`, {
    signal: opts.signal,
  })
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
      `PostgreSQL API(${PG_BASE})에 연결할 수 없습니다. NAS 주소 또는 API 서버를 확인하세요.`,
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
