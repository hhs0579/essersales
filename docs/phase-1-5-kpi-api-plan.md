# Phase 1-5 KPI 확장 API 설계

## 문서 목적

Phase 2에서 Vue 클라이언트 KPI 계산을 PostgreSQL 백엔드 API로 이전하기 위한 **API 설계안**입니다.

- 이번 단계에서는 **구현하지 않음** (설계만)
- 기존 `esserMetrics`, `platformKpiSplit`, `manualAdSpend` 등 클라이언트 로직 위치 정리 포함
- PG 모드 production 기본값 전환은 Phase 2 이후

---

## Part A — KPI 확장 API 설계

### 공통 사항

**Base path:** `/api/v1/kpi`

**공통 쿼리 필터 (대부분 API 공유):**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `from` | date (YYYY-MM-DD) | 기간 시작 |
| `to` | date | 기간 종료 |
| `platform` | string | 쿠팡, 스마트스토어, 자사몰 등 |
| `sales_method` | string | 판매방식 |
| `store_name` | string | 스토어/브랜드 |
| `upload_kind` | string | 업로드 종류 |
| `upload_id` | uuid (복수 가능) | 선택 업로드만 |
| `scope` | string | `platform`, `company_b`, `combined_daily` 등 (채널 필터) |
| `record_type` | string | 기본 `detail` |

**공통 응답 패턴:**

```json
{
  "filters": { "from": "2026-01-01", "to": "2026-06-30", "platform": null },
  "rows": [ ... ],
  "totals": { "sales": 0, "salesQty": 0, "netProfit": 0, ... }
}
```

**DB 컬럼 (이미 마이그레이션됨):** `sales`, `sales_qty`, `net_profit`, `ad_spend`, `platform`, `sales_method`, `store_name`, `order_date`, `business_date`, `upload_kind`, `transaction_type`, JSONB `data` (광고·원가·마진율 등)

**성능 공통:**

- `sales_records`에 복합 인덱스: `(record_type, order_date)`, `(platform, order_date)`, `(upload_id)`
- 집계는 SQL `SUM/COUNT/GROUP BY` — JSONB 파싱 최소화
- 반품·엑셀 총합 행: `transaction_type`, `data` 플래그로 SQL 또는 후처리
- 수기 광고·파워프라이스·1P·자사몰: Phase 2-2에서 `app_settings` 조인 또는 별도 API

---

### 1. `GET /api/v1/kpi/summary` ✅ (구현됨)

| 항목 | 내용 |
|------|------|
| **목적** | 필터 조건下的 총 매출·수량·건수·업로드 수 |
| **사용 화면** | 대시보드 상단 KPI 카드 (매출·판매수량), PG 모드 검증 |
| **지원 필터** | `from`, `to`, `platform`, `sales_method`, `store_name`, `upload_kind` |
| **응답 예시** | `{ "salesTotal": 291737783, "quantityTotal": 8304, "recordCount": 4350, "uploadCount": 153, "filters": {...} }` |
| **클라이언트 로직** | `esserMetrics.summarizeEsserKpis`, `manualAdSpend.summarizeEsserKpisWithManual` |
| **필요 컬럼** | `sales`, `sales_qty`, `upload_id`, 날짜·필터 컬럼 |
| **성능** | 단일 aggregate 쿼리 — ms 단위. **확장:** `netProfit`, `adSpend`, `totalCost` 추가 |

---

### 2. `GET /api/v1/kpi/by-platform`

| 항목 | 내용 |
|------|------|
| **목적** | 쿠팡 / 스마트스토어 / 자사몰 / 외부광고 / 종합 KPI 행 |
| **사용 화면** | `SalesPeriodDashboard` 플랫폼 분리 표 (`showPlatformBreakdown`) |
| **지원 필터** | 공통 + `include_manual_ad=true` (settings 조인) |
| **응답 예시** | `{ "rows": [{ "label": "쿠팡", "sales": 1, "salesQty": 2, "netProfit": 3, "adSpend": 4, "roas": 5, ... }, { "label": "종합", ... }] }` |
| **클라이언트 로직** | `platformKpiSplit.buildPlatformKpiSplitRows`, `summarizeBrandKpis` |
| **필요 컬럼** | `platform`, `sales_method`, `sales`, `sales_qty`, `net_profit`, `ad_spend`, JSONB 광고 필드 |
| **성능** | `GROUP BY platform` + 수기 광고는 settings 1회 로드 후 merge. 캐시 TTL 60s 권장 |

