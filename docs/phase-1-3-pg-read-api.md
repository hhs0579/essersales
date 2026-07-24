# Phase 1-3 PostgreSQL Read API

> **목적:** PostgreSQL 복제 데이터 기준 **읽기 전용 API** 추가 및 SQLite 결과와 비교 검증  
> **범위:** `:3002` 신규 API만. Vue·`:3001` 레거시 **미변경**

---

## 1. 목적

Phase 1-2에서 PostgreSQL로 복제한 데이터를 **페이지네이션·필터**로 조회할 수 있는 API를 제공하고, 기존 SQLite 데이터와 **수치·건수 일치**를 확인합니다.

- Vue 연동: **하지 않음** (Phase 1-4+)
- KPI 전체 계산 이전: **하지 않음** (기본 합계만)

---

## 2. 구현된 API 목록

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/health` | (Phase 0) DB 헬스 |
| GET | `/api/v1/uploads` | 업로드 목록 (페이징·필터) |
| GET | `/api/v1/uploads/:id` | 업로드 상세 + 집계 |
| GET | `/api/v1/records` | sales_records 목록 + summary |
| GET | `/api/v1/settings` | app_settings 목록 |
| GET | `/api/v1/kpi/summary` | 기본 KPI 합계 |

---

## 3. API별 요청/응답 예시

### GET `/api/v1/uploads`

**쿼리:** `page`, `limit`, `file_type`, `status`, `from`, `to`, `keyword`

```json
{
  "items": [
    {
      "id": "2df7157a-f1c8-4c6d-99a6-531e9d165ef4",
      "fileName": "빅셀_로켓그로스_매출분석_20260601_20260601 (1).xlsx",
      "fileType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "platform": "쿠팡",
      "uploadKind": "platform_daily",
      "totalCount": 21,
      "status": "ok",
      "uploadedAt": "2026-06-01T..."
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 153
}
```

정렬: `created_at DESC` (응답 필드 `uploadedAt`)

### GET `/api/v1/uploads/:id`

```json
{
  "upload": { "id": "...", "fileName": "...", "uploadKind": "platform_daily" },
  "recordCount": 21,
  "salesTotal": 1587612,
  "quantityTotal": 45
}
```

### GET `/api/v1/records`

**쿼리:** `page`, `limit`, `from`, `to`, `platform`, `sales_method`, `store_name`, `product_code`, `product_name`, `transaction_type`, `upload_kind`, `upload_format`, `sort`, `order`, `include_data` (선택)

```json
{
  "items": [
    {
      "id": "...",
      "uploadId": "...",
      "orderDate": "2026-06-01",
      "platform": "쿠팡",
      "sales": 20900,
      "salesQty": 1,
      "uploadFormat": "coupang_esser"
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 4350,
  "summary": {
    "salesTotal": 291737783,
    "quantityTotal": 8304
  }
}
```

기본 응답에는 **JSONB `data` 미포함**. 전체 원본 필요 시 `include_data=true`.

### GET `/api/v1/settings`

**쿼리:** `scope`, `kind` (선택)

```json
{
  "items": [
    {
      "scope": "company_b",
      "kind": "own_mall_manual",
      "data": { "products": [], "sales": [], "salesSourceFiles": [] },
      "updatedAt": "...",
      "dataSize": 284884
    }
  ],
  "total": 9
}
```

이번 단계는 **기존 호환성 우선** — `own_mall_manual` base64 포함 전체 `data` 반환.

> **추후 제안:** 목록 API는 `dataSize`만, 상세 API `GET /api/v1/settings/:scope/:kind`에서 전체 value 제공.

### GET `/api/v1/kpi/summary`

**쿼리:** `from`, `to`, `platform`, `sales_method`, `store_name`, `upload_kind`

```json
{
  "salesTotal": 291737783,
  "quantityTotal": 8304,
  "recordCount": 4350,
  "uploadCount": 153,
  "filters": { "from": null, "to": null, "platform": null }
}
```

---

## 4. 기존 SQLite API와 차이점

| 항목 | 레거시 `:3001` | 신규 `:3002` |
|------|----------------|--------------|
| DB | SQLite | PostgreSQL |
| uploads | 전체 배열 반환 | 페이지네이션 `{ items, total }` |
| records | `recordType`별 **전체** 반환 | 필터·페이징·summary |
| settings | `GET /api/settings/:scope/:kind` 단건 | `GET /api/v1/settings` 목록 |
| KPI | 없음 (브라우저 계산) | `GET /api/v1/kpi/summary` 기본 합계 |
| 쓰기 | POST/PATCH/PUT 지원 | **읽기만** (Phase 1-3) |

---

## 5. 페이지네이션 정책

| 항목 | 값 |
|------|-----|
| 기본 `page` | 1 |
| 기본 `limit` | 50 |
| 최대 `limit` | 500 |
| offset | `(page - 1) * limit` |

---

## 6. 필터 정책

### uploads

| 파라미터 | 대상 컬럼 |
|----------|-----------|
| `file_type` | `uploads.file_type` |
| `status` | `uploads.parse_status` |
| `from` / `to` | `uploads.created_at::date` |
| `keyword` | `file_name ILIKE` |

### records / kpi

| 파라미터 | 대상 |
|----------|------|
| `from` / `to` | `order_date`, `business_date`, `period_from`~`period_to` 교차 |
| `platform`, `sales_method`, … | 정규 컬럼 equality |
| `product_name` | `ILIKE` 부분 일치 |

### records 정렬 whitelist

`order_date`, `sales`, `sales_qty`, `platform`, `store_name`, `product_name`, `created_at`, `upload_kind`

---

## 7. 검증 스크립트 실행 방법

```powershell
# API 컨테이너 재빌드 (코드 변경 후)
docker compose up -d --build api

# SQLite vs PostgreSQL read API 비교
npm run compare:read-api

# nginx 경유
node infra/scripts/compare-sqlite-pg-read-api.mjs --base-url http://localhost:8080
```

---

## 8. 검증 결과 (2026-07-01)

### PowerShell API smoke test (`:3002`)

| API | 결과 |
|-----|------|
| `GET /api/v1/uploads?page=1&limit=5` | total=**153** |
| `GET /api/v1/records?page=1&limit=5` | total=**4350**, salesTotal=**291737783** |
| `GET /api/v1/kpi/summary` | recordCount=**4350**, uploadCount=**153** |
| `GET /api/v1/settings` | **9** items |
| `GET /api/v1/uploads/:id` | recordCount·salesTotal 정상 |

### `compare-sqlite-pg-read-api.mjs`

**`:3002` 및 `:8080` (nginx) 모두 OVERALL: PASS**

```text
uploads count: OK 153 / 153
records count: OK 4350 / 4350
sales total: OK 291,737,783 / 291,737,783
quantity total: OK 8304 / 8304
platform filter: OK
upload_kind filter: OK
period filter (2026-06): OK
sample diff: OK (10건)
settings keys: OK
```

---

## 9. 남은 리스크

| 리스크 | 설명 |
|--------|------|
| **이중 쓰기 없음** | 업로드는 여전히 SQLite만 갱신 — PG는 스냅샷 |
| **settings 대용량** | `own_mall_manual` 전체 JSON 응답 — 목록/상세 분리 필요 |
| **records 원본** | 기본 목록에 JSONB 미포함 — 상세 API는 Phase 1-4 |
| **KPI 단순 합계** | `platformKpiSplit` 등 미구현 |
| **정렬 tie-break** | `created_at` 동일 시 SQLite·PG 순서 차이 가능 |

---

## 10. Phase 1-4 제안

1. Vue feature flag로 **읽기 API** 점진 연동 (`VITE_USE_PG_READ_API`)
2. `GET /api/v1/records/:id` 상세 (JSONB 선택 반환)
3. `GET /api/v1/settings/:scope/:kind` — 대용량 base64 분리
4. KPI API 확장 (`/api/v1/kpi/platform-split`) — 백엔드 포팅 시작
5. PostgreSQL **쓰기 경로**는 Phase 3(서버 파싱) 이후

---

## 부록: PowerShell 테스트 명령

### 직접 API (`:3002`)

```powershell
Invoke-RestMethod "http://localhost:3002/api/v1/uploads?page=1&limit=10"
Invoke-RestMethod "http://localhost:3002/api/v1/records?page=1&limit=10"
Invoke-RestMethod "http://localhost:3002/api/v1/kpi/summary"
Invoke-RestMethod "http://localhost:3002/api/v1/settings"
Invoke-RestMethod "http://localhost:3002/api/v1/kpi/summary?platform=쿠팡"
```

### nginx 경유 (`:8080`)

```powershell
Invoke-RestMethod "http://localhost:8080/api/v1/uploads?page=1&limit=10"
Invoke-RestMethod "http://localhost:8080/api/v1/records?page=1&limit=10"
Invoke-RestMethod "http://localhost:8080/api/v1/kpi/summary"
```

---

## 부록: 코드 위치

```
backend/src/routes/uploads.js
backend/src/routes/records.js
backend/src/routes/settings.js
backend/src/routes/kpi.js
backend/src/repositories/uploadsRepository.js
backend/src/repositories/recordsRepository.js
backend/src/repositories/settingsRepository.js
backend/src/services/kpiReadService.js
infra/scripts/compare-sqlite-pg-read-api.mjs
```

---

*Vue·SQLite `:3001`·파서·KPI·export는 변경하지 않았습니다.*
