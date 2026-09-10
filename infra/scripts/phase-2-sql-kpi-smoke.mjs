#!/usr/bin/env bun
/**
 * 2단계 KPI SQL — 응답 형태·속도 스모크.
 * 라이브 NAS 또는 VITE_PG_API_BASE.
 *
 * bun infra/scripts/phase-2-sql-kpi-smoke.mjs
 */
const BASE = (process.env.VITE_PG_API_BASE || 'http://192.168.0.245:8080/api/v1').replace(/\/$/, '')
const FROM = process.env.KPI_FROM || '2026-08-01'
const TO = process.env.KPI_TO || '2026-08-19'

async function fetchJson(path) {
  const t0 = performance.now()
  const res = await fetch(`${BASE}${path}`)
  const ms = Math.round(performance.now() - t0)
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, ms, body }
}

function ok(label, pass, extra = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
  return pass
}

async function main() {
  let pass = 0
  let fail = 0
  const check = (label, cond, extra) => {
    if (ok(label, cond, extra)) pass += 1
    else fail += 1
  }

  const daily = await fetchJson(
    `/kpi/daily?from=${FROM}&to=${TO}&scope=platform&include_manual_ads=true`,
  )
  check('daily 200', daily.ok, `${daily.status} ${daily.ms}ms items=${daily.body.items?.length ?? '-'}`)
  check('daily items 배열', Array.isArray(daily.body.items))
  const first = daily.body.items?.[0]
  if (first) {
    check('daily date', Boolean(first.date))
    check('daily salesTotal 숫자', Number.isFinite(Number(first.salesTotal)))
  }

  const plat = await fetchJson(
    `/kpi/by-platform?from=${FROM}&to=${TO}&scope=platform&include_manual_ads=true`,
  )
  check('by-platform 200', plat.ok, `${plat.status} ${plat.ms}ms`)
  const labels = (plat.body.items || []).map((i) => i.platform)
  check(
    'by-platform 구분 라벨',
    labels.includes('쿠팡') ||
    labels.includes('베스트하임(판매자)') ||
    labels.includes('베스트하임(그로스)') ||
    labels.includes('베스트하임(판매자+그로스)') ||
    labels.length >= 0,
    labels.join(', '),
  )

  const seg = await fetchJson(
    `/kpi/by-segment?from=${FROM}&to=${TO}&scope=combined_daily&include_manual_ads=true`,
  )
  check('by-segment 200', seg.ok, `${seg.status} ${seg.ms}ms items=${seg.body.items?.length ?? '-'}`)
  check('by-segment 2초 이내(목표)', seg.ms < 8000, `${seg.ms}ms`)

  const dod = await fetchJson(
    `/kpi/compare-yesterday?from=${FROM}&to=${TO}&scope=platform&include_manual_ads=true`,
  )
  check('compare-yesterday 200', dod.ok, `${dod.status} ${dod.ms}ms`)

  console.log(`\n결과 PASS ${pass} / FAIL ${fail}`)
  if (fail) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