**주의:** 스마트스토어 원가 역산(`deriveEsserProfitKpis`), 엑셀 총합 행 광고만 반영(`isEsserSheetTotalRecord`) 로직 포팅 필요.

---

### 3. `GET /api/v1/kpi/by-sales-method`

| 항목 | 내용 |
|------|------|
| **목적** | 판매방식별 KPI (로켓·판매자·N배송 등) |
| **사용 화면** | 대시보드 집계 표, 엑셀 ⑦스토어·판매방식 시트 |
| **지원 필터** | 공통 + `platform` (플랫폼 내 판매방식) |
| **응답 예시** | `{ "rows": [{ "label": "로켓", "sales": 0, "salesQty": 0, ... }] }` |
| **클라이언트 로직** | `esserMetrics.aggregateEsserBySalesMethod`, `manualAdSpend.aggregateEsserBySalesMethodWithManual` |
| **필요 컬럼** | `sales_method`, `platform`, metrics 컬럼 |
| **성능** | `GROUP BY sales_method, platform`. 스마트스토어 원가 역산은 서버 공통 함수화 |

---

### 4. `GET /api/v1/kpi/by-store`

| 항목 | 내용 |
|------|------|
| **목적** | 스토어(브랜드)별 KPI |
| **사용 화면** | 상품·스토어 순위, 통합 브랜드 KPI (`베스트하임`/`사본느리`) |
| **지원 필터** | 공통 |
| **응답 예시** | `{ "rows": [{ "storeName": "주식회사 에쎄르", "sales": 0, ... }] }` |
| **클라이언트 로직** | `esserMetrics.aggregateEsserByStore`, `platformKpiSplit.summarizeBrandKpis`, `combinedKpiSegments` |
| **필요 컬럼** | `store_name`, metrics |
| **성능** | `GROUP BY store_name` LIMIT 500 기본. 정렬 `sales DESC` |

---

### 5. `GET /api/v1/kpi/daily`

| 항목 | 내용 |
|------|------|
| **목적** | 일별 매출·마진·광고 버킷 (차트·일별 탭) |
| **사용 화면** | `SalesCharts`, 데이터 탭 `daily`, 대시보드 일별 표 |
| **지원 필터** | 공통 + `expand_period_uploads=true` (기간 업로드 일별 분배) |
| **응답 예시** | `{ "rows": [{ "date": "2026-06-30", "sales": 0, "salesQty": 0, "adSpend": 0, ... }] }` |
| **클라이언트 로직** | `esserMetrics.aggregateEsserByDay`, `expandPeriodUploadRowsForDaily`, `manualAdSpend.aggregateEsserByDayWithManual`, `esserBucketsToDailyTabRows` |
| **필요 컬럼** | `order_date`/`business_date`, metrics, `upload_kind`, JSONB 기간 필드 |
| **성능** | `GROUP BY date` — 365행 이하. 기간 업로드 분배는 CPU 집약 → materialized view 후보 |

**Phase 2 우선순위: 높음** (차트·일별 탭이 records 전량 로드에 의존)

---

### 6. `GET /api/v1/kpi/weekly`

| 항목 | 내용 |
|------|------|
| **목적** | ISO 주차별 집계 |
| **사용 화면** | 데이터 탭 weekly (esser 대시보드), 엑셀 |
| **지원 필터** | 공통 + `year` |
| **응답 예시** | `{ "rows": [{ "year": 2026, "week": 26, "label": "2026-W26", "sales": 0, ... }] }` |
| **클라이언트 로직** | `esserMetrics.aggregateEsserByWeek`, `manualAdSpend.aggregateEsserByWeekWithManual`, `salesAggregation.aggregateByWeek` |
| **필요 컬럼** | 날짜 컬럼 |
| **성능** | `date_trunc('week', order_date)` GROUP BY |

