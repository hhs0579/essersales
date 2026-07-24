/**
 * Phase 1-4 — legacy vs pg service layer smoke test (Node, no Vite).
 * Usage: node infra/scripts/verify-vue-api-clients.mjs [legacy|pg]
 */
import { adaptPgUploadList } from '../../src/services/adapters/uploadsAdapter.js'
import { adaptPgRecordList } from '../../src/services/adapters/recordsAdapter.js'
import { adaptPgKpiSummary } from '../../src/services/adapters/kpiAdapter.js'

const mode = process.argv[2] || 'pg'
const PG = process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1'
const LEGACY = process.env.VITE_LEGACY_API_BASE || 'http://localhost:3001/api'

async function fetchJson(base, path) {
  const res = await fetch(`${base}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

async function testLegacy() {
  const uploads = await fetchJson(LEGACY, '/uploads')
  const records = await fetchJson(LEGACY, '/records?recordType=detail')
  console.log('legacy uploads:', uploads.length)
  console.log('legacy detail records:', records.length)
  return { uploads: uploads.length, records: records.length }
}

async function testPg() {
  const upBody = await fetchJson(PG, '/uploads?page=1&limit=500')
  const uploads = adaptPgUploadList(upBody.items)
  const recBody = await fetchJson(
    PG,
    '/records?page=1&limit=500&record_type=detail&include_data=true',
  )
  const records = adaptPgRecordList(recBody.items)
  const kpi = adaptPgKpiSummary(await fetchJson(PG, '/kpi/summary'))
  console.log('pg uploads (page1):', uploads.length, 'total:', upBody.total)
  console.log('pg detail records (page1):', records.length, 'total:', recBody.total)
  console.log('pg kpi:', kpi)
  return { uploads: upBody.total, records: recBody.total, kpi }
}

try {
  if (mode === 'legacy') {
    await testLegacy()
    console.log('PASS legacy')
  } else {
    await testPg()
    console.log('PASS pg')
  }
} catch (e) {
  console.error('FAIL', e.message)
  process.exit(1)
}
