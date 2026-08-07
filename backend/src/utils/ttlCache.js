/**
 * TTL 결과 캐시 + in-flight Promise 공유 (single-flight)
 * @template T
 */
export function createTtlCache(defaultTtlMs = 60000) {
  /** @type {Map<string, { value: T, expiresAt: number }>} */
  const results = new Map()
  /** @type {Map<string, Promise<T>>} */
  const inflight = new Map()

  function get(key) {
    const hit = results.get(key)
    if (!hit) return undefined
    if (Date.now() > hit.expiresAt) {
      results.delete(key)
      return undefined
    }
    return hit.value
  }

  /**
   * @param {string} key
   * @param {() => Promise<T>} factory
   * @param {number} [ttlMs]
   */
  function getOrLoad(key, factory, ttlMs = defaultTtlMs) {
    const cached = get(key)
    if (cached !== undefined) return Promise.resolve(cached)

    const pending = inflight.get(key)
    if (pending) return pending

    const p = Promise.resolve()
      .then(factory)
      .then((value) => {
        results.set(key, { value, expiresAt: Date.now() + ttlMs })
        return value
      })
      .finally(() => {
        if (inflight.get(key) === p) inflight.delete(key)
      })
    inflight.set(key, p)
    return p
  }

  /** @param {string | ((key: string) => boolean)} [matcher] */
  function invalidate(matcher) {
    if (matcher == null) {
      results.clear()
      inflight.clear()
      return
    }
    if (typeof matcher === 'string') {
      results.delete(matcher)
      inflight.delete(matcher)
      return
    }
    for (const key of [...results.keys()]) {
      if (matcher(key)) results.delete(key)
    }
    for (const key of [...inflight.keys()]) {
      if (matcher(key)) inflight.delete(key)
    }
  }

  function clearInflight() {
    inflight.clear()
  }

  return { get, getOrLoad, invalidate, clearInflight }
}
