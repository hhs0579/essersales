/**
 * 특판 — 일별 필터 시 행 날짜만 매칭 (업로드 period 8/1~8/31 겹침 제외)
 */
import { matchDateRangeFilter } from '../src/utils/recordFilters.js'
import { rowMatchesKpiDateRange } from '../backend/src/utils/esserKpiAggregate.js'

const closedMallRow = {
  uploadKind: 'esser_closed_mall',
  uploadFormat: 'ESSER_CLOSED_MALL',
  platform: '특판 폐쇄몰',
  date: '2026-08-15',
  order_date: '2026-08-15',
  periodFrom: '2026-08-01',
  periodTo: '2026-08-31',
  sales: '10000',
}

const aug2 = { dateFrom: '2026-08-02', dateTo: '2026-08-02' }
const aug15 = { dateFrom: '2026-08-15', dateTo: '2026-08-15' }

let failed = 0
function check(label, cond) {
  if (!cond) {
    console.error('FAIL:', label)
    failed += 1
  } else {
    console.log('OK:', label)
  }
}

check('8/2 filter excludes 8/15 row (client)', !matchDateRangeFilter(closedMallRow, aug2.dateFrom, aug2.dateTo))
check('8/15 filter includes 8/15 row (client)', matchDateRangeFilter(closedMallRow, aug15.dateFrom, aug15.dateTo))
check(
  '8/2 filter excludes 8/15 row (server JS)',
  !rowMatchesKpiDateRange(
    {
      upload_kind: 'esser_closed_mall',
      order_date: '2026-08-15',
      period_from: '2026-08-01',
      period_to: '2026-08-31',
    },
    { from: '2026-08-02', to: '2026-08-02' },
  ),
)
check(
  '8/15 filter includes 8/15 row (server JS)',
  rowMatchesKpiDateRange(
    {
      upload_kind: 'esser_closed_mall',
      order_date: '2026-08-15',
      period_from: '2026-08-01',
      period_to: '2026-08-31',
    },
    { from: '2026-08-15', to: '2026-08-15' },
  ),
)

if (failed) {
  process.exit(1)
}
console.log('verify-closed-mall-date-filter: PASS')
