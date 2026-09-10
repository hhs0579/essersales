import { getPool } from '../db/pool.js'
import { getSetting } from '../repositories/settingsRepository.js'
import { adaptPgRecordFromRow } from '../utils/pgRecordAdapter.js'
import { parseKpiQuery, buildKpiWhere } from '../repositories/kpiRepository.js'
import { addDaysToYmd } from '../utils/esserKpiAggregate.js'
import { loadManualAdEntriesForScope } from './manualAdLoadService.js'
import { filterByScope } from '../utils/scopeFilter.js'
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
  resolveRecordDateForAggregation,
} from '../../../src/utils/recordFilters.js'
import { enrichExportRecords } from '../../../src/utils/combinedExportRecords.js'
import { resolveOwnMallStoreForKpi } from '../../../src/utils/ownMallRecords.js'
import { buildSpecialSaleMonthlyTotals, addMonthsToMonthKey } from '../../../src/utils/dayOverDaySales.js'
import { pickSpecialSaleSettingForMonth, mergeSpecialSaleSettingRaw } from '../../../src/utils/specialSaleKpi.js'
import {
  pickManualExpenseSettingForMonth,
  mergeManualExpenseSettingRaw,
} from '../../../src/utils/manualExpenseKpi.js'
import { buildKpiSplitRowsForChannel } from '../../../src/utils/platformKpiSplit.js'
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

function parseExportQuery(query = {}) {
  const kpi = parseKpiQuery(query)
  return {
    ...kpi,
    scope: String(query.scope || 'platform').trim(),
    format: String(query.format || 'xlsx').trim(),
  }
}

/** export SQL — 전월 대비용 from (월별은 전월 1일, 일별은 40일) */
function exportSqlFilters(filters) {
  if (!filters.from || !filters.to) return filters
  const scope = filters.scope || ''
  let widenedFrom = filters.from

  if (isMonthlyScope(scope)) {
    const m = String(filters.from).match(/^(\d{4})-(\d{2})/)
    if (m) {
      const y = Number(m[1])
      const mo = Number(m[2])
      widenedFrom = mo === 1 ? `${y - 1}-12-01` : `${y}-${String(mo - 1).padStart(2, '0')}-01`
    }
  } else {
    widenedFrom = addDaysToYmd(filters.from, -40) || filters.from
  }

  if (!widenedFrom || widenedFrom === filters.from) return filters
  return { ...filters, from: widenedFrom }
}

/** enrich 직후 — 수기(자사몰·PP·1P) 전체 이력이 붙지 않도록 export 창으로 자름 */
function recordOverlapsExportWindow(row, from, to) {
  if (!from || !to) return true
  const d = resolveRecordDateForAggregation(row)
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d >= from && d <= to
  }
  const pf = String(row.periodFrom || row.period_from || '').slice(0, 10)
  const pt = String(row.periodTo || row.period_to || '').slice(0, 10)
  if (pf && pt) return pf <= to && pt >= from
  if (pf) return pf >= from && pf <= to
  return true
}

function trimRecordsToExportWindow(rows, from, to) {
  if (!from || !to || !rows?.length) return rows || []
  return rows.filter((r) => recordOverlapsExportWindow(r, from, to))
}

