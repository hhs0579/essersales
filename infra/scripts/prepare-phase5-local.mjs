#!/usr/bin/env node
/**
 * Phase 5 — 로컬 PC 배포 준비 (빌드 확인 + PG/uploads/exports 백업 + NAS 복사 목록)
 *
 * Usage (project root):
 *   node infra/scripts/prepare-phase5-local.mjs
 *
 * Prereq:
 *   npm run build:production
 *   docker compose up -d api db   (로컬 dev PG 스택, 실제 데이터)
 */
import { spawnSync, execSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')
const STAMP = formatStamp(new Date())
const OUT_DIR = join(ROOT, 'deploy', 'nas-transfer', STAMP)

const DEV_COMPOSE = process.env.DEV_COMPOSE_FILE || 'docker-compose.yml'
const DB_SERVICE = process.env.DB_SERVICE || 'db'
const DB_NAME = process.env.DB_NAME || 'essersales'
const DB_USER = process.env.DB_USER || 'essersales'

function formatStamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts })
  return r
}

function ok(msg) {
  console.log(`[OK] ${msg}`)
}

function fail(msg) {
  console.error(`[FAIL] ${msg}`)
  process.exit(1)
}

function countFiles(dir) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) n += countFiles(p)
    else n++
  }
  return n
}

function dirSizeHint(dir) {
  if (!existsSync(dir)) return '0 files'
  const n = countFiles(dir)
  return `${n} files`
}

// --- 1. dist 확인 ---
const distIndex = join(ROOT, 'dist', 'index.html')
if (!existsSync(distIndex)) {
  fail('dist/index.html 없음 — 먼저 npm run build:production 실행')
}
ok(`dist/ 확인 — ${dirSizeHint(join(ROOT, 'dist'))} in dist/`)

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(join(OUT_DIR, 'backups'), { recursive: true })
mkdirSync(join(OUT_DIR, 'manifest'), { recursive: true })

// --- 2. PostgreSQL dump (dev compose db) ---
const pgFile = join(OUT_DIR, 'backups', `essersales-pg-${STAMP}.sql`)
console.log(`[..] PostgreSQL dump → ${pgFile}`)

try {
  const out = execSync(
    `docker compose -f ${DEV_COMPOSE} exec -T ${DB_SERVICE} pg_dump -U ${DB_USER} -d ${DB_NAME} --no-owner --no-acl`,
    { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 },
  )
  writeFileSync(pgFile, out)
} catch (e) {
  console.error(e.stderr?.toString() || e.message)
  fail(`pg_dump 실패 — docker compose -f ${DEV_COMPOSE} up -d api db 확인`)
}

if (!existsSync(pgFile) || statSync(pgFile).size < 100) {
  fail('pg_dump 결과 파일이 비어 있습니다')
}
copyFileSync(pgFile, join(OUT_DIR, 'backups', 'essersales-pg-latest.sql'))
ok(`PostgreSQL dump — ${(statSync(pgFile).size / 1024 / 1024).toFixed(2)} MB`)

// --- 3. uploads / exports (docker volumes → tar) ---
for (const { vol, label } of [
  { vol: 'essersales-uploads', label: 'uploads' },
  { vol: 'essersales-exports', label: 'exports' },
]) {
  const archive = join(OUT_DIR, 'backups', `essersales-${label}-${STAMP}.tar.gz`)
  console.log(`[..] ${label} volume → ${archive}`)
  const tar = run('docker', [
    'run',
    '--rm',
    '-v',
    `${vol}:/data:ro`,
    'alpine:3.20',
    'tar',
    'czf',
    '-',
    '-C',
    '/data',
    '.',
  ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 })

  if (tar.status !== 0) {
    console.warn(`[WARN] ${label} 백업 실패 (볼륨 비어있거나 없음): ${tar.stderr?.trim()}`)
    writeFileSync(join(OUT_DIR, 'backups', `essersales-${label}-${STAMP}.EMPTY`), '')
  } else {
    writeFileSync(archive, Buffer.from(tar.stdout))
    ok(`${label} backup — ${(tar.stdout.length / 1024 / 1024).toFixed(2)} MB`)
  }
}

