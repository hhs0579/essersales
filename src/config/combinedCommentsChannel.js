/** 매출 대시보드 — 통합 담당 코멘트 전용 탭 */

export const COMBINED_COMMENTS_SCOPE = 'combined_comments'
export const COMBINED_COMMENTS_CHANNEL_ID = 'channel_combined_comments'

/** @typedef {import('./dataChannels.js').DataChannel} DataChannel */

/** @type {DataChannel} */
export const COMBINED_COMMENTS_CHANNEL = {
  id: COMBINED_COMMENTS_CHANNEL_ID,
  tabLabel: '통합코멘트',
  reportTitle: '통합 담당 코멘트',
  description:
    '베스트하임·사본느리·파워프라이스·마케팅 코멘트를 날짜별로 저장합니다. 기간을 지정하면 그 구간의 일별 코멘트가 모두 표시됩니다.',
  commentsOnly: true,
  manualOnly: true,
  modes: [
    {
      id: 'daily',
      label: '일별 코멘트',
      scope: COMBINED_COMMENTS_SCOPE,
      uploadKind: 'combined_comments',
    },
  ],
}

/** @param {string} scope */
export function isCombinedCommentsScope(scope) {
  return scope === COMBINED_COMMENTS_SCOPE
}

/** @param {string} channelId */
export function isCombinedCommentsChannel(channelId) {
  return channelId === COMBINED_COMMENTS_CHANNEL_ID
}
