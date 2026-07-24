/** 외부·타 채널 수동 광고 — 기업별 scope 분리 */

/**
 * @typedef {Object} ExternalAdChannel
 * @property {string} label
 * @property {string} dailyScope
 * @property {string} [monthlyScope]
 */

/** @type {ExternalAdChannel[]} */
export const EXTERNAL_AD_CHANNELS = [
  { label: '베스트하임', dailyScope: 'platform', monthlyScope: 'platform_monthly' },
  { label: '사본느리', dailyScope: 'company_b', monthlyScope: 'company_b_monthly' },
  { label: '파워프라이스', dailyScope: 'power_price' },
]

export const EXTERNAL_AD_LABELS = EXTERNAL_AD_CHANNELS.map((c) => c.label)

/** @param {ExternalAdChannel} channel @param {'daily'|'monthly'} [period] */
export function resolveExternalAdScope(channel, period = 'daily') {
  if (period === 'monthly' && channel.monthlyScope) return channel.monthlyScope
  return channel.dailyScope
}

/** @param {string} label */
export function isExternalAdChannelLabel(label) {
  return EXTERNAL_AD_LABELS.includes(label)
}

/** @param {string} scope — platform | company_b | platform_monthly 등 */
export function findExternalAdChannelByScope(scope) {
  if (!scope) return null
  return (
    EXTERNAL_AD_CHANNELS.find((ch) => ch.dailyScope === scope || ch.monthlyScope === scope) || null
  )
}
