import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { networkInterfaces } from 'os'
import { db, dbPath, nowIso, rowToRecord } from './db.js'
import {
  getAppSetting,
  putAppSetting,
  isValidSettingScope,
  isValidSettingKind,
} from './settings.js'
import {
  detectPlatformFromChannelKind,
  resolveUploadPlatform,
  inferUploadSalesMethodFromDetails,
  resolveRecordPlatform,
} from './platformResolve.js'
import { normalizeSalesMethod } from '../src/utils/salesMethodDetect.js'
import { UI_BUILD_ID } from '../src/constants/appVersion.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001
const isProd = process.env.NODE_ENV === 'production'

const app = express()

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (allowedOrigins?.length) {
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true)
        } else {
          callback(new Error(`CORS blocked: ${origin}`))
        }
      },
    }),
  )
} else {
  app.use(cors())
}

app.use(express.json({ limit: '50mb' }))

const PROTECTED = new Set(['id', 'uploadId', 'recordType', 'createdAt', 'updatedAt'])

function allParsedRecords(parsed, uploadId, sourceFileName) {
  const types = ['details', 'daily', 'channel', 'product', 'productOption']
  const typeMap = {
    details: 'detail',
    daily: 'daily',
    channel: 'channel',
    product: 'product',
    productOption: 'productOption',
  }
  const lists = []
  const ts = nowIso()
  for (const key of types) {
    const recordType = typeMap[key]
    for (const row of parsed[key] || []) {
      lists.push({
        recordType,
        uploadId,
        sourceFileName: row.sourceFileName || sourceFileName,
        createdAt: ts,
        updatedAt: ts,
        ...row,
      })
    }
  }
  return lists
}

function resolveRowSalesMethod(row, uploadPlatform, fileName, fallbackMethod = '') {
  const platform =
    resolveRecordPlatform(row, uploadPlatform, fileName) || uploadPlatform
  const delivery =
    row.deliveryMethod ||
    row.delivery_method ||
    row['배송구분'] ||
    ''
  return (
    normalizeSalesMethod(platform, row.salesMethod || fallbackMethod, delivery) ||
    ''
  )
}

function insertRecords(records) {
  const stmt = db.prepare(`
    INSERT INTO sales_records (id, upload_id, record_type, data, created_at, updated_at)
    VALUES (@id, @upload_id, @record_type, @data, @created_at, @updated_at)
  `)
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      const { id, uploadId, recordType, createdAt, updatedAt, ...data } = r
      stmt.run({
        id: id || randomUUID(),
        upload_id: uploadId,
        record_type: recordType,
        data: JSON.stringify(data),
        created_at: createdAt,
        updated_at: updatedAt,
      })
    }
  })
  insertMany(records)
}

/** 클라이언트·start-preview가 구버전 서버(재시작 필요) 판별용 */
const API_FEATURES = {
  platformPeriod: true,
  uploadPlatformResolve: true,
  uiBuild: UI_BUILD_ID,
  deliveryColumn: true,
  deliveryForwardFill: true,
  appSettings: true,
  platformMonthly: true,
  manualAdSettings: true,
  specialSaleSettings: true,
  combinedCommentsSettings: true,
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dbPath, apiVersion: 6, uiBuild: UI_BUILD_ID, features: API_FEATURES })
})

