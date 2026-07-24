# essersales 현재 구조 분석

> 작성 목적: Vue 프론트엔드 중심 아키텍처를 파악하고, 백엔드 분리 후보를 식별하기 위한 문서  
> 코드 수정 없이 구조만 정리 (2026-06 기준)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 스택 | Vue 3 + Vite (클라이언트) · Express + better-sqlite3 (서버) |
| 데이터 저장 | `server/data/essersales.db` (SQLite) |
| Excel 라이브러리 | `xlsx` (경량 읽기/병합) · `exceljs` (서식 있는 다운로드) |
| 실행 | 개발: `npm run dev` (API `:3001` + Vite `:5173`) · 운영: `npm run preview` (빌드 + 단일 포트) |

**핵심 특징:** Excel **업로드·파싱·KPI·다운로드**가 거의 전부 **브라우저**에서 실행된다. 서버는 파싱된 JSON과 설정만 저장·조회한다.

---

## 2. 디렉터리 구조

```
essersales/
├── src/                    # Vue SPA
│   ├── App.vue             # 메인 탭 (업로드 / 대시보드 / 통합매출)
│   ├── components/         # UI (업로드, 대시보드, 수동입력 패널)
│   ├── components/pages/   # 페이지 단위 조립
│   ├── composables/        # useSalesData, 설정 hydrate, 수동입력 스토어
│   ├── services/           # REST 클라이언트 (salesApi, appSettingsApi)
│   ├── utils/              # 파서, KPI, Excel export, 필터
│   └── config/             # 채널·플랫폼·광고·손익 양식 등 도메인 설정
├── server/                 # Express API
│   ├── index.js            # 라우트, 정적 파일 서빙
│   ├── db.js               # SQLite 스키마·마이그레이션
│   ├── settings.js         # app_settings CRUD
│   ├── platformResolve.js  # 플랫폼·판매방식 해석
│   └── recordFields.js     # 레코드 필드 정규화
├── scripts/                # DB 점검·파서 테스트 (운영 도구)
├── dist/                   # vite build 산출물
└── docs/                   # 구조·설계 문서 (본 파일)
```

---

## 3. 데이터 흐름 (전체)

```
[사용자 Excel 파일]
        │
        ▼  (브라우저에서만 파싱)
┌───────────────────────────────────────┐
│  src/utils/*Parser.js                 │
│  excelReader.js · platformDetect.js   │
└───────────────────┬───────────────────┘
                    │ JSON (details / parsed)
                    ▼
┌───────────────────────────────────────┐
│  src/services/salesApi.js             │
│  POST /api/uploads/*                  │
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│  SQLite                               │
│  uploads · sales_records · app_settings│
└───────────────────┬───────────────────┘
                    │ GET /api/records, /api/settings
                    ▼
┌───────────────────────────────────────┐
│  useSalesData.js (+ 설정 composables) │
│  전체 detail 캐시 · scope별 merge     │
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│  KPI utils (esserMetrics, platformKpi │
│  Split, manualAdSpend, …)             │
└───────────────────┬───────────────────┘
                    ▼
┌──────────────┐    ┌────────────────────────────┐
│ 대시보드 UI   │    │ dashboardExporter.js        │
│ SalesCharts  │    │ → profitLossReportExporter  │
│ SalesDataView│    │ → excelWorkbookStyle (Blob) │
└──────────────┘    └────────────────────────────┘
```

---

## 4. Excel 업로드

### 4.1 원칙

- **서버는 Excel 바이너리를 받지 않음** (일반 플랫폼/통합 리포트 경로).
- 브라우저에서 파싱 → `details[]` 또는 `parsed` 객체를 JSON으로 POST.
- 예외: 자사몰 판매 엑셀은 `own_mall_manual` 설정에 **base64 원본**도 함께 보관 (재적용용).

### 4.2 UI → 파서 → API 경로