// --- 4. NAS 복사 목록 ---
const NAS_COPY_LIST = `# essersales Phase 5 — NAS 복사 파일 목록
# 생성: ${STAMP}
# 로컬 경로 기준 — NAS: /volume1/docker/essersales/

## 필수 (NAS 프로젝트 루트)

docker-compose.nas.yml
.env                          ← .env.production.example 복사 후 비밀번호 설정 (git 제외)
.env.production.example       ← 참고용 (선택)

dist/                         ← npm run build:production 결과 (전체 폴더)
backend/                      ← API Dockerfile 빌드 컨텍스트
  Dockerfile
  package.json
  package-lock.json
  src/

infra/
  nginx/nas.conf
  db/                         ← migration SQL (001_initial.sql 등)

package.json                  ← Docker 빌드 시 root deps
package-lock.json

src/utils/                    ← API 파서 공유
src/config/
src/constants/

## 백업 (NAS data/ 복원용)

deploy/nas-transfer/${STAMP}/backups/
  essersales-pg-latest.sql              → NAS 복원 시 사용
  essersales-uploads-${STAMP}.tar.gz    → data/uploads/ 복원
  essersales-exports-${STAMP}.tar.gz    → data/exports/ 복원

## NAS에서 생성 (복사하지 않음)

data/postgres/                ← 빈 폴더 생성 후 docker compose 최초 기동
data/uploads/                 ← 백업 tar 복원
data/exports/                 ← 백업 tar 복원
data/backups/                 ← 빈 폴더

## 복사하지 않아도 되는 항목

node_modules/
.git/
archive/                      ← 선택 (legacy 보관, 용량 주의)
docs/                         ← 선택
infra/scripts/                ← 선택 (운영 필수 아님)
src/components/               ← dist에 포함됨, NAS 빌드 불필요
.env (로컬 dev)               ← NAS용 .env 별도 작성

## 복사 방법 예시

### Windows → NAS (Synology File Station / SMB)
1. \\\\NAS_IP\\docker\\essersales\\ 폴더 생성
2. 위 필수 항목 복사
3. deploy/nas-transfer/${STAMP}/backups/ → NAS data/backups/ 또는 임시 폴더

### rsync (SSH 가능 시)
rsync -avz --exclude node_modules --exclude .git \\
  ./dist ./backend ./infra ./package.json ./package-lock.json \\
  ./docker-compose.nas.yml \\
  ./src/utils ./src/config ./src/constants \\
  admin@NAS_IP:/volume1/docker/essersales/
`

writeFileSync(join(OUT_DIR, 'manifest', 'NAS-COPY-LIST.md'), NAS_COPY_LIST, 'utf8')
writeFileSync(join(ROOT, 'deploy', 'nas-transfer', 'NAS-COPY-LIST-latest.md'), NAS_COPY_LIST, 'utf8')

// --- 5. 요약 로그 ---
const summary = {
  timestamp: STAMP,
  dist: existsSync(distIndex),
  distFiles: countFiles(join(ROOT, 'dist')),
  backups: readdirSync(join(OUT_DIR, 'backups')),
  outputDir: OUT_DIR.replace(/\\/g, '/'),
}

writeFileSync(join(OUT_DIR, 'manifest', 'prepare-summary.json'), JSON.stringify(summary, null, 2))

console.log('')
console.log('=== Phase 5 로컬 준비 완료 ===')
console.log(`출력 폴더: ${OUT_DIR}`)
console.log(`백업 파일: ${summary.backups.join(', ')}`)
console.log(`NAS 복사 목록: deploy/nas-transfer/NAS-COPY-LIST-latest.md`)
console.log('')
console.log('다음: docs/phase-5-nas-deployment-runbook.md 의 "NAS 실행 단계" 진행')
