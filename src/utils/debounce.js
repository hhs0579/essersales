/** @param {(...args: unknown[]) => void} fn @param {number} ms */
export function debounce(fn, ms = 400) {
  let timer = null
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }
}
