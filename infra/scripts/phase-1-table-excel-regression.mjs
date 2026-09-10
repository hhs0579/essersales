#!/usr/bin/env bun
/**
 * 1단계 회귀 — 판매내역 표 페이지네이션 / 필터 / 엑셀 도출값
 * bun infra/scripts/phase-1-table-excel-regression.mjs
 */
import ExcelJS from 'exceljs'
import { readFileSync } from 'fs'
import { loadDotEnv, pgConfigFromEnv } from './lib/migration-utils.mjs'
import { createPool, closePool, testConnection } from '../../backend/src/db/pool.js'
import {
  parseRecordsQuery,
  buildRecordsWhere,
  listMatchingRecords,
} from '../../backend/src/repositories/recordsRepository.js'
import {
  buildLegacyFilteredTableRows,
  listTablePage,
  loadAllUploads,
  loadManualStores,
} from '../../backend/src/services/legacyTableQueryService.js'
import { adaptPgRecordList } from '../../src/services/adapters/recordsAdapter.js'
import { enrichExportRecords } from '../../src/utils/combinedExportRecords.js'
import {
  applyRecordFilters,
} from '../../src/utils/recordFilters.js'
import { isReturnRecord } from '../../src/utils/transactionType.js'
import { isEsserSheetTotalRecord } from '../../src/utils/esserMetrics.js'
import {
  buildLegacyTableRows,
  paginateLegacyTableRows,
  filterObjFromQuery,
} from '../../src/utils/legacyTableRows.js'
import {
  RECORD_TYPES,
  resolveDetailColumns,
  sanitizeDetailColumns,
} from '../../src/constants/salesColumns.js'
import { buildTableWorkbook } from '../../src/utils/dashboardExporter.js'

const results = []

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  return pass
}

function cellDump(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if (value.result != null) return cellDump(value.result)
    if (value.formula != null) return `=${value.formula}`
    if (value.text != null) return String(value.text)
    if (value.richText) return value.richText.map((t) => t.text).join('')
    return JSON.stringify(value)
  }
  if (typeof value === 'number') return String(value)
  return String(value)
}

function dumpWorkbook(wb) {
  return wb.worksheets.map((ws) => {
    const rows = []
    const maxCol = ws.columnCount || 1
    ws.eachRow({ includeEmpty: true }, (row) => {
      const cells = []
      for (let c = 1; c <= Math.max(maxCol, row.cellCount || 0); c += 1) {
        cells.push(cellDump(row.getCell(c).value))
      }
      rows.push(cells)
    })
    return { name: ws.name, rows }
  })
}

function compareWorkbooks(a, b) {
  const da = dumpWorkbook(a)
  const db = dumpWorkbook(b)
  const diffs = []
  if (da.length !== db.length) {
    diffs.push(`sheetCount ${da.length} vs ${db.length}`)
    return diffs
  }
  for (let s = 0; s < da.length; s += 1) {
    if (da[s].name !== db[s].name) diffs.push(`sheet[${s}] name "${da[s].name}" vs "${db[s].name}"`)
    const ra = da[s].rows
    const rb = db[s].rows
    if (ra.length !== rb.length) {
      diffs.push(`sheet[${da[s].name}] rowCount ${ra.length} vs ${rb.length}`)
    }
    const n = Math.min(ra.length, rb.length)
    for (let r = 0; r < n; r += 1) {
      const ca = ra[r]
      const cb = rb[r]
      const cols = Math.max(ca.length, cb.length)
      if (r === 0 && ca.length !== cb.length) {
        diffs.push(`header colCount ${ca.length} vs ${cb.length}`)
      }
      if (r === 0) {
        for (let c = 0; c < cols; c += 1) {
          if ((ca[c] || '') !== (cb[c] || '')) {
            diffs.push(`header[${c}] "${ca[c]}" vs "${cb[c]}"`)
          }
        }
        continue
      }
      for (let c = 0; c < cols; c += 1) {
        if ((ca[c] || '') !== (cb[c] || '')) {
          diffs.push(`r${r + 1}c${c + 1} "${ca[c]}" vs "${cb[c]}"`)
          if (diffs.length > 25) return diffs
        }
      }
    }
  }
  return diffs
}

