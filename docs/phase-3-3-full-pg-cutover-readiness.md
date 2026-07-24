# Phase 3-3 Full PG Cutover Readiness

## 1. 목적

Phase 0~3-2에서 이전한 **읽기·KPI·쓰기·업로드·export** 기능이 **전체 PG 모드**에서 운영 가능한지 검증하고, legacy SQLite API 제거(Phase 3-4) 전 필요한 의존성 분석·체크리스트·env 제안을 정리한다.

이번 단계에서는 **legacy API 삭제, SQLite 삭제, NAS 배포를 하지 않는다.**

## 2. 전체 PG 모드 설정

검증·스테이징 기준 env (`.env.pg-staging` 참고):

```env
VITE_API_MODE=pg
VITE_KPI_SOURCE=server
VITE_WRITE_API_MODE=pg
VITE_EXPORT_API_MODE=pg
VITE_PG_API_BASE=http://localhost:3002/api/v1
```

개발용 **기본 `.env` / `.env.example` 기본값은 legacy 유지**:

```env
VITE_API_MODE=legacy
VITE_KPI_SOURCE=client
VITE_WRITE_API_MODE=legacy
VITE_EXPORT_API_MODE=legacy
```

## 3. 전체 PG 모드 E2E 검증 결과

```bash
docker compose up -d --build api
npm run regression:phase-3-3
```

| 검증 항목 | 내용 |
|-----------|------|
| health | PG API + DB 연결 |
| settings GET list / GET single / PUT | `__test__` scope만 쓰기 |
| uploads list | 페이지네이션 |
| records lazy load | `page=1&limit=500` (+ page 2) |
| KPI 4종 | summary, daily, by-platform, compare-yesterday |
| record PATCH / DELETE | `__test__` 데이터 |
| upload excel | multipart `POST /uploads/excel` |
| upload 후 KPI 반영 | summary 매출 증가 |
| upload DELETE 후 KPI 복구 | baseline 매출 복귀 |
| export integrated | HTTP GET + 필수 시트 + KPI·상세·순위 |
| legacy API 호출 | **0회** (스크립트 내 PG URL만 사용) |

실행 후 `npm run regression:phase-3-3` 결과 (최종):

```text
health: OK
settings write: OK
record patch/delete: OK
upload excel: OK
kpi summary/daily/platform/dod: OK
export integrated: OK
legacy api calls: 0
OVERALL: PASS
```

| 항목 | 결과 |
|------|------|
| health | OK |
| settings GET/PUT | OK |
| uploads list | OK (total=153) |
| records lazy load | OK (page1=500, total=4350) |
| KPI 4종 | OK (sales=77,469,726) |
| record PATCH/DELETE | OK |
| upload excel + KPI 반영/복구 | OK |
| export integrated + 필수 시트 | OK (14 sheets, ~709KB) |
| export KPI 매출 | OK (77,469,726) |
| legacy API 호출 | **0회** |

## 4. 기능별 PG 전환 상태

| 기능 | PG API | Vue 분기 | PG 전환 | 비고 |
|------|--------|----------|---------|------|
| 업로드 목록 | `GET /uploads` | `VITE_API_MODE=pg` | 완료 | |
| records 조회 | `GET /records` | `VITE_API_MODE=pg` | 완료 | lazy page |
| settings 조회 | `GET /settings` | `VITE_API_MODE=pg` | 완료 | |
| KPI summary | `GET /kpi/summary` | `pg` + `server` | 완료 | |
| KPI daily | `GET /kpi/daily` | `pg` + `server` | 완료 | |
| KPI by-platform | `GET /kpi/by-platform` | `pg` + `server` | 완료 | |
| KPI compare-yesterday | `GET /kpi/compare-yesterday` | `pg` + `server` | 완료 | |
| settings 저장 | `PUT /settings/:scope/:kind` | `VITE_WRITE_API_MODE=pg` | 완료 | |
| record 수정/삭제 | `PATCH/DELETE /records/:id` | `VITE_WRITE_API_MODE=pg` | 완료 | |
| upload 삭제 | `DELETE /uploads/:id` | `VITE_WRITE_API_MODE=pg` | 완료 | |
| 엑셀 업로드 | `POST /uploads/excel` | `VITE_WRITE_API_MODE=pg` | 완료 | multipart |
| 통합 export | `GET /exports/integrated` | `VITE_EXPORT_API_MODE=pg` | 완료 | Phase 3-2 |
| legacy JSON 업로드 | `POST /api/uploads/*` | `legacy` write만 | **미제거** | Phase 3-4 |
| legacy SQLite 읽기 | `server/index.js` | `legacy` mode | **미제거** | Phase 3-4 |

