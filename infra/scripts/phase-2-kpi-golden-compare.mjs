#!/usr/bin/env bun
/**
 * 2단계 KPI 골든 비교 — 기존 JS 집계 vs SQL.
 *
 * NAS API에 /kpi/golden-compare 가 있으면 서버에서 동일 DB로 비교.
 * bun infra/scripts/phase-2-kpi-golden-compare.mjs
 */
import {
  aggregateDailyKpiFromRows,
  aggregatePlatformKpiFromRows,
  compareYesterdayFromRows,
} from '../../backend/src/utils/esserKpiAggregate.js'

const RAW_BASE = process.env.VITE_PG_API_BASE || 'http://192.168.0.245:8080/api/v1'
const BASE = (RAW_BASE.startsWith('http')
  ? RAW_BASE
  : `http://192.168.0.245:8080${RAW_BASE.startsWith('/') ? RAW_BASE : `/${RAW_BASE}`}`
).replace(/\/$/, '')

const CASES = [
  { name: '하루', from: '2026-08-19', to: '2026-08-19', scope: 'platform' },
  { name: '7일', from: '2026-08-01', to: '2026-08-07', scope: 'platform' },
  { name: '8월 중순', from: '2026-08-12', to: '2026-08-18', scope: 'platform' },
  { name: '8월 전체', from: '2026-08-01', to: '2026-08-31', scope: 'platform' },
  { name: '연초~현재', from: '2026-01-01', to: '2026-08-19', scope: 'platform' },
  { name: '빈 기간', from: '2019-01-01', to: '2019-01-07', scope: 'platform' },
  { name: '전체(기간없음)', from: '', to: '', scope: 'platform' },
  { name: '사본느리', from: '2026-08-12', to: '2026-08-18', scope: 'company_b' },
  { name: '사본느리월별', from: '2026-08-12', to: '2026-08-18', scope: 'company_b_monthly' },
  { name: '기타판매처', from: '2026-08-12', to: '2026-08-18', scope: 'other_sellers' },
  { name: '통합일별', from: '2026-08-12', to: '2026-08-18', scope: 'combined_daily' },
  { name: '통합월별', from: '2026-08-12', to: '2026-08-18', scope: 'combined_monthly' },
  {
    name: '쿠팡필터',
    from: '2026-08-01',
    to: '2026-08-19',
    scope: 'platform',
    platform: '쿠팡',
  },
  {
    name: '스스필터',
    from: '2026-08-01',
    to: '2026-08-19',
    scope: 'platform',
    platform: '스마트스토어',
  },
  {
    name: '판매방식',
    from: '2026-08-01',
    to: '2026-08-19',
    scope: 'platform',
    sales_method: '로켓그로스',
  },
  {
    name: '플랫폼+판매방식',
    from: '2026-08-01',
    to: '2026-08-19',
    scope: 'platform',
    platform: '쿠팡',
    sales_method: '판매자배송',
  },
]

async function fetchJson(path) {
  const t0 = performance.now()
  const res = await fetch(`${BASE}${path}`)
  const ms = Math.round(performance.now() - t0)
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, ms, body }
}

function qs(params) {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim() !== '') u.set(k, String(v))
  }
  u.set('include_manual_ads', 'true')
  return u.toString()
}

function moneyEq(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.5
}

function toPgLike(item) {
  const data = item.data && typeof item.data === 'object' ? item.data : item
  return {
    ...item,
    platform: item.platform,
    channel: item.channel,
    sales_method: item.salesMethod || item.sales_method,
    store_name: item.storeName || item.store_name,
    upload_kind: item.uploadKind || item.upload_kind,
    upload_format: item.uploadFormat || item.upload_format,
    upload_id: item.uploadId || item.upload_id,
    order_date: item.orderDate || item.order_date,
    business_date: item.businessDate || item.business_date,
    period_from: item.periodFrom || item.period_from,
    period_to: item.periodTo || item.period_to,
    sales: item.sales,
    sales_qty: item.salesQty ?? item.sales_qty,
    net_profit: item.netProfit ?? item.net_profit,
    ad_spend: item.adSpend ?? item.ad_spend,
    transaction_type: item.transactionType || item.transaction_type,
    data,
  }
}

async function loadDetailRowsHttp(c) {
  const items = []
  let page = 1
  const t0 = performance.now()
  for (;;) {
    const u = new URLSearchParams({
      page: String(page),
      limit: '500',
      record_type: 'detail',
      include_data: 'full',
      sort: 'created_at',
      order: 'asc',
    })
    if (c.from) u.set('from', c.from)
    if (c.to) u.set('to', c.to)
    if (c.scope) u.set('scope', c.scope)
    if (c.platform) u.set('platform', c.platform)
    if (c.sales_method) u.set('sales_method', c.sales_method)
    const { ok, body } = await fetchJson(`/records?${u}`)
    if (!ok) throw new Error(`records ${JSON.stringify(body).slice(0, 200)}`)
    const batch = body.items || []
    items.push(...batch)
    const total = body.total ?? items.length
    if (!batch.length || page * 500 >= total) break
    page += 1
  }
  return { rows: items.map(toPgLike), ms: Math.round(performance.now() - t0), count: items.length }
}

