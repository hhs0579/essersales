/**
 * DEV 전용 — legacy API 호출 감시 (Phase 3-4A Full PG UI smoke)
 */
const calls = []

export function recordLegacyApiCall(path, method = 'GET') {
  if (!import.meta.env.DEV) return
  const entry = { path, method, at: Date.now() }
  calls.push(entry)
  console.warn(`[essersales] legacy API 호출 감지: ${method} ${path}`)
}

export function getLegacyApiCallLog() {
  return [...calls]
}

export function resetLegacyApiCallLog() {
  calls.length = 0
}

export function getLegacyApiCallCount() {
  return calls.length
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__esserLegacyApiCalls = calls
  window.__esserGetLegacyApiCallCount = () => calls.length
}