---

### 7. `GET /api/v1/kpi/monthly`

| 항목 | 내용 |
|------|------|
| **목적** | 월별 집계 (월별 대시보드 scope) |
| **사용 화면** | `platform_monthly`, `company_b_monthly`, `combined_monthly` |
| **지원 필터** | 공통 + `year` |
| **응답 예시** | `{ "rows": [{ "year": 2026, "month": 6, "sales": 0, ... }] }` |
| **클라이언트 로직** | `esserMetrics.aggregateEsserByMonth`, `manualAdSpend.aggregateEsserByMonthWithManual` |
| **필요 컬럼** | 날짜 컬럼 |
| **성능** | `date_trunc('month', ...)` — 저비용 |

---

### 8. `GET /api/v1/kpi/products`

| 항목 | 내용 |
|------|------|
| **목적** | 상품·옵션별 매출 순위 |
| **사용 화면** | 데이터 탭 `product`/`productOption`, 엑셀 ⑩순위 시트 |
| **지원 필터** | 공통 + `limit`, `sort=sales` |
| **응답 예시** | `{ "rows": [{ "productCode": "", "productName": "", "option": "", "sales": 0, "salesQty": 0 }] }` |
| **클라이언트 로직** | `esserMetrics.aggregateEsserByProductOption`, `salesAggregation.aggregateDetailsByProductOption`, `buildSummaryTabFromDetails('product')` |
| **필요 컬럼** | `product_code`, `product_name`, `option_name`, metrics |
| **성능** | `GROUP BY product_code, product_name, option_name` + LIMIT. Top-N만 반환 |

---

### 9. `GET /api/v1/kpi/compare-yesterday`

| 항목 | 내용 |
|------|------|
| **목적** | 전일 대비 매출 증감 (플랫폼·브랜드·종합) |
| **사용 화면** | `SalesPeriodDashboard` 전일 대비 섹션 |
| **지원 필터** | `date` (기준일) 또는 `from`/`to`에서 종료일 기준 |
| **응답 예시** | `{ "rows": [{ "label": "쿠팡", "currentSales": 0, "prevSales": 0, "change": 0, "changeRate": 0 }] }` |
| **클라이언트 로직** | `dayOverDaySales.computeDayOverDaySales`, `computeCombinedBrandDayOverDaySales` |
| **필요 컬럼** | 날짜 + `platform` + metrics |
| **성능** | 기준일·전일 2회 집계 또는 window function. 캐시 유효 |

**주의:** 날짜 필터 미적용 records 집합 필요 (`dashboardDayOverDayRecords`) — API는 `reference_date` 파라미터로 명시.

---

## Part B — 구현 로드맵 (Phase 2 제안)

| 순위 | API | 이유 |
|------|-----|------|
| P0 | `summary` 확장 (margin, adSpend) | 대시보드 카드 — records 전량 로드 제거 1단계 |
| P0 | `daily` | 차트·일별 탭 — 가장 빈번한 집계 |
| P1 | `by-platform` | 플랫폼 분리 표 — 핵심 UX |
| P1 | `compare-yesterday` | 대시보드 전일 대비 |
| P2 | `by-store`, `by-sales-method`, `products` | 데이터 탭·엑셀 |
| P2 | `weekly`, `monthly` | 월별 scope |
| P3 | 수기 광고·파워프라이스·1P·자사몰 merge | settings 연동 복잡도 높음 |
| P3 | 통합(`combined`) 세그먼트 KPI | `combinedKpiSegments` + 다채널 merge |

---

## Part C — 기존 클라이언트 KPI 계산 로직 위치

### `src/utils/esserMetrics.js` — 핵심 KPI 엔진