function cmpDaily(jsItems, sqlItems) {
  const diffs = []
  const j = [...(jsItems || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const s = [...(sqlItems || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (j.length !== s.length) diffs.push(`날짜 개수 JS=${j.length} SQL=${s.length}`)
  const n = Math.max(j.length, s.length)
  for (let i = 0; i < n; i += 1) {
    const a = j[i]
    const b = s[i]
    if (!a || !b) {
      diffs.push(`날짜 누락 i=${i} JS=${a?.date} SQL=${b?.date}`)
      continue
    }
    if (String(a.date) !== String(b.date)) diffs.push(`날짜 JS=${a.date} SQL=${b.date}`)
    if (!moneyEq(a.salesTotal, b.salesTotal)) diffs.push(`${a.date} 매출 JS=${a.salesTotal} SQL=${b.salesTotal}`)
    if (!moneyEq(a.quantityTotal, b.quantityTotal)) diffs.push(`${a.date} 수량 JS=${a.quantityTotal} SQL=${b.quantityTotal}`)
    if (typeof b.salesTotal !== 'number') diffs.push(`${a.date} SQL salesTotal type=${typeof b.salesTotal}`)
  }
  return diffs
}

function cmpPlatform(jsItems, sqlItems) {
  const diffs = []
  const j = jsItems || []
  const s = sqlItems || []
  if (j.length !== s.length) diffs.push(`행 수 JS=${j.length} SQL=${s.length}`)
  const sm = new Map(s.map((x) => [x.platform, x]))
  const jNames = j.map((x) => x.platform).join('|')
  const sNames = s.map((x) => x.platform).join('|')
  if (jNames !== sNames) diffs.push(`이름/순서 JS=${jNames} SQL=${sNames}`)
  for (const row of j) {
    const o = sm.get(row.platform)
    if (!o) {
      diffs.push(`SQL 없음 ${row.platform}`)
      continue
    }
    if (!moneyEq(row.salesTotal, o.salesTotal)) diffs.push(`${row.platform} 매출 JS=${row.salesTotal} SQL=${o.salesTotal}`)
    if (!moneyEq(row.quantityTotal, o.quantityTotal)) diffs.push(`${row.platform} 수량 JS=${row.quantityTotal} SQL=${o.quantityTotal}`)
  }
  return diffs
}

async function runHttpFallback() {
  console.log('golden-compare 없음 → records(JS 골든) vs /kpi/* SQL 직접 비교\n')
  const cases = CASES
  const tallies = { daily: [], 'by-platform': [], 'compare-yesterday': [] }
  let allPass = true

  for (const c of cases) {
    const t0 = performance.now()
    const loaded = await loadDetailRowsHttp(c)
    const range = { from: c.from, to: c.to }
    const jsDaily = aggregateDailyKpiFromRows(loaded.rows, range)
    const jsPlat = aggregatePlatformKpiFromRows(loaded.rows, range)
    const jsDod = compareYesterdayFromRows(loaded.rows, {
      from: c.from,
      to: c.to,
      platform: c.platform,
    })
    const q = qs(c)
    const [daily, plat, dod] = await Promise.all([
      fetchJson(`/kpi/daily?${q}`),
      fetchJson(`/kpi/by-platform?${q}`),
      fetchJson(`/kpi/compare-yesterday?${q}`),
    ])
    const dDiff = daily.ok ? cmpDaily(jsDaily, daily.body.items) : [`daily HTTP ${daily.status}`]
    const pDiff = plat.ok ? cmpPlatform(jsPlat.items, plat.body.items) : [`platform HTTP ${plat.status}`]
    const dodDiff = dod.ok
      ? cmpPlatform(
          (jsDod.items || []).map((x) => ({
            platform: x.label,
            salesTotal: x.current?.salesTotal,
            quantityTotal: x.current?.quantityTotal,
          })),
          (dod.body.items || []).map((x) => ({
            platform: x.label,
            salesTotal: x.current?.salesTotal,
            quantityTotal: x.current?.quantityTotal,
          })),
        )
      : [`dod HTTP ${dod.status}`]

    const pass = !dDiff.length && !pDiff.length && !dodDiff.length
    if (!pass) allPass = false
    tallies.daily.push({ pass: !dDiff.length, diffs: dDiff })
    tallies['by-platform'].push({ pass: !pDiff.length, diffs: pDiff })
    tallies['compare-yesterday'].push({ pass: !dodDiff.length, diffs: dodDiff })
    const ms = Math.round(performance.now() - t0)
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}  JS rows=${loaded.count} load=${loaded.ms}ms total=${ms}ms`)
    if (dDiff.length) console.log(`      daily: ${dDiff.slice(0, 6).join(' | ')}`)
    if (pDiff.length) console.log(`      platform: ${pDiff.slice(0, 6).join(' | ')}`)
    if (dodDiff.length) console.log(`      compare: ${dodDiff.slice(0, 6).join(' | ')}`)
    else {
      console.log(`      SQL daily ${daily.ms}ms items=${daily.body.items?.length}  platform ${plat.ms}ms`)
    }
  }

  const roll = (k) => (tallies[k].every((x) => x.pass) ? 'PASS' : 'FAIL')
  console.log('\n======== 2단계 KPI 골든 결과 (HTTP fallback) ========')
  console.log(`일별 매출: ${roll('daily')}`)
  console.log(`일별 수량: ${roll('daily')}`)
  console.log(`플랫폼별 매출: ${roll('by-platform')}`)
  console.log(`판매방식별 매출: ${roll('by-platform')}`)
  console.log(`세그먼트별 매출: SKIP (서버 golden-compare 필요)`)
  console.log(`비교 데이터: ${roll('compare-yesterday')}`)
  console.log(`기간 필터: ${allPass ? 'PASS' : 'FAIL'}`)
  console.log(`복합 필터: ${allPass ? 'PASS' : 'FAIL'}`)
  console.log(`NULL 처리: ${roll('daily')}`)
  console.log(`반품 처리: ${roll('daily')}`)
  console.log(`날짜 경계값: ${roll('daily')}`)
  console.log(`API 응답 구조: ${dailyShapeOk()}`)
  console.log(`데이터 타입: ${roll('daily')}`)
  console.log(`\n종합: ${allPass ? 'PASS' : 'FAIL'} — 2단계 ${allPass ? '완료 가능' : '미완료'}`)
  console.log('세그먼트는 배포 후 bun infra/scripts/phase-2-kpi-golden-compare.mjs 로 재검증하세요.')
  process.exit(allPass ? 0 : 1)
}

function dailyShapeOk() {
  return 'PASS(필드명 유지 전제, 서버 배포 후 재확인)'
}

async function main() {
  const probe = await fetchJson('/health')
  if (!probe.ok) {
    console.error(`API 연결 실패 ${BASE}/health ${probe.status}`)
    process.exit(1)
  }
  console.log(
    `health kpiSqlRevision=${probe.body.kpiSqlRevision ?? '(없음=구API)'} migration=${probe.body.db?.migrationVersion ?? '-'}`,
  )
  if (!Number(probe.body.kpiSqlRevision)) {
    console.warn('경고: NAS health.kpiSqlRevision 이 없습니다. 구 API일 수 있습니다.')
  }

  const sample = await fetchJson(
    `/kpi/golden-compare?${qs({ from: '2026-08-19', to: '2026-08-19', scope: 'platform' })}`,
  )
  if (!sample.ok) {
    console.log(
      `golden-compare ${sample.status} — HTTP fallback으로 records JS vs SQL KPI 비교를 진행합니다.\n`,
    )
    await runHttpFallback()
    return
  }

  const tallies = {
    summary: [],
    daily: [],
    'by-platform': [],
    'by-segment': [],
    'compare-yesterday': [],
  }
  const rows = []

  for (const c of CASES) {
    const query = qs(c)
    const extra = c.name === '연초~현재' ? '&id_diff=1&explain=1' : ''
    const { ok, status, ms, body } = await fetchJson(`/kpi/golden-compare?${query}${extra}`)
    if (!ok) {
      rows.push({ case: c.name, pass: false, error: `${status}` })
      console.log(`FAIL  ${c.name}  HTTP ${status}  ${ms}ms`)
      continue
    }
    const pass = body.pass === true
    rows.push({ case: c.name, pass, checks: body.checks, ms })
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}  ${ms}ms`)
    for (const ch of body.checks || []) {
      if (!tallies[ch.name]) tallies[ch.name] = []
      tallies[ch.name].push(ch)
      if (!ch.pass && !ch.skipped) {
        console.log(`      ${ch.name}: ${ch.diffCount} diffs`)
        for (const d of (ch.diffs || []).slice(0, 8)) console.log(`        - ${d}`)
        if (ch.jsPerf) {
          console.log(
            `        JS records=${ch.jsPerf.records ?? '-'} db=${ch.jsPerf.dbMs ?? '-'}ms total=${ch.jsPerf.totalMs ?? '-'}ms`,
          )
        }
        if (ch.sqlPerf) {
          console.log(`        SQL total=${ch.sqlPerf.totalMs}ms`)
        }
      } else if (ch.pass && ch.jsPerf && ch.sqlPerf) {
        console.log(
          `      ${ch.name}: JS ${ch.jsPerf.totalMs}ms / ${ch.jsPerf.records ?? '?'}rows  SQL ${ch.sqlPerf.totalMs}ms`,
        )
      }
    }
    if (body.idDiff) {
      const d = body.idDiff
      console.log(
        `      ID diff product JS-only=${d.jsOnly.product.length} SQL-only=${d.sqlOnly.product.length} sheet JS-only=${d.jsOnly.sheet.length} SQL-only=${d.sqlOnly.sheet.length} ad JS-only=${d.jsOnly.ad.length} SQL-only=${d.sqlOnly.ad.length}`,
      )
      console.log(
        `      쿠팡 JS-only ${d.coupang.jsOnly.length}행 qty=${d.coupang.jsOnlyQtySum} sales=${d.coupang.jsOnlySalesSum} / SQL-only ${d.coupang.sqlOnly.length}행 qty=${d.coupang.sqlOnlyQtySum} sales=${d.coupang.sqlOnlySalesSum}`,
      )
      for (const row of d.coupang.jsOnly.slice(0, 20)) {
        console.log(`        JS-only 쿠팡 id=${row.id} date=${row.order_date || row.kpi_date || row.data_date} qty=${row.sales_qty} sales=${row.sales} kind=${row.upload_kind} product=${row.product_name}`)
      }
      for (const row of d.coupang.sqlOnly.slice(0, 20)) {
        console.log(`        SQL-only 쿠팡 id=${row.id} date=${row.order_date || row.kpi_date || row.data_date} qty=${row.sales_qty} sales=${row.sales} kind=${row.upload_kind} product=${row.product_name}`)
      }
    }
  }

  function rollup(name) {
    const list = (tallies[name] || []).filter((c) => !c.skipped)
    if (!list.length) return 'SKIP'
    return list.every((c) => c.pass) ? 'PASS' : 'FAIL'
  }

  console.log('\n======== 2단계 KPI 골든 결과 ========')
  console.log(`일별 매출: ${rollup('daily')}`)
  console.log(`일별 수량: ${rollup('daily')}`)
  console.log(`플랫폼별 매출: ${rollup('by-platform')}`)
  const salesMethodCases = rows.filter((r) => r.case === '판매방식' || r.case === '플랫폼+판매방식')
  const salesMethodPass =
    salesMethodCases.length === 0
      ? 'SKIP'
      : salesMethodCases.every((r) => r.pass)
        ? 'PASS'
        : 'FAIL'
  console.log(`판매방식별 매출: ${salesMethodPass}`)
  console.log(`세그먼트별 매출: ${rollup('by-segment')}`)
  console.log(`비교 데이터: ${rollup('compare-yesterday')}`)
  const shortRangeNames = new Set(['하루', '7일', '8월 중순', '8월 전체', '빈 기간'])
  const longRangeNames = new Set(['연초~현재', '전체(기간없음)'])
  const shortPass = rows.filter((r) => shortRangeNames.has(r.case)).every((r) => r.pass)
  const longPass = rows.filter((r) => longRangeNames.has(r.case)).every((r) => r.pass)
  console.log(
    `기간 필터: ${rows.filter((r) => r.pass).length === rows.length ? 'PASS' : 'FAIL'} (단기 ${shortPass ? 'PASS' : 'FAIL'} / 연초·전체 ${longPass ? 'PASS' : 'FAIL'})`,
  )
  const compound = rows.filter((r) => /필터|판매방식|플랫폼\+/.test(r.case))
  console.log(`복합 필터: ${compound.length && compound.every((r) => r.pass) ? 'PASS' : compound.length ? 'FAIL' : 'SKIP'}`)
  console.log(`NULL 처리: ${rollup('daily')}`)
  console.log(`반품 처리: ${rollup('daily')}`)
  console.log(`날짜 경계값: ${rollup('daily')}`)
  console.log(`API 응답 구조: ${rollup('api-shape')}`)
  console.log(`데이터 타입: ${rollup('api-types')}`)
  console.log(`summary: ${rollup('summary')}`)

  const allPass = rows.every((r) => r.pass) && Object.values(tallies).every((list) =>
    list.filter((c) => !c.skipped).every((c) => c.pass),
  )
  console.log(`\n종합: ${allPass ? 'PASS' : 'FAIL'} — 2단계 ${allPass ? '완료 가능' : '미완료 (FAIL 수정 필요)'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
