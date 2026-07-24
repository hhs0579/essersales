/** @returns {'legacy' | 'pg'} */
export function getApiMode() {
  const mode = String(import.meta.env.VITE_API_MODE || 'pg').toLowerCase()
  return mode === 'legacy' ? 'legacy' : 'pg'
}

export function isPgMode() {
  return getApiMode() === 'pg'
}

export function isLegacyMode() {
  return getApiMode() === 'legacy'
}

export function getApiModeLabel() {
  return getApiMode().toUpperCase()
}