async function loadDetailRows(filters) {
  const pool = getPool()
  const { where, params } = buildKpiWhere(exportSqlFilters(filters))
  const whereClause = where
    ? where.replace(/^WHERE /i, "WHERE record_type = 'detail' AND ")
    : "WHERE record_type = 'detail'"

  const res = await pool.query(
    `SELECT
       id, upload_id, record_type,
       order_date, business_date, period_from, period_to,
       platform, sales_method, channel, store_name,
       product_code, product_name, option_name,
       sales, sales_qty, net_profit, ad_spend,
       transaction_type, upload_kind, upload_format,
       data, created_at, updated_at, kpi_date
     FROM sales_records ${whereClause}
     ORDER BY created_at ASC`,
    params,
  )
  let rows = res.rows.map(adaptPgRecordFromRow).filter(Boolean)
  const scope = filters.scope || ''
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

function specialSaleMonthlyTotalsFromRaw(raw, monthKey = '') {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  if (o.months && typeof o.months === 'object') {
    const flat = {}
    for (const [mk, bucket] of Object.entries(
      /** @type {Record<string, unknown>} */ (o.months),
    )) {
      const entries =
        bucket && typeof bucket === 'object' && Array.isArray(
          /** @type {{ entries?: unknown[] }} */ (bucket).entries,
        )
          ? /** @type {{ entries: unknown[] }} */ (bucket).entries
          : Array.isArray(bucket)
            ? bucket
            : []
      flat[mk] = entries
    }
    return buildSpecialSaleMonthlyTotals(flat)
  }
  if (Array.isArray(o.entries) && monthKey) {
    return buildSpecialSaleMonthlyTotals({ [monthKey]: o.entries })
  }
  return null
}

function resolveExportMonthKey(filterObj) {
  const y = String(filterObj.year || '').trim()
  const mo = String(filterObj.month || '').trim()
  if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(mo)) {
    return `${y}-${String(mo).padStart(2, '0')}`
  }
  const to = String(filterObj.dateTo || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) return to.slice(0, 7)
  const from = String(filterObj.dateFrom || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return from.slice(0, 7)
  return ''
}

/** 전월 필터 (YYYY-MM → dateFrom/dateTo/year/month) */
function filtersForPrevExportMonth(filterObj, exportMonthKey) {
  const prevMk = addMonthsToMonthKey(exportMonthKey, -1)
  if (!prevMk) return null
  const [y, m] = prevMk.split('-')
  const lastDay = new Date(Number(y), Number(m), 0).getDate()
  return {
    ...filterObj,
    dateFrom: `${prevMk}-01`,
    dateTo: `${prevMk}-${String(lastDay).padStart(2, '0')}`,
    year: y,
    month: String(Number(m)),
    platform: '',
    salesMethod: '',
  }
}

/**
 * 전월 통합 세그먼트 KPI 행 — 대시보드 by-segment 전월과 동일 SoT
 * (records 브랜드 DoD 폴백은 PG 행 분류 누락으로 0이 될 수 있음)
 */
function buildPrevMonthCombinedSegmentRows(
  allRecords,
  filterObj,
  exportMonthKey,
  manualAdByChannel,
  specialSaleRaw,
  manualExpenseRaw = null,
) {
  const prevFilters = filtersForPrevExportMonth(filterObj, exportMonthKey)
  if (!prevFilters) return []
  const prevMk = addMonthsToMonthKey(exportMonthKey, -1)
  const prevRecords = applyKpiDetailFilters(
    applyRecordFilters(allRecords || [], 'detail', prevFilters),
    prevFilters,
  )
  const prevSpecialSale = pickSpecialSaleSettingForMonth(specialSaleRaw, prevMk)
  const prevExpense = pickManualExpenseSettingForMonth(manualExpenseRaw, prevMk)
  const prevCtx = {
    ...prevFilters,
    specialSale: prevSpecialSale,
    manualExpense: prevExpense,
  }
  return buildKpiSplitRowsForChannel('통합', prevRecords, manualAdByChannel, prevCtx)
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
  }
  if (
    combined ||
    scope === 'company_b' ||
    scope === 'company_b_monthly'
  ) {
    ownMallStore = await resolveOwnMallStoreForKpi(
      await getSettingData(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND),
    )
  }
  if (scope === 'platform' || scope === 'platform_monthly' || combined) {
    coupang1pStore = await getSettingData(COUPANG_1P_ROCKET_SCOPE, 'coupang_1p_rocket')
  }
  allRecords = enrichExportRecords(allRecords, scope, {
    powerPriceStore,
    ownMallStore,
    coupang1pStore,
  })

  const sqlWindow = exportSqlFilters(filters)
  const exportWindowFrom = sqlWindow.from || filters.from || ''
  const exportWindowTo = filters.to || ''
  allRecords = trimRecordsToExportWindow(allRecords, exportWindowFrom, exportWindowTo)

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

  // 특판 수기는 월별 통합 엑셀에만 포함. 기간(일별) 다운로드에는 넣지 않음.
  const includeMonthlyExtras = combined && isMonthlyScope(scope)
  const exportMonthKey = resolveExportMonthKey(filterObj)
  const specialSaleOverride = includeMonthlyExtras
    ? parseSettingOverride(query.special_sale)
    : null
  const specialSaleDb = includeMonthlyExtras
    ? await getSettingData(specialSaleScopeFor(scope), 'special_sale')
    : null
  const specialSaleRaw = includeMonthlyExtras
    ? mergeSpecialSaleSettingRaw(specialSaleDb, specialSaleOverride, exportMonthKey)
    : null
  const specialSale = includeMonthlyExtras
    ? pickSpecialSaleSettingForMonth(specialSaleRaw, exportMonthKey)
    : null
  const specialSaleByMonth = includeMonthlyExtras
    ? specialSaleMonthlyTotalsFromRaw(specialSaleRaw, exportMonthKey)
    : null

  const expenseOverride = includeMonthlyExtras
    ? parseSettingOverride(query.manual_expense)
    : null
  const expenseDb = includeMonthlyExtras
    ? await getSettingData(specialSaleScopeFor(scope), 'manual_expense')
    : null
  const expenseRaw = includeMonthlyExtras
    ? mergeManualExpenseSettingRaw(expenseDb, expenseOverride, exportMonthKey)
    : null
  const manualExpense = includeMonthlyExtras
    ? pickManualExpenseSettingForMonth(expenseRaw, exportMonthKey)
    : null

  const channelManualAd =
    manualAdByChannel || [
      { label: channel?.tabLabel || '외부 광고', entries: manualAdEntries },
    ]

  // 전월 세그먼트 — 대시보드 전월대비와 동일 (엑셀 전월 0원 방지)
  const serverPrevMonthPlatformKpiRows =
    includeMonthlyExtras && exportMonthKey
      ? buildPrevMonthCombinedSegmentRows(
          allRecords,
          filterObj,
          exportMonthKey,
          channelManualAd,
          specialSaleRaw,
          expenseRaw,
        )
      : []

  const combinedComments = null
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
    manualAdByChannel: channelManualAd,
    manualAdEntries,
    specialSale,
    specialSaleByMonth,
    manualExpense,
    combinedComments,
    hiddenKpiKeys,
    profitLossTemplate,
    uploads: [],
    selectedUploadIds: [],
    summarySheetOnly: isMonthlyScope(scope),
    serverPrevMonthPlatformKpiRows,
  }
}

export { parseExportQuery }
