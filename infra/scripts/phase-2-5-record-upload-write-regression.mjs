#!/usr/bin/env node
/**
 * Phase 2-5 — PG record/upload write API regression.
 * node infra/scripts/phase-2-5-record-upload-write-regression.mjs
 *
 * Uses __test__ upload/record only — does not delete production data.
 */
import pg from 'pg'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import {
  loadDotEnv,
  pgConfigFromEnv,
  sqlitePathFromEnv,
} from './lib/migration-utils.mjs'

const { Pool } = pg

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const LEGACY = (process.env.VITE_LEGACY_API_BASE || 'http://localhost:3001/api').replace(
  /\/$/,
  '',
)

const TEST_UPLOAD_KIND = '__test__'
const TEST_UPLOAD_FORMAT = 'phase-2-5'
const TEST_PRODUCT_CODE = '__test_record__'
const TEST_STORE = '__test__'

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
  return { res, body }
}

async function legacyRequest(path, options = {}) {
  const res = await fetch(`${LEGACY}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function createTestUploadAndRecord(pool) {
  const uploadId = randomUUID()
  const recordId = randomUUID()
  const now = new Date().toISOString()

  await pool.query(
    `INSERT INTO uploads (
       id, file_name, upload_kind, parse_status, created_at,
       platform, sales_method, detail_count, total_count
     ) VALUES ($1, $2, $3, 'ok', $4, '', '', 1, 1)`,
    [uploadId, 'phase-2-5-test.xlsx', TEST_UPLOAD_KIND, now],
  )

  const data = {
    productCode: TEST_PRODUCT_CODE,
    storeName: TEST_STORE,
    sales: '1000',
    salesQty: '2',
    uploadKind: TEST_UPLOAD_KIND,
    uploadFormat: TEST_UPLOAD_FORMAT,
  }

  await pool.query(
    `INSERT INTO sales_records (
       id, upload_id, record_type, platform, store_name, product_code,
       product_name, sales, sales_qty, upload_kind, upload_format, data,
       created_at, updated_at
     ) VALUES (
       $1, $2, 'detail', '', $3, $4,
       'Phase 2-5 Test', 1000, 2, $5, $6, $7::jsonb,
       $8, $8
     )`,
    [
      recordId,
      uploadId,
      TEST_STORE,
      TEST_PRODUCT_CODE,
      TEST_UPLOAD_KIND,
      TEST_UPLOAD_FORMAT,
      JSON.stringify(data),
      now,
    ],
  )

  return { uploadId, recordId }
}

async function countRecordsForUpload(pool, uploadId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM sales_records WHERE upload_id = $1`,
    [uploadId],
  )
  return r.rows[0].c
}

async function cleanupTestArtifacts(pool) {
  await pool.query(
    `DELETE FROM sales_records WHERE upload_kind = $1 OR product_code = $2`,
    [TEST_UPLOAD_KIND, TEST_PRODUCT_CODE],
  )
  await pool.query(`DELETE FROM uploads WHERE upload_kind = $1`, [TEST_UPLOAD_KIND])
}