function sampleRows() {
  return [
    {
      id: 's1',
      date: '2026-08-01',
      platform: '쿠팡',
      channel: '쿠팡',
      salesMethod: '로켓그로스',
      brand: '에쎄르',
      productName: '비타민C',
      option: '30정',
      sales: '10000',
      salesQty: '2',
      uploadKind: 'platform_daily',
    },
    {
      id: 's2',
      date: '2026-08-02',
      platform: '스마트스토어',
      channel: '스마트스토어',
      salesMethod: '일반배송',
      brand: '',
      productName: '',
      option: '',
      sales: '5000',
      salesQty: '1',
      uploadKind: 'platform_daily',
    },
    {
      id: 's3',
      date: '2026-08-03',
      platform: '쿠팡',
      channel: '쿠팡',
      brand: '에쎄르',
      productName: '오메가3',
      sales: '-3000',
      salesQty: '-1',
      transactionType: 'return',
      uploadKind: 'platform_daily',
    },
    {
      id: 's4',
      date: '2026-08-10',
      platform: '쿠팡',
      channel: '쿠팡',
      brand: '테스트브랜드',
      productName: '한글검색상품',
      option: '대',
      sales: '0',
      salesQty: '0',
      uploadKind: 'platform_daily',
    },
    {
      id: 's5',
      date: '2026-07-01',
      platform: '쿠팡',
      channel: '쿠팡',
      brand: '에쎄르',
      productName: '기간밖',
      sales: '1',
      salesQty: '1',
      uploadKind: 'platform_daily',
    },
    {
      id: 'm1',
      date: '2026-08-01',
      platform: '쿠팡',
      channel: '쿠팡',
      productName: '1P수기',
      sales: '7000',
      salesQty: '1',
      isCoupang1pRocketManual: true,
    },
  ]
}

