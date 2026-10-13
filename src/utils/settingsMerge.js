/**
 * app_settings 동시 저장 충돌 시 3-way 병합 (base = 마지막으로 서버에서 받은 값).
 * - 한쪽만 바뀐 값은 바뀐 쪽 채택
 * - 양쪽 모두 바뀐 객체는 키 단위로 재귀 병합
 * - id 있는 객체 배열은 id 단위 병합, 그 외 배열·원시값은 로컬(방금 편집) 우선
 * - 로컬 삭제 vs 서버 수정 → 서버 값 유지 (데이터 유실 방지)
 */

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/** jsonb는 키 순서를 바꾸므로 순서 무관 비교 */
export function deepEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null && a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false
    const ka = Object.keys(a).filter((k) => a[k] !== undefined)
    const kb = Object.keys(b).filter((k) => b[k] !== undefined)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false
}

function idOf(item) {
  if (!isPlainObject(item)) return null
  const id = item.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

function isIdArray(arr) {
  return Array.isArray(arr) && arr.every((x) => idOf(x) != null)
}

function mergeIdArrays(base, local, server) {
  const baseMap = new Map((base || []).map((x) => [idOf(x), x]))
  const localMap = new Map(local.map((x) => [idOf(x), x]))
  const serverMap = new Map(server.map((x) => [idOf(x), x]))
  const out = []
  const seen = new Set()

  const resolve = (id) => {
    const b = baseMap.get(id)
    const l = localMap.get(id)
    const s = serverMap.get(id)
    if (l !== undefined && s !== undefined) return mergeValues(b, l, s)
    if (l !== undefined) {
      // 서버에서 삭제됨: 로컬이 수정하지 않았으면 삭제 반영
      if (b !== undefined && deepEqual(b, l)) return undefined
      return l
    }
    if (s !== undefined) {
      // 로컬에서 삭제됨: 서버가 수정하지 않았으면 삭제 반영
      if (b !== undefined && deepEqual(b, s)) return undefined
      return s
    }
    return undefined
  }

  for (const item of local) {
    const id = idOf(item)
    if (seen.has(id)) continue
    seen.add(id)
    const v = resolve(id)
    if (v !== undefined) out.push(v)
  }
  for (const item of server) {
    const id = idOf(item)
    if (seen.has(id)) continue
    seen.add(id)
    const v = resolve(id)
    if (v !== undefined) out.push(v)
  }
  return out
}

/**
 * @param {unknown} base
 * @param {unknown} local
 * @param {unknown} server
 * @returns {unknown}
 */
export function mergeValues(base, local, server) {
  if (deepEqual(local, server)) return local
  if (deepEqual(base, local)) return server
  if (deepEqual(base, server)) return local

  if (isPlainObject(local) && isPlainObject(server)) {
    const b = isPlainObject(base) ? base : {}
    const out = {}
    const keys = new Set([...Object.keys(local), ...Object.keys(server)])
    for (const k of keys) {
      const inL = local[k] !== undefined
      const inS = server[k] !== undefined
      const inB = b[k] !== undefined
      if (inL && inS) {
        out[k] = mergeValues(b[k], local[k], server[k])
      } else if (inL) {
        if (inB && deepEqual(b[k], local[k])) continue
        out[k] = local[k]
      } else if (inS) {
        if (inB && deepEqual(b[k], server[k])) continue
        out[k] = server[k]
      }
    }
    return out
  }

  if (Array.isArray(local) && Array.isArray(server) && isIdArray(local) && isIdArray(server)) {
    return mergeIdArrays(isIdArray(base) ? base : [], local, server)
  }

  return local
}

/**
 * @param {unknown} base 마지막으로 서버에서 받은 data (없으면 null → 서버 항목 모두 보존)
 * @param {unknown} local 저장하려는 data
 * @param {unknown} server 현재 서버 data
 */
export function mergeSettingData(base, local, server) {
  // local null = 명시적 초기화(삭제)
  if (server == null || local == null) return local
  return mergeValues(base ?? null, local, server)
}
