# Phase 3-1 Excel Upload & Parser PG Migration

## 1. 목적

legacy `:3001` JSON 업로드 API를 PostgreSQL API(`:3002/api/v1`)로 이전한다. **기존 `src/utils` 파서를 서버에서 재사용**하고, `VITE_WRITE_API_MODE=pg`일 때 multipart 업로드를 사용한다.

## 2. 기존 legacy 업로드 구조

| 경로 | 방식 | 설명 |
|------|------|------|
| `POST /api/uploads/sales-report` | JSON `{ fileName, parsed }` | 클라이언트 파싱 후 저장 |
| `POST /api/uploads/platform-daily` | JSON `{ fileName, platform, details, … }` | 일별 플랫폼 |
| `POST /api/uploads/platform-period` | JSON | 기간 합산 |
| `POST /api/uploads/platform-monthly` | JSON | 월별 |

### 클라이언트 파싱

- `src/utils/salesReportParser.js` — 통합 매출 리포트
- `src/utils/platformOrderParser.js` — 플랫폼 일/기간/월별
- `src/utils/coupangEsserParser.js` — 빅셀 매출분석
- `src/utils/excelReader.js` — FileReader 기반 엑셀 읽기

### legacy 저장

- `server/index.js` — SQLite `uploads` + `sales_records.data` JSON만 저장 (정규 컬럼 없음)
- 중복 처리: Vue에서 **동일 fileName + uploadKind** 기존 업로드 삭제 후 재저장

## 3. 신규 PG 업로드 API 구조

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/v1/uploads/excel` | multipart 엑셀 업로드 (메인) |

### multipart 필드

| 필드 | 설명 |
|------|------|
| `file` | 엑셀 파일 (.xlsx/.xls/.csv) |
| `upload_kind` | `sales_report`, `platform_daily`, `platform_period`, `platform_monthly`, `__test__` 등 |
| `platform` | 선택 플랫폼 |
| `sales_method` | 판매방식 (선택) |
| `upload_format` | 파서 format 힌트 (선택) |
| `replace_same_name` | `true` 시 동일 fileName+uploadKind 기존 업로드 삭제 (legacy 호환, 기본 true) |
| `force` | `true` 시 sha256 중복 무시 |

## 4. 기존 파서 재사용 방식

- `readExcelBuffer()` — Node/브라우저 공용 (`excelReader.js`)
- `readPlatformDailyBuffer`, `readPlatformPeriodBuffer`, `readPlatformMonthlyBuffer`, `readSalesReportBuffer`
- Docker 이미지에 `src/utils`, `src/config`, `src/constants` 포함
- 백엔드 `uploadParseService.js` → `recordBuilder.js` → PG insert

파서 로직 변경 없음. 저장 시 migration과 동일한 `mapSalesRecordBackfill`로 정규 컬럼 동기화.

## 5. 업로드 요청 파라미터

`upload_kind`에 따라 파서 분기:

| upload_kind | 파서 |
|-------------|------|
| `sales_report` | `readSalesReportBuffer` |
| `platform_daily`, `sales_daily_b`, `__test__` | `readPlatformDailyBuffer` |
| `platform_period`, `sales_period_b` | `readPlatformPeriodBuffer` |
| `platform_monthly`, `sales_monthly_b` | `readPlatformMonthlyBuffer` |

## 6. PostgreSQL 저장 구조

### uploads

`file_name`, `file_type`, `storage_path`, `platform`, `sales_method`, `upload_kind`, `business_date`, `period_from`, `period_to`, count 컬럼들, `parse_status`, `created_at`

### upload_files

`upload_id`, `sha256`, `size_bytes`, `mime_type`, `stored_at`

### sales_records

정규 컬럼 + `data` JSONB (raw row 전체 보존)

파일 바이너리는 `UPLOAD_DIR/{uploadId}/{fileName}`에 저장.

## 7. 중복 업로드 정책

| 기준 | 동작 |
|------|------|
| sha256 + upload_kind | 동일 시 `409 duplicate` (force=false) |
| fileName + upload_kind | `replace_same_name=true` 시 기존 삭제 후 재업로드 (legacy Vue 동작) |
| force=true | sha256 중복 허용 |

응답 예:

```json
{
  "ok": false,
  "duplicate": true,
  "message": "이미 업로드된 파일입니다.",
  "existingUploadId": "uuid"
}
```

## 8. 트랜잭션 정책

| 단계 | 실패 시 |
|------|---------|
| 파싱 | HTTP 400, DB 미기록 |
| DB insert (upload + upload_files + records) | **ROLLBACK** 전체 |
| 파일 디스크 저장 | commit 성공 후 (실패 시 DB는 이미 commit — 운영 시 모니터링) |

parse 실패용 `uploads failed` row는 생성하지 않음 (단순 400 반환).

## 9. Vue VITE_WRITE_API_MODE 연동

`src/services/salesApi.js`:

- `VITE_WRITE_API_MODE=legacy` → 기존 JSON API
- `VITE_WRITE_API_MODE=pg` + `file` 전달 → `pgUploadExcel` multipart

컴포넌트: `file` 인자만 추가 (`PlatformDailyUpload`, `PlatformPeriodUpload`, `PlatformMonthlyUpload`, `useSalesData`).

## 10. 업로드 후 KPI 갱신 방식

`useSalesData.refreshAfterUpload(scope)`:

- `loadUploads()` 항상
- `VITE_KPI_SOURCE=server` + `VITE_API_MODE=pg`: `loadServerKpiForScope` (summary/daily/by-platform/compare-yesterday)
- detail cache가 이미 로드된 경우에만 무효화 후 재로드
- client KPI 모드: 기존 `refreshAll()`

## 11. 회귀 검증 방법

```bash
docker compose up -d --build api
npm run regression:phase-3-1
```

테스트 파일: 스크립트가 런타임에 빅셀 형식 xlsx 생성 (`upload_kind=__test__`). 테스트 후 DELETE로 정리.

## 12. 회귀 검증 결과

```
npm run regression:phase-3-1 → OVERALL: PASS
```

| 항목 | 결과 |
|------|------|
| client parser rows | OK (details=3) |
| PG excel upload | OK |
| uploads / upload_files / sales_records | OK |
| parser vs PG count | OK |
| KPI summary 변화 | OK (+3000) |
| duplicate upload 409 | OK |
| upload DELETE 정리 | OK |

## 13. 아직 legacy에 남은 기능

- legacy JSON 업로드 API (`:3001`)
- 통합 엑셀 export
- SQLite DB 전체

## 14. Phase 3-2 제안

**통합 엑셀 export PG 전환**

1. `GET/POST /api/v1/exports/...` 설계
2. 대용량 export 비동기 job 큐 검토
3. legacy export 제거 전 parity 검증
4. 이후 legacy API 단계적 제거 → NAS 배포
