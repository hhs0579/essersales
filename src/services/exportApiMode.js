/** @returns {'legacy' | 'pg'} */
export function getExportApiMode() {
  const mode = String(import.meta.env.VITE_EXPORT_API_MODE || 'pg').toLowerCase()
  return mode === 'legacy' ? 'legacy' : 'pg'
}

export function isPgExportMode() {
  return getExportApiMode() === 'pg'
}

export function isLegacyExportMode() {
  return getExportApiMode() === 'legacy'
}

export function getExportApiModeLabel() {
  return getExportApiMode().toUpperCase()
}
