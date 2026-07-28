/**

 * 데이터 채널 = 기업별 탭·DB 분리 (일별 엑셀만).

 * 기존 platform_daily / sales_daily_b 업로드 → 각 채널.

 */



/** @typedef {'daily' | 'monthly'} UploadModeId */



/**

 * @typedef {Object} DataChannelMode

 * @property {UploadModeId} id

 * @property {string} label

 * @property {string} scope

 * @property {string} uploadKind

 */



/**

 * @typedef {Object} DataChannel

 * @property {string} id

 * @property {string} tabLabel

 * @property {string} reportTitle

 * @property {string} description

 * @property {DataChannelMode[]} modes

 * @property {boolean} [esserDashboard]

 */



import {
  COMBINED_CHANNEL,
  COMBINED_CHANNEL_ID,
  isCombinedScope,
  combinedSourceScopes,
  combinedIncludesPowerPrice,
} from './combinedChannel.js'
import {
  COMBINED_COMMENTS_CHANNEL,
  COMBINED_COMMENTS_CHANNEL_ID,
  COMBINED_COMMENTS_SCOPE,
  isCombinedCommentsScope,
  isCombinedCommentsChannel,
} from './combinedCommentsChannel.js'

/** @type {DataChannel[]} */

export const DATA_CHANNELS = [

  {

    id: 'channel_a',

    tabLabel: '베스트하임',

    reportTitle: '일별 매출',

    description: '쿠팡 에쎄르 · 빅셀 일별 엑셀 (하루치 파일)',

    esserDashboard: true,

    modes: [

      {

        id: 'daily',

        label: '일별 엑셀',

        scope: 'platform',

        uploadKind: 'platform_daily',

      },

      {

        id: 'monthly',

        label: '월별 엑셀',

        scope: 'platform_monthly',

        uploadKind: 'platform_monthly',

      },

    ],

  },

  {

    id: 'channel_b',

    tabLabel: '사본느리',

    reportTitle: '일별 매출',

    description: '베스트하임과 동일 엑셀 형식 · 사본느리 전용 탭에만 저장',

    esserDashboard: true,

    modes: [

      {

        id: 'daily',

        label: '일별 엑셀',

        scope: 'company_b',

        uploadKind: 'sales_daily_b',

      },

      {

        id: 'monthly',

        label: '월별 엑셀',

        scope: 'company_b_monthly',

        uploadKind: 'sales_monthly_b',

      },

    ],

  },

  {

    id: 'channel_c',

    tabLabel: '파워프라이스',

    reportTitle: '일별 매출',

    description: '엑셀 없이 물품·판매·광고비를 직접 입력합니다. 매출 대시보드 KPI·그래프에 반영됩니다.',

    manualOnly: true,

    esserDashboard: true,

    modes: [

      {

        id: 'daily',

        label: '직접 입력',

        scope: 'power_price',

        uploadKind: 'power_price_manual',

      },

    ],

  },

  {

    id: 'channel_d',

    tabLabel: '쿠팡 1P 로켓',

    reportTitle: '쿠팡 1P 로켓 발주',

    description:

      '쿠팡 1P 로켓배송 발주를 직접 입력합니다. 공급매출·매입원가가 베스트하임 쿠팡 매출 KPI에 반영됩니다.',

    manualOnly: true,

    esserDashboard: true,

    modes: [

      {

        id: 'daily',

        label: '직접 입력',

        scope: 'coupang_1p_rocket',

        uploadKind: 'coupang_1p_rocket_manual',

      },

    ],

  },

  {
    id: 'channel_e',
    tabLabel: '기타 판매처',
    reportTitle: '특판 · 폐쇄몰',
    description:
      '에쎄르·베스트하임 특판/폐쇄몰 엑셀을 업로드합니다. 통합 대시보드에 판매처별 행으로 반영됩니다.',
    esserDashboard: true,
    closedMallChannel: true,
    modes: [
      {
        id: 'daily',
        label: '특판/폐쇄몰',
        scope: 'other_sellers',
        uploadKind: 'bestheim_closed_mall',
      },
    ],
  },

]



const DEFAULT_CHANNEL_ID = DATA_CHANNELS[0]?.id || 'channel_a'