## 5. legacy API 의존성 목록

### Vue / 프론트엔드

| 파일 | 의존 코드 | 현재 역할 | PG 대체 | 삭제 가능 |
|------|-----------|-----------|---------|-----------|
| `src/services/legacyApiClient.js` | `VITE_LEGACY_API_BASE`, `legacyRequest` | legacy HTTP 클라이언트 | `pgApiClient.js` | `legacy` mode 제거 후 |
| `src/services/apiClient.js` | `legacyFetch*` 분기 | 읽기 API 라우팅 | `pgFetch*` | 분기 제거 후 |
| `src/services/salesApi.js` | `legacyRequest` (upload/record) | 쓰기·업로드 | `pgApiClient` | `pg` write 시 미호출 |
| `src/services/appSettingsApi.js` | `legacyRequest` PUT | settings 저장 | `pgPutAppSetting` | `pg` write 시 미호출 |
| `src/services/apiMode.js` | `VITE_API_MODE` | 읽기 모드 | — | env 유지 시 필요 |
| `src/services/writeApiMode.js` | `VITE_WRITE_API_MODE` | 쓰기 모드 | — | env 유지 시 필요 |
| `src/services/exportApiMode.js` | `VITE_EXPORT_API_MODE` | export 모드 | — | env 유지 시 필요 |
| `src/components/Platform*Upload.vue` | UI 문구 `localhost:3001` | 오류 안내 | PG base URL 안내로 변경 가능 | 문구만 |
| `package.json` `dev:server` | `server/index.js` | legacy API 기동 | Docker PG API | legacy 제거 후 |

### Legacy 서버 (`server/`)

| 파일 | 의존 | 역할 | PG 대체 | 삭제 가능 |
|------|------|------|---------|-----------|
| `server/index.js` | SQLite, Express | `:3001` 전체 API | `backend/src` | Phase 3-4 |
| `server/db.js` | `better-sqlite3`, `DB_PATH` | SQLite 연결 | PostgreSQL pool | Phase 3-4 |
| `server/data/essersales.db` | 파일 | legacy 데이터 | PG | 백업 후 Phase 3-4 |

### Legacy JSON 업로드 엔드포인트 (`server/index.js`)

| Method | Path | PG 대체 |
|--------|------|---------|
| POST | `/api/uploads/sales-report` | `POST /api/v1/uploads/excel` |
| POST | `/api/uploads/platform-daily` | 동일 |
| POST | `/api/uploads/platform-period` | 동일 |
| POST | `/api/uploads/platform-monthly` | 동일 |

기타 legacy 라우트: `GET/PUT /api/settings`, `GET /api/uploads`, `GET /api/records`, `PATCH/DELETE /api/records/:id`, `DELETE /api/uploads/:id`, `GET /api/health`.

### 인프라·마이그레이션 스크립트 (운영 런타임 아님)

| 파일 | SQLite/legacy 사용 | 역할 |
|------|-------------------|------|
| `infra/scripts/migrate-sqlite-to-pg.mjs` | SQLite 읽기 | 초기 마이그레이션 |
| `infra/scripts/verify-pg-migration.mjs` | 비교 | 검증 |
| `infra/scripts/compare-sqlite-pg-read-api.mjs` | 비교 | 검증 |
| `infra/scripts/resync-app-setting-from-sqlite.mjs` | resync | drift 복구 |
| `infra/scripts/backup-sqlite.mjs` | 백업 | 롤백용 |
| `scripts/*.mjs` (purge, inspect 등) | 직접 DB | **일회성 유지보수** |

## 6. legacy JSON 업로드 API 상태

| API | Vue 호출 (`salesApi.js`) | `VITE_WRITE_API_MODE=pg` |
|-----|--------------------------|---------------------------|
| `POST /uploads/sales-report` | `saveSalesReportUpload` | **미호출** → `pgUploadExcel` |
| `POST /uploads/platform-daily` | `savePlatformDailyUpload` | **미호출** |
| `POST /uploads/platform-period` | `savePlatformPeriodUpload` | **미호출** |
| `POST /uploads/platform-monthly` | `savePlatformMonthlyUpload` | **미호출** |

- `isPgWriteMode() && file` 이면 항상 multipart PG 업로드.
- legacy JSON 경로는 `VITE_WRITE_API_MODE=legacy` 또는 `file` 없을 때만 사용.
- **삭제 가능 여부**: Full PG cutover 후 **가능** (Phase 3-4).
- **삭제 전 회귀**: `regression:phase-3-1`, `regression:phase-3-3`, 수동 UI 업로드 스모크.

