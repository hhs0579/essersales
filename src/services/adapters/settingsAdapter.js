/** PostgreSQL settings item → legacy { ok, data, updatedAt } */
export function adaptPgSettingResponse(items) {
  const item = Array.isArray(items) ? items[0] : items
  if (!item) {
    return { ok: true, data: null, updatedAt: null }
  }
  return {
    ok: true,
    data: item.data ?? null,
    updatedAt: item.updatedAt ?? item.updated_at ?? null,
  }
}

/** PUT /settings/:scope/:kind 응답 → fetchAppSetting 호환 */
export function adaptPgSettingPutResponse(body) {
  if (!body) return { ok: true, data: null, updatedAt: null }
  return {
    ok: body.ok !== false,
    scope: body.scope,
    kind: body.kind,
    data: body.data ?? null,
    updatedAt: body.updatedAt ?? body.updated_at ?? null,
  }
}
