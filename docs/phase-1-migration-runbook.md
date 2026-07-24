# Phase 1-2 SQLite to PostgreSQL Migration Runbook

> **목적:** 기존 Vue·SQLite API(`:3001`)는 그대로 두고, `essersales.db` 데이터를 PostgreSQL Docker DB에 **복제**합니다.  
> **범위:** 스키마 002 적용 + 데이터 이전 + 검증. Vue 연동은 Phase 1-3 이후.

---

## 1. 목적

- SQLite `uploads` / `sales_records` / `app_settings` → PostgreSQL 이전
- 이전 결과 정합성 검증 (건수·합계·샘플)
- 레거시 시스템 무중단 (SQLite는 백업 후에도 계속 사용)

---

## 2. 전제 조건

| 항목 | 확인 |
|------|------|
| Docker Desktop + WSL2 | 실행 중 |
| `.env` | 프로젝트 루트에 존재 (`DB_PASSWORD` 등) |
| SQLite DB | `server/data/essersales.db` 존재 |
| Node.js 20+ | `npm install` 완료 |
| 레거시 서버 | 이전 중에도 `:3001` 사용 가능 (읽기 전용 권장) |

**호스트에서 스크립트 실행 시:** `.env`의 `DB_HOST=db`는 자동으로 `localhost`로 해석됩니다.

---

## 3. 백업 절차

```powershell
cd "C:\Users\Esser\Desktop\esser dev\essersales"
npm run backup:sqlite
```

또는:

```powershell
node infra/scripts/backup-sqlite.mjs
```

생성 위치:

- `server/data/backup/essersales-before-pg-migration-YYYYMMDD-HHMMSS.db`
- `server/data/backup/essersales-before-pg-migration-latest.db`

---

## 4. Docker/PostgreSQL 실행 확인

```powershell
docker compose up -d --build
Invoke-RestMethod http://localhost:3002/api/v1/health
```

기대: `ok: true`, `db.connected: true`, `migrationVersion` ≥ 1

API 컨테이너 재시작 시 **002 마이그레이션**이 자동 적용됩니다 (`MIGRATIONS_DIR=/app/infra/db`).

수동 확인:

```powershell
docker compose exec -T db psql -U essersales -d essersales -c "SELECT version, name FROM schema_migrations ORDER BY version"
```

---

## 5. 002 마이그레이션 적용 확인

```powershell
docker compose exec -T db psql -U essersales -d essersales -c "\d uploads"
docker compose exec -T db psql -U essersales -d essersales -c "\d sales_records"
```

002 추가 컬럼 예:

- `uploads.total_count`, `uploads.file_type`
- `sales_records.product_code`, `option_name`, `transaction_type`, `upload_kind`, `upload_format`, `period_from`, `period_to`, `business_date`

마이그레이션 스크립트 실행 시에도 002가 미적용이면 **자동 적용**됩니다.

---

## 6. Dry-run 실행

```powershell
npm run migrate:pg:dry-run
```

또는:

```powershell
node infra/scripts/migrate-sqlite-to-pg.mjs --dry-run
```

- **기본값이 dry-run** (`--execute` 없으면 데이터 미기록)
- 스키마 002는 dry-run에서도 적용됨 (컬럼 확보)
- 계획 건수·샘플 row 출력 확인

---

## 7. 실제 마이그레이션 실행

```powershell
npm run migrate:pg
```

또는:

```powershell
node infra/scripts/migrate-sqlite-to-pg.mjs --execute
```

PostgreSQL에 이미 이전 데이터가 있으면 **중단**됩니다. 덮어쓰려면:

```powershell
node infra/scripts/migrate-sqlite-to-pg.mjs --execute --force
```

`--force`는 `uploads`, `sales_records`, `app_settings`만 삭제 후 재삽입합니다.

---

## 8. 검증 스크립트 실행

```powershell
npm run verify:pg
```

또는:

```powershell
node infra/scripts/verify-pg-migration.mjs
```

기대 출력:

```text
uploads: OK 153 / 153
sales_records: OK 4350 / 4350
app_settings: OK 9 / 9
sales total: OK
quantity total: OK
sample diff: OK
OVERALL: PASS
```

---

## 9. 실패 시 롤백 방법

### PostgreSQL 데이터만 제거

```powershell
node infra/scripts/migrate-sqlite-to-pg.mjs --execute --force
# 또는
docker compose exec -T db psql -U essersales -d essersales -c "DELETE FROM sales_records; DELETE FROM uploads; DELETE FROM app_settings;"
```

### PostgreSQL 전체 초기화 (주의)

```powershell
docker compose down -v
docker compose up -d --build
```

### SQLite 복원

```powershell
copy server\data\backup\essersales-before-pg-migration-latest.db server\data\essersales.db
```

레거시 `:3001` API는 SQLite 파일을 사용하므로, SQLite만 복원하면 기존 앱이 복구됩니다.

---

## 10. 주의사항

| 항목 | 내용 |
|------|------|
| Vue / `:3001` | **이번 단계에서 변경 없음** — 여전히 SQLite 사용 |
| 플랫폼 원본 xlsx | SQLite에 파일 바이너리 없음 (파일명만) — `sales_records.data` JSON이 원천 |
| 자사몰 base64 | `app_settings.own_mall_manual` JSONB에 **그대로 보존** — 추후 `upload_files` 외부화 검토 |
| `sales_type` | 별도 컬럼 없음 — `sales_method`에 매핑 |
| `quantity` | 별도 컬럼 없음 — `sales_qty`에 매핑 |
| `raw_data` | 별도 컬럼 없음 — `data` JSONB에 전체 보관 |
| 이중 쓰기 | Phase 1-2 이후에도 업로드는 SQLite에만 기록됨 — PG는 스냅샷 복제본 |

### 권장 실행 순서 (전체)

```powershell
docker compose up -d --build
node infra/scripts/backup-sqlite.mjs
node infra/scripts/migrate-sqlite-to-pg.mjs --dry-run
node infra/scripts/migrate-sqlite-to-pg.mjs --execute
node infra/scripts/verify-pg-migration.mjs
```

---

## 부록: npm scripts

| script | 명령 |
|--------|------|
| `npm run backup:sqlite` | SQLite 백업 |
| `npm run migrate:pg:dry-run` | 이전 dry-run |
| `npm run migrate:pg` | 이전 execute |
| `npm run verify:pg` | 검증 |

---

*Phase 1-3: PostgreSQL 읽기 API 추가 및 Vue 점진 연동 (별도 문서).*
