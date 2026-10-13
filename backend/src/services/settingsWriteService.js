import {
  isValidSettingScope,
  isValidSettingKind,
} from '../constants/appSettings.js'
import { getSetting, saveSettingWithHistory } from '../repositories/settingsRepository.js'
import { OWN_MALL_MANUAL_SETTING_KIND } from '../../../src/config/ownMallManual.js'

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

/**
 * omit_sources 클라이언트가 base64 없이 PUT 해도 DB 원본 엑셀을 지우지 않음
 * @param {unknown} incoming
 * @param {unknown} existing
 */
export function mergeOwnMallManualPreserveSources(incoming, existing) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return incoming

  const next = /** @type {Record<string, unknown>} */ ({ ...incoming })
  const prev = /** @type {Record<string, unknown>} */ (existing)
  const nextFiles = Array.isArray(next.salesSourceFiles) ? next.salesSourceFiles : []
  const prevFiles = Array.isArray(prev.salesSourceFiles) ? prev.salesSourceFiles : []

  if (!prevFiles.length) return incoming

  const prevById = new Map()
  const prevByName = new Map()
  for (const item of prevFiles) {
    if (!item || typeof item !== 'object') continue
    const f = /** @type {Record<string, unknown>} */ (item)
    const b64 = typeof f.dataBase64 === 'string' ? f.dataBase64 : ''
    if (!b64) continue
    if (typeof f.id === 'string' && f.id) prevById.set(f.id, f)
    if (typeof f.fileName === 'string' && f.fileName) prevByName.set(f.fileName, f)
  }

  // 클라이언트가 파일 목록을 비웠는데 서버에 원본이 있으면 원본 유지
  if (!nextFiles.length && prevById.size + prevByName.size > 0) {
    next.salesSourceFiles = prevFiles
    if (!Array.isArray(next.sales) || next.sales.length === 0) {
      if (Array.isArray(prev.sales) && prev.sales.length) next.sales = prev.sales
    }
    return next
  }

  next.salesSourceFiles = nextFiles.map((item) => {
    if (!item || typeof item !== 'object') return item
    const f = /** @type {Record<string, unknown>} */ ({ ...item })
    const hasB64 = typeof f.dataBase64 === 'string' && f.dataBase64.length > 0
    if (hasB64) return f
    const id = typeof f.id === 'string' ? f.id : ''
    const name = typeof f.fileName === 'string' ? f.fileName : ''
    const from = (id && prevById.get(id)) || (name && prevByName.get(name)) || null
    if (from && typeof from.dataBase64 === 'string') {
      f.dataBase64 = from.dataBase64
    }
    return f
  })

  return next
}

/**
 * @param {string} scope
 * @param {string} kind
 * @param {{ omitSources?: boolean }} [opts]
 */
export async function getAppSetting(scope, kind, opts = {}) {
  assertScopeKind(scope, kind)
  const row = await getSetting(scope, kind, opts)
  if (!row) {
    return { ok: true, scope, kind, data: null, updatedAt: null }
  }
  return formatSettingResponse(row)
}

/**
 * @param {string} scope
 * @param {string} kind
 * @param {unknown} data
 * @param {{ checkBase?: boolean, baseUpdatedAt?: string | null }} [opts]
 *   checkBase=true 이면 서버 updated_at이 baseUpdatedAt과 다를 때 409 (다른 화면이 먼저 저장)
 */
export async function putAppSetting(scope, kind, data, opts = {}) {
  assertScopeKind(scope, kind)
  const isOwnMall = kind === OWN_MALL_MANUAL_SETTING_KIND
  const result = await saveSettingWithHistory(
    scope,
    kind,
    (existingData) =>
      isOwnMall ? mergeOwnMallManualPreserveSources(data, existingData) : data,
    {
      checkBase: Boolean(opts.checkBase),
      baseUpdatedAt: opts.baseUpdatedAt ?? null,
      needExistingData: isOwnMall,
    },
  )
  if (result.conflict) {
    const current = await getSetting(scope, kind, { omitSources: isOwnMall })
    const err = new Error('다른 화면에서 먼저 저장된 내용이 있습니다.')
    err.status = 409
    err.code = 'SETTING_CONFLICT'
    err.current = formatSettingResponse(current)
    throw err
  }
  return formatSettingResponse(result.row)
}
