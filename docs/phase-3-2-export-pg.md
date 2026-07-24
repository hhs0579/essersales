# Phase 3-2 Integrated Excel Export PG Migration

## 1. 목적

클라이언트 `dashboardExporter.js` 기반 **통합 엑셀 export**를 PostgreSQL API(`:3002/api/v1`)에서 생성·다운로드할 수 있게 한다. 데이터는 PG `sales_records`·`app_settings`·KPI 서비스 기준이며, 기존 시트 구조·KPI 계산을 유지한다.

## 2. 기존 legacy export 구조

| 항목 | 내용 |
|------|------|
| 서버 API | **없음** — legacy `:3001`에 export 엔드포인트 없음 |
| 실행 위치 | 브라우저 (`useSalesData.downloadDashboardExport`) |
| 생성 로직 | `src/utils/dashboardExporter.js` + `excelWorkbookStyle.js` (ExcelJS) |
| 입력 데이터 | 클라이언트 메모리의 records (SQLite/PG 읽기 API 결과) |
| 수기 광고비 | `manualAdSpend.js` + composable snapshot |
| 다운로드 | `downloadExcelWorkbook` → Blob |

## 3. 신규 PG export API 구조

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/exports/integrated` | 동기 통합 export (쿼리 파라미터) |
| POST | `/api/v1/exports/integrated` | 동기 통합 export (body + query) |

응답: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` 스트림 (파일 디스크 저장 없음, 1차 구현).

대용량/운영용: `export_jobs` + `EXPORT_DIR` 비동기 전환 제안 (Phase 3-3+).

## 4. export 요청 파라미터

| 파라미터 | 설명 |
|----------|------|
| `scope` | `platform`, `combined_daily` 등 (기본 `platform`) |
| `from`, `to` | YYYY-MM-DD |
| `platform`, `sales_method`, `store_name` | 필터 |
| `upload_kind`, `upload_format` | 선택 필터 |
| `include_manual_ads` | 기본 true |
| `year`, `month`, `day_of_week` | UI 필터 호환 (`applyRecordFilters`와 동일 shape) |
| `date`, `channel`, `brand`, `product_name`, `option` | 상세 탭 텍스트 필터 |
| `format` | `xlsx` (기본) |

`filterObj`는 Vue `createDefaultFilters()`와 동일하게 `dayOfWeek: ''` 등 빈 문자열 필드를 포함해야 `applyRecordFilters`가 기간 필터를 오적용하지 않는다.

## 5. 시트 구성

기존 `buildDashboardWorkbook`과 동일:

| 시트 | 설명 |
|------|------|
| ⓪손익계산서* | 통합 + 템플릿 있을 때 |
| ①요약리포트 | KPI 요약 |
| 베스트하임/사본느리/파워프라이스 요약* | 통합 시 |
| ②전일대비 | 전일/전주 대비 |
| ②판매방식별 | 판매방식 집계 |
| ③일별 ~ ⑦스토어별 | 기간·스토어 |
| ⑧상세_판매 | 상품 행 상세 |
| ⑨반품 | 반품 |
| ⑩상품순위 | 순위 |
| ⑪빅셀_판매 / ⑫빅셀_반품 | 빅셀 형식 |
| KPI | KPI 카드 표 |

## 6. 시트별 데이터 소스

| 데이터 | PG 소스 |
|--------|---------|
| 상세/집계 records | `sales_records` (upload_kind = scope) |
| 수기 광고비 | `app_settings` (`manual_ad`) |
| staff memo | `app_settings` (`staff_memo`) |
| special sale / comments | `app_settings` (통합 scope) |
| 손익 템플릿 | `app_settings` (`profit_loss_template`) |

## 7. KPI 계산 기준

- `buildDashboardWorkbook` 내부 `esserMetrics` / `manualAdSpend` (Phase 2-3과 동일 Esser 규칙)
- PG KPI summary API와 export KPI 시트 매출은 **동일 scope·upload_kind** 기준으로 일치 (회귀: `upload_kind=platform_daily`)

## 8. 수기 광고비 반영 기준

- `include_manual_ads=true` (기본)
- `loadManualAdEntriesForScope` + `manualAdSpend.js` merge (KPI API와 동일 scope 규칙)

## 9. ExcelJS 생성 방식

- `buildDashboardWorkbook` → `workbookToBuffer` (서버)
- `addStyledSheet` 등 기존 `excelWorkbookStyle.js` 재사용

## 10. Vue export API mode 구조

별도 flag 사용 (쓰기 API와 분리):

```env
VITE_EXPORT_API_MODE=legacy   # 기본값
VITE_EXPORT_API_MODE=pg
```

| mode | 동작 |
|------|------|
| `legacy` | 브라우저 `downloadDashboardExcel` (기존) |
| `pg` | `GET /api/v1/exports/integrated` → Blob 다운로드 |

`VITE_WRITE_API_MODE`와 독립 — 읽기 전용 export만 PG로 분리 가능.

## 11. 회귀 검증 방법

```bash
docker compose up -d --build api
npm run regression:phase-3-2
```

## 12. 회귀 검증 결과

```text
npm run regression:phase-3-2 → OVERALL: PASS
```

| 항목 | 결과 |
|------|------|
| PG export 생성 | OK (~709KB, 14 sheets) |
| 필수 시트 존재 | OK (①요약리포트 ~ KPI) |
| ⑧상세_판매 row count | OK (2023 rows) |
| KPI 시트 vs summary API (`upload_kind=platform_daily`) | OK (매출 77,469,726) |
| client build vs server sheet count | OK (14) |
| client KPI vs export KPI 시트 | OK |
| ⑩상품순위 row count | OK (202 rows) |
| HTTP GET `/exports/integrated` | OK (200) |

비교 시 바이너리 전체 diff는 하지 않음. 시트명·row count·주요 KPI 값 중심.

## 13. 기존 legacy와 차이점

| 항목 | legacy (client) | PG export |
|------|-----------------|-----------|
| 실행 | 브라우저 | 서버 |
| 데이터 로드 | Vue state | PG SQL |
| 손익 템플릿 | composable + localStorage | `app_settings` |
| API | 없음 | `/api/v1/exports/integrated` |

시트 구조·계산 로직은 **동일 함수** (`buildDashboardWorkbook`) 사용.

## 14. 아직 legacy에 남은 기능

- 클라이언트 export (`VITE_EXPORT_API_MODE=legacy` 기본)
- legacy JSON 업로드 API
- SQLite DB

## 15. Phase 3-3 제안

1. `export_jobs` 비동기 큐 + `EXPORT_DIR` 파일 보관
2. legacy API 단계적 제거 계획
3. NAS 배포 (전체 PG 전환 완료 후)
