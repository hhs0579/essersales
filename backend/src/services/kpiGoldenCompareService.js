/**
 * JS 골든 vs SQL KPI 비교 (검증 전용, 운영 캐시 없음)
 */
import { parseKpiQuery } from '../repositories/kpiRepository.js'
import {
  getKpiSummary,
  getKpiDaily,
  getKpiByPlatform,
  getKpiBySegment,
  getKpiCompareYesterday,
} from './kpiReadService.js'
import {
  getKpiSummaryJs,
  getKpiDailyJs,
  getKpiByPlatformJs,
  getKpiBySegmentJs,
  getKpiCompareYesterdayJs,
} from './kpiJsGoldenService.js'

const MONEY_EPS = 0.5
const RATE_EPS = 0.011

function num(v) {
  if (v == null || v === '') return 0
  return Number(v)
}

function moneyEq(a, b) {
  return Math.abs(num(a) - num(b)) < MONEY_EPS
}

function rateEq(a, b) {
  return Math.abs(num(a) - num(b)) < RATE_EPS
}

function typeOfNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * @param {string} path
 * @param {unknown} js
 * @param {unknown} sql
 * @param {string[]} diffs
 */
function cmpMoney(path, js, sql, diffs) {
  if (!moneyEq(js, sql)) {
    diffs.push(`${path}: JS=${js} SQL=${sql}`)
  }
}

function cmpRate(path, js, sql, diffs) {
  if (!rateEq(js, sql)) {
    diffs.push(`${path}: JS=${js} SQL=${sql}`)
  }
}

function cmpType(path, js, diffs) {
  if (js == null) return
  if (typeof js === 'number' && !typeOfNum(js)) {
    diffs.push(`${path}: JS number invalid`)
  }
}

