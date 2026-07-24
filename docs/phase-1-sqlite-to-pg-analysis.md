# Phase 1-1 SQLite to PostgreSQL 분석

> **범위:** 분석·설계 문서만. 코드·DB·마이그레이션 SQL 수정 없음.  
> **분석 일시:** 2026-07-01  
> **선행:** [current-structure.md](./current-structure.md), [target-architecture.md](./target-architecture.md), [phase-0-verification.md](./phase-0-verification.md)

---

## 1. 기존 SQLite 구조

### 1.1 DB 파일 위치

| 항목 | 값 |
|------|-----|
| 기본 경로 | `server/data/essersales.db` |
| 환경 변수 오버라이드 | `DB_PATH` (`server/db.js`) |
| 실측 경로 (로컬) | `C:\Users\Esser\Desktop\esser dev\essersales\server\data\essersales.db` |
| 저널 | SQLite WAL (`*.db-wal`, `*.db-shm`) |

### 1.2 연결 코드 위치

| 파일 | 역할 |
|------|------|
| `server/db.js` | `better-sqlite3` 연결, 스키마 `CREATE TABLE`, 시작 시 데이터 보정 마이그레이션 |
| `server/index.js` | Express 라우트에서 `db` 직접 사용 |
| `server/settings.js` | `app_settings` CRUD |

```19:20:server/db.js
const dbPath = process.env.DB_PATH || join(dataDir, 'essersales.db')
const db = new Database(dbPath)
```

### 1.3 서버 실행 파일

| 명령 | 진입점 | 포트 |
|------|--------|------|
| `npm run dev:server` | `server/index.js` (`--watch`) | 3001 |
| `npm run start` / `preview` | `server/index.js` (production) | 3001 |

프로덕션 시 `dist/` 정적 파일도 동일 프로세스에서 서빙.

### 1.4 테이블 목록 (실측)

읽기 전용 스크립트 `infra/scripts/inspect-sqlite-readonly.mjs` 결과:

| 테이블 | 행 수 (로컬 DB) | 역할 |
|--------|-----------------|------|
| `uploads` | 153 | 업로드 메타데이터 (파일명·종류·건수) |
| `sales_records` | 4,350 | 판매/집계 레코드 (본문은 JSON `data`) |
| `app_settings` | 9 | scope·kind별 수기입력·메모 JSON |

**SQLite에 없는 것:** KPI 집계 테이블, export 이력, 원본 파일 바이너리 테이블.

### 1.5 `uploads` 컬럼

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | TEXT PK | UUID 문자열 |
| `file_name` | TEXT | 원본 엑셀 파일명 |
| `platform` | TEXT | 쿠팡·네이버 등 (서버 보정 가능) |
| `upload_kind` | TEXT | `platform_daily`, `sales_daily_b`, `platform_monthly`, `sales_report` 등 |
| `business_date` | TEXT | 일별 기준일 또는 기간 문자열 |
| `detail_count` | INTEGER | 상세 건수 |
| `daily_count` | INTEGER | 일별 집계 건수 |
| `channel_count` | INTEGER | 채널 집계 건수 |
| `product_count` | INTEGER | 상품 집계 건수 |
| `product_option_count` | INTEGER | 옵션 집계 건수 |
| `total_count` | INTEGER | 전체 건수 합 |
| `created_at` | TEXT (ISO) | 생성 시각 |
| `sales_method` | TEXT | ALTER로 추가된 판매방식 대표값 |

### 1.6 `sales_records` 컬럼

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | TEXT PK | 레코드 ID |
| `upload_id` | TEXT FK → `uploads` | 소속 업로드 |
| `record_type` | TEXT | `detail`, `daily`, `channel`, `product`, `productOption` |
| `data` | TEXT | **전체 비즈니스 필드 JSON 문자열** |
| `created_at` | TEXT | 생성 |
| `updated_at` | TEXT | 수정 |