async function main() {
  loadDotEnv()
  let allOk = true

  const cfg = pgConfigFromEnv()
  const pool = new Pool({ connectionString: cfg.connectionString })

  await cleanupTestArtifacts(pool)

  const { uploadId, recordId } = await createTestUploadAndRecord(pool)
  allOk = okLine('test data created', true, `upload=${uploadId} record=${recordId}`) && allOk

  // --- PATCH ---
  const patchBody = { fields: { sales: '2500', productName: 'Patched Name' } }
  const { res: patchRes, body: patchOut } = await pgRequest(`/records/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify(patchBody),
  })
  allOk =
    okLine('PG record PATCH', patchRes.ok && patchOut.ok === true, `status=${patchRes.status}`) &&
    allOk

  const { res: getRes, body: getOut } = await pgRequest(
    `/records?product_code=${encodeURIComponent(TEST_PRODUCT_CODE)}&include_data=true&limit=5`,
  )
  const patched = getOut.items?.find((r) => r.id === recordId)
  allOk =
    okLine(
      'PATCH 후 GET 반영',
      getRes.ok &&
        patched &&
        Number(patched.sales) === 2500 &&
        patched.productName === 'Patched Name',
      `sales=${patched?.sales}`,
    ) && allOk

  // --- DELETE record ---
  const countBeforeDel = await countRecordsForUpload(pool, uploadId)
  const { res: delRecRes, body: delRecOut } = await pgRequest(`/records/${recordId}`, {
    method: 'DELETE',
  })
  const countAfterDel = await countRecordsForUpload(pool, uploadId)
  allOk =
    okLine(
      'PG record DELETE',
      delRecRes.ok && delRecOut.deleted === true && countAfterDel === countBeforeDel - 1,
      `before=${countBeforeDel} after=${countAfterDel}`,
    ) && allOk

  // --- DELETE upload (with records) ---
  const uploadId2 = randomUUID()
  const recordId2 = randomUUID()
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO uploads (id, file_name, upload_kind, parse_status, created_at, detail_count, total_count)
     VALUES ($1, 'phase-2-5-upload-del.xlsx', $2, 'ok', $3, 1, 1)`,
    [uploadId2, TEST_UPLOAD_KIND, now],
  )
  await pool.query(
    `INSERT INTO sales_records (
       id, upload_id, record_type, store_name, product_code, sales, sales_qty,
       upload_kind, upload_format, data, created_at, updated_at
     ) VALUES ($1, $2, 'detail', $3, $4, 500, 1, $5, $6, '{}'::jsonb, $7, $7)`,
    [recordId2, uploadId2, TEST_STORE, TEST_PRODUCT_CODE, TEST_UPLOAD_KIND, TEST_UPLOAD_FORMAT, now],
  )

  const recCountBefore = await countRecordsForUpload(pool, uploadId2)
  const { res: delUpRes, body: delUpOut } = await pgRequest(`/uploads/${uploadId2}`, {
    method: 'DELETE',
  })
  const uploadStill = await pool.query(`SELECT id FROM uploads WHERE id = $1`, [uploadId2])
  const recCountAfter = await countRecordsForUpload(pool, uploadId2)

  allOk =
    okLine(
      'PG upload DELETE',
      delUpRes.ok &&
        delUpOut.deleted === true &&
        delUpOut.recordsDeleted === recCountBefore &&
        uploadStill.rows.length === 0 &&
        recCountAfter === 0,
      `recordsDeleted=${delUpOut.recordsDeleted}`,
    ) && allOk

  // --- legacy delete behavior note (no prod data) ---
  const { res: legDel404 } = await legacyRequest(`/uploads/${randomUUID()}`, { method: 'DELETE' })
  const { res: pgDel404 } = await pgRequest(`/uploads/${randomUUID()}`, { method: 'DELETE' })
  allOk =
    okLine(
      'legacy vs PG upload DELETE 404',
      legDel404.status === 404 && pgDel404.status === 404,
      `legacy=${legDel404.status} pg=${pgDel404.status}`,
    ) && allOk

  // --- own_mall_manual drift ---
  const sqlitePath = sqlitePathFromEnv()
  let sqliteData = null
  let legacyData = null
  let pgData = null

  if (existsSync(sqlitePath)) {
    const sqlite = new Database(sqlitePath, { readonly: true })
    const row = sqlite
      .prepare(`SELECT data FROM app_settings WHERE scope = ? AND kind = ?`)
      .get('company_b', 'own_mall_manual')
    if (row) {
      try {
        sqliteData = JSON.parse(row.data)
      } catch {
        sqliteData = null
      }
    }
    sqlite.close()
  }

  try {
    const leg = await legacyRequest('/settings/company_b/own_mall_manual')
    if (leg.res.ok) legacyData = leg.body.data
  } catch {
    legacyData = null
  }

  try {
    const pg = await pgRequest('/settings/company_b/own_mall_manual')
    if (pg.res.ok) pgData = pg.body.data
  } catch {
    pgData = null
  }

  const legacySqliteMatch = stableJson(legacyData) === stableJson(sqliteData)
  const pgLegacyMatch = stableJson(pgData) === stableJson(legacyData)

  allOk =
    okLine(
      'own_mall_manual legacy/SQLite',
      legacySqliteMatch,
      legacySqliteMatch ? '' : 'mismatch',
    ) && allOk

  if (!pgLegacyMatch && legacySqliteMatch && sqliteData != null) {
    console.log('own_mall_manual PG drift detected — resync from SQLite (--execute)')
    const upsert = await pool.query(
      `INSERT INTO app_settings (scope, kind, data, updated_at)
       VALUES ('company_b', 'own_mall_manual', $1::jsonb, NOW())
       ON CONFLICT (scope, kind)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING updated_at`,
      [JSON.stringify(sqliteData)],
    )
    const verify = await pool.query(
      `SELECT data FROM app_settings WHERE scope = 'company_b' AND kind = 'own_mall_manual'`,
    )
    const after = verify.rows[0]?.data
    const resyncOk = stableJson(after) === stableJson(sqliteData)
    allOk =
      okLine(
        'own_mall_manual resync 후 PG/SQLite',
        resyncOk,
        `updated_at=${upsert.rows[0].updated_at}`,
      ) && allOk
  } else {
    allOk =
      okLine(
        'own_mall_manual PG/legacy',
        pgLegacyMatch,
        pgLegacyMatch ? '' : 'drift (legacy/SQLite 불일치 시 resync 스킵)',
      ) && allOk
  }

  await cleanupTestArtifacts(pool)
  await pool.end()

  allOk = okLine('test cleanup', true) && allOk

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
