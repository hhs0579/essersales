/** legacy server/settings.js 와 동일 + 회귀용 __test__ scope */

export const ALLOWED_SETTING_SCOPES = new Set([
  'platform',
  'company_b',
  'platform_monthly',
  'company_b_monthly',
  'power_price',
  'coupang_1p_rocket',
  'sales_report',
  'combined_daily',
  'combined_monthly',
  'combined_comments',
  '__test__',
])

export const ALLOWED_SETTING_KINDS = new Set([
  'staff_memo',
  'power_price',
  'coupang_1p_rocket',
  'manual_ad',
  'profit_loss_template',
  'own_mall_manual',
  'special_sale',
  'combined_comments',
  'settings_write_regression',
])

export function isValidSettingScope(scope) {
  return ALLOWED_SETTING_SCOPES.has(String(scope || ''))
}

export function isValidSettingKind(kind) {
  return ALLOWED_SETTING_KINDS.has(String(kind || ''))
}
