/**
 * DEV 전용 — PG API fetch 통계 (Phase 1-5 성능 관찰)
 */
const stats = {
  lastFetch: null,
  cumulative: { requests: 0, ms: 0, records: 0 },
}

export function recordPgFetch({ label, requests = 1, ms = 0, records = 0 }) {
  if (!import.meta.env.DEV) return
  stats.lastFetch = { label, requests, ms: Math.round(ms), records, at: Date.now() }
  stats.cumulative.requests += requests
  stats.cumulative.ms += ms
  stats.cumulative.records += records
}

export function getDevApiStats() {
  return {
    lastFetch: stats.lastFetch,
    cumulative: {
      ...stats.cumulative,
      ms: Math.round(stats.cumulative.ms),
    },
  }
}

export function resetDevApiStats() {
  stats.lastFetch = null
  stats.cumulative = { requests: 0, ms: 0, records: 0 }
}