| 업로드 종류 | UI 컴포넌트 | 파서 | API |
|-------------|-------------|------|-----|
| 플랫폼 일별 | `PlatformDailyUpload.vue` | `platformOrderParser.readPlatformDailyFile` | `POST /api/uploads/platform-daily` |
| 플랫폼 월별 | `PlatformMonthlyUpload.vue` | `platformOrderParser.readPlatformMonthlyFile` | `POST /api/uploads/platform-monthly` |
| 플랫폼 기간(레거시) | `PlatformPeriodUpload.vue` | `readPlatformPeriodFile` | `POST /api/uploads/platform-period` |
| 통합 매출 리포트 | `SalesReportPage.vue` → `useSalesData` | `salesReportParser.readSalesReportFile` | `POST /api/uploads/sales-report` |
| 자사몰 카탈로그/판매 | `OwnMallManualPanel.vue` | `ownMallCatalogParser` · `ownMallSalesParser` | `PUT /api/settings/.../own_mall_manual` |
| 네이버 광고센터 | `ManualAdSpendPanel.vue` | `naverAdCenterParser` | `PUT /api/settings/.../manual_ad` |

공통 파일 선택 UI: `ExcelUpload.vue` (드래그앤드롭, `.xlsx` / `.xls` / `.csv`).

페이지 조립: `PlatformUploadPage.vue` (채널 탭·업로드 모드·이력), `UploadHistoryList.vue` (선택·삭제).

### 4.3 서버 저장 (`server/index.js`)

1. `uploads` 테이블에 메타데이터 INSERT (`upload_kind`, `platform`, `file_name`, 건수 등).
2. `sales_records`에 `record_type`별 행 INSERT (`detail` / `daily` / `channel` / `product` / `productOption`).
3. 각 행의 `data` 컬럼은 **JSON 문자열**.
4. 플랫폼·판매방식은 `platformResolve.js` + `salesMethodDetect.js`로 서버에서 일부 보정.

### 4.4 업로드 후 갱신

`useSalesData.onDataChannelUploaded` → `loadUploads()` + `refreshAll()` → `GET /api/records?recordType=detail` 등 **전체 재로드**.

---

## 5. Excel 파싱

### 5.1 공통 인프라 (`src/utils/`)

| 파일 | 역할 |
|------|------|
| `lazyXlsx.js` | `xlsx` 동적 import |
| `lazyExceljs.js` | `exceljs` 동적 import (export 쪽) |
| `excelReader.js` | 시트 AOA 읽기, 빅셀 헤더 스캔, 배송구분 forward-fill |
| `dateParse.js` | 날짜·파일명 기간 파싱 |
| `parseAmount.js` | 금액 파싱 |
| `platformDetect.js` | 파일명·헤더로 빅셀/표준 주문 형식 감지 |
| `channelMappings.js` (`config/`) | 표준 주문 열 자동 매핑 |
| `dataTransformer.js` | 매핑 기반 행 변환 |

### 5.2 형식별 파서

| 파일 | 지원 형식 |
|------|-----------|
| `coupangEsserParser.js` | **빅셀 매출분석** (쿠팡 에쎄르) — 일별/월별/기간 |
| `platformOrderParser.js` | 일별·월별·기간 오케스트레이션 (빅셀 vs 표준 `order`) |
| `salesReportParser.js` | **통합 매출 리포트** — 상세+일별+판매처+상품+옵션 다중 섹션 |
| `ownMallSalesParser.js` | 아임웹 `기본_양식` 판매내역 |
| `ownMallCatalogParser.js` | 자사몰 상품 카탈로그 |
| `ownMallSalesImport.js` | 자사몰 판매 엑셀 import·소스 파일 보관 |
| `naverAdCenterParser.js` | 네이버 광고센터 소진 엑셀 |
| `profitLossTemplateParser.js` | 손익 양식 템플릿 `{{placeholder}}` (export 보조) |

**모든 파서는 `src/utils/`에만 존재** — 서버에 파서 코드 없음.

---

## 6. KPI 계산

### 6.1 원칙

- API에 KPI 엔드포인트 **없음**.
- `GET /api/records`로 **전체(또는 타입별) 레코드**를 받아 브라우저에서 집계.
- 수동입력(광고·파워프라이스·1P 로켓·자사몰·특판)은 `app_settings`에서 hydrate 후 **메모리에서 detail 행으로 merge**.

### 6.2 핵심 계산 모듈

