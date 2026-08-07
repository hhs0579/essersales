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

function envFlag(name, defaultValue = true) {
  const raw = import.meta.env[name]
  if (raw == null || String(raw).trim() === '') return defaultValue
  const v = String(raw).trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false
  return true
}

/**
 * 화면 상단 KPI·합계는 서버만 (클라 detail 재집계로 덮지 않음)
 * VITE_SERVER_KPI_ONLY=false 로 롤백 가능
 */
export function isServerKpiOnly() {
  return isServerKpi() && envFlag('VITE_SERVER_KPI_ONLY', true)
}

/**
 * 통합·기타 판매처도 detail 전량 await 없이 KPI 먼저 표시
 * VITE_LAZY_DETAIL_LOAD=false 로 이전 방식 복구 가능
 */
export function isLazyDetailLoad() {
  return isServerKpi() && envFlag('VITE_LAZY_DETAIL_LOAD', true)
}
