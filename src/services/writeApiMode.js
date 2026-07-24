/** @returns {'legacy' | 'pg'} */
export function getWriteApiMode() {
  const mode = String(import.meta.env.VITE_WRITE_API_MODE || 'pg').toLowerCase()
  return mode === 'legacy' ? 'legacy' : 'pg'
}

export function isPgWriteMode() {
  return getWriteApiMode() === 'pg'
}

export function isLegacyWriteMode() {
  return getWriteApiMode() === 'legacy'
}

export function getWriteApiModeLabel() {
  return getWriteApiMode().toUpperCase()
}