| 파일 | 역할 |
|------|------|
| `esserMetrics.js` | Esser 행 값 해석, `summarizeEsserKpis`, 일/주/월 버킷 |
| `platformKpiSplit.js` | 플랫폼·브랜드·통합 세그먼트 KPI 표 (`buildCombinedKpiSplitRows` 등) |
| `manualAdSpend.js` | 수동 광고 합산, `summarizeEsserKpisWithManual`, 일별 집계 |
| `combinedKpiSegments.js` | 통합 탭 세그먼트 정의 (베스트하임 판매자/로켓/스스 등) |
| `specialSaleKpi.js` | 특판 행 KPI |
| `dayOverDaySales.js` | 전일/전주 대비 매출 |
| `recordFilters.js` | 날짜·플랫폼·판매방식 필터 |
| `salesAggregation.js` | 레거시 통합 집계, 요약 탭 생성 |
| `powerPriceRecords.js` · `coupang1pRocketRecords.js` · `ownMallRecords.js` | 수동입력 → detail 행 변환 |

### 6.3 오케스트레이션 (`useSalesData.js`)

- 앱 로드 시 `detail` / `daily` / `channel` / `product` 캐시 일괄 fetch.
- scope별 `scopedDetailRecords` computed:
  - SQLite detail + `powerPriceDetailRecords` + `coupang1pRocketDetailRecords` + `ownMallManualDetailRecords` merge.
  - `applyDataCorrections`, `applyRecordFilters` 적용.
- 대시보드 KPI: `SalesPeriodDashboard.vue` → `buildPlatformKpiSplitRows` / `summarizeEsserKpisWithManual`.
- 차트: `SalesCharts.vue` → 필터된 detail → 일/주/월 버킷.

### 6.4 설정(수동입력)과 KPI의 관계

| Composable | kind | KPI 반영 방식 |
|------------|------|----------------|
| `useManualAdSpend` | `manual_ad` | 광고비·광고매출 합산 |
| `usePowerPrice` | `power_price` | 파워프라이스 detail 행 |
| `useCoupang1pRocket` | `coupang_1p_rocket` | 베스트하임 쿠팡 KPI 합산 |
| `useOwnMallManual` | `own_mall_manual` | 사본느리 자사몰 detail 행 |
| `useSpecialSale` | `special_sale` | 통합 특판 행 |
| `useStaffMemo` | `staff_memo` | 엑셀 export만 (KPI 수치 미반영) |
| `useCombinedComments` | `combined_comments` | 엑셀 ①요약리포트 하단 |

---

## 7. 통합 Excel 다운로드

### 7.1 UI 진입점

```
SalesDataView.vue  [「매출 리포트 엑셀」 버튼]
  → useSalesData.downloadDashboardExport()   (동적 import)
  → dashboardExporter.downloadDashboardExcel({ ... })
  → Blob 다운로드 (브라우저)
```

관련 composable: `src/composables/useSalesData.js` (약 850~907행 부근).

전달 인자: 필터된 `records`, `platformSplitRecords`, `dayOverDayRecords`, `manualAdByChannel`, `specialSale`, `combinedComments`, `staffMemo` 등.

### 7.2 Export 모듈 계층

| 파일 | 역할 |
|------|------|
| **`dashboardExporter.js`** | 메인 오케스트레이터 — 다중 시트 워크북, `downloadDashboardExcel` |
| **`profitLossReportExporter.js`** | 통합 ①요약리포트 `buildIntegratedProfitLossSummaryRows`, 판매방식·스토어·일별 블록 |
| **`integratedKpiExcel.js`** | 통합 세그먼트 KPI 표 (웹과 동일 로직) |
| **`excelWorkbookStyle.js`** | ExcelJS 서식·병합·색상·`downloadExcelWorkbook` (Blob) |
| `manualAdExcel.js` | 외부 광고 표 블록 |
| `staffMemoExcel.js` | 담당자 메모 블록 |
| `combinedCommentsExcel.js` | 통합 담당 코멘트 블록 |
| `salesReportExporter.js` | 선택 업로드 병합 단순 xlsx (`xlsx` 라이브러리) |
| `excelExporter.js` | 레거시 단순 export |

### 7.3 통합(`isCombined`) 시트 구성 (요약)

