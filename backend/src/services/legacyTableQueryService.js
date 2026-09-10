import { listMatchingRecords, listMatchingRecordsCursor } from '../repositories/recordsRepository.js'
import { getSetting } from '../repositories/settingsRepository.js'
import { getPool } from '../db/pool.js'
import { adaptPgRecordList } from '../../../src/services/adapters/recordsAdapter.js'
import { enrichExportRecords } from '../../../src/utils/combinedExportRecords.js'
import {
  buildLegacyTableRows,
  filterObjFromQuery,
  paginateLegacyTableRows,
  includesOtherSellersInTable,
} from '../../../src/utils/legacyTableRows.js'
import { buildSummaryTabFromDetails } from '../../../src/utils/salesAggregation.js'
import { sortRecordsForTab } from '../../../src/utils/recordSort.js'
import { isCombinedScope } from '../../../src/config/dataChannels.js'
import { combinedIncludesPowerPrice } from '../../../src/config/combinedChannel.js'
import { POWER_PRICE_SCOPE } from '../../../src/config/powerPrice.js'
import {
  OWN_MALL_MANUAL_SCOPE,
  OWN_MALL_MANUAL_SETTING_KIND,
} from '../../../src/config/ownMallManual.js'
import { COUPANG_1P_ROCKET_SCOPE } from '../../../src/config/coupang1pRocket.js'

async function getSettingData(scope, kind) {
  const row = await getSetting(scope, kind)
  return row?.data ?? null
}

export async function loadAllUploads() {
  const pool = getPool()
  const res = await pool.query(
    `SELECT
       id, file_name, file_type, platform, sales_method, upload_kind,
       business_date, period_from, period_to, parse_status, parse_error, created_at
     FROM uploads`,
  )
  return res.rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    fileType: row.file_type || '',
    platform: row.platform || '',
    salesMethod: row.sales_method || '',
    uploadKind: row.upload_kind,
    businessDate: row.business_date,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    status: row.parse_status,
    errorMessage: row.parse_error,
    uploadedAt: row.created_at,
    createdAt: row.created_at,
  }))
}

export async function loadManualStores(scope) {
  const combined = isCombinedScope(scope)
  let powerPriceStore = null
  let ownMallStore = null
  let coupang1pStore = null
  if (combined && combinedIncludesPowerPrice(scope)) {
    powerPriceStore = await getSettingData(POWER_PRICE_SCOPE, 'power_price')
  }
  if (combined || scope === 'company_b' || scope === 'company_b_monthly') {
    ownMallStore = await getSettingData(OWN_MALL_MANUAL_SCOPE, OWN_MALL_MANUAL_SETTING_KIND)
  }
  if (scope === 'platform' || scope === 'platform_monthly' || combined) {
    coupang1pStore = await getSettingData(COUPANG_1P_ROCKET_SCOPE, 'coupang_1p_rocket')
  }
  return { powerPriceStore, ownMallStore, coupang1pStore }
}

function isSummaryTableTab(tab) {
  return tab === 'daily' || tab === 'channel' || tab === 'product' || tab === 'productOption'
}

async function loadPgRecordsForTable(query, recordType, scope) {
  const useCursor = query.use_pg_cursor === true || query.use_pg_cursor === '1'
  const listFn = useCursor ? listMatchingRecordsCursor : listMatchingRecords
  const t0 = performance.now()
  const matched = await listFn(supersetListQuery(query, recordType))
  const t1 = performance.now()
  let items = matched.items || []
  if (includesOtherSellersInTable(scope)) {
    const extra = await listFn({
      ...supersetListQuery(query, recordType),
      scope: 'other_sellers',
    })
    items = items.concat(extra.items || [])
  }
  const t2 = performance.now()
  const adapted = adaptPgRecordList(items)
  return {
    records: adapted,
    timings: {
      pgQuery: Math.round(t1 - t0),
      pgExtraQuery: Math.round(t2 - t1),
      adapt: Math.round(performance.now() - t2),
    },
  }
}

function supersetListQuery(query, recordType) {
  return {
    record_type: recordType,
    include_data: 'full',
    scope: query.scope,
    upload_ids: query.upload_ids,
    start_date: query.start_date || query.from,
    end_date: query.end_date || query.to,
    from: query.from,
    to: query.to,
    filter_engine: 'js',
    sort: 'order_date',
    order: 'asc',
  }
}

/**
 * Vue 개선 전과 동일한 전체 행 (페이지 없음)
 */
export async function buildLegacyFilteredTableRows(query = {}) {
  const scope = String(query.scope || 'platform').trim()
  const rowKind = String(query.row_kind || '').toLowerCase()
  const tabRaw = String(query.tab || '').trim()
  const resolvedTab =
    tabRaw === 'returns' || rowKind === 'return'
      ? 'returns'
      : tabRaw || 'detail'
  const detailType = 'detail'

  const tLoad = performance.now()
  const [pgLoaded, uploads, stores] = await Promise.all([
    loadPgRecordsForTable(query, detailType, scope),
    loadAllUploads(),
    loadManualStores(scope),
  ])
  const pgRecords = pgLoaded.records
  const timings = { ...(pgLoaded.timings || {}), loadParallel: Math.round(performance.now() - tLoad) }

  const tEnrich = performance.now()
  const manualRecords = enrichExportRecords([], scope, stores)
  timings.enrichExportRecords = Math.round(performance.now() - tEnrich)
  const filters = filterObjFromQuery(query)
  const lineTab = resolvedTab === 'returns' ? 'returns' : 'detail'

  const tLegacy = performance.now()
  let rows = buildLegacyTableRows({
    pgRecords,
    uploads,
    manualRecords,
    scope,
    tab: lineTab,
    filters,
  })
  timings.buildLegacyTableRows = Math.round(performance.now() - tLegacy)
  Object.assign(timings, buildLegacyTableRows.lastTimings || {})

  if (isSummaryTableTab(resolvedTab)) {
    const tSum = performance.now()
    rows = sortRecordsForTab(buildSummaryTabFromDetails(resolvedTab, rows), resolvedTab)
    timings.summaryTab = Math.round(performance.now() - tSum)
  }

  let returnTotal = 0
  const skipReturnTotal = query.skip_return_total === true || query.skip_return_total === '1'
  if (!skipReturnTotal && (resolvedTab === 'detail' || isSummaryTableTab(resolvedTab))) {
    const tRet = performance.now()
    returnTotal = buildLegacyTableRows({
      pgRecords,
      uploads,
      manualRecords,
      scope,
      tab: 'returns',
      filters,
    }).length
    timings.returnsPass = Math.round(performance.now() - tRet)
  }

  return {
    rows,
    returnTotal,
    scope,
    tab: resolvedTab,
    filters,
    pgCount: pgRecords.length,
    manualCount: manualRecords.length,
    timings,
  }
}

export async function listTablePage(query = {}) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 100))
  const built = await buildLegacyFilteredTableRows(query)
  const paged = paginateLegacyTableRows(built.rows, page, limit)
  return {
    items: paged.items,
    data: paged.items,
    shape: 'legacy',
    page: paged.pagination.page,
    limit: paged.pagination.limit,
    total: paged.pagination.total,
    pagination: {
      ...paged.pagination,
      returnTotal: built.returnTotal,
      manualCount: built.manualCount,
    },
    summary: {
      salesTotal: null,
      quantityTotal: null,
    },
  }
}
