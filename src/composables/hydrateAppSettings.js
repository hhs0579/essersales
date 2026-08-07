import { hydrateManualAdForScope } from './useManualAdSpend.js'
import { EXTERNAL_AD_CHANNELS } from '../config/externalAdChannels.js'
import { hydratePowerPriceStore } from './usePowerPrice.js'
import { hydrateCoupang1pRocketStore } from './useCoupang1pRocket.js'
import { hydrateOwnMallManualStore } from './useOwnMallManual.js'
import { hydrateProfitLossTemplate } from './useProfitLossTemplate.js'
import { hydrateSpecialSaleForScope } from './useSpecialSale.js'
import { hydrateCombinedCommentsForScope } from './useCombinedComments.js'

/** @type {Promise<void> | null} */
let hydratePromise = null
let hydrateCompleted = false

/**
 * 서버 DB에서 파워프라이스·외부 광고·통합 코멘트 등 불러오기 (다른 PC와 공유)
 * @param {{ forceRefresh?: boolean }} [opts]
 */
export async function hydrateAppSettings(opts = {}) {
  const forceRefresh = Boolean(opts.forceRefresh)
  if (!forceRefresh && hydrateCompleted) return
  if (!forceRefresh && hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    const manualScopes = new Set(
      EXTERNAL_AD_CHANNELS.flatMap((ch) => [ch.dailyScope, ch.monthlyScope].filter(Boolean)),
    )
    const tasks = [
      hydratePowerPriceStore({ forceRefresh }),
      hydrateCoupang1pRocketStore({ forceRefresh }),
      hydrateOwnMallManualStore({ forceRefresh }),
      hydrateProfitLossTemplate({ forceRefresh }),
      hydrateSpecialSaleForScope('combined_daily', { forceRefresh }),
      hydrateSpecialSaleForScope('combined_monthly', { forceRefresh }),
      hydrateCombinedCommentsForScope('combined_comments', { forceRefresh }),
      ...[...manualScopes].map((scope) => hydrateManualAdForScope(scope, { forceRefresh })),
    ]
    await Promise.allSettled(tasks)
    hydrateCompleted = true
  })().finally(() => {
    hydratePromise = null
  })

  return hydratePromise
}

/** 설정 저장 성공 후 — 다음 hydrate가 다시 서버를 보도록 */
export function invalidateAppSettingsHydration() {
  hydrateCompleted = false
}
