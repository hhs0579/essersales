#!/usr/bin/env node
/**
 * Phase 3-4B — Full PG stack regression (API E2E + browser UI smoke).
 * node infra/scripts/regression-full-pg.mjs
 *
 * Prereq: docker compose up -d api db
 */
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, script)], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${script} exited with ${code}`))
    })
  })
}

async function main() {
  console.log('=== regression:full-pg (phase-3-3 API E2E) ===')
  await run('phase-3-3-full-pg-e2e-regression.mjs')
  console.log('\n=== smoke:full-pg (phase-3-4a browser UI) ===')
  await run('phase-3-4a-full-pg-ui-smoke.mjs')
  console.log('\nOVERALL: PASS')
}

main().catch((err) => {
  console.error('\nOVERALL: FAIL', err.message)
  process.exit(1)
})