function runFilterCases() {
  const rows = sampleRows().filter((r) => r.id !== 'm1')
  const period = { dateFrom: '2026-08-01', dateTo: '2026-08-19' }

  const byPeriod = applyRecordFilters(rows, 'detail', period)
  record(
    '필터/기간',
    byPeriod.every((r) => r.date >= '2026-08-01' && r.date <= '2026-08-19') &&
      byPeriod.some((r) => r.id === 's1') &&
      !byPeriod.some((r) => r.id === 's5'),
    `n=${byPeriod.length}`,
  )

  const byYear = applyRecordFilters(rows, 'detail', { year: '2026' })
  record(
    '필터/연도',
    byYear.every((r) => String(r.date).startsWith('2026')) && byYear.length === rows.length,
  )
  const byMonth = applyRecordFilters(rows, 'detail', { year: '2026', month: '8' })
  record(
    '필터/월',
    byMonth.every((r) => String(r.date).slice(5, 7) === '08') && !byMonth.some((r) => r.id === 's5'),
  )
  const saturday = String(new Date(2026, 7, 1).getDay())
  const byDow = applyRecordFilters(rows, 'detail', { ...period, dayOfWeek: saturday })
  record(
    '필터/요일',
    byDow.length >= 1 &&
      byDow.every((r) => {
        const [y, m, d] = String(r.date).split('-').map(Number)
        return new Date(y, m - 1, d).getDay() === Number(saturday)
      }),
    `n=${byDow.length} dow=${saturday}`,
  )

  const byPlat = applyRecordFilters(rows, 'detail', { ...period, platform: '쿠팡' })
  record(
    '필터/플랫폼',
    byPlat.every((r) => r.platform === '쿠팡') && !byPlat.some((r) => r.id === 's2'),
  )

  const byMethod = applyRecordFilters(rows, 'detail', {
    ...period,
    salesMethod: '로켓그로스',
  })
  record('필터/판매방식', byMethod.length === 1 && byMethod[0].id === 's1')

  const byChannel = applyRecordFilters(rows, 'detail', { ...period, channel: '쿠팡' })
  record(
    '필터/판매처 부분검색',
    byChannel.every((r) => String(r.channel).includes('쿠팡')),
  )

  const byBrandEmpty = applyRecordFilters(rows, 'detail', { ...period, brand: '에쎄르' })
  record(
    '필터/브랜드 빈문자열 제외',
    byBrandEmpty.every((r) => r.brand && String(r.brand).includes('에쎄르')) &&
      !byBrandEmpty.some((r) => r.id === 's2'),
  )

  const byName = applyRecordFilters(rows, 'detail', { ...period, productName: '한글' })
  record('필터/한글 부분검색 상품명', byName.length === 1 && byName[0].id === 's4')

  const byOption = applyRecordFilters(rows, 'detail', { ...period, option: '30정' })
  record(
    '필터/옵션(상세탭은 기존처럼 미적용)',
    byOption.some((r) => r.id === 's1') && byOption.some((r) => r.id === 's4'),
    'detail 탭은 option 필터를 쓰지 않음',
  )

  const nullBrand = applyRecordFilters(
    [{ ...rows[0], id: 'n1', brand: null, productName: 'x', date: '2026-08-01' }],
    'detail',
    { ...period, brand: '에쎄르' },
  )
  record('필터/NULL 브랜드', nullBrand.length === 0)

  const emptyBrand = applyRecordFilters(
    [{ ...rows[0], id: 'e1', brand: '', productName: 'x', date: '2026-08-01' }],
    'detail',
    { ...period, brand: '에쎄르' },
  )
  record('필터/빈 문자열 브랜드', emptyBrand.length === 0)

  const sales = rows.filter((r) => !isReturnRecord(r) && !isEsserSheetTotalRecord(r))
  const returns = rows.filter((r) => isReturnRecord(r))
  record('필터/반품 제외', sales.every((r) => r.id !== 's3') && returns.some((r) => r.id === 's3'))

  const neg = isReturnRecord({ sales: '-1', salesQty: '1' }) && isReturnRecord({ sales: '1', salesQty: '-1' })
  record('필터/음수 sales·sales_qty → 반품', neg)

  const typedSale = !isReturnRecord({ transactionType: 'sale', sales: '-100' })
  record('필터/transactionType=sale 이면 음수여도 판매(기존 JS)', typedSale)
}

function runSqlWhereCases() {
  const q = parseRecordsQuery({
    filter_engine: 'js',
    record_type: 'detail',
    scope: 'platform',
    start_date: '2026-08-01',
    end_date: '2026-08-19',
    platform: '쿠팡',
    sales_method: '로켓그로스',
    brand: '에쎄르',
    channel: '쿠팡',
    product_name: '비타민',
    option: '30정',
    row_kind: 'sale',
    year: '2026',
    month: '8',
  })
  const { where } = buildRecordsWhere(q)
  record(
    'SQL jsMatch는 플랫폼/상품/반품 WHERE를 넣지 않음',
    !/platform\s*=/.test(where) &&
      !/product_name/i.test(where) &&
      !/transaction_type/.test(where) &&
      /record_type/.test(where) &&
      /kpi_date/.test(where),
    where.slice(0, 180),
  )
}

