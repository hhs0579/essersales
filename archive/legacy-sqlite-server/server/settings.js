import { db, nowIso } from './db.js'

const ALLOWED_SCOPES = new Set([
  'platform',
  'company_b',
  'platform_monthly',
  'company_b_monthly',
  'power_price',
  'coupang_1p_rocket',
  'sales_report',
  'combined_daily',
  'combined_monthly',
])
const ALLOWED_KINDS = new Set([
  'staff_memo',
  'power_price',
  'coupang_1p_rocket',
  'manual_ad',
  'profit_loss_template',
  'own_mall_manual',
  'special_sale',
  'combined_comments',
])

export function isValidSettingScope(scope) {
  return ALLOWED_SCOPES.has(String(scope || ''))
}

export function isValidSettingKind(kind) {
  return ALLOWED_KINDS.has(String(kind || ''))
}

/** @returns {{ data: unknown, updatedAt: string } | null} */
export function getAppSetting(scope, kind) {
  const row = db
    .prepare(`SELECT data, updated_at FROM app_settings WHERE scope = ? AND kind = ?`)
    .get(scope, kind)
  if (!row) return null
  try {
    return { data: JSON.parse(row.data), updatedAt: row.updated_at }
  } catch {
    return null
  }
}

/** @param {unknown} data */
export function putAppSetting(scope, kind, data) {
  const ts = nowIso()
  const json = JSON.stringify(data ?? null)
  db.prepare(
    `INSERT INTO app_settings (scope, kind, data, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(scope, kind, json, ts)
  return { updatedAt: ts }
}