API 응답 시 `rowToRecord()`가 `data` JSON을 파싱해 평탄화 (`id`, `uploadId`, `recordType` + 모든 JSON 필드).

### 1.7 `app_settings` 컬럼

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `scope` | TEXT PK | 채널·통합 scope (`platform`, `company_b`, …) |
| `kind` | TEXT PK | 설정 종류 (`manual_ad`, `power_price`, …) |
| `data` | TEXT | JSON 문서 |
| `updated_at` | TEXT | 갱신 시각 |

### 1.8 로컬 DB 실측 통계

| 항목 | 값 |
|------|-----|
| `record_type` 분포 | `detail` 4,350건 (daily/channel/product 없음) |
| `upload_kind` 분포 | `platform_daily` 90, `sales_daily_b` 60, `platform_monthly` 3 |
| `app_settings` | 9행 (아래 §7 참고) |

---

## 2. 기존 API 구조

Base: `/api` (포트 **3001**, 레거시 Express)

| Method | Path | 역할 |
|--------|------|------|
| GET | `/api/health` | 헬스·SQLite 경로·기능 플래그 |
| GET | `/api/uploads` | 업로드 목록 (전체) |
| GET | `/api/records?recordType=` | 타입별 레코드 **전체** 조회 |
| POST | `/api/uploads/sales-report` | 통합 리포트 JSON 저장 |
| POST | `/api/uploads/platform-daily` | 일별 상세 JSON 저장 |
| POST | `/api/uploads/platform-monthly` | 월별 상세 JSON 저장 |
| POST | `/api/uploads/platform-period` | 기간 상세 JSON 저장 (레거시) |
| PATCH | `/api/records/:id` | `data` JSON 병합 수정 |
| DELETE | `/api/records/:id` | 단건 삭제 |
| DELETE | `/api/uploads/:id` | 업로드 + 연관 레코드 삭제 |
| GET | `/api/settings/:scope/:kind` | 설정 조회 |
| PUT | `/api/settings/:scope/:kind` | 설정 저장 |

**특징:**

- 업로드 API는 **파싱된 JSON**을 받음 (엑셀 바이너리 없음).
- `GET /api/records`는 `recordType`만 필터, **날짜·scope·페이징 없음**.
- 저장 시 서버가 `platform`, `salesMethod` 일부 보정 (`platformResolve.js`, `salesMethodDetect.js`).

---

## 3. 기존 Vue API 호출 위치

### 3.1 HTTP 클라이언트

| 파일 | Base URL |
|------|----------|
| `src/services/salesApi.js` | `VITE_API_BASE` 또는 `/api` → `:3001` |
| `src/services/appSettingsApi.js` | 동일 |

### 3.2 `salesApi.js` 호출 매핑

| 함수 | API | 호출 위치 |
|------|-----|-----------|
| `saveSalesReportUpload` | POST `/uploads/sales-report` | `useSalesData.onSalesReportFilesSelected` |
| `savePlatformDailyUpload` | POST `/uploads/platform-daily` | `PlatformDailyUpload.vue` |
| `savePlatformMonthlyUpload` | POST `/uploads/platform-monthly` | `PlatformMonthlyUpload.vue` |
| `savePlatformPeriodUpload` | POST `/uploads/platform-period` | `PlatformPeriodUpload.vue` |
| `fetchUploads` | GET `/uploads` | `useSalesData.loadUploads`, 업로드 컴포넌트 중복 체크 |
| `fetchSalesRecords` | GET `/records?recordType=` | `useSalesData` 캐시 로드 전반 |
| `updateSalesRecord` | PATCH `/records/:id` | `useSalesData` 편집 저장 |
| `deleteSalesRecord` | DELETE `/records/:id` | `useSalesData` |
| `deleteUploadAndRecords` | DELETE `/uploads/:id` | `useSalesData`, `UploadHistoryList` |

### 3.3 `appSettingsApi.js` 호출 매핑

