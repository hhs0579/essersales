import { getPool } from '../db/pool.js'
import { getSetting } from '../repositories/settingsRepository.js'
import { adaptPgRecordFromRow } from '../utils/pgRecordAdapter.js'
import { parseKpiQuery } from '../repositories/kpiRepository.js'
import { loadManualAdEntriesForScope } from './manualAdLoadService.js'
import { filterByScope } from '../utils/scopeFilter.js'
import { allowedUploadKindsForScope } from '../../../src/utils/scopeFilter.js'
import {
  getChannelByScope,
  isCombinedScope,
  isMonthlyScope,
  specialSaleScopeFor,
} from '../../../src/config/dataChannels.js'
import { EXTERNAL_AD_CHANNELS, resolveExternalAdScope } from '../../../src/config/externalAdChannels.js'
import {
  applyRecordFilters,
  applyKpiDetailFilters,
  filtersForDayOverDayLookup,
} from '../../../src/utils/recordFilters.js'
import { enrichExportRecords } from '../../../src/utils/combinedExportRecords.js'
import {
  COMBINED_HIDDEN_KPI_KEYS,
  combinedManualAdScopes,
  combinedIncludesPowerPrice,
} from '../../../src/config/combinedChannel.js'
import {
  POWER_PRICE_SCOPE,
  POWER_PRICE_HIDDEN_KPI_KEYS,
  isPowerPriceRecord,
} from '../../../src/config/powerPrice.js'
import { OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND } from '../../../src/config/ownMallManual.js'
import {
  COUPANG_1P_ROCKET_SCOPE,
  COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS,
} from '../../../src/config/coupang1pRocket.js'
import {
  PROFIT_LOSS_TEMPLATE_SCOPE,
  PROFIT_LOSS_TEMPLATE_KIND,
} from '../../../src/config/profitLossReport.js'
import {
  COMBINED_COMMENTS_SETTING_KIND,
  COMBINED_COMMENTS_SETTING_SCOPE,
  listCombinedCommentsInRange,
  normalizeCombinedCommentsStore,
} from '../../../src/config/combinedComments.js'

function parseExportQuery(query = {}) {
  const kpi = parseKpiQuery(query)
  return {
    ...kpi,
    scope: String(query.scope || 'platform').trim(),
    format: String(query.format || 'xlsx').trim(),
  }
}

async function loadDetailRows(filters) {
  const pool = getPool()
  const clauses = [`record_type = 'detail'`]
  const params = []
  let i = 1

  const scope = filters.scope || ''
  const kinds = allowedUploadKindsForScope(scope)
  if (kinds.length) {
    clauses.push(`upload_kind = ANY($${i++}::text[])`)
    params.push(kinds)
  }

  if (filters.platform) {
    clauses.push(`platform = $${i++}`)
    params.push(filters.platform)
  }
  if (filters.salesMethod) {
    clauses.push(`sales_method = $${i++}`)
    params.push(filters.salesMethod)
  }
  if (filters.storeName) {
    clauses.push(`store_name = $${i++}`)
    params.push(filters.storeName)
  }

  const where = `WHERE ${clauses.join(' AND ')}`
  const res = await pool.query(
    `SELECT
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       data, created_at, updated_at
     FROM sales_records ${where}
     ORDER BY created_at ASC`,
    params,
  )
  let rows = res.rows.map(adaptPgRecordFromRow).filter(Boolean)
  if (scope) {
    rows = filterByScope(rows, scope)
  }
  return rows
}

async function getSettingData(scope, kind) {
  const row = await getSetting(scope, kind)
  return row?.data ?? null
}

/** export 요청 body — 클라이언트 스냅샷(JSON 문자열·객체) */
function parseSettingOverride(raw) {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return null
}