## 7. SQLite 의존성 분석

### 읽기

| 위치 | 용도 |
|------|------|
| `server/db.js` | legacy API 모든 GET |
| `server/index.js` | uploads/records/settings 조회 |
| `scripts/*.mjs` | 유지보수·검사 (운영 경로 아님) |
| `infra/scripts/*` | 마이그레이션·회귀 비교 |

### 쓰기

| 위치 | 용도 |
|------|------|
| `server/index.js` | JSON 업로드, settings PUT, record PATCH/DELETE, upload DELETE |

### PG 모드에서 SQLite 필요 여부

| 모드 | SQLite 필요 |
|------|-------------|
| `VITE_*=pg/server/pg/pg` (Full PG) | **불필요** (Vue + PG API만) |
| 일부 legacy env | legacy `server/index.js` 기동 시 필요 |
| 마이그레이션·백업 스크립트 | 비교·resync 시 필요 |

### Phase 3-4 삭제 후보 / 보관

| 삭제 후보 (Phase 3-4) | 보관 |
|----------------------|------|
| `server/index.js`, `server/db.js` | `infra/scripts/backup-sqlite.mjs` |
| `server/data/essersales.db` (운영) | `backups/*.db` 스냅샷 |
| `better-sqlite3` (package.json) | 마이그레이션 스크립트 완료 전까지 devDep 검토 |

## 8. production env 제안

- **스테이징**: `.env.pg-staging` (로컬 Full PG 검증)
- **운영 예시**: `.env.production.example` (nginx + `/api/v1`, 롤백용 `/legacy-api`)

권장 운영 전환 순서:

1. PG 백업 + SQLite `npm run backup:sqlite`
2. `.env.production`에 Full PG env 적용
3. `npm run build` → static + Docker `api` + `db`
4. `npm run regression:phase-3-3` (스테이징/운영 URL)
5. legacy env는 롤백용으로만 유지 (Phase 3-4까지)

## 9. legacy 제거 전 체크리스트

- [x] 전체 PG 회귀 테스트 PASS (`npm run regression:phase-3-3`)
- [ ] `VITE_API_MODE=pg` 화면 정상 (업로드·상세·필터)
- [ ] `VITE_KPI_SOURCE=server` KPI 정상 (대시보드·차트)
- [ ] `VITE_WRITE_API_MODE=pg` 저장 정상 (settings·record·upload)
- [ ] `VITE_EXPORT_API_MODE=pg` export 정상
- [ ] 엑셀 업로드 PG 정상 (각 채널 컴포넌트)
- [ ] 통합 export PG 정상
- [x] legacy API 호출 0회 확인 (E2E 스크립트)
- [ ] SQLite 없이 실행 가능 검토 완료 (Docker: api+db+proxy만)
- [ ] 운영 데이터 백업 계획 완료 (PG dump + SQLite archive)
- [ ] 롤백 계획 작성 완료 (env legacy 복원 + SQLite 서버)

## 10. 남은 리스크

| 리스크 | 설명 | 완화 |
|--------|------|------|
| KPI scope 필터 | summary API `scope`만으로는 upload_kind 미필터 → export와 범위 불일치 가능 | UI/export와 동일 `upload_kind` 쿼리 사용 |
| settings drift | `own_mall_manual` 등 PG/SQLite 불일치 | `resync-app-setting-from-sqlite.mjs` |
| legacy 서버 동시 기동 | 개발 시 `:3001`+`:3002` 혼동 | `.env.pg-staging`으로 명확히 분리 |
| nginx UI 통합 미완 | proxy는 API만, Vue는 별도 dev/preview | NAS 배포 시 static+proxy 통합 |
| 일회성 scripts | `scripts/purge-*.mjs`가 SQLite 직접 참조 | PG 전환 후 deprecated 표시 |

## 11. Phase 3-4 제안

1. **legacy API 제거**: `server/` 축소 또는 제거, JSON 업로드 라우트 삭제
2. **SQLite 제거**: `better-sqlite3` 의존성·`essersales.db` 운영 경로 제거 (백업 보관)
3. **Vue 분기 단순화**: `legacyApiClient`·mode flag 제거 또는 pg 고정
4. **nginx 통합 배포**: static UI + `/api/v1` 단일 origin
5. **NAS 배포**: Docker Compose 운영 + 백업 cron + `regression:phase-3-3` CI

---

*회귀 결과는 `npm run regression:phase-3-3` 실행 후 §3 표를 갱신하세요.*
