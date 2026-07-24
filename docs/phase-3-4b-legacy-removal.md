# Phase 3-4B Legacy SQLite Removal

## 1. 목적

Phase 3-4A에서 Full PG 브라우저 UI 스모크 테스트가 PASS되고 legacy API 호출 0회가 확인되었으므로, **legacy SQLite API 런타임 의존성을 제거**하고 **Vue + PG API + PostgreSQL + Export API** 단일 스택으로 전환한다.

이번 단계는 로컬/개발환경 검증 단계이며 **NAS 배포는 하지 않는다**.

---

## 2. 제거 전 상태

| 항목 | 제거 전 |
|------|---------|
| Legacy API | `server/` Express + better-sqlite3, `:3001` |
| SQLite DB | `server/data/essersales.db` |
| Vue API 분기 | `legacyApiClient` + mode flag (`VITE_API_MODE=legacy` 기본) |
| dev 스크립트 | `npm run dev` = legacy API + Vite 동시 실행 |
| npm dependencies | `better-sqlite3`, `express`, `cors` (루트) |

---

## 3. 백업 및 archive 처리

### 백업 위치

| 파일 | 경로 |
|------|------|
| legacy server 전체 | `archive/legacy-sqlite-server/server/` |
| SQLite 원본 | `archive/legacy-sqlite-server/server/data/essersales.db` |
| 독립 백업 | `archive/legacy-sqlite-server/essersales.db.20260702-094106.bak` |
| 마이그레이션 백업 | `archive/legacy-sqlite-server/server/data/backup/` |
| 백업 로그 | `archive/legacy-sqlite-server/BACKUP.log` |

### archive 이동 항목

```
server/                          → archive/legacy-sqlite-server/server/
src/services/legacyApiClient.js  → archive/legacy-sqlite-server/src-services/
src/services/devLegacyGuard.js   → archive/legacy-sqlite-server/src-services/
scripts/* (SQLite 유지보수)       → archive/legacy-sqlite-server/scripts/maintenance/
```

루트 `server/` 디렉터리는 **삭제됨** (archive에 보관).

---

## 4. legacy 의존성 검색 결과

| 파일 | 남아 있는 코드 | 삭제 가능 | PG 대체 | 보존 이유 |
|------|---------------|----------|---------|----------|
| `src/services/apiClient.js` | legacy 분기 제거, PG only | ✅ 정리 완료 | `pgApiClient.js` | — |
| `src/services/salesApi.js` | legacy 분기 제거, PG only | ✅ 정리 완료 | `pgApiClient.js` | — |
| `src/services/appSettingsApi.js` | legacy 분기 제거 | ✅ 정리 완료 | `pgPutAppSetting` | — |
| `src/services/apiMode.js` | 기본값 `pg` | 유지 (라벨용) | — | DEV 배지 표시 |
| `src/services/writeApiMode.js` | 기본값 `pg` | 유지 (라벨용) | — | DEV 배지 표시 |
| `src/services/exportApiMode.js` | 기본값 `pg` | 유지 (라벨용) | — | DEV 배지 표시 |
| `src/services/kpiSource.js` | 기본값 `server` | 유지 | PG KPI API | — |
| `vite.config.js` | `:3001` proxy 제거 | ✅ 정리 완료 | `:3002/api/v1` proxy | — |
| `.env` / `.env.example` | `VITE_LEGACY_API_BASE` 제거 | ✅ 정리 완료 | `VITE_PG_API_BASE` | — |
| `package.json` | `dev:server`, `start`, `watch` 제거 | ✅ 정리 완료 | `docker compose api` | — |
| `infra/scripts/phase-1-5~2-5` | legacy 비교 스크립트 | 보존 | — | 과거 phase 회귀용 |
| `infra/scripts/migrate-*.mjs` | `better-sqlite3` 사용 | 보존 | — | 마이그레이션/검증용 |
| `infra/scripts/lib/migration-utils.mjs` | `sqlitePathFromEnv()` | 보존 | archive 경로 | 마이그레이션용 |
| `docs/phase-0~3-3*.md` | legacy 설명 | 보존 | — | 이력 문서 |
| `README.md` | legacy 안내 문구 | **미갱신** | — | Phase 4에서 갱신 권장 |
| `archive/legacy-sqlite-server/**` | 전체 legacy 코드 | 보존 | — | 롤백용 |

### 런타임 검색 결과 (src/ 기준)