app.get('/api/settings/:scope/:kind', (req, res) => {
  try {
    const { scope, kind } = req.params
    if (!isValidSettingScope(scope) || !isValidSettingKind(kind)) {
      return res.status(400).json({ error: 'invalid scope or kind' })
    }
    const row = getAppSetting(scope, kind)
    res.json({ ok: true, data: row?.data ?? null, updatedAt: row?.updatedAt ?? null })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/settings/:scope/:kind', (req, res) => {
  try {
    const { scope, kind } = req.params
    if (!isValidSettingScope(scope) || !isValidSettingKind(kind)) {
      return res.status(400).json({ error: 'invalid scope or kind' })
    }
    const { data } = req.body ?? {}
    const result = putAppSetting(scope, kind, data)
    res.json({ ok: true, updatedAt: result.updatedAt })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/uploads', (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM uploads ORDER BY created_at DESC`)
    .all()
  res.json(
    rows.map((u) => ({
      id: u.id,
      fileName: u.file_name,
      platform: resolveUploadPlatform(u.file_name, u.platform),
      uploadKind: u.upload_kind,
      businessDate: u.business_date,
      detailCount: u.detail_count,
      dailyCount: u.daily_count,
      channelCount: u.channel_count,
      productCount: u.product_count,
      productOptionCount: u.product_option_count,
      totalCount: u.total_count,
      salesMethod: u.sales_method || '',
      createdAt: u.created_at,
    })),
  )
})

app.get('/api/records', (req, res) => {
  const recordType = req.query.recordType || 'detail'
  const rows = db
    .prepare(
      `SELECT * FROM sales_records WHERE record_type = ? ORDER BY created_at DESC`,
    )
    .all(recordType)
  res.json(rows.map(rowToRecord))
})

app.post('/api/uploads/sales-report', (req, res) => {
  try {
    const { fileName, parsed, platform = '' } = req.body
    if (!fileName || !parsed) {
      return res.status(400).json({ error: 'fileName, parsed 필요' })
    }

    const uploadId = randomUUID()
    const createdAt = nowIso()
    const detailCount = parsed.details?.length || 0
    const dailyCount = parsed.daily?.length || 0
    const channelCount = parsed.channel?.length || 0
    const productCount = parsed.product?.length || 0
    const productOptionCount = parsed.productOption?.length || 0
    const totalCount =
      detailCount + dailyCount + channelCount + productCount + productOptionCount

    db.prepare(
      `INSERT INTO uploads (
        id, file_name, platform, upload_kind, business_date,
        detail_count, daily_count, channel_count, product_count, product_option_count,
        total_count, created_at
      ) VALUES (?, ?, ?, 'sales_report', '', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uploadId,
      fileName,
      platform || '',
      detailCount,
      dailyCount,
      channelCount,
      productCount,
      productOptionCount,
      totalCount,
      createdAt,
    )

    const records = allParsedRecords(parsed, uploadId, fileName).map((r) => ({
      ...r,
      id: randomUUID(),
      platform: platform || r.channel || '',
    }))
    insertRecords(records)

    res.json({ uploadId, count: records.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const ALLOWED_DAILY_UPLOAD_KINDS = new Set(['platform_daily', 'sales_daily_b'])
const ALLOWED_PERIOD_UPLOAD_KINDS = new Set(['platform_period', 'sales_period_b'])
const ALLOWED_MONTHLY_UPLOAD_KINDS = new Set(['platform_monthly', 'sales_monthly_b'])

app.post('/api/uploads/platform-daily', (req, res) => {
  try {
    const {
      fileName,
      platform,
      businessDate,
      details,
      salesMethod = '',
      uploadKind: rawKind = 'platform_daily',
    } = req.body
    const uploadKind = ALLOWED_DAILY_UPLOAD_KINDS.has(rawKind) ? rawKind : 'platform_daily'
    if (!fileName || !platform || !details?.length) {
      return res.status(400).json({ error: 'fileName, platform, details 필요' })
    }

    const resolvedPlatform = resolveUploadPlatform(fileName, platform, details)

    const uploadId = randomUUID()
    const createdAt = nowIso()
    const method = inferUploadSalesMethodFromDetails(
      details,
      fileName,
      salesMethod || details[0]?.salesMethod || '',
    )

    db.prepare(
      `INSERT INTO uploads (
        id, file_name, platform, upload_kind, business_date, sales_method,
        detail_count, daily_count, channel_count, product_count, product_option_count,
        total_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
    ).run(
      uploadId,
      fileName,
      resolvedPlatform,
      uploadKind,
      businessDate || '',
      method,
      details.length,
      details.length,
      createdAt,
    )

    const records = details.map((row) => {
      const platform =
        resolveRecordPlatform(row, resolvedPlatform, fileName) || resolvedPlatform
      const rowMethod = resolveRowSalesMethod(row, resolvedPlatform, fileName, method)
      const delivery =
        row.deliveryMethod || row.delivery_method || row['배송구분'] || ''
      return {
        id: randomUUID(),
        recordType: 'detail',
        uploadId,
        sourceFileName: row.sourceFileName || fileName,
        uploadKind,
        createdAt,
        updatedAt: createdAt,
        ...row,
        platform,
        channel: platform,
        deliveryMethod: delivery,
        salesMethod: rowMethod || method,
      }
    })
    insertRecords(records)

    res.json({ uploadId, count: records.length, uploadKind, platform: resolvedPlatform })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/uploads/platform-period', (req, res) => {
  try {
    const {
      fileName,
      platform,
      businessDate,
      periodFrom,
      periodTo,
      details,
      salesMethod = '',
      uploadKind: rawKind = 'platform_period',
    } = req.body
    const uploadKind = ALLOWED_PERIOD_UPLOAD_KINDS.has(rawKind) ? rawKind : 'platform_period'
    if (!fileName || !platform || !details?.length || !periodFrom || !periodTo) {
      return res.status(400).json({
        error: 'fileName, platform, periodFrom, periodTo, details 필요',
      })
    }

    const resolvedPlatform = resolveUploadPlatform(fileName, platform, details)

    const uploadId = randomUUID()
    const createdAt = nowIso()
    const method = inferUploadSalesMethodFromDetails(
      details,
      fileName,
      salesMethod || details[0]?.salesMethod || '',
    )

    db.prepare(
      `INSERT INTO uploads (
        id, file_name, platform, upload_kind, business_date, sales_method,
        detail_count, daily_count, channel_count, product_count, product_option_count,
        total_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
    ).run(
      uploadId,
      fileName,
      resolvedPlatform,
      uploadKind,
      businessDate || `${periodFrom}~${periodTo}`,
      method,
      details.length,
      details.length,
      createdAt,
    )

    const records = details.map((row) => {
      const platform =
        resolveRecordPlatform(row, resolvedPlatform, fileName) || resolvedPlatform
      const rowMethod = resolveRowSalesMethod(row, resolvedPlatform, fileName, method)
      const delivery =
        row.deliveryMethod || row.delivery_method || row['배송구분'] || ''
      return {
        id: randomUUID(),
        recordType: 'detail',
        uploadId,
        sourceFileName: row.sourceFileName || fileName,
        uploadKind,
        createdAt,
        updatedAt: createdAt,
        ...row,
        platform,
        channel: platform,
        deliveryMethod: delivery,
        salesMethod: rowMethod || method,
      }
    })
    insertRecords(records)

    res.json({ uploadId, count: records.length, uploadKind, platform: resolvedPlatform })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/uploads/platform-monthly', (req, res) => {
  try {
    const {
      fileName,
      platform,
      businessDate,
      periodFrom,
      periodTo,
      details,
      salesMethod = '',
      uploadKind: rawKind = 'platform_monthly',
    } = req.body
    const uploadKind = ALLOWED_MONTHLY_UPLOAD_KINDS.has(rawKind) ? rawKind : 'platform_monthly'
    if (!fileName || !platform || !details?.length || !periodFrom || !periodTo) {
      return res.status(400).json({
        error: 'fileName, platform, periodFrom, periodTo, details 필요',
      })
    }

    const resolvedPlatform = resolveUploadPlatform(fileName, platform, details)

    const uploadId = randomUUID()
    const createdAt = nowIso()
    const method = inferUploadSalesMethodFromDetails(
      details,
      fileName,
      salesMethod || details[0]?.salesMethod || '',
    )

    db.prepare(
      `INSERT INTO uploads (
        id, file_name, platform, upload_kind, business_date, sales_method,
        detail_count, daily_count, channel_count, product_count, product_option_count,
        total_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
    ).run(
      uploadId,
      fileName,
      resolvedPlatform,
      uploadKind,
      businessDate || `${periodFrom}~${periodTo}`,
      method,
      details.length,
      details.length,
      createdAt,
    )

    const records = details.map((row) => {
      const platform =
        resolveRecordPlatform(row, resolvedPlatform, fileName) || resolvedPlatform
      const rowMethod = resolveRowSalesMethod(row, resolvedPlatform, fileName, method)
      const delivery =
        row.deliveryMethod || row.delivery_method || row['배송구분'] || ''
      return {
        id: randomUUID(),
        recordType: 'detail',
        uploadId,
        sourceFileName: row.sourceFileName || fileName,
        uploadKind,
        createdAt,
        updatedAt: createdAt,
        ...row,
        platform,
        channel: platform,
        deliveryMethod: delivery,
        salesMethod: rowMethod || method,
      }
    })
    insertRecords(records)

    res.json({ uploadId, count: records.length, uploadKind, platform: resolvedPlatform })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/records/:id', (req, res) => {
  try {
    const { id } = req.params
    const incoming = req.body?.fields || req.body
    const row = db.prepare(`SELECT * FROM sales_records WHERE id = ?`).get(id)
    if (!row) return res.status(404).json({ error: 'not found' })

    const current = rowToRecord(row)
    const stripMeta = (obj) => {
      const copy = { ...obj }
      for (const k of PROTECTED) delete copy[k]
      return copy
    }
    const merged = { ...stripMeta(current), ...stripMeta(incoming) }

    db.prepare(
      `UPDATE sales_records SET data = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(merged), nowIso(), id)

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/records/:id', (req, res) => {
  const r = db.prepare(`DELETE FROM sales_records WHERE id = ?`).run(req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

app.delete('/api/uploads/:id', (req, res) => {
  const uploadId = req.params.id
  const del = db.transaction(() => {
    db.prepare(`DELETE FROM sales_records WHERE upload_id = ?`).run(uploadId)
    return db.prepare(`DELETE FROM uploads WHERE id = ?`).run(uploadId)
  })
  const r = del()
  if (!r.changes) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

if (isProd) {
  const dist = join(__dirname, '..', 'dist')
  if (existsSync(dist)) {
    app.use(
      express.static(dist, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html') || filePath.includes('assets')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
          }
        },
      }),
    )
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      res.sendFile(join(dist, 'index.html'))
    })
  }
}

const HOST = process.env.HOST || '0.0.0.0'

function lanAddresses() {
  const urls = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      urls.push(`http://${ni.address}:${PORT}`)
    }
  }
  return urls
}

const server = app.listen(PORT, HOST, () => {
  console.log(`essersales — 로컬 http://localhost:${PORT}`)
  const lan = lanAddresses()
  if (lan.length) {
    console.log('팀원(같은 Wi‑Fi/사내망) 접속 주소:')
    for (const u of lan) console.log(`  ${u}`)
  }
  console.log(`SQLite: ${dbPath}`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('')
    console.error(`❌ 포트 ${PORT}이(가) 이미 사용 중입니다.`)
    console.error('   → 작업 관리자에서 Node.js 를 종료하거나, 이미 켜 둔 서버 창을 사용하세요.')
    console.error('   → 브라우저: http://localhost:3001')
    console.error('')
  } else {
    console.error('서버 시작 실패:', err.message)
  }
  process.exit(1)
})