function runManualPaginationCases() {
  const pgRecords = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    uploadId: 'u1',
    date: `2026-08-${String(i + 2).padStart(2, '0')}`,
    platform: '쿠팡',
    channel: '쿠팡',
    productName: `상품${i + 1}`,
    sales: '1000',
    salesQty: '1',
    uploadKind: 'platform_daily',
  }))
  const manuals = [
    {
      id: 'manual-early',
      date: '2026-08-01',
      platform: '쿠팡',
      channel: '쿠팡',
      productName: '1P수기',
      sales: '9000',
      salesQty: '1',
      isCoupang1pRocketManual: true,
    },
    {
      id: 'manual-late',
      date: '2026-08-20',
      platform: '쿠팡',
      channel: '쿠팡',
      productName: '1P후순위',
      sales: '8000',
      salesQty: '1',
      isCoupang1pRocketManual: true,
    },
  ]
  const filters = { dateFrom: '2026-08-01', dateTo: '2026-08-31' }
  const all = buildLegacyTableRows({
    pgRecords,
    uploads: [{ id: 'u1', uploadKind: 'platform_daily' }],
    manualRecords: manuals,
    scope: 'platform',
    tab: 'detail',
    filters,
  })
  const p1 = paginateLegacyTableRows(all, 1, 5)
  const p2 = paginateLegacyTableRows(all, 2, 5)
  const ids1 = p1.items.map((r) => r.id)
  const ids2 = p2.items.map((r) => r.id)
  const overlap = ids1.filter((id) => ids2.includes(id))
  record(
    '수기/total에 포함',
    p1.pagination.total === pgRecords.length + manuals.length,
    `total=${p1.pagination.total}`,
  )
  record(
    '수기/totalPages',
    p1.pagination.totalPages === 2,
    `pages=${p1.pagination.totalPages}`,
  )
  record('수기/페이지 간 중복 없음', overlap.length === 0, overlap.join(','))
  record(
    '수기/정렬 위치(이른 날짜는 1페이지)',
    ids1[0] === 'manual-early',
    `first=${ids1[0]}`,
  )
  record(
    '수기/늦은 날짜는 마지막 페이지',
    ids2.includes('manual-late') && !ids1.includes('manual-late'),
    `p2=${ids2.join(',')}`,
  )
}

async function workbookFromRows(rows, tab = 'detail') {
  const columns = sanitizeDetailColumns(resolveDetailColumns(rows))
  return buildTableWorkbook({
    rows,
    columns,
    sheetName: RECORD_TYPES[tab]?.label || tab,
    channelLabel: '매출',
    filters: {},
  })
}

async function tryPgConnect() {
  loadDotEnv()
  const base = pgConfigFromEnv()
  const attempts = [
    base,
    {
      ...base,
      host: 'localhost',
      password: 'essersales_dev',
      connectionString: `postgres://essersales:${encodeURIComponent('essersales_dev')}@localhost:${base.port}/essersales`,
    },
  ]
  let last = { ok: false, error: 'no attempt' }
  for (const cfg of attempts) {
    await closePool().catch(() => {})
    createPool(cfg)
    last = await testConnection()
    if (last.ok) return last
  }
  return last
}

