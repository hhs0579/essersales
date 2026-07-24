#!/usr/bin/env node
/**
 * Backup SQLite database before PostgreSQL migration.
 * node infra/scripts/backup-sqlite.mjs
 */
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import {
  sqlitePathFromEnv,
  loadDotEnv,
  PROJECT_ROOT,
} from './lib/migration-utils.mjs'

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function main() {
  loadDotEnv()
  const src = sqlitePathFromEnv()
  if (!existsSync(src)) {
    console.error(`SQLite DB not found: ${src}`)
    process.exit(1)
  }

  const backupDir = join(PROJECT_ROOT, 'archive/legacy-sqlite-server/server/data/backup')
  mkdirSync(backupDir, { recursive: true })

  const dest = join(backupDir, `essersales-before-pg-migration-${timestamp()}.db`)
  copyFileSync(src, dest)

  const latest = join(backupDir, 'essersales-before-pg-migration-latest.db')
  copyFileSync(src, latest)

  console.log(`[backup] Copied to: ${dest}`)
  console.log(`[backup] Latest link: ${latest}`)
}

main()
