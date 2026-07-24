import {
  isValidSettingScope,
  isValidSettingKind,
} from '../constants/appSettings.js'
import { getSetting, upsertSetting } from '../repositories/settingsRepository.js'

function assertScopeKind(scope, kind) {
  if (!isValidSettingScope(scope) || !isValidSettingKind(kind)) {
    const err = new Error('invalid scope or kind')
    err.status = 400
    err.code = 'INVALID_SETTING_KEY'
    throw err
  }
}

export function formatSettingResponse(row) {
  if (!row) {
    return { ok: true, scope: '', kind: '', data: null, updatedAt: null }
  }
  return {
    ok: true,
    scope: row.scope,
    kind: row.kind,
    data: row.data ?? null,
    updatedAt: row.updatedAt,
  }
}

export async function getAppSetting(scope, kind) {
  assertScopeKind(scope, kind)
  const row = await getSetting(scope, kind)
  if (!row) {
    return { ok: true, scope, kind, data: null, updatedAt: null }
  }
  return formatSettingResponse(row)
}

/**
 * @param {string} scope
 * @param {string} kind
 * @param {unknown} data
 */
export async function putAppSetting(scope, kind, data) {
  assertScopeKind(scope, kind)
  const row = await upsertSetting(scope, kind, data)
  return formatSettingResponse(row)
}
