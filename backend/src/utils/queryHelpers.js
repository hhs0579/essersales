/**
 * Shared query parsing for read APIs.
 */

export function parsePage(raw, defaultPage = 1) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return defaultPage
  return Math.floor(n)
}

export function parseLimit(raw, defaultLimit = 50, maxLimit = 500) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return defaultLimit
  return Math.min(Math.floor(n), maxLimit)
}

export function parseOffset(page, limit) {
  return (page - 1) * limit
}

/** @param {string | undefined} raw */
export function parseSort(raw, allowed, fallback = 'created_at') {
  const key = String(raw || fallback).trim()
  return allowed.includes(key) ? key : fallback
}

/** @param {string | undefined} raw */
export function parseOrder(raw) {
  return String(raw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
}

/** @param {string | undefined} raw */
export function parseOptionalDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

export function trimFilter(raw) {
  if (raw == null) return ''
  return String(raw).trim()
}
