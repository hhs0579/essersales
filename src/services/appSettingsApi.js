import { fetchAppSetting } from './apiClient.js'
import { pgPutAppSetting } from './pgApiClient.js'

export { fetchAppSetting }

/**
 * settings 저장 — PUT 성공 후 GET으로 재확인 (optimistic update 없음)
 * @param {string} scope
 * @param {string} kind
 * @param {unknown} data
 * @returns {Promise<{ ok: boolean, data: unknown, updatedAt: string | null }>}
 */
export async function saveAppSetting(scope, kind, data) {
  await pgPutAppSetting(scope, kind, data)
  return fetchAppSetting(scope, kind)
}
