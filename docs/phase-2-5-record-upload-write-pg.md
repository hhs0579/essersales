# Phase 2-5 Record & Upload Write API Migration

## 1. 목적

settings 저장(Phase 2-4)에 이어 **record 수정/삭제**와 **업로드 삭제**를 PostgreSQL API(`:3002/api/v1`)로 이전하고, `VITE_WRITE_API_MODE` feature flag로 legacy/pg 쓰기 전환이 가능한 상태를 만든다.

NAS 배포·엑셀 업로드 PG 전환은 이번 단계 범위 밖이다.

## 2. 기존 legacy record/upload 쓰기 구조

| 동작 | Legacy API | 구현 |
|------|------------|------|
| record 수정 | `PATCH /api/records/:id` | body `{ fields }` — `data` JSON 병합, `updated_at` 갱신 |
| record 삭제 | `DELETE /api/records/:id` | `sales_records` hard delete |
| 업로드 삭제 | `DELETE /api/uploads/:id` | transaction: records 선삭제 → upload 삭제 |

legacy PATCH는 `id`, `uploadId`, `recordType`, `createdAt`, `updatedAt`을 보호하고 나머지 필드를 `data` JSON에 병합한다. 정규 컬럼(platform, sales 등)은 갱신하지 않는다.

batch record 삭제 API는 legacy에 없음.

## 3. 신규 PG record 쓰기 API

| Method | Path | 설명 |
|--------|------|------|
| PATCH | `/api/v1/records/:id` | 단일 row 수정 |
| DELETE | `/api/v1/records/:id` | 단일 row 삭제 |

### PATCH 동작

- body: legacy 호환 `{ fields: { ... } }` 또는 flat body
- 보호 필드: `id`, `uploadId`, `recordType`, `createdAt`, `updatedAt` 등
- whitelist 필드만 허용 (platform, salesMethod, storeName, productCode, …)
- 숫자·날짜 형식 검증
- `data` JSONB 병합 (legacy와 동일한 merge 규칙)
- **추가**: PG KPI/필터 일관성을 위해 정규 컬럼도 병합 결과에서 동기화

### DELETE 동작

- 존재 확인 후 hard delete (legacy와 동일)
- soft delete(`deleted_at`)는 스키마에 컬럼이 없어 **방법 B** 채택

## 4. 신규 PG upload 삭제 API

| Method | Path | 설명 |
|--------|------|------|
| DELETE | `/api/v1/uploads/:id` | 업로드 및 연관 records 삭제 |

응답 예: `{ ok: true, id, deleted: true, recordsDeleted: N }`

## 5. 삭제 정책

| 대상 | 정책 | 근거 |
|------|------|------|
| record | hard delete | legacy `DELETE FROM sales_records WHERE id = ?` |
| upload | hard delete + 연관 records 선삭제 | legacy transaction과 동일 |
| upload_files | upload 삭제 시 FK `ON DELETE CASCADE` | 001 스키마 |
| batch DELETE `/records` | 미구현 | legacy에 없음 — Phase 3 이후 필요 시 제안 |

## 6. VITE_WRITE_API_MODE 연동 방식

```env
VITE_WRITE_API_MODE=legacy   # 기본값
VITE_WRITE_API_MODE=pg
```

| 함수 | legacy | pg |
|------|--------|-----|
| `updateSalesRecord` | `:3001/api/records/:id` PATCH | `:3002/api/v1/records/:id` PATCH |
| `deleteSalesRecord` | `:3001/api/records/:id` DELETE | `:3002/api/v1/records/:id` DELETE |
| `deleteUploadAndRecords` | `:3001/api/uploads/:id` DELETE | `:3002/api/v1/uploads/:id` DELETE |

분기 위치: `src/services/salesApi.js` (컴포넌트 변경 최소화).

읽기 API는 기존대로 `VITE_API_MODE`가 제어한다.

## 7. own_mall_manual drift 원인 및 조치

### 증상 (Phase 2-4 회귀)

- `company_b/own_mall_manual`: legacy/SQLite 일치, PG만 WARN

### 추정 원인

1. 초기 `migrate:pg` 이후 legacy(SQLite)에서 own_mall 수기 데이터가 추가·수정됨
2. PG `app_settings`는 마이그레이션 시점 스냅샷만 보유
3. own_mall JSON 내부 id 재생성 등으로 바이트 단위 diff 가능

### 조치

단일 key만 재동기화 (전체 `app_settings` 덮어쓰기 금지):

```bash
# PG 현재값 로그 후 비교만
node infra/scripts/resync-app-setting-from-sqlite.mjs --scope company_b --kind own_mall_manual --dry-run

# SQLite → PG upsert
node infra/scripts/resync-app-setting-from-sqlite.mjs --scope company_b --kind own_mall_manual --execute
```

회귀 스크립트는 drift 감지 시 SQLite 기준으로 자동 resync 후 재검증한다.

## 8. 테스트 방법

### API 서버

```bash
docker compose up -d --build api
npm run dev:server   # legacy :3001
```

### 회귀

```bash
npm run regression:phase-2-5
```

테스트 데이터: `upload_kind=__test__`, `upload_format=phase-2-5`, `product_code=__test_record__` — 테스트 후 정리.

### Vue 수동 확인

```env
VITE_WRITE_API_MODE=pg
VITE_API_MODE=pg
```

데이터 탭에서 record 수정/삭제, 업로드 삭제 동작 확인.

## 9. 회귀 검증 결과

```
npm run regression:phase-2-5 → OVERALL: PASS
```

| 항목 | 결과 |
|------|------|
| PG record PATCH | OK |
| PATCH 후 GET 반영 | OK (sales=2500) |
| PG record DELETE | OK |
| PG upload DELETE | OK (recordsDeleted=1) |
| legacy vs PG upload DELETE 404 | OK |
| own_mall_manual legacy/SQLite | OK |
| own_mall_manual resync 후 PG/SQLite | OK (drift 자동 복구) |

## 10. 아직 legacy에 남은 기능

- 엑셀 업로드/파싱 (`POST /api/uploads/*`)
- 통합 엑셀 export
- SQLite DB 전체 (운영 소스)

## 11. Phase 3-1 제안

**엑셀 업로드/파싱 PG 전환**

1. `POST /api/v1/uploads/sales-report` 등 업로드 엔드포인트 추가
2. 파서는 기존 `src/` 로직 재사용, 저장만 PG repository로
3. `VITE_WRITE_API_MODE=pg` 시 업로드 POST도 PG로 분기
4. 대용량 트랜잭션·중복 파일(sha256) 처리
5. 업로드 완료 후 KPI 즉시 반영 검증

그 다음 단계: 통합 엑셀 export PG 이전 → legacy API 제거 검토 → NAS 배포.
