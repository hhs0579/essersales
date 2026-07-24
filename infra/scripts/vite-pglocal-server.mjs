#!/usr/bin/env node
/**
 * Full PG mode Vite dev server (Phase 3-4A smoke / manual UI test).
 * node infra/scripts/vite-pglocal-server.mjs [port]
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { join } from 'path'
import { loadDotEnv } from './lib/migration-utils.mjs'

const port = process.argv[2] || '5174'
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..')

loadDotEnv()

for (const k of Object.keys(process.env)) {
  if (k.startsWith('VITE_')) delete process.env[k]
}

process.env.VITE_API_MODE = 'pg'
process.env.VITE_KPI_SOURCE = 'server'
process.env.VITE_WRITE_API_MODE = 'pg'
process.env.VITE_EXPORT_API_MODE = 'pg'
process.env.VITE_PG_API_BASE =
  process.env.VITE_PG_API_BASE || 'http://localhost:3002/api/v1'

const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const child = spawn(
  process.execPath,
  [viteBin, '--mode', 'pglocal', '--port', port, '--strictPort'],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
