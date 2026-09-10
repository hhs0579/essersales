import { getPgApiBase } from './pgApiClient.js'

import { isPgExportMode } from './exportApiMode.js'



/**

 * PG 통합 export 다운로드

 * @param {Record<string, string>} params — 쿼리 파라미터 (scope, from, to …)

 * @param {Record<string, unknown>} [settingsOverrides] — 클라이언트 스냅샷 (special_sale, combined_comments …)

 */

export async function pgDownloadIntegratedExport(params = {}, settingsOverrides = {}) {

  const qs = new URLSearchParams()

  for (const [k, v] of Object.entries(params)) {

    if (v != null && String(v).trim() !== '') qs.set(k, String(v))

  }

  const suffix = qs.toString() ? `?${qs}` : ''



  const bodyKeys = Object.keys(settingsOverrides || {}).filter(

    (k) => settingsOverrides[k] != null,

  )

  const usePost = bodyKeys.length > 0



  const timeoutMs = Number(import.meta.env.VITE_EXPORT_TIMEOUT_MS || 300_000)

  const controller = new AbortController()

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)



  let res

  try {

    res = await fetch(`${getPgApiBase()}/exports/integrated${suffix}`, {

      method: usePost ? 'POST' : 'GET',

      headers: usePost ? { 'Content-Type': 'application/json' } : undefined,

      body: usePost ? JSON.stringify(settingsOverrides) : undefined,

      signal: controller.signal,

    })

  } catch (err) {

    if (err?.name === 'AbortError') {

      throw new Error(`엑셀 생성 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초). 잠시 후 다시 시도해 주세요.`)

    }

    throw new Error('PostgreSQL export API에 연결할 수 없습니다.')

  } finally {

    clearTimeout(timeoutId)

  }

  if (!res.ok) {

    const body = await res.json().catch(() => ({}))

    const msg =

      typeof body.error === 'string'

        ? body.error

        : body.error?.message || body.message || `export 실패 (${res.status})`

    throw new Error(msg)

  }

  const blob = await res.blob()

  const cd = res.headers.get('Content-Disposition') || ''

  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i)

  const fileName = decodeURIComponent(m?.[1] || m?.[2] || 'export.xlsx')

  return { blob, fileName }

}



export function triggerBlobDownload(blob, fileName) {

  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')

  a.href = url

  a.download = fileName

  a.rel = 'noopener'

  document.body.appendChild(a)

  a.click()

  a.remove()

  URL.revokeObjectURL(url)

}



export { isPgExportMode }