| 함수 | 역할 | 사용 화면 | 입력 | 출력 | 이전 우선순위 | 주의사항 |
|------|------|-----------|------|------|---------------|----------|
| `esserRowValues` | 행 단위 매출·마진·광고 파싱 | 전역 | record row | metrics object | P0 | JSONB+컬럼 혼합 |
| `summarizeEsserKpis` | 상품 행 KPI 합산 | 대시보드, export | detail[] | bucket (sales, margin, ad...) | P0 | 엑셀 총합 행 광고 처리 |
| `summarizeReturnKpis` | 반품 집계 | 반품 탭 | return rows | bucket | P2 | 매출 KPI와 분리 |
| `deriveEsserProfitKpis` | 마진·원가·ROAS 파생 | KPI 카드 | bucket | enriched bucket | P0 | 스마트스토어 원가 역산 |
| `finalizeEsserBucket` | 비율·ROAS 계산 | 전역 | bucket | bucket | P0 | |
| `buildPlatformKpiSplitRows` 등 | — | → `platformKpiSplit.js` | | | | |
| `aggregateEsserByDay/Week/Month` | 기간별 집계 | 차트, 탭 | rows | buckets[] | P0 (daily) | |
| `aggregateEsserByChannel/ProductOption/SalesMethod/Store` | 차원별 집계 | 데이터 탭 | rows, metricKey | groups[] | P1–P2 | |
| `esserBucketsToDailyTabRows` | 버킷 → 표 행 | 일별 탭 | buckets | table rows | P1 | |
| `expandPeriodUploadRowsForDaily` | 기간 업로드 일별 분배 | 일별 | rows | expanded rows | P1 | 복잡 |
| `isEsserSheetTotalRecord` | 엑셀 하단 총합 행 판별 | KPI 필터 | row | boolean | P0 | 광고만 KPI 반영 |

### `src/utils/platformKpiSplit.js` — 플랫폼·통합 KPI 표

| 함수 | 역할 | 사용 화면 | 입력 | 출력 | 우선순위 | 주의 |
|------|------|-----------|------|------|----------|------|
| `buildPlatformKpiSplitRows` | 쿠팡/스스/자사몰/외부광고/종합 행 | 베스트하임 일별 대시보드 | records, manualAd | split rows | P1 | 수기 광고 merge |
| `buildCombinedKpiSplitRows` | 통합 세그먼트 표 | combined_daily | records, manualAd | rows | P2 | 파워프라이스·브랜드 |
| `buildPowerPriceKpiSplitRows` | 파워프라이스 KPI | power_price scope | records, manualAd | rows | P3 | 광고비만 |
| `buildCoupang1pRocketKpiSplitRows` | 1P 로켓 KPI | coupang_1p scope | records | rows | P3 | |
| `summarizeBrandKpis` | 브랜드별 합산 | 통합 | records | bucket | P2 | |
| `summarizeCombinedKpis` | 통합 종합 | 통합 | records | bucket | P2 | |
| `kpiSplitSectionTitle` | 표 제목 | 대시보드 UI | rows | string | P3 | UI only |

### `src/utils/manualAdSpend.js` — 수기 광고 KPI 반영

| 함수 | 역할 | 사용 화면 | 입력 | 출력 | 우선순위 | 주의 |
|------|------|-----------|------|------|----------|------|
| `summarizeEsserKpisWithManual` | 상품 KPI + 수기 광고 | 대시보드 | rows, manual entries | bucket | P1 | settings 의존 |
| `aggregateEsserByDayWithManual` | 일별 + 광고 | 차트, 일별 | rows, manual | buckets | P1 | |
| `aggregateCombinedByDayWithManual` | 통합 일별 | combined | rows, multi manual | buckets | P2 | |
| `aggregateEsserByMonth/WeekWithManual` | 월/주별 | 월별 대시보드 | rows, manual | buckets | P2 | |
| `totalManualAdSpend` | 광고비 합 | KPI 표 | entries, filter | number | P1 | |

### `src/utils/salesAggregation.js` — 레거시·비-esser 집계

| 함수 | 역할 | 사용 화면 | 우선순위 | 주의 |
|------|------|-----------|----------|------|
| `buildSummaryTabFromDetails` | detail → daily/channel/product 탭 | 데이터 탭 | P1 | esser vs non-esser 분기 |
| `buildDailySummaryFromDetails` | 일별 요약 | sales_report | P2 | |
| `summarizeKpis` | 상단 카드 (구형) | sales_report | P3 | |
| `aggregateDetailsByChannel/Store/ProductOption` | 차원 집계 | 데이터 탭 | P2 | |

