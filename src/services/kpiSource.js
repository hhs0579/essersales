/** @returns {'client' | 'server'} */
export function getKpiSource() {
  const source = String(import.meta.env.VITE_KPI_SOURCE || 'server').toLowerCase()
  return source === 'client' ? 'client' : 'server'
}

export function isServerKpi() {
  return getKpiSource() === 'server'
}

export function isClientKpi() {
  return !isServerKpi()
}

export function getKpiSourceLabel() {
  return getKpiSource().toUpperCase()
}