/** DB·클라이언트 스냅샷 → { entries } (월별 저장 구조 호환) */
function normalizeSpecialSaleSetting(raw, monthKey = '') {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)

  if (o.months && typeof o.months === 'object') {
    const months = /** @type {Record<string, unknown>} */ (o.months)
    const mk = /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : ''
    const pickKey =
      mk && months[mk]
        ? mk
        : Object.keys(months).sort().pop() || ''
    const bucket = pickKey ? months[pickKey] : null
    if (bucket && typeof bucket === 'object') {
      const entries = /** @type {{ entries?: unknown[] }} */ (bucket).entries
      if (Array.isArray(entries) && entries.length) return { entries }
    }
    return { entries: [] }
  }

  if (Array.isArray(o.entries) && o.entries.length) {
    return { entries: o.entries }
  }
  if (o.totalSales || o.margin || o.marginRate) {
    return {
      entries: [
        {
          name: '특판',
          sales: o.totalSales ?? '',
          margin: o.margin ?? '',
        },
      ],
    }
  }
  return null
}

function resolveExportMonthKey(filterObj = {}) {
  const y = String(filterObj.year || '').trim()
  const mo = String(filterObj.month || '').trim()
  if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(mo)) {
    return `${y}-${String(mo).padStart(2, '0')}`
  }
  const to = String(filterObj.dateTo || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to.slice(0, 7)
  return ''
}

function buildManualAdByChannel(scope) {
  const period = isMonthlyScope(scope) ? 'monthly' : 'daily'
  if (!isCombinedScope(scope)) {
    const ch = EXTERNAL_AD_CHANNELS.find((c) => c.dailyScope === scope || c.monthlyScope === scope)
    return null
  }
  return EXTERNAL_AD_CHANNELS.filter((ch) =>
    combinedIncludesPowerPrice(scope) ? true : ch.dailyScope !== 'power_price',
  ).map((ch) => ({
    label: ch.label,
    entries: [],
  }))
}

/**
 * @param {Record<string, string | undefined>} query
 */