### `src/utils/dayOverDaySales.js` — 전일 대비

| 함수 | 역할 | 사용 화면 | 우선순위 |
|------|------|-----------|----------|
| `computeDayOverDaySales` | 플랫폼별 전일 대비 | 일별 대시보드 | P1 |
| `computeCombinedBrandDayOverDaySales` | 브랜드·종합 전일 대비 | 통합 | P2 |

### `src/utils/combinedKpiSegments.js` — 통합 세그먼트 분류

| 함수 | 역할 | 우선순위 |
|------|------|----------|
| `classifyCombinedSegment` | 행 → 베스트하임/사본느리/파워프라이스 | P2 |
| `recordsForCombinedSegment` | 세그먼트 필터 | P2 |

### `src/utils/specialSaleKpi.js` — 특판 매출

| 함수 | 역할 | 우선순위 |
|------|------|----------|
| `summarizeSpecialSaleKpi` | 통합 특판 KPI | P3 (settings) |

### `src/utils/dashboardExporter.js` / `profitLossReportExporter.js` — export KPI

| 영역 | 역할 | 우선순위 | 주의 |
|------|------|----------|------|
| `downloadDashboardExcel` | KPI·일별·상세 시트 | P3 | 클라이언트 KPI 전부 사용 |
| `buildIntegratedSegmentKpiExcelRows` | 통합 엑셀 KPI | P3 | |
| `profitLossReportExporter` | ①요약리포트 | P3 | 템플릿 플레이스홀더 |

### `src/composables/useSalesData.js` — 오케스트레이션

| 영역 | 역할 | 우선순위 | 주의 |
|------|------|----------|------|
| `filteredDetailForCharts` | KPI·차트용 필터 records | P0 | records 전량 상주 |
| `dashboardPlatformSplitRecords` | 플랫폼 분리 KPI 입력 | P1 | |
| `dashboardDayOverDayRecords` | 전일 대비 입력 | P1 | 날짜 필터 제외 |
| `dailyFromDetails` | 일별 탭·차트 버킷 | P0 | manual ad merge |
| `loadDetailCache` / `refreshAll` | API → 캐시 | P0 | PG 9+ 요청 |

### `src/composables` — settings 기반 수기 데이터

| 파일 | 역할 | API 이전 | 주의 |
|------|------|----------|------|
| `useManualAdSpend.js` | 광고비 수기 | settings + KPI merge | 저장 legacy |
| `usePowerPrice.js` | 파워프라이스 | detailRecords 파생 | |
| `useCoupang1pRocket.js` | 1P 발주 | settings → detailRecords | |
| `useOwnMallManual.js` | 자사몰 수기 | settings + detail merge | |
| `useSpecialSale.js` | 특판 | settings | |
| `hydrateAppSettings.js` | settings 일괄 로드 | 조회 PG 가능 | |

### `src/components/SalesPeriodDashboard.vue`

- KPI 카드·플랫폼 분리 표·전일 대비 **표시만** — 계산은 utils 위임
- Phase 2: props로 API 응답 직접 수신하도록 변경

---

## Part D — Vue 전환 시 아키텍처 (참고)

```text
[현재]
useSalesData → fetchSalesRecords(전량) → detailRecords[] → esserMetrics → UI

[Phase 2 목표]
useSalesData → fetchKpiSummary / fetchKpiDaily / fetchKpiByPlatform(filters)
             → 상세 탭만 fetchRecords(page, limit)
             → UI
```

**feature flag:** `VITE_API_MODE=pg` + `VITE_KPI_SOURCE=server|client` (Phase 2에서 추가 권장) — 점진 전환·A/B 검증.

---

## Part E — 미전환 유지 (Phase 1-5 범위)

- 엑셀 업로드·파싱
- 통합 export KPI 계산
- settings 저장
- record 수정/삭제
- `VITE_API_MODE` 기본값 `legacy`
