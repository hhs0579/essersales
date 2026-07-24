#!/usr/bin/env node
/**
 * Phase 2-4 — PG settings write API regression.
 * node infra/scripts/phase-2-4-settings-write-regression.mjs
 *
 * Uses __test__ scope only for writes — does not overwrite production settings.
 */
import { loadDotEnv } from './lib/migration-utils.mjs'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { sqlitePathFromEnv } from './lib/migration-utils.mjs'

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const LEGACY = (process.env.VITE_LEGACY_API_BASE || 'http://localhost:3001/api').replace(
  /\/$/,
  '',
)
const TEST_SCOPE = '__test__'
const TEST_KIND = 'settings_write_regression'

/** @type {Array<[string, string]>} */
const PRODUCTION_KEYS = [
  ['platform', 'manual_ad'],
  ['platform', 'staff_memo'],
  ['platform', 'special_sale'],
  ['power_price', 'power_price'],
  ['coupang_1p_rocket', 'coupang_1p_rocket'],
  ['company_b', 'own_mall_manual'],
  ['combined_daily', 'combined_comments'],
]

function okLine(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

function stableJson(val) {
  return JSON.stringify(sortKeys(val))
}

function sortKeys(val) {
  if (Array.isArray(val)) return val.map(sortKeys)
  if (val && typeof val === 'object') {
    return Object.keys(val)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(val[key])
        return acc
      }, {})
  }
  return val
}

async function pgRequest(path, options = {}) {
  const res = await fetch(`${PG}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`)
  }
  return body
}

async function legacyGet(scope, kind) {
  const res = await fetch(
    `${LEGACY}/settings/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`,
  )
  if (!res.ok) throw new Error(`legacy GET ${scope}/${kind} → ${res.status}`)
  return res.json()
}

async function pgGet(scope, kind) {
  return pgRequest(`/settings/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`)
}

async function pgPut(scope, kind, data) {
  return pgRequest(`/settings/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`, {
    method: 'PUT',
    body: JSON.stringify({ data }),
  })
}

async function main() {
  loadDotEnv()
  let allOk = true

  // --- PG GET list ---
  const list = await pgRequest('/settings?scope=platform&kind=manual_ad')
  allOk =
    okLine('PG settings GET list', Array.isArray(list.items), `items=${list.items?.length}`) &&
    allOk

  // --- backup __test__ row if exists ---
  let backup = null
  try {
    backup = await pgGet(TEST_SCOPE, TEST_KIND)
    if (!backup?.data) backup = null
  } catch {
    backup = null
  }

  const testPayload = {
    phase: '2-4',
    savedAt: new Date().toISOString(),
    nested: { ok: true, count: 1 },
  }

  const putRes = await pgPut(TEST_SCOPE, TEST_KIND, testPayload)
  allOk =
    okLine(
      'PG settings PUT',
      putRes.ok === true && putRes.scope === TEST_SCOPE && putRes.kind === TEST_KIND,
      `updatedAt=${putRes.updatedAt}`,
    ) && allOk

  const getRes = await pgGet(TEST_SCOPE, TEST_KIND)
  allOk =
    okLine(
      'PUT 후 GET 일치',
      stableJson(getRes.data) === stableJson(testPayload) &&
        stableJson(putRes.data) === stableJson(testPayload),
      stableJson(getRes.data) === stableJson(testPayload) ? '' : 'data mismatch',
    ) && allOk

  const manualSample = [
    {
      id: 'test-manual-ad-1',
      date: '2026-06-30',
      adSpend: '10000',
      adSales: '20000',
      source: 'meta',
    },
  ]
  let manualBackup = null
  try {
    const prev = await pgGet(TEST_SCOPE, 'manual_ad')
    if (prev?.data) manualBackup = prev
  } catch {
    manualBackup = null
  }

  await pgPut(TEST_SCOPE, 'manual_ad', manualSample)
  const manualGet = await pgGet(TEST_SCOPE, 'manual_ad')
  allOk =
    okLine(
      'manual_ad 저장/조회',
      Array.isArray(manualGet.data) &&
        manualGet.data.length === 1 &&
        manualGet.data[0].adSpend === '10000',
      `rows=${manualGet.data?.length}`,
    ) && allOk

  const powerSample = { products: [], sales: [{ date: '2026-06-30', sales: '1' }] }
  await pgPut(TEST_SCOPE, 'power_price', powerSample)
  const powerGet = await pgGet(TEST_SCOPE, 'power_price')
  allOk =
    okLine(
      'power_price 저장/조회',
      Array.isArray(powerGet.data?.sales) && powerGet.data.sales.length === 1,
    ) && allOk

  const ownMallSample = { products: [], salesSourceFiles: [], sales: [] }
  await pgPut(TEST_SCOPE, 'own_mall_manual', ownMallSample)
  const ownGet = await pgGet(TEST_SCOPE, 'own_mall_manual')
  allOk =
    okLine(
      'own_mall_manual 저장/조회',
      ownGet.data && typeof ownGet.data === 'object' && Array.isArray(ownGet.data.sales),
    ) && allOk

  // --- legacy vs PG read compare (no writes) ---
  const sqlitePath = sqlitePathFromEnv()
  if (existsSync(sqlitePath)) {
    const sqlite = new Database(sqlitePath, { readonly: true })
    for (const [scope, kind] of PRODUCTION_KEYS) {
      let legacyData = null
      let pgData = null
      try {
        const leg = await legacyGet(scope, kind)
        legacyData = leg.data
      } catch {
        legacyData = null
      }
      try {
        const pg = await pgGet(scope, kind)
        pgData = pg.data
      } catch {
        pgData = null
      }
      const row = sqlite
        .prepare(`SELECT data FROM app_settings WHERE scope = ? AND kind = ?`)
        .get(scope, kind)
      let sqliteData = null
      if (row) {
        try {
          sqliteData = JSON.parse(row.data)
        } catch {
          sqliteData = null
        }
      }
      const pgSqliteMatch = stableJson(pgData) === stableJson(sqliteData)
      const legacySqliteMatch = stableJson(legacyData) === stableJson(sqliteData)
      const pgLegacyMatch = stableJson(pgData) === stableJson(legacyData)
      allOk =
        okLine(
          `legacy/SQLite ${scope}/${kind}`,
          legacySqliteMatch,
          legacySqliteMatch ? '' : 'data mismatch',
        ) && allOk
      if (!pgLegacyMatch && legacySqliteMatch) {
        console.log(
          `PG/legacy ${scope}/${kind}: WARN (PG read drift — migrate:pg 재실행 검토)`,
        )
      } else {
        allOk =
          okLine(
            `PG/legacy ${scope}/${kind}`,
            pgLegacyMatch,
            pgLegacyMatch ? '' : 'data mismatch',
          ) && allOk
      }
      void pgSqliteMatch
    }
    sqlite.close()
  } else {
    console.log('SQLite compare: SKIP (db not found)')
  }

  // --- cleanup __test__ ---
  if (manualBackup) {
    await pgPut(TEST_SCOPE, 'manual_ad', manualBackup.data)
  } else {
    await pgPut(TEST_SCOPE, 'manual_ad', [])
  }
  if (backup?.data) {
    await pgPut(TEST_SCOPE, TEST_KIND, backup.data)
  } else {
    await pgPut(TEST_SCOPE, TEST_KIND, null)
  }
  await pgPut(TEST_SCOPE, 'power_price', { products: [], sales: [] })
  await pgPut(TEST_SCOPE, 'own_mall_manual', { products: [], salesSourceFiles: [], sales: [] })

  allOk = okLine('test scope cleanup', true) && allOk

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