1. (선택) 손익계산 템플릿 시트 — `buildProfitLossReportSheets`
2. **①요약리포트** — `buildIntegratedProfitLossSummaryRows` (양식 v31)
   - 외부 광고 · KPI 세그먼트 · 손익·전일대비 · 판매방식 · 스토어 · 일별 요약 · 통합 코멘트
3. KPI 분리 · 일별/주별/월별 · 상세 · 반품 · 스토어 · 판매방식 · 전일대비 등 추가 시트

KPI·전일대비·원가는 export 시점에 **다시 브라우저에서 계산** (`summarizeCombinedKpis`, `computeCombinedBrandDayOverDaySales` 등).

### 7.4 기타 다운로드

| 함수 | 용도 |
|------|------|
| `downloadCurrentTableExport` | 현재 탭 표만 단순 export |
| `downloadMergedExcel` | 선택 업로드 2개+ 병합 (`salesReportExporter`) |

---

## 8. 서버 API 요약

| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET | `/api/health` | 헬스체크 |
| GET | `/api/uploads` | 업로드 메타 목록 |
| GET | `/api/records?recordType=` | 레코드 전체 조회 |
| POST | `/api/uploads/sales-report` | 통합 리포트 저장 |
| POST | `/api/uploads/platform-daily` | 일별 상세 저장 |
| POST | `/api/uploads/platform-monthly` | 월별 상세 저장 |
| POST | `/api/uploads/platform-period` | 기간 상세 저장 |
| PATCH | `/api/records/:id` | 레코드 수정 |
| DELETE | `/api/records/:id` | 레코드 삭제 |
| DELETE | `/api/uploads/:id` | 업로드+연관 레코드 삭제 |
| GET/PUT | `/api/settings/:scope/:kind` | 수동입력·메모 등 |

DB 테이블: `uploads`, `sales_records`, `app_settings`.

---

## 9. 채널·스코프 구조 (`config/dataChannels.js`)

| 채널 | scope 예시 | 데이터 소스 |
|------|------------|-------------|
| 베스트하임 | `platform` / `platform_monthly` | 빅셀 업로드 + 1P 로켓 수동 + 외부 광고 |
| 사본느리 | `sales_daily_b` / `sales_monthly_b` | 빅셀 업로드 + 자사몰 수동 + 외부 광고 |
| 파워프라이스 | `power_price` | 수동입력만 |
| 쿠팡 1P 로켓 | `coupang_1p_rocket` | 발주 수동입력만 |
| 통합 | `combined_daily` / `combined_monthly` | 위 소스 자동 merge |

---

## 10. 백엔드 분리 제안

### 10.1 분리 우선순위가 높은 기능 (백엔드로 이전 권장)

| 기능 | 현재 위치 | 이전 이유 |
|------|-----------|-----------|
| **전체 레코드 로드 + KPI 집계** | `useSalesData` + `esserMetrics` + `platformKpiSplit` | 데이터 증가 시 브라우저 메모리·재계산 부담 (버벅임 주원인) |
| **통합 Excel 다운로드** | `dashboardExporter` + `profitLossReportExporter` + `excelWorkbookStyle` | ExcelJS ~940KB, 대량 행 처리 시 UI 프리즈 |
| **필터·기간별 레코드 조회** | `GET /api/records` 전체 + 클라이언트 필터 | SQL `WHERE dateFrom/dateTo`로 페이징 가능 |
| **전일/전주 대비 계산** | `dayOverDaySales.js` (브라우저) | 기간 밖 전일 데이터 lookup에 전체 로드 필요 |
| **(선택) Excel 업로드 파싱** | `*Parser.js` (브라우저) | 대용량 파일·NAS 서버 일원화 시 서버 파싱이 안정적 |

**권장 API 예시 (신규):**

```
GET  /api/kpi/summary?scope=combined_daily&dateFrom=&dateTo=
GET  /api/kpi/platform-split?scope=...
POST /api/export/integrated-excel   → 파일 스트림 반환
GET  /api/records?dateFrom=&dateTo=&limit=&offset=  (페이징)
POST /api/uploads/platform-daily/raw  (선택: 서버 파싱)
```

### 10.2 프론트엔드에 유지해도 되는 기능

