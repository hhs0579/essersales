/** DB 플랫폼 보정 (server/db.js 마이그레이션 실행) */
import '../server/db.js'
import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'essersales.db')
const db = new Database(dbPath)
const rows = db
  .prepare(
    `SELECT file_name, platform FROM uploads WHERE file_name LIKE '%네이버%'`,
  )
  .all()
console.log('네이버 파일 업로드 플랫폼:', rows)