export async function loadExportPayload(query = {}) {
  const filters = parseExportQuery(query)
  const scope = filters.scope || 'platform'
  const channel = getChannelByScope(scope)
  const combined = isCombinedScope(scope)

  let allRecords = await loadDetailRows(filters)

  let powerPriceStore = null
  let ownMallStore = null
  let coupang1pStore = null
  if (combined) {
    if (combinedIncludesPowerPrice(scope)) {
      powerPriceStore = await getSettingData(POWER_PRICE_SCOPE, 'power_price')
    }
    ownMallStore = await getSettingData(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND)
  }
  if (scope === 'platform' || scope === 'platform_monthly' || combined) {
    coupang1pStore = await getSettingData(COUPANG_1P_ROCKET_SCOPE, 'coupang_1p_rocket')
  }
  allRecords = enrichExportRecords(allRecords, scope, {
    powerPriceStore,
    ownMallStore,
    coupang1pStore,
  })

  if (!allRecords.length) {
    const err = new Error('export할 데이터가 없습니다.')
    err.status = 404
    err.code = 'NO_DATA'
    throw err
  }

  const period = isMonthlyScope(scope) ? 'monthly' : 'daily'
  const filterObj = {
    dateFrom: filters.from || '',
    dateTo: filters.to || '',
    platform: filters.platform || '',
    salesMethod: filters.salesMethod || '',
    year: String(query.year || '').trim(),
    month: String(query.month || '').trim(),
    dayOfWeek: String(query.day_of_week ?? query.dayOfWeek ?? '').trim(),
    period,
    date: String(query.date || '').trim(),
    channel: String(query.channel || '').trim(),
    brand: String(query.brand || '').trim(),
    productName: String(query.product_name || query.productName || '').trim(),
    option: String(query.option || '').trim(),
  }

  const chartFilters =
    scope === POWER_PRICE_SCOPE || scope === COUPANG_1P_ROCKET_SCOPE || combined
      ? { ...filterObj, platform: '', salesMethod: '' }
      : filterObj

  const chartRecords = applyKpiDetailFilters(
    applyRecordFilters(allRecords, 'detail', chartFilters),
    chartFilters,
  )

  if (!chartRecords.length) {
    const err = new Error('선택한 조회 기간에 export할 데이터가 없습니다.')
    err.status = 404
    err.code = 'NO_DATA'
    throw err
  }

  let platformSplit = allRecords
  if (combined && combinedIncludesPowerPrice(scope)) {
    platformSplit = platformSplit.filter((r) => !isPowerPriceRecord(r))
  }
  const platformSplitRecords = applyKpiDetailFilters(
    applyRecordFilters(platformSplit, 'detail', { ...filterObj, platform: '' }),
    { ...filterObj, platform: '' },
  )

  const dayOverDayRecords = applyRecordFilters(
    allRecords,
    'detail',
    filtersForDayOverDayLookup(filterObj),
  )

  const manualScopes = combined ? combinedManualAdScopes(scope) : [scope]
  const manualAdEntries = filters.includeManualAds
    ? (await Promise.all(manualScopes.map((s) => loadManualAdEntriesForScope(s)))).flat()
    : []

  let manualAdByChannel = buildManualAdByChannel(scope)
  if (manualAdByChannel) {
    manualAdByChannel = await Promise.all(
      manualAdByChannel.map(async (g) => {
        const ch = EXTERNAL_AD_CHANNELS.find((c) => c.label === g.label)
        const adScope = ch ? resolveExternalAdScope(ch, period) : scope
        return {
          label: g.label,
          entries: filters.includeManualAds ? await loadManualAdEntriesForScope(adScope) : [],
        }
      }),
    )
  }

  const specialSaleOverride = parseSettingOverride(query.special_sale)
  const combinedCommentsOverride = parseSettingOverride(query.combined_comments)
  const specialSaleRaw = combined
    ? (specialSaleOverride ??
      (await getSettingData(specialSaleScopeFor(scope), 'special_sale')))
    : null
  const specialSale = normalizeSpecialSaleSetting(specialSaleRaw, resolveExportMonthKey(filterObj))
  let combinedComments = null
  if (combined) {
    if (combinedCommentsOverride) {
      combinedComments = combinedCommentsOverride
    } else {
      const raw =
        (await getSettingData(COMBINED_COMMENTS_SETTING_SCOPE, COMBINED_COMMENTS_SETTING_KIND)) ||
        (await getSettingData('combined_daily', COMBINED_COMMENTS_SETTING_KIND))
      const store = normalizeCombinedCommentsStore(raw)
      const days = listCombinedCommentsInRange(
        store.byDate,
        filterObj.dateFrom || '',
        filterObj.dateTo || '',
      )
      combinedComments = {
        labels: store.labels,
        byDate: store.byDate,
        days:
          filterObj.dateFrom &&
          filterObj.dateTo &&
          filterObj.dateFrom === filterObj.dateTo &&
          !days.length
            ? [
                {
                  date: filterObj.dateFrom,
                  comments: ['', '', '', ''],
                },
              ]
            : days,
      }
    }
  }
  const profitLossTemplate = combined
    ? await getSettingData(PROFIT_LOSS_TEMPLATE_SCOPE, PROFIT_LOSS_TEMPLATE_KIND)
    : null

  let hiddenKpiKeys = []
  if (combined) hiddenKpiKeys = COMBINED_HIDDEN_KPI_KEYS
  else if (scope === POWER_PRICE_SCOPE) hiddenKpiKeys = POWER_PRICE_HIDDEN_KPI_KEYS
  else if (scope === COUPANG_1P_ROCKET_SCOPE) hiddenKpiKeys = COUPANG_1P_ROCKET_HIDDEN_KPI_KEYS

  return {
    records: chartRecords,
    platformSplitRecords,
    dayOverDayRecords,
    filters: filterObj,
    channelLabel: combined ? '통합' : channel?.tabLabel || '매출',
    isCombined: combined,
    manualAdByChannel: manualAdByChannel || [
      { label: channel?.tabLabel || '외부 광고', entries: manualAdEntries },
    ],
    manualAdEntries,
    specialSale,
    combinedComments,
    hiddenKpiKeys,
    profitLossTemplate,
    uploads: [],
    selectedUploadIds: [],
  }
}

export { parseExportQuery }