| Composable | scope · kind | API |
|------------|--------------|-----|
| `useManualAdSpend` | 채널별 `manual_ad` | GET/PUT `/settings/:scope/manual_ad` |
| `usePowerPrice` | `power_price` / `power_price` | GET/PUT |
| `useCoupang1pRocket` | `coupang_1p_rocket` / `coupang_1p_rocket` | GET/PUT |
| `useOwnMallManual` | `company_b` / `own_mall_manual` | GET/PUT |
| `useStaffMemo` | `platform`, `company_b`, `power_price` / `staff_memo` | GET/PUT |
| `useSpecialSale` | `combined_daily`, `combined_monthly` / `special_sale` | GET/PUT |
| `useCombinedComments` | `combined_*` / `combined_comments` | GET/PUT |
| `useProfitLossTemplate` | (scope) / `profit_loss_template` | GET/PUT |
| `hydrateAppSettings` | 위 전체 일괄 hydrate | — |

### 3.4 API를 호출하지 않는 영역

| 영역 | 처리 위치 |
|------|-----------|
| 엑셀 파싱 | `src/utils/*Parser.js` (브라우저) |
| KPI 계산 | `platformKpiSplit.js`, `esserMetrics.js`, `useSalesData` computed |
| 통합 엑셀 다운로드 | `dashboardExporter.js` (브라우저 ExcelJS) |

---

## 4. 기존 데이터 흐름

```
[1] 엑셀 업로드
    UI: ExcelUpload.vue, PlatformDailyUpload.vue, PlatformMonthlyUpload.vue,
         SalesReportPage → useSalesData
    ↓ File 객체

[2] 엑셀 파싱 (브라우저)
    platformOrderParser.js, salesReportParser.js, coupangEsserParser.js,
    ownMallSalesParser.js, naverAdCenterParser.js
    ↓ details[] / parsed 객체

[3] 데이터 저장 (레거시 API → SQLite)
    salesApi.save* → POST /api/uploads/*
    server/index.js → INSERT uploads + sales_records (data JSON)
    수기입력: appSettingsApi → PUT /api/settings/* → app_settings
    ↓

[4] 데이터 로드
    useSalesData.refreshAll()
    → GET /api/records?recordType=detail|daily|... (전체)
    → hydrateAppSettings() → GET /api/settings/*
    → scope별 필터·merge (powerPrice, 1pRocket, ownMall detail 행 합성)
    ↓

[5] KPI 계산 (브라우저)
    recordFilters.js → esserMetrics / manualAdSpend / platformKpiSplit
    SalesPeriodDashboard.vue, SalesCharts.vue
    ↓

[6] 화면 표시
    SalesDataView.vue, VirtualScrollTableBody, 차트 컴포넌트
    ↓

[7] 통합 엑셀 다운로드 (브라우저)
    useSalesData.downloadDashboardExport()
    → dashboardExporter.js → profitLossReportExporter.js → Blob
```

### 4.1 단계별 파일 참조

| 단계 | 주요 파일 |
|------|-----------|
| 업로드 UI | `src/components/ExcelUpload.vue`, `Platform*Upload.vue`, `pages/PlatformUploadPage.vue` |
| 파싱 | `src/utils/platformOrderParser.js`, `salesReportParser.js`, `coupangEsserParser.js` |
| 저장 API | `src/services/salesApi.js` → `server/index.js` |
| 조회·캐시 | `src/composables/useSalesData.js` |
| 수기입력 | `*Panel.vue` → `use*.js` → `appSettingsApi.js` |
| KPI | `src/utils/platformKpiSplit.js`, `esserMetrics.js`, `manualAdSpend.js` |
| Export | `src/utils/dashboardExporter.js`, `profitLossReportExporter.js` |

---

## 5. SQLite 테이블 구조

### 5.1 ERD (개념)

```
uploads (1) ──< sales_records (N)
app_settings (scope, kind) — 독립 문서 저장
```