const CHANNEL_UPLOAD_KINDS = new Set(

  DATA_CHANNELS.flatMap((c) => c.modes.map((m) => m.uploadKind)),

)



/** 기간 업로드 kind — UI 제거, DB에 남은 데이터용 */

export const DEPRECATED_PERIOD_UPLOAD_KINDS = new Set(['platform_period', 'sales_period_b'])

/** 월별 업로드 kind (1일~말일 엑셀) */

export const MONTHLY_UPLOAD_KINDS = new Set(['platform_monthly', 'sales_monthly_b'])



export function getDefaultChannelId() {

  return DEFAULT_CHANNEL_ID

}



/** @param {string} channelId */

export function getChannel(channelId) {
  if (channelId === COMBINED_CHANNEL_ID) return COMBINED_CHANNEL
  if (channelId === COMBINED_COMMENTS_CHANNEL_ID) return COMBINED_COMMENTS_CHANNEL
  return DATA_CHANNELS.find((c) => c.id === channelId) || DATA_CHANNELS[0]
}

/** 매출 대시보드 탭 순서 */
export function getDashboardChannels() {
  const power = DATA_CHANNELS.find((c) => c.id === 'channel_c')
  const coupang1p = DATA_CHANNELS.find((c) => c.id === 'channel_d')
  const otherSellers = DATA_CHANNELS.find((c) => c.id === 'channel_e')
  return [
    DATA_CHANNELS.find((c) => c.id === 'channel_a'),
    DATA_CHANNELS.find((c) => c.id === 'channel_b'),
    power,
    coupang1p,
    otherSellers,
    COMBINED_CHANNEL,
    COMBINED_COMMENTS_CHANNEL,
  ].filter(Boolean)
}



/** @param {string} scope */

export function getChannelByScope(scope) {
  if (isCombinedScope(scope)) return COMBINED_CHANNEL
  if (isCombinedCommentsScope(scope)) return COMBINED_COMMENTS_CHANNEL

  if (scope === 'platform_period') scope = 'platform'

  if (scope === 'company_b_period') scope = 'company_b'

  if (scope === 'platform_monthly') scope = 'platform'

  if (scope === 'company_b_monthly') scope = 'company_b'

  for (const ch of DATA_CHANNELS) {
    if (ch.modes.some((m) => m.scope === scope)) return ch
  }

  return null
}



/** @param {string} channelId @param {UploadModeId} [modeId] */

export function getMode(channelId, modeId = 'daily') {
  const ch = getChannel(channelId)
  return ch.modes.find((m) => m.id === modeId) || ch.modes[0]
}



/** @param {string} scope */

export function getModeByScope(scope) {
  if (isCombinedScope(scope)) {
    const mode = COMBINED_CHANNEL.modes.find((m) => m.scope === scope)
    if (mode) return { channel: COMBINED_CHANNEL, mode }
  }
  if (isCombinedCommentsScope(scope)) {
    return {
      channel: COMBINED_COMMENTS_CHANNEL,
      mode: COMBINED_COMMENTS_CHANNEL.modes[0],
    }
  }

  for (const ch of DATA_CHANNELS) {
    const mode = ch.modes.find((m) => m.scope === scope)
    if (mode) return { channel: ch, mode }
  }

  if (scope === 'platform_period' || scope === 'platform') {

    return { channel: getChannel('channel_a'), mode: getChannel('channel_a').modes[0] }

  }

  if (scope === 'company_b_period' || scope === 'company_b') {

    return { channel: getChannel('channel_b'), mode: getChannel('channel_b').modes[0] }

  }

  return null

}



/** @param {string} uploadKind */

export function getModeByUploadKind(uploadKind) {
  if (uploadKind === 'platform_period') {
    return { channel: getChannel('channel_a'), mode: getChannel('channel_a').modes[0] }
  }
  if (uploadKind === 'bestheim_closed_mall' || uploadKind === 'esser_closed_mall') {
    return { channel: getChannel('channel_e'), mode: getChannel('channel_e').modes[0] }
  }
  if (uploadKind === 'sales_period_b') {
    return { channel: getChannel('channel_b'), mode: getChannel('channel_b').modes[0] }
  }
  for (const ch of DATA_CHANNELS) {
    const mode = ch.modes.find((m) => m.uploadKind === uploadKind)
    if (mode) return { channel: ch, mode }
  }
  return null
}