function compareDaily(jsRes, sqlRes) {
  const diffs = []
  const jsItems = [...(jsRes.items || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const sqlItems = [...(sqlRes.items || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (jsItems.length !== sqlItems.length) {
    diffs.push(`날짜 개수: JS=${jsItems.length} SQL=${sqlItems.length}`)
  }
  const n = Math.max(jsItems.length, sqlItems.length)
  for (let i = 0; i < n; i += 1) {
    const j = jsItems[i]
    const s = sqlItems[i]
    if (!j || !s) {
      diffs.push(`index ${i}: ${!j ? 'JS 없음' : 'SQL 없음'} (${j?.date || s?.date})`)
      continue
    }
    if (String(j.date) !== String(s.date)) {
      diffs.push(`날짜 순서 ${i}: JS=${j.date} SQL=${s.date}`)
    }
    cmpMoney(`${j.date}.salesTotal`, j.salesTotal, s.salesTotal, diffs)
    cmpMoney(`${j.date}.quantityTotal`, j.quantityTotal, s.quantityTotal, diffs)
    cmpMoney(`${j.date}.netProfitTotal`, j.netProfitTotal, s.netProfitTotal, diffs)
    cmpMoney(`${j.date}.adSpendTotal`, j.adSpendTotal, s.adSpendTotal, diffs)
    cmpType(`${j.date}.salesTotal`, s.salesTotal, diffs)
    if (typeof s.salesTotal !== 'number') diffs.push(`${j.date}.salesTotal SQL type=${typeof s.salesTotal}`)
  }
  const jsOrder = jsItems.map((x) => x.date).join('|')
  const sqlOrder = sqlItems.map((x) => x.date).join('|')
  if (jsOrder !== sqlOrder) diffs.push(`정렬: JS=${jsOrder.slice(0, 80)} SQL=${sqlOrder.slice(0, 80)}`)
  return diffs
}

function itemKey(item) {
  return String(item.platform || item.segment || item.label || '')
}

function compareNamedItems(jsItems, sqlItems, label) {
  const diffs = []
  const jList = jsItems || []
  const sList = sqlItems || []
  if (jList.length !== sList.length) {
    diffs.push(`${label} 개수: JS=${jList.length} SQL=${sList.length}`)
  }
  const jKeys = jList.map(itemKey)
  const sKeys = sList.map(itemKey)
  if (jKeys.join('\0') !== sKeys.join('\0')) {
    diffs.push(`${label} 이름/순서: JS=[${jKeys.join(', ')}] SQL=[${sKeys.join(', ')}]`)
  }
  const sMap = new Map(sList.map((x) => [itemKey(x), x]))
  for (const j of jList) {
    const key = itemKey(j)
    const s = sMap.get(key)
    if (!s) {
      diffs.push(`${label} 누락 SQL: ${key}`)
      continue
    }
    cmpMoney(`${label}.${key}.salesTotal`, j.salesTotal, s.salesTotal, diffs)
    cmpMoney(`${label}.${key}.quantityTotal`, j.quantityTotal, s.quantityTotal, diffs)
    cmpRate(`${label}.${key}.marginRate`, j.marginRate, s.marginRate, diffs)
    if (s.salesTotal != null && typeof s.salesTotal !== 'number') {
      diffs.push(`${label}.${key}.salesTotal type=${typeof s.salesTotal}`)
    }
  }
  return diffs
}

const NUMBER_FIELD_RE =
  /(sales|quantity|qty|margin|adSpend|adSales|count|percentage|cost|profit|rate|average|recordCount|uploadCount|productRowCount|diffRate|Diff)/i

function collectShape(value, path, acc) {
  if (value === null) {
    acc.push({ path, kind: 'null' })
    return
  }
  if (Array.isArray(value)) {
    acc.push({ path, kind: 'array' })
    if (value.length && typeof value[0] === 'object' && value[0] !== null) {
      collectShape(value[0], `${path}[]`, acc)
    }
    return
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    acc.push({ path, kind: 'object', keys })
    for (const key of keys) collectShape(value[key], path ? `${path}.${key}` : key, acc)
    return
  }
  acc.push({ path, kind: typeof value })
}

function compareApiShape(jsRes, sqlRes) {
  const diffs = []
  const jsShape = []
  const sqlShape = []
  collectShape(jsRes, '', jsShape)
  collectShape(sqlRes, '', sqlShape)
  const jsMap = new Map(jsShape.map((x) => [x.path, x]))
  const sqlMap = new Map(sqlShape.map((x) => [x.path, x]))
  for (const [path, js] of jsMap) {
    const sql = sqlMap.get(path)
    if (!sql) {
      diffs.push(`스키마 누락 SQL: ${path || '(root)'}`)
      continue
    }
    if (js.kind !== sql.kind) {
      diffs.push(`스키마 타입 ${path || '(root)'}: JS=${js.kind} SQL=${sql.kind}`)
    }
    if (js.kind === 'object' && sql.kind === 'object') {
      const missing = (js.keys || []).filter((k) => !(sql.keys || []).includes(k))
      const extra = (sql.keys || []).filter((k) => !(js.keys || []).includes(k))
      if (missing.length) diffs.push(`${path || 'root'} SQL 누락 field: ${missing.join(', ')}`)
      if (extra.length) diffs.push(`${path || 'root'} SQL 추가 field: ${extra.join(', ')}`)
    }
  }
  return diffs
}

function compareApiTypes(jsRes, sqlRes) {
  const diffs = []
  function walk(js, sql, path) {
    if (js == null && sql == null) return
    if (Array.isArray(js) && Array.isArray(sql)) {
      const n = Math.min(js.length, sql.length, 3)
      for (let i = 0; i < n; i += 1) walk(js[i], sql[i], `${path}[${i}]`)
      return
    }
    if (js && sql && typeof js === 'object' && typeof sql === 'object' && !Array.isArray(js)) {
      for (const key of Object.keys(js)) {
        walk(js[key], sql[key], path ? `${path}.${key}` : key)
      }
      return
    }
    if (typeof js === 'number') {
      if (sql != null && typeof sql !== 'number') {
        diffs.push(`${path} SQL type=${typeof sql} value=${JSON.stringify(sql)}`)
      }
    }
  }
  walk(jsRes, sqlRes, '')
  return diffs
}

function compareSummary(jsRes, sqlRes) {
  const diffs = []
  for (const k of [
    'salesTotal',
    'quantityTotal',
    'recordCount',
    'productRowCount',
    'netProfitTotal',
    'adSpendTotal',
    'adSalesTotal',
    'costTotal',
  ]) {
    cmpMoney(`summary.${k}`, jsRes[k], sqlRes[k], diffs)
  }
  cmpRate('summary.marginRate', jsRes.marginRate, sqlRes.marginRate, diffs)
  if (sqlRes.salesTotal != null && typeof sqlRes.salesTotal !== 'number') {
    diffs.push(`summary.salesTotal type=${typeof sqlRes.salesTotal}`)
  }
  return diffs
}

function compareDod(jsRes, sqlRes) {
  const diffs = []
  const jItems = jsRes.items || []
  const sItems = sqlRes.items || []
  if (jItems.length !== sItems.length) {
    diffs.push(`전일대비 행 수: JS=${jItems.length} SQL=${sItems.length}`)
  }
  const sMap = new Map(sItems.map((x) => [x.label, x]))
  for (const j of jItems) {
    const s = sMap.get(j.label)
    if (!s) {
      diffs.push(`전일대비 누락: ${j.label}`)
      continue
    }
    if (j.current?.date !== s.current?.date) {
      diffs.push(`${j.label}.current.date JS=${j.current?.date} SQL=${s.current?.date}`)
    }
    cmpMoney(`${j.label}.current.sales`, j.current?.salesTotal, s.current?.salesTotal, diffs)
    cmpMoney(`${j.label}.previous.sales`, j.previous?.salesTotal, s.previous?.salesTotal, diffs)
    cmpMoney(`${j.label}.current.qty`, j.current?.quantityTotal, s.current?.quantityTotal, diffs)
  }
  const jOrder = jItems.map((x) => x.label).join('|')
  const sOrder = sItems.map((x) => x.label).join('|')
  if (jOrder !== sOrder) diffs.push(`전일대비 순서: JS=${jOrder} SQL=${sOrder}`)
  return diffs
}

async function timed(fn) {
  const t0 = performance.now()
  const out = await fn()
  return { out, ms: Math.round(performance.now() - t0) }
}

/**
 * @param {Record<string, string>} query
 */
export async function runKpiGoldenCompare(query = {}) {
  const filters = parseKpiQuery(query)
  const scope = filters.scope || 'platform'
  const want = String(query.endpoints || 'summary,daily,by-platform,by-segment,compare-yesterday')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const checks = []

  async function runOne(name, jsFn, sqlFn, cmp) {
    if (!want.includes(name) && want[0] !== 'all') return
    if (name === 'by-segment' && !String(scope).startsWith('combined')) {
      checks.push({
        name,
        pass: true,
        skipped: true,
        diffs: [],
        note: 'combined scope만 해당',
      })
      return
    }
    const jsTimed = await timed(() => jsFn(query))
    const sqlTimed = await timed(() => sqlFn(query))
    const jsBody = jsTimed.out.result ? jsTimed.out.result : jsTimed.out
    const sqlBody = sqlTimed.out
    const jsPerf = jsTimed.out.perf || { totalMs: jsTimed.ms }
    const diffs = cmp(jsBody, sqlBody)
    checks.push({
      name,
      pass: diffs.length === 0,
      diffs: diffs.slice(0, 40),
      diffCount: diffs.length,
      jsPerf,
      sqlPerf: { totalMs: sqlTimed.ms },
    })
  }

  await runOne('summary', getKpiSummaryJs, getKpiSummary, compareSummary)
  await runOne('daily', getKpiDailyJs, getKpiDaily, compareDaily)
  await runOne('by-platform', getKpiByPlatformJs, getKpiByPlatform, (j, s) => {
    const d = compareNamedItems(j.items, s.items, 'platform')
    if (j.totalRow && s.totalRow) {
      cmpMoney('platform.합계.salesTotal', j.totalRow.salesTotal, s.totalRow.salesTotal, d)
      cmpMoney('platform.합계.quantityTotal', j.totalRow.quantityTotal, s.totalRow.quantityTotal, d)
    }
    return d
  })
  await runOne('by-segment', getKpiBySegmentJs, getKpiBySegment, (j, s) => {
    const d = compareNamedItems(j.items, s.items, 'segment')
    if (j.totalRow && s.totalRow) {
      cmpMoney('segment.합계.salesTotal', j.totalRow.salesTotal, s.totalRow.salesTotal, d)
      cmpMoney('segment.합계.quantityTotal', j.totalRow.quantityTotal, s.totalRow.quantityTotal, d)
    }
    return d
  })
  await runOne('compare-yesterday', getKpiCompareYesterdayJs, getKpiCompareYesterday, compareDod)

  if (want.includes('summary') || want.includes('daily') || want[0] === 'all') {
    const jsPlat = await getKpiByPlatformJs(query)
    const sqlPlat = await getKpiByPlatform(query)
    const jsBody = jsPlat.result || jsPlat
    const shapeDiffs = compareApiShape(jsBody, sqlPlat)
    const typeDiffs = compareApiTypes(jsBody, sqlPlat)
    checks.push({
      name: 'api-shape',
      pass: shapeDiffs.length === 0,
      diffs: shapeDiffs.slice(0, 40),
      diffCount: shapeDiffs.length,
    })
    checks.push({
      name: 'api-types',
      pass: typeDiffs.length === 0,
      diffs: typeDiffs.slice(0, 40),
      diffCount: typeDiffs.length,
    })
  }

  let idDiff = null
  if (query.id_diff === '1') {
    const { runKpiIdDiff } = await import('./kpiIdDiffService.js')
    idDiff = await runKpiIdDiff(query)
  }

  let explain = null
  if (query.explain === '1') {
    try {
      const { explainDailyKpiSql } = await import('../repositories/kpiSqlAggregate.js')
      explain = await explainDailyKpiSql(filters)
    } catch (e) {
      explain = [String(e.message)]
    }
  }

  const fail = checks.filter((c) => !c.pass && !c.skipped)
  return {
    filters,
    pass: fail.length === 0,
    checks,
    explain,
    idDiff,
  }
}