| 기능 | 이유 |
|------|------|
| **UI·필터·탭·차트 표시** | Vue + Chart.js는 표시에 적합 |
| **수동입력 패널** (광고·발주·판매·특판·코멘트) | 폼 편집·즉시 피드백; 저장만 API로 충분 |
| **업로드 UI·진행 표시** | 파일 선택·드래그앤드롭은 클라이언트 UX |
| **가벼운 표 export** | `downloadCurrentTableExport` (현재 화면 소량) |
| **설정 hydrate** | `app_settings` CRUD는 이미 서버 분리됨 |
| **YmdDateFields 등 입력 컴포넌트** | 순수 UI |

### 10.3 단계적 마이그레이션 로드맵 (제안)

```
Phase 1 — API만 추가 (Vue 유지)
  · GET /api/kpi/summary, /api/kpi/platform-split
  · GET /api/records with date filter + pagination
  · useSalesData에서 computed 대신 API 호출 (캐시)

Phase 2 — 무거운 export 서버 이전
  · POST /api/export/dashboard → Node/Python에서 ExcelJS/openpyxl
  · Vue는 버튼 → 다운로드 URL/Blob만 처리

Phase 3 — (선택) 파싱 서버 이전
  · multipart 업로드 → 서버 파싱 → DB insert
  · 기존 클라이언트 파서는 폴백 또는 제거

Phase 4 — Python 백엔드 (장기)
  · KPI·export 로직을 Python으로 포팅 (pandas/openpyxl)
  · Vue는 얇은 SPA 또는 Streamlit 병행
```

### 10.4 백엔드 기술 선택 참고

| 옵션 | 장점 | 단점 |
|------|------|------|
| **Node (Express 확장)** | `platformKpiSplit` 등 JS 로직 재사용 가능 | 현재와 동일 언어, 무거운 작업은 여전히 단일 스레드 |
| **Python (FastAPI)** | pandas·openpyxl·NAS 배치에 유리 | KPI 로직 전면 포팅 필요 |
| **하이브리드** | KPI/export만 Python, CRUD는 Node 유지 | 운영 복잡도 증가 |

---

## 11. 성능 병목 요약 (현재)

1. **`GET /api/records?recordType=detail` 전체 로드** — 레코드 수에 비례해 JSON·메모리 증가.
2. **`useSalesData` 다중 computed** — 필터 변경마다 merge·집계·KPI 재계산.
3. **`downloadDashboardExcel`** — export 시 동일 데이터로 KPI·손익·다중 시트 재조립 + ExcelJS 렌더링.
4. **클라이언트 파싱** — 대용량 빅셀 업로드 시 업로드 직후 UI 정지 가능.

---

## 12. 주요 파일 빠른 참조

| 관심사 | 파일 |
|--------|------|
| 업로드 API | `server/index.js` |
| DB 스키마 | `server/db.js` |
| 레코드 fetch | `src/services/salesApi.js` |
| 데이터 허브 | `src/composables/useSalesData.js` |
| 빅셀 파싱 | `src/utils/coupangEsserParser.js`, `platformOrderParser.js` |
| 통합 리포트 파싱 | `src/utils/salesReportParser.js` |
| KPI 핵심 | `src/utils/platformKpiSplit.js`, `esserMetrics.js` |
| 통합 ①요약리포트 | `src/utils/profitLossReportExporter.js` |
| 엑셀 다운로드 진입 | `src/utils/dashboardExporter.js` |
| 엑셀 서식 | `src/utils/excelWorkbookStyle.js` |
| 대시보드 UI | `src/components/SalesDataView.vue`, `SalesPeriodDashboard.vue` |
| 업로드 UI | `src/components/pages/PlatformUploadPage.vue` |

---

## 13. 미연결·레거시 참고

- `ProfitLossTemplatePanel.vue` — 컴포넌트 존재, App 라우트 미연결 (export 시 snapshot만 사용).
- `ColumnMapping.vue`, `DataPreview.vue` — 현재 import 없음.
- `PlatformPeriodUpload` — deprecated 기간 업로드.
- `salesReportExporter` / `excelExporter` — 단순 xlsx 경로 (ExcelJS 아님).

---

*이 문서는 코드 변경 없이 구조 분석만 수행한 결과입니다. 백엔드 분리 작업 시 본 문서의 Phase 1부터 순차 적용을 권장합니다.*
