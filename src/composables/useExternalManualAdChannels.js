import { computed, unref } from 'vue'
import { EXTERNAL_AD_CHANNELS, resolveExternalAdScope } from '../config/externalAdChannels.js'
import { useManualAdSpend } from './useManualAdSpend.js'

/** scope별 entries ref — 채널 전환 시에도 hydrate 유지 */
const entriesByScope = {}

/** @param {string} scope */
function entriesRefForScope(scope) {
  if (!entriesByScope[scope]) {
    entriesByScope[scope] = useManualAdSpend(scope).entries
  }
  return entriesByScope[scope]
}

/**
 * 베스트하임 / 사본느리 / 파워프라이스 외부 광고 entries (반응형)
 * @param {import('vue').MaybeRef<'daily'|'monthly'>} periodMode
 */
export function useExternalManualAdChannels(periodMode) {
  return computed(() => {
    const period = unref(periodMode) === 'monthly' ? 'monthly' : 'daily'
    return EXTERNAL_AD_CHANNELS.map((ch) => {
      const scope = resolveExternalAdScope(ch, period)
      return {
        label: ch.label,
        scope,
        entries: entriesRefForScope(scope).value,
      }
    })
  })
}
