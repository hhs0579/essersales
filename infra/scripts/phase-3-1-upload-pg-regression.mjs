#!/usr/bin/env node
/**
 * Phase 3-1 — PG excel upload regression.
 * node infra/scripts/phase-3-1-upload-pg-regression.mjs
 */
import pg from 'pg'
import * as XLSX from 'xlsx'
import {
  loadDotEnv,
  pgConfigFromEnv,
} from './lib/migration-utils.mjs'
import { readPlatformDailyBuffer } from '../../src/utils/platformOrderParser.js'

const { Pool } = pg

const PG = (process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1').replace(/\/$/, '')
const TEST_KIND = '__test__'
const TEST_FILE = '빅셀_로켓그로스_매출분석_일자20260601_phase31test.xlsx'

function okLine(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

function buildTestEsserXlsxBuffer() {
  const headers = ['상품명', '매출', '판매수량', '배송구분', '날짜', '순이익금']
  const rows = [
    headers,
    ['합계', '3000', '3', '로켓그로스', '2026-06-01', '500'],
    ['테스트상품A', '1000', '1', '로켓그로스', '2026-06-01', '200'],
    ['테스트상품B', '2000', '2', '로켓그로스', '2026-06-01', '300'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

async function pgMultipartUpload(buffer, fileName, fields = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([buffer]), fileName)
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, String(v))
  }
  const res = await fetch(`${PG}/uploads/excel`, { method: 'POST', body: fd })
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function fetchKpiSummary() {
  const res = await fetch(`${PG}/kpi/summary`)
  if (!res.ok) throw new Error(`kpi/summary → ${res.status}`)
  return res.json()
}

async function cleanupTest(pool) {
  await pool.query(
    `DELETE FROM sales_records WHERE upload_kind = $1`,
    [TEST_KIND],
  )
  const uploads = await pool.query(
    `SELECT id FROM uploads WHERE upload_kind = $1`,
    [TEST_KIND],
  )
  for (const row of uploads.rows) {
    await fetch(`${PG}/uploads/${row.id}`, { method: 'DELETE' })
  }
}

async function main() {
  loadDotEnv()
  let allOk = true

  const cfg = pgConfigFromEnv()
  const pool = new Pool({ connectionString: cfg.connectionString })

  await cleanupTest(pool)

  const buffer = buildTestEsserXlsxBuffer()
  const clientParsed = await readPlatformDailyBuffer(buffer, TEST_FILE, '쿠팡')
  allOk =
    okLine(
      'client parser rows',
      clientParsed.details?.length >= 2,
      `details=${clientParsed.details?.length}`,
    ) && allOk

  const kpiBefore = await fetchKpiSummary()
  const recordsBefore = await pool.query(
    `SELECT COUNT(*)::int AS c FROM sales_records WHERE upload_kind = $1`,
    [TEST_KIND],
  )

  const { res: upRes, body: upBody } = await pgMultipartUpload(buffer, TEST_FILE, {
    upload_kind: TEST_KIND,
    platform: '쿠팡',
    replace_same_name: 'true',
  })
  allOk =
    okLine(
      'PG excel upload',
      upRes.ok && upBody.ok === true && upBody.count >= 2,
      `status=${upRes.status} count=${upBody.count}`,
    ) && allOk

  const uploadId = upBody.uploadId

  const uploadRow = await pool.query(`SELECT * FROM uploads WHERE id = $1`, [uploadId])
  allOk =
    okLine(
      'uploads row',
      uploadRow.rows.length === 1 && uploadRow.rows[0].upload_kind === TEST_KIND,
      `file=${uploadRow.rows[0]?.file_name}`,
    ) && allOk

  const fileRow = await pool.query(`SELECT * FROM upload_files WHERE upload_id = $1`, [uploadId])
  allOk =
    okLine(
      'upload_files row',
      fileRow.rows.length === 1 && fileRow.rows[0].sha256?.length === 64,
      `sha256=${fileRow.rows[0]?.sha256?.slice(0, 12)}…`,
    ) && allOk

  const recCount = await pool.query(
    `SELECT COUNT(*)::int AS c FROM sales_records WHERE upload_id = $1`,
    [uploadId],
  )
  allOk =
    okLine(
      'sales_records count',
      recCount.rows[0].c === upBody.count,
      `db=${recCount.rows[0].c} api=${upBody.count}`,
    ) && allOk

  allOk =
    okLine(
      'parser vs PG count',
      recCount.rows[0].c === clientParsed.details.length,
      `client=${clientParsed.details.length}`,
    ) && allOk

  const recordsAfter = await pool.query(
    `SELECT COUNT(*)::int AS c FROM sales_records WHERE upload_kind = $1`,
    [TEST_KIND],
  )
  allOk =
    okLine(
      'upload 전/후 record count',
      recordsAfter.rows[0].c > recordsBefore.rows[0].c,
      `before=${recordsBefore.rows[0].c} after=${recordsAfter.rows[0].c}`,
    ) && allOk

  const kpiAfter = await fetchKpiSummary()
  allOk =
    okLine(
      'KPI summary 변화',
      Number(kpiAfter.salesTotal) >= Number(kpiBefore.salesTotal),
      `before=${kpiBefore.salesTotal} after=${kpiAfter.salesTotal}`,
    ) && allOk

  const { res: dupRes, body: dupBody } = await pgMultipartUpload(buffer, TEST_FILE, {
    upload_kind: TEST_KIND,
    platform: '쿠팡',
  })
  allOk =
    okLine(
      'duplicate upload 감지',
      dupRes.status === 409 && dupBody.duplicate === true,
      `status=${dupRes.status}`,
    ) && allOk

  const delRes = await fetch(`${PG}/uploads/${uploadId}`, { method: 'DELETE' })
  const delBody = await delRes.json().catch(() => ({}))
  const recAfterDel = await pool.query(
    `SELECT COUNT(*)::int AS c FROM sales_records WHERE upload_id = $1`,
    [uploadId],
  )
  allOk =
    okLine(
      'upload DELETE 정리',
      delRes.ok && delBody.deleted === true && recAfterDel.rows[0].c === 0,
      `recordsLeft=${recAfterDel.rows[0].c}`,
    ) && allOk

  await cleanupTest(pool)
  await pool.end()

  allOk = okLine('test cleanup', true) && allOk

  console.log(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