async function runLivePgCases() {
  const conn = await tryPgConnect()
  if (!conn.ok) {
    record('라이브 PG 연결', false, String(conn.error || JSON.stringify(conn)))
    await closePool().catch(() => {})
    return false
  }
  record('라이브 PG 연결', true, `migration=${conn.migrationVersion}`)

  const query = {
    scope: 'platform',
    tab: 'detail',
    start_date: '2026-08-01',
    end_date: '2026-08-19',
    row_kind: 'sale',
    page: '1',
    limit: '100',
  }

  const [allTime, uploads, stores, live] = await Promise.all([
    listMatchingRecords({
      record_type: 'detail',
      scope: 'platform',
      include_data: 'full',
      filter_engine: 'js',
    }),
    loadAllUploads(),
    loadManualStores('platform'),
    buildLegacyFilteredTableRows(query),
  ])
  record(
    '라이브 조회 규모',
    true,
    `allTimePg=${allTime.total} periodRows=${live.rows.length} manuals=${live.manualCount}`,
  )

  const manuals = enrichExportRecords([], 'platform', stores)
  const oldRows = buildLegacyTableRows({
    pgRecords: adaptPgRecordList(allTime.items),
    uploads,
    manualRecords: manuals,
    scope: 'platform',
    tab: 'detail',
    filters: filterObjFromQuery(query),
  })

  if (!oldRows.length && !live.rows.length) {
    record('엑셀/개선전 vs 개선후', true, '둘 다 0건')
  } else if (!oldRows.length || !live.rows.length) {
    record(
      '엑셀/개선전 vs 개선후',
      false,
      `old=${oldRows.length} new=${live.rows.length}`,
    )
  } else {
    const { wb: oldWb } = await workbookFromRows(oldRows, 'detail')
    const { wb: newWb } = await workbookFromRows(live.rows, 'detail')
    const diffs = compareWorkbooks(oldWb, newWb)
    record(
      '엑셀/개선전(전량+JS필터) vs 개선후(기간SQL superset+JS필터)',
      diffs.length === 0,
      diffs.length
        ? `old=${oldRows.length} new=${live.rows.length} ${diffs.slice(0, 8).join(' | ')}`
        : `rows=${live.rows.length} sheets=1 name=${dumpWorkbook(newWb)[0]?.name}`,
    )
  }

  if (live.rows.length) {
    const page = await listTablePage({ ...query, page: 1, limit: 100 })
    record(
      '페이지네이션/1페이지 ≤100건',
      (page.items || []).length <= 100,
      `items=${page.items.length} total=${page.total}`,
    )
    record(
      '페이지네이션/total=엑셀 행수',
      page.total === live.rows.length,
      `page.total=${page.total} excel=${live.rows.length}`,
    )
    const expected = live.rows.slice(0, 100).map((r) => r.id)
    const got = page.items.map((r) => r.id)
    record(
      '페이지네이션/1페이지 내용=정렬 후 slice',
      JSON.stringify(expected) === JSON.stringify(got),
    )
    if (page.pagination.totalPages > 1) {
      const p2 = await listTablePage({ ...query, page: 2, limit: 100 })
      const exp2 = live.rows.slice(100, 200).map((r) => r.id)
      record(
        '페이지네이션/2페이지 내용',
        JSON.stringify(exp2) === JSON.stringify(p2.items.map((r) => r.id)),
      )
      const dup = page.items.some((r) => p2.items.some((x) => x.id === r.id))
      record('페이지네이션/페이지 간 중복 없음', !dup)
    } else {
      record('페이지네이션/2페이지', true, 'totalPages=1 skip')
    }
  } else {
    record('페이지네이션/데이터 없음(해당 기간)', true, '비교 대상 0건')
  }

  await closePool()
  return true
}

async function main() {
  console.log('=== 1단계 표/엑셀 회귀 ===')
  runFilterCases()
  runSqlWhereCases()
  runManualPaginationCases()

  const salesData = readFileSync(
    new URL('../../src/composables/useSalesData.js', import.meta.url),
    'utf8',
  )
  record(
    '화면/표는 fetchSalesRecordsPage만 사용',
    salesData.includes('fetchSalesRecordsPage(recordType, q)') &&
      !/loadTablePageForScope[\s\S]*fetchSalesRecords\(/.test(salesData),
  )
  record(
    '화면/1페이지 수기 덤프 병합 제거',
    !salesData.includes('mergeManualsIntoTablePage(items'),
  )
  record(
    '화면/백그라운드 전량 detail prefetch 비활성',
    /function loadDetailInBackground\([^)]*\) \{\s*return\s*\}/.test(salesData),
  )

  record(
    '엑셀 대용량 구조(현재는 조건 전체 Node 적재)',
    true,
    '50만~100만 행이면 메모리 병목 가능. 추후 chunk/stream 시에도 이 스크립트로 셀 비교 필수',
  )

  try {
    await runLivePgCases()
  } catch (err) {
    record('라이브 PG 검증', false, err.message)
    try {
      await closePool()
    } catch {
      /* ignore */
    }
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n=== 요약 ===')
  console.log(`PASS ${results.filter((r) => r.pass).length} / ${results.length}`)
  if (failed.length) {
    console.log('FAIL 목록:')
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

await main()
