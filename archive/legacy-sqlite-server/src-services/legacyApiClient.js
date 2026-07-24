import { recordLegacyApiCall } from './devLegacyGuard.js'

const LEGACY_BASE = (
  import.meta.env.VITE_LEGACY_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  '/api'
).replace(/\/$/, '')

export function getLegacyApiBase() {
  return LEGACY_BASE
}

/**
 * @param {string} path - e.g. `/records?recordType=detail`
 */
export async function legacyRequest(path, options = {}) {
  recordLegacyApiCall(path, options.method || 'GET')
  let res
  try {
    res = await fetch(`${LEGACY_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    })
  } catch {
    const hint =
      LEGACY_BASE && !LEGACY_BASE.includes('localhost')
        ? `API 주소(${LEGACY_BASE})에 연결할 수 없습니다.`
        : 'API 서버(localhost:3001)에 연결할 수 없습니다. start-preview.cmd 를 실행했는지 확인하세요.'
    throw new Error(hint)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 404 && /\/uploads\/platform-(daily|monthly|period)/.test(path)) {
      throw new Error(
        '업로드 API를 찾을 수 없습니다. start-preview.cmd 를 다시 실행해 서버를 재시작하세요.',
      )
    }
    const errMsg =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message || `요청 실패 (${res.status})`
    throw new Error(errMsg)
  }
  return body
}

export async function legacyFetchSalesRecords(recordType = 'detail') {
  return legacyRequest(`/records?recordType=${encodeURIComponent(recordType)}`)
}

export async function legacyFetchUploads() {
  return legacyRequest('/uploads')
}

export async function legacyFetchAppSetting(scope, kind) {
  return legacyRequest(`/settings/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`)
}