- `localhost:3001` — **0건** (런타임 코드)
- `legacyApiClient` — **0건** (archive로 이동)
- `VITE_LEGACY_API_BASE` — **0건** (`.env`에서 제거)

---

## 5. 제거/이동한 파일 목록

### 이동 (archive)

- `server/` → `archive/legacy-sqlite-server/server/`
- `src/services/legacyApiClient.js` → `archive/legacy-sqlite-server/src-services/`
- `src/services/devLegacyGuard.js` → `archive/legacy-sqlite-server/src-services/`
- `scripts/purge-*.mjs`, `rebuild-*.mjs`, `inspect-*.mjs`, `repair-*.mjs`, `check-*.mjs`, `test-upload-platform.mjs`, `clear-own-mall-17.mjs` → `archive/legacy-sqlite-server/scripts/maintenance/`

### 수정

- `src/services/apiClient.js`, `salesApi.js`, `appSettingsApi.js` — PG 단일 client
- `src/services/apiMode.js`, `writeApiMode.js`, `exportApiMode.js`, `kpiSource.js` — 기본값 PG
- `src/App.vue` — legacy call 카운터 제거
- `src/components/Platform*Upload.vue` — 안내 문구 PG 스택 기준으로 변경
- `vite.config.js` — PG API proxy (`:3002/api/v1`)
- `package.json`, `package-lock.json` — dependency/script 정리
- `.env`, `.env.example`, `.env.pglocal`, `.env.pg-staging`, `.env.production.example`
- `docker-compose.yml` — 주석 갱신
- `start-preview.cmd` — PG dev 안내로 변경
- `scripts/check-api-health.js` — PG API `:3002` health check
- `infra/scripts/backup-sqlite.mjs`, `migration-utils.mjs`, `inspect-sqlite-readonly.mjs`, `vite-pglocal-server.mjs`

### 추가

- `infra/scripts/regression-full-pg.mjs` — 통합 회귀 스크립트
- `docs/phase-3-4b-legacy-removal.md` — 본 문서

### 삭제

- 루트 `server/` (archive로 이동 후 제거)

---

## 6. 제거한 dependency

### 루트 `package.json` dependencies에서 제거

| 패키지 | 이유 |
|--------|------|
| `better-sqlite3` | 런타임 미사용 → **devDependencies로 이동** (마이그레이션 스크립트용) |
| `express` | legacy server 제거, backend에만 존재 |
| `cors` | legacy server 제거, backend에만 존재 |

### 유지

| 패키지 | 용도 |
|--------|------|
| `pg` | 회귀 스크립트 |
| `vue`, `chart.js`, `vue-chartjs`, `xlsx`, `exceljs` | 프론트엔드 |
| `better-sqlite3` (devDep) | `migrate:pg`, `verify:pg`, `compare:read-api` 등 |
| `playwright` (devDep) | UI smoke 테스트 |
| `vite`, `@vitejs/plugin-vue` (devDep) | 빌드/개발 |

`npm install` 후 68 packages 제거 확인.

---

## 7. env 기본값 변경

### 변경 후 (`.env` / `.env.example`)

```env
VITE_API_MODE=pg
VITE_PG_API_BASE=http://localhost:3002/api/v1
VITE_KPI_SOURCE=server
VITE_WRITE_API_MODE=pg
VITE_EXPORT_API_MODE=pg
```

### 제거

```env
# VITE_LEGACY_API_BASE  — 제거됨 (롤백 시 archive 복원 + env 수동 설정)
```

### 마이그레이션 전용

```env
# SQLITE_PATH=./archive/legacy-sqlite-server/server/data/essersales.db
```

---

## 8. npm script 변경

| 이전 | 이후 |
|------|------|
| `dev` = legacy API + Vite | `dev` = Vite only (PG env) |
| `dev:server` = `server/index.js` | **제거** |
| `start` = legacy production | **제거** |
| `watch` = legacy watch | **제거** |
| `preview` = build + legacy start | `preview` = `vite preview` |
| — | `api` = `docker compose up -d --build api db` |
| — | `regression:full-pg` = phase-3-3 + smoke 통합 |
| — | `smoke:full-pg` = 브라우저 PG 스모크 |

### 로컬 개발 절차

```bash
docker compose up -d --build api db   # 또는 npm run api
npm run dev                            # http://localhost:5173
```

---

## 9. Docker Compose 변경