### 5.2 `sales_records.data` JSON 필드 (detail 실측 키)

로컬 DB `detail` 50건 샘플에서 수집된 키:

```
actualPayment, adConversionRate, adNetProfit, adNetProfitRate, adProfit,
adQty, adQtyRate, adRoas, adSales, adSalesRate, adSpend, adSpendRate,
brand, channel, channelFee, date, grossSales, importUnitCost,
isEsserSheetTotal, margin, marginRate, netProfit, option, optionId,
organicQty, organicQtyRate, platform, productCode, productId, productName,
quantity, salePrice, sales, salesMethod, salesQty, settlementPrice,
sheetTotalKind, shippingFee, sourceFileName, storeName, totalCost,
transactionType, unitCost, uploadFormat, uploadKind
```

**메타 필드 (JSON 내부):** `uploadId`, `sourceFileName`, `uploadKind`, `uploadFormat`, `createdAt`, `updatedAt`도 저장됨 (INSERT 시 spread).

### 5.3 `app_settings` 실측 (로컬)

| scope | kind | data 크기 | 내용 성격 |
|-------|------|-----------|-----------|
| `platform` | `manual_ad` | ~10KB | 네이버 광고 수동입력 |
| `platform` | `staff_memo` | ~153B | 담당 메모 |
| `company_b` | `manual_ad` | ~6KB | 외부 광고 |
| `company_b` | `own_mall_manual` | **~278KB** | 상품·판매 + **base64 원본 엑셀** |
| `company_b` | `staff_memo` | ~131B | 메모 |
| `power_price` | `power_price` | ~12KB | 파워프라이스 판매 행 |
| `power_price` | `manual_ad` | ~2KB | 광고 |
| `coupang_1p_rocket` | `coupang_1p_rocket` | ~6KB | 1P 로켓 발주 |
| `combined_daily` | `special_sale` | ~45B | 특판 |

---

## 6. PostgreSQL 테이블 매핑표

Phase 0 스키마: `infra/db/001_initial.sql` (수정 금지 — 제안만 §8)

### 6.1 `uploads`

| SQLite 컬럼 | SQLite 타입 | PG 컬럼 | PG 타입 | 변환 | 누락 | 비고 |
|-------------|-------------|---------|---------|------|------|------|
| `id` | TEXT | `id` | UUID | TEXT→UUID | — | 기존 UUID 문자열 유지 가능 |
| `file_name` | TEXT | `file_name` | TEXT | — | — | |
| — | — | `storage_path` | TEXT | — | **PG만** | Phase 3 서버 파싱 시 파일 저장 경로 |
| `platform` | TEXT | `platform` | TEXT | — | — | |
| `sales_method` | TEXT | `sales_method` | TEXT | — | — | |
| `upload_kind` | TEXT | `upload_kind` | TEXT | — | — | |
| `business_date` | TEXT | `business_date` | DATE | 파싱 | — | `2026-06-01` 또는 `2026-06-01~2026-06-30` 분리 필요 |
| — | — | `period_from` | DATE | — | **PG만** | monthly/period에서 `periodFrom` 추출 |
| — | — | `period_to` | DATE | — | **PG만** | |
| `detail_count` | INTEGER | `detail_count` | INTEGER | — | — | |
| `daily_count` | INTEGER | `daily_count` | INTEGER | — | — | |
| `channel_count` | INTEGER | `channel_count` | INTEGER | — | — | |
| `product_count` | INTEGER | `product_count` | INTEGER | — | — | |
| `product_option_count` | INTEGER | `product_option_count` | INTEGER | — | — | |
| `total_count` | INTEGER | — | — | — | **SQLite만** | §8에서 PG 추가 제안 |
| — | — | `parse_status` | TEXT | — | **PG만** | 이전 시 `ok` 고정 |
| — | — | `parse_error` | TEXT | — | **PG만** | |
| `created_at` | TEXT | `created_at` | TIMESTAMPTZ | ISO 파싱 | — | |

