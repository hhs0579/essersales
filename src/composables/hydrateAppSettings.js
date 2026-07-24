import { hydrateManualAdForScope } from './useManualAdSpend.js'
import { EXTERNAL_AD_CHANNELS } from '../config/externalAdChannels.js'
import { hydratePowerPriceStore } from './usePowerPrice.js'
import { hydrateCoupang1pRocketStore } from './useCoupang1pRocket.js'
import { hydrateOwnMallManualStore } from './useOwnMallManual.js'
import { hydrateProfitLossTemplate } from './useProfitLossTemplate.js'
import { hydrateSpecialSaleForScope } from './useSpecialSale.js'
import { hydrateCombinedCommentsForScope } from './useCombinedComments.js'

/** 서버 DB에서 파워프라이스·외부 광고·통합 코멘트 등 불러오기 (다른 PC와 공유) */
export async function hydrateAppSettings() {
  const manualScopes = new Set(
    EXTERNAL_AD_CHANNELS.flatMap((ch) => [ch.dailyScope, ch.monthlyScope].filter(Boolean)),
  )
  const tasks = [
    hydratePowerPriceStore(),
    hydrateCoupang1pRocketStore(),
    hydrateOwnMallManualStore(),
    hydrateProfitLossTemplate(),
    hydrateSpecialSaleForScope('combined_daily'),
    hydrateSpecialSaleForScope('combined_monthly'),
    hydrateCombinedCommentsForScope('combined_comments'),
    ...[...manualScopes].map((scope) => hydrateManualAdForScope(scope)),
  ]
  await Promise.allSettled(tasks)
}