- legacy API 서비스는 **원래 없음** (Phase 0부터 `api` = PG backend)
- 주석만 Phase 3-4B 기준으로 갱신
- 최종 서비스: `db`, `api`, `proxy`

```bash
docker compose up -d --build api db
npm run dev
```

---

## 10. Full PG 회귀 테스트 결과

**실행:** `npm run regression:phase-3-3`  
**일시:** 2026-07-02  
**결과:** **PASS**

| 항목 | 결과 |
|------|------|
| health | OK |
| settings write | OK |
| record patch/delete | OK |
| upload excel | OK |
| kpi summary/daily/platform/dod | OK |
| export integrated | OK (709130 bytes, 14 sheets) |
| legacy api calls | **0** |
| pg requests | 24 |
| OVERALL | **PASS** |

---

## 11. 브라우저 smoke 테스트 결과

**실행:** `npm run smoke:full-pg`  
**일시:** 2026-07-02  
**결과:** **PASS**

| 항목 | 결과 |
|------|------|
| env 배지 | `API MODE: PG · KPI: SERVER · WRITE: PG · EXPORT: PG` |
| KPI 4종 | OK (kpiRequests=4) |
| lazy load | OK (recordRequests=18, cache reuse 0) |
| settings 저장 | OK |
| upload excel | OK (3건 저장) |
| export | OK (710097 bytes, 14 sheets) |
| record delete | OK (API 폴백) |
| legacy network calls | **0** |
| legacy client calls | **0** |
| pg api only | 259 requests |
| OVERALL | **PASS** |

**빌드 검증:** `npm run build` — PASS

---

## 12. 롤백 방법

### A. legacy SQLite API로 완전 롤백 (비권장)

1. `archive/legacy-sqlite-server/server/` → `./server/` 복원
2. `.env` 설정:
   ```env
   VITE_API_MODE=legacy
   VITE_LEGACY_API_BASE=http://localhost:3001/api
   VITE_WRITE_API_MODE=legacy
   VITE_EXPORT_API_MODE=legacy
   VITE_KPI_SOURCE=client
   ```
3. `package.json`에서 `express`, `cors`, `better-sqlite3`(dependencies) 복원 및 `dev:server` 스크립트 복원 (git history 참조)
4. `npm install`
5. `npm run dev:server` + legacy Vite proxy (`vite.config.js` `:3001`)

### B. PG 데이터만 유지 (권장)

- Docker volume `essersales-pgdata`는 그대로 유지
- archive는 참조용으로만 보관

### C. SQLite DB 복원

```bash
copy archive\legacy-sqlite-server\server\data\essersales.db <대상경로>
# 또는
copy archive\legacy-sqlite-server\essersales.db.20260702-094106.bak <대상경로>
```

---

## 13. 남은 리스크

| 리스크 | 수준 | 설명 |
|--------|------|------|
| README.md 미갱신 | LOW | 여전히 SQLite/`:3001` 안내 포함 |
| 과거 phase 회귀 스크립트 | LOW | phase-1-5~2-5는 legacy API 필요 (archive 복원 시에만 실행 가능) |
| `dist/` 구빌드 산출물 | LOW | `npm run build`로 재생성됨 |
| 가상 스크롤 record delete UI | LOW | Phase 3-4A와 동일, API DELETE 폴백 |
| NAS 미배포 | INFO | 이번 단계 범위 외 |

---

## 14. Phase 4 제안

1. **README.md 갱신** — PG 단일 스택 개발/배포 가이드
2. **NAS Docker Compose 배포** — `proxy` + 정적 Vue 빌드 서빙
3. **HTTPS / 도메인 연결** — Cloudflare Tunnel 또는 nginx TLS
4. **운영 env 템플릿** — `.env.production` 실제 값 구성
5. **archive 정리** — 6개월 안정 운영 후 `archive/legacy-sqlite-server/` 압축 보관
6. **phase-1~2 회귀 스크립트 archive** — legacy API 없이 실행 불가한 스크립트 이동
7. **mode flag 완전 제거** — `apiMode.js` 등을 상수로 단순화 (선택)

---

## 부록: 최종 아키텍처

```
Vue (Vite :5173)
    ↓ HTTP
PG API (Docker :3002/api/v1)
    ↓
PostgreSQL (Docker :5432)
```

**legacy SQLite API (`:3001`) — 런타임에서 제거됨**