### 6.2 `upload_files` (SQLite에 없음)

| SQLite | PG | 비고 |
|--------|-----|------|
| 없음 | `upload_files` | 기존에는 업로드 원본 미보관 (자사몰만 `app_settings` base64) |
| `app_settings.own_mall_manual.salesSourceFiles[]` | `upload_files` + 볼륨 | Phase 1-2에서 base64→파일 추출 검토 |

### 6.3 `sales_records`

| SQLite 컬럼 | SQLite 타입 | PG 컬럼 | PG 타입 | 변환 | 누락 | 비고 |
|-------------|-------------|---------|---------|------|------|------|
| `id` | TEXT | `id` | UUID | TEXT→UUID | — | |
| `upload_id` | TEXT | `upload_id` | UUID FK | — | — | |
| `record_type` | TEXT | `record_type` | TEXT | — | — | |
| `data.date` | JSON | `order_date` | DATE | 파싱 | — | `date` 필드 기준 |
| `data.platform` | JSON | `platform` | TEXT | — | — | |
| `data.salesMethod` | JSON | `sales_method` | TEXT | — | — | |
| `data.channel` | JSON | `channel` | TEXT | — | — | |
| `data.brand` / `storeName` | JSON | `store_name` | TEXT | 병합 | — | Esser는 `brand` 우선 |
| `data.productName` | JSON | `product_name` | TEXT | — | — | |
| `data.sales` | JSON | `sales` | NUMERIC | 금액 파싱 | — | |
| `data.salesQty` | JSON | `sales_qty` | NUMERIC | — | — | |
| `data.netProfit` | JSON | `net_profit` | NUMERIC | — | — | `margin` 폴백 |
| `data.adSpend` | JSON | `ad_spend` | NUMERIC | — | — | |
| `data` (전체) | TEXT JSON | `data` | JSONB | TEXT→JSONB | — | 나머지 필드 보존 |
| `created_at` | TEXT | `created_at` | TIMESTAMPTZ | — | — | |
| `updated_at` | TEXT | `updated_at` | TIMESTAMPTZ | — | — | |

### 6.4 `app_settings`

| SQLite | PG | 변환 | 비고 |
|--------|-----|------|------|
| `scope` TEXT | `scope` TEXT | — | 동일 |
| `kind` TEXT | `kind` TEXT | — | 동일 |
| `data` TEXT JSON | `data` JSONB | parse | |
| `updated_at` TEXT | `updated_at` TIMESTAMPTZ | ISO | |

### 6.5 `export_jobs` / `schema_migrations`

| SQLite | PG | 비고 |
|--------|-----|------|
| 없음 | `export_jobs` | 신규 — Phase 4 export 서버 이전 시 사용 |
| 없음 | `schema_migrations` | PG 마이그레이션 이력 (Phase 0에서 version=1) |

---

## 7. 이전 대상 데이터 분류

### 1. 반드시 PostgreSQL로 이전해야 하는 데이터

| 데이터 | SQLite 위치 | 이유 |
|--------|-------------|------|
| 업로드 메타 153건 | `uploads` | 이력·필터·삭제의 기준 |
| 판매 레코드 4,350건 | `sales_records` | KPI·대시보드·export의 원천 |
| 수기입력 9건 | `app_settings` | 광고·파워프라이스·자사몰·1P·특판·메모 |
| 특히 `own_mall_manual` (~278KB) | `app_settings` | base64 원본 엑셀 포함 — **손실 시 재업로드 필요** |

### 2. PostgreSQL로 이전하지 않고 재생성 가능한 데이터

| 데이터 | 현재 위치 | 재생성 방법 |
|--------|-----------|-------------|
| 요약 탭 행 (daily/channel/product) | `sales_records` (타입별) 또는 detail에서 빌드 | `buildSummaryTabFromDetails` (브라우저) |
| KPI 집계 결과 | 없음 (메모리) | `platformKpiSplit` 재계산 |
| 전일대비 | 없음 | `dayOverDaySales.js` |
| Vue 캐시 | `useSalesData` ref | API 재조회 |

