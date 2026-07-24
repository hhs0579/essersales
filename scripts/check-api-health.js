/**
 * PostgreSQL API health check (exit 0 = OK, 1 = unavailable)
 */
const port = Number(process.env.API_PORT || process.env.PORT || 3002)
const url = `http://127.0.0.1:${port}/api/v1/health`

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) {
    process.exit(1)
  }
  const body = await res.json()
  if (body?.ok === true || body?.status === 'ok') {
    process.exit(0)
  }
  process.exit(1)
} catch {
  process.exit(1)
}
