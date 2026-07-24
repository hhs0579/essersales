#!/usr/bin/env node
/**
 * Phase 4 — verify NAS production compose locally (no actual NAS deploy).
 *
 * Prereq:
 *   npm run build:production
 *   copy .env.production.example .env  (set POSTGRES_PASSWORD / DB_PASSWORD)
 *   docker compose -f docker-compose.nas.yml up -d --build
 *
 * Usage:
 *   node infra/scripts/verify-production-compose.mjs
 *   PROXY_BASE=http://localhost:8080 node infra/scripts/verify-production-compose.mjs
 */
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')
const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.nas.yml'
const PROXY_BASE = (process.env.PROXY_BASE || `http://localhost:${process.env.HTTP_PORT || 8080}`).replace(
  /\/$/,
  '',
)

/** @type {Record<string, { pass: boolean; detail: string }>} */
const results = {}

function ok(key, pass, detail = '') {
  results[key] = { pass, detail }
  console.log(`${key}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForUrl(url, timeoutMs = 120000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
    } catch {
      /* retry */
    }
    await sleep(1500)
  }
  throw new Error(`timeout: ${url}`)
}

async function main() {
  let allOk = true

  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    ok('dist build', false, 'run npm run build:production first')
    process.exit(1)
  }
  ok('dist build', true, 'dist/index.html exists')

  const cfg = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'config'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (cfg.status !== 0) {
    ok('compose config', false, cfg.stderr?.trim() || 'invalid')
    process.exit(1)
  }
  ok('compose config', true)

  try {
    const healthRes = await waitForUrl(`${PROXY_BASE}/api/v1/health`)
    const health = await healthRes.json()
    ok('proxy /api/v1/health', health?.ok === true || health?.status === 'ok', JSON.stringify(health).slice(0, 80))
  } catch (e) {
    ok('proxy /api/v1/health', false, e.message)
    allOk = false
  }

  try {
    const indexRes = await fetch(`${PROXY_BASE}/`)
    const html = await indexRes.text()
    const spaOk = indexRes.ok && html.includes('<div id="app">')
    ok('proxy vue static', spaOk, `status=${indexRes.status}`)
    if (!spaOk) allOk = false
  } catch (e) {
    ok('proxy vue static', false, e.message)
    allOk = false
  }

  try {
    const kpiRes = await fetch(`${PROXY_BASE}/api/v1/kpi/summary`)
    const kpi = await kpiRes.json()
    ok('kpi summary', kpiRes.ok && kpi != null, `status=${kpiRes.status}`)
    if (!kpiRes.ok) allOk = false
  } catch (e) {
    ok('kpi summary', false, e.message)
    allOk = false
  }

  try {
    const expRes = await fetch(
      `${PROXY_BASE}/api/v1/exports/integrated?scope=platform&include_manual_ads=true`,
    )
    const expCt = expRes.headers.get('content-type') || ''
    const exportOk =
      expRes.ok ||
      (expRes.status === 404 &&
        expCt.includes('application/json') &&
        (await expRes.clone().json()).code === 'NO_DATA')
    ok(
      'export integrated',
      exportOk,
      `status=${expRes.status} type=${expCt.split(';')[0]}`,
    )
    if (!exportOk) allOk = false
  } catch (e) {
    ok('export integrated', false, e.message)
    allOk = false
  }

  try {
    const upRes = await fetch(`${PROXY_BASE}/api/v1/uploads`)
    ok('uploads list', upRes.ok, `status=${upRes.status}`)
    if (!upRes.ok) allOk = false
  } catch (e) {
    ok('uploads list', false, e.message)
    allOk = false
  }

  const legacyProbe = await fetch(`${PROXY_BASE}/api/health`).catch(() => null)
  const legacyCt = legacyProbe?.headers.get('content-type') || ''
  const legacyBody = legacyProbe ? await legacyProbe.text() : ''
  const legacyIsApi =
    legacyCt.includes('application/json') &&
    (legacyBody.includes('apiVersion') || legacyBody.includes('platformPeriod'))
  ok(
    'no legacy /api path',
    !legacyIsApi,
    legacyProbe ? `status=${legacyProbe.status} type=${legacyCt.split(';')[0]}` : 'unreachable',
  )
  if (legacyIsApi) allOk = false

  console.log('')
  if (allOk && Object.values(results).every((r) => r.pass)) {
    console.log('OVERALL: PASS')
    process.exit(0)
  }
  console.log('OVERALL: FAIL')
  console.log('Hint: docker compose -f docker-compose.nas.yml up -d --build')
  process.exit(1)
}

main()