로컬 DB는 현재 **detail만** 존재 → daily/channel/product 타입 이전 부담 낮음.

### 3. 임시 데이터 (이전 불필요)

| 데이터 | 위치 |
|--------|------|
| UI 필터 상태 | Vue composable `ref` |
| 편집 모달 `editingRecord` | `useSalesData` |
| 차트 버킷 중간값 | 컴포넌트 computed |
| export Blob URL | 다운로드 직전 메모리 |

### 4. 수기 입력성 데이터 (`app_settings`)

| kind | scope (실측) | PG 이전 |
|------|--------------|---------|
| `manual_ad` | platform, company_b, power_price | 필수 |
| `power_price` | power_price | 필수 |
| `coupang_1p_rocket` | coupang_1p_rocket | 필수 |
| `own_mall_manual` | company_b | 필수 (대용량) |
| `staff_memo` | platform, company_b | 필수 |
| `special_sale` | combined_daily | 필수 |
| `combined_comments` | (DB에 없음, 로컬만 가능) | 있으면 이전 |
| `profit_loss_template` | (DB에 없음) | 있으면 이전 |

### 5. 업로드 원천 데이터

| 유형 | 현재 저장 | Phase 1-2 처리 |
|------|-----------|----------------|
| 플랫폼 빅셀 일별/월별 | `uploads.file_name`만 | 메타만 이전; **원본 xlsx 없음** |
| 통합 sales_report | 동일 | 동일 |
| 자사몰 판매 엑셀 | `own_mall_manual.salesSourceFiles[].dataBase64` | base64 → `upload_files` + 볼륨 **권장** |

### 6. KPI 산출 데이터

- DB에 **저장되지 않음**. 이전 대상 아님.
- Phase 2+에서 API가 계산해 반환.

### 7. 파일 기반으로만 관리되는 데이터

| 항목 | 위치 |
|------|------|
| 손익 양식 템플릿 | `app_settings` `profit_loss_template` (없을 수 있음) |
| 자사몰 base64 엑셀 | `app_settings` JSON 내부 |
| SQLite 파일 자체 | `server/data/essersales.db` — 이전 후 백업 보관 |

---

## 8. 누락 컬럼 및 스키마 보완 제안

> **`001_initial.sql`은 이번 단계에서 수정하지 않음.** Phase 1-2에서 `002_*.sql`로 반영 검토.

### 8.1 `uploads`

| 제안 컬럼 | 타입 | 이유 |
|-----------|------|------|
| `total_count` | INTEGER | SQLite `total_count` 보존 (sales_report 건수 합) |
| `legacy_id` | TEXT UNIQUE | 이전 추적·롤백용 (선택) |
| `migrated_at` | TIMESTAMPTZ | 이전 배치 메타 (선택) |

`business_date`가 `2026-06-01~2026-06-30` 형태일 때 → `period_from` / `period_to` / `business_date` 분리 파서 필요.

### 8.2 `sales_records`

| 제안 컬럼 | 타입 | 이유 |
|-----------|------|------|
| `product_code` | TEXT | JSON `productCode` — 상품 필터 |
| `option_name` | TEXT | JSON `option` |
| `transaction_type` | TEXT | JSON `transactionType` — 반품 분리 |
| `upload_kind` | TEXT | JSON `uploadKind` — scope 필터 (인덱스) |
| `upload_format` | TEXT | JSON `uploadFormat` — Esser/자사몰 구분 |
| `source_file_name` | TEXT | JSON `sourceFileName` |
| `is_sheet_total` | BOOLEAN | `isEsserSheetTotal` — KPI 제외 행 |
| `delivery_method` | TEXT | 판매방식 보정용 |