/** @param {string} channelId */

export function uploadKindsForChannel(channelId) {
  if (channelId === 'channel_e') return ['esser_closed_mall', 'bestheim_closed_mall']
  return getChannel(channelId).modes.map((m) => m.uploadKind)
}



/** @param {string} scope */

export function uploadKindsForScope(scope) {
  if (isCombinedScope(scope)) {
    return combinedSourceScopes(scope).flatMap((s) => uploadKindsForScope(s))
  }

  if (isMonthlyScope(scope)) {
    return uploadKindsForScope(dailyScopeForMonthly(scope))
  }

  if (scope === 'platform') return ['platform_daily']

  if (scope === 'other_sellers') return ['esser_closed_mall', 'bestheim_closed_mall']

  const found = getModeByScope(scope)

  if (found?.mode?.uploadKind) {
    if (found.channel?.id === 'channel_e') {
      return ['esser_closed_mall', 'bestheim_closed_mall']
    }
    return [found.mode.uploadKind]
  }

  if (scope === 'sales_report') return ['sales_report']

  return []
}



export function allDataScopes() {
  const scopes = new Set()

  for (const ch of DATA_CHANNELS) {
    for (const m of ch.modes) scopes.add(m.scope)
  }

  for (const m of COMBINED_CHANNEL.modes) scopes.add(m.scope)

  scopes.add('sales_report')

  return [...scopes]
}



/** @param {string} scope */

export function usesEsserDashboard(scope) {
  if (isCombinedScope(scope)) return true

  const ch = getChannelByScope(scope)

  if (ch) return ch.esserDashboard !== false

  return scope === 'platform'
}



/** @param {string} uploadKind */

export function channelLabelForUploadKind(uploadKind) {
  if (uploadKind === 'bestheim_closed_mall' || uploadKind === 'esser_closed_mall') {
    return '기타 판매처'
  }

  for (const ch of DATA_CHANNELS) {

    if (ch.modes.some((m) => m.uploadKind === uploadKind)) return ch.tabLabel

  }

  return ''

}



export function isChannelUploadKind(kind) {
  if (kind === 'bestheim_closed_mall' || kind === 'esser_closed_mall') return true
  return CHANNEL_UPLOAD_KINDS.has(kind)
}

/** @param {string} channelId */
export function isClosedMallChannel(channelId) {
  return getChannel(channelId)?.closedMallChannel === true
}

/** @param {string} scope */
export function isOtherSellersScope(scope) {
  return scope === 'other_sellers'
}



/** @param {string} channelId */

export function isManualOnlyChannel(channelId) {

  const ch = getChannel(channelId)

  return ch?.manualOnly === true

}



/** @param {string} scope */

export function isPowerPriceScope(scope) {

  return scope === 'power_price'

}



/** @param {string} scope */

export function isCoupang1pRocketScope(scope) {

  return scope === 'coupang_1p_rocket'

}



/** @param {string} scope */

export function isMonthlyScope(scope) {
  return (
    scope === 'platform_monthly' ||
    scope === 'company_b_monthly' ||
    scope === 'combined_monthly'
  )
}



/** 월별 대시보드·광고 — 일별 scope와 공유 */
export function dailyScopeForMonthly(scope) {
  if (scope === 'platform_monthly') return 'platform'
  if (scope === 'company_b_monthly') return 'company_b'
  return scope
}

/** 통합 탭 — 특판 수동 입력 scope (월별 저장은 combined_monthly에 통일) */
export function specialSaleScopeFor(scope) {
  if (scope === 'combined_monthly' || scope === 'combined_daily') return 'combined_monthly'
  return 'combined_daily'
}

export {
  isCombinedScope,
  combinedSourceScopes,
  combinedIncludesPowerPrice,
  COMBINED_CHANNEL,
  COMBINED_CHANNEL_ID,
  COMBINED_COMMENTS_CHANNEL,
  COMBINED_COMMENTS_CHANNEL_ID,
  COMBINED_COMMENTS_SCOPE,
  isCombinedCommentsScope,
  isCombinedCommentsChannel,
}



export const LEGACY_BESTHEIM_UPLOAD_KINDS = new Set(['', 'sales_report'])