정규 컬럼은 **JSONB `data`와 중복** 허용 (조회 성능 vs 단일 소스). Phase 1-2는 최소 세트(`order_date`, `platform`, `sales`, …) backfill 후 점진 확장.

### 8.3 `app_settings`

현 스키마로 **충분**. `own_mall_manual` 대용량은 JSONB 압축·base64 외부화만 검토.

### 8.4 `upload_files`

| 제안 | 이유 |
|------|------|
| `source_kind` TEXT | `platform_upload` vs `own_mall_sales` |
| `original_file_name` TEXT | `file_name`과 구분 |

자사몰 base64 이전 시 `upload_id` nullable 또는 별도 `settings_file_id` FK 검토.

### 8.5 인덱스 추가 제안 (Phase 1-2)

- `sales_records (upload_kind, order_date)` — scope 필터
- `sales_records (upload_format)` — Esser 행 필터
- `uploads (sales_method)` — 대시보드 필터

---

## 9. 기존 API와 신규 API 비교

| 기존 API | 현재 역할 | Vue 호출 위치 | 신규 API 후보 | 이전 우선순위 | 비고 |
|----------|-----------|---------------|---------------|---------------|------|
| GET `/api/health` | 레거시 헬스 | (직접 호출 없음) | GET `/api/v1/health` | 낮음 | 이미 Phase 0 존재 |
| GET `/api/uploads` | 업로드 목록 | `useSalesData`, 업로드 UI | GET `/api/v1/uploads` | **P1** | scope 필터 추가 |
| GET `/api/records` | 타입별 전체 조회 | `useSalesData` | GET `/api/v1/records` | **P1** | dateFrom/To, paging |
| POST `/api/uploads/platform-daily` | JSON 저장 | `PlatformDailyUpload` | POST `/api/v1/uploads/platform-daily` (multipart) | P3 | Phase 1은 JSON 이전만 |
| POST `/api/uploads/platform-monthly` | JSON 저장 | `PlatformMonthlyUpload` | 동일 | P3 | |
| POST `/api/uploads/platform-period` | JSON 저장 | `PlatformPeriodUpload` | 동일 | P4 | deprecated |
| POST `/api/uploads/sales-report` | JSON 저장 | `useSalesData` | POST `/api/v1/uploads/sales-report` | P3 | |
| PATCH `/api/records/:id` | 행 수정 | `useSalesData` | PATCH `/api/v1/records/:id` | P2 | |
| DELETE `/api/records/:id` | 행 삭제 | `useSalesData` | DELETE `/api/v1/records/:id` | P2 | |
| DELETE `/api/uploads/:id` | 업로드 삭제 | `useSalesData` | DELETE `/api/v1/uploads/:id` | P2 | |
| GET `/api/settings/:s/:k` | 설정 조회 | `appSettingsApi`, composables | GET `/api/v1/settings/:s/:k` | **P1** | 1:1 호환 가능 |
| PUT `/api/settings/:s/:k` | 설정 저장 | composables | PUT `/api/v1/settings/:s/:k` | **P1** | |
| — | KPI 집계 | 브라우저 | GET `/api/v1/kpi/summary` 등 | P2 | DB 이전 후 |
| — | 엑셀 export | 브라우저 | POST `/api/v1/exports/dashboard` | P4 | |

**Phase 1-2 범위:** 데이터 **이전 스크립트 + 검증**만. Vue는 계속 `:3001` 레거시 API 사용.

---

## 10. Phase 1-2 구현 계획

### 10.1 목표

SQLite `essersales.db` → PostgreSQL `essersales` **일회성 이전** + 정합성 검증.  
Vue·레거시 서버 **무변경**. 신규 `backend/`는 읽기 검증 API만 추가 가능 (선택).

### 10.2 작업 목록

| # | 작업 | 산출물 |
|---|------|--------|
| 1 | 스키마 보완 설계 확정 | `002_migration_columns.sql` 초안 (Phase 1-2) |
| 2 | 이전 스크립트 | `infra/scripts/migrate-sqlite-to-pg.mjs` |
| 3 | 행 변환 로직 | `uploads`/`sales_records` backfill (date, numeric, UUID) |
| 4 | `business_date` / period 파싱 | `2026-06-01~2026-06-30` → `period_from/to` |
| 5 | `app_settings` 이전 | JSON TEXT → JSONB |
| 6 | `own_mall_manual` base64 처리 | 옵션: `uploads`+볼륨 또는 JSONB 유지 |
| 7 | 정합성 검증 | `infra/scripts/verify-pg-migration.mjs` |
| 8 | 검증 항목 | uploads 건수, sales_records 건수, sales 합계, settings 9건, 샘플 행 diff |
| 9 | 문서 | `docs/phase-1-migration-runbook.md` |
| 10 | 롤백 | PG `docker compose down -v` + SQLite 백업 복사 |

### 10.3 이전 순서 (권장)

```
1. SQLite 파일 백업 (essersales.db 복사)
2. PostgreSQL 스키마 002 적용 (필요 시)
3. uploads INSERT
4. sales_records INSERT (배치, backfill 컬럼)
5. app_settings INSERT
6. (선택) own_mall base64 → upload_files
7. verify 스크립트 실행
8. phase-1-migration-report.md 작성
```

### 10.4 이전하지 않는 것 (Phase 1-2)

- Vue `salesApi` / `appSettingsApi` URL 변경
- 레거시 `server/index.js` PostgreSQL 연결
- KPI / export 백엔드 이전
- 원본 플랫폼 xlsx 복구 (DB에 없음)

### 10.5 분석용 스크립트 (추가됨)

| 스크립트 | 용도 |
|----------|------|
| `infra/scripts/inspect-sqlite-readonly.mjs` | SQLite 스키마·통계·JSON 키 (읽기 전용) |

---

## 11. 리스크 및 주의사항

| 리스크 | 설명 | 완화 |
|--------|------|------|
| **UUID 타입** | SQLite TEXT UUID → PG UUID 호환 | `::uuid` 캐스트, 실패 시 `gen_random_uuid()` + legacy_id |
| **날짜 형식** | `date` 필드 다양 (`YYYY-MM-DD`, 엑셀 직렬) | `dateParse.js` 로직 재사용 (이전 스크립트) |
| **금액 문자열** | `sales`에 콤마·원화 기호 | `parseAmount.js` 재사용 |
| **JSON 중복** | 정규 컬럼 vs JSONB 불일치 | 이전 후 샘플 diff, KPI golden test |
| **대용량 settings** | `own_mall_manual` 278KB | 배치 INSERT, 타임아웃 설정 |
| **이중 쓰기** | Phase 1-2는 **읽기 전용 이전** | 레거시 SQLite 계속 쓰기, PG는 복제본 |
| **total_count 누락** | PG에 없음 | 002 마이그레이션 또는 이전 시 무시+재계산 |
| **원본 엑셀 없음** | 플랫폼 153건 파일명만 | 재파싱 불가 — detail JSON이 유일 원천 |
| **detail만 존재** | daily/channel/product 0건 | 코드는 5타입 지원 — sales_report 업로드 시에만 생성 |

---

## 부록 A. 읽기 전용 분석 명령

```powershell
node infra/scripts/inspect-sqlite-readonly.mjs
```

---

## 부록 B. Phase 1-1 완료 체크

- [x] SQLite 구조·API·Vue 호출 분석
- [x] 데이터 흐름 7단계 정리
- [x] 이전 대상 분류
- [x] PG 매핑표
- [x] 누락 컬럼 제안 (SQL 미수정)
- [x] API 비교표
- [x] Phase 1-2 계획
- [ ] Phase 1-2 실제 이전 실행 (다음 단계)

---

*Phase 1-1은 분석·설계만 수행했습니다. `001_initial.sql` 및 애플리케이션 코드는 변경하지 않았습니다.*
