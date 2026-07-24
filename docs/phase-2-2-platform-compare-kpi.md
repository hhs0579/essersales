# Phase 2-2 Platform & Compare KPI API

## 1. 목적

Phase 2-1에서 분리한 **대시보드 KPI summary·일별 차트**에 이어, **플랫폼별 KPI split**과 **전일 대비 KPI**를 PostgreSQL 백엔드 API로 이전합니다.

- `VITE_API_MODE=pg` + `VITE_KPI_SOURCE=server`일 때만 신규 API 사용
- 기본값 `legacy` + `client` 유지 — 운영 동작 변경 없음
- 대시보드 진입 시 records 전량 로드 없이 KPI 4종 API만으로 주요 영역 표시

## 2. 구현 범위

### 백엔드

| API | 상태 |
|-----|------|
| `GET /api/v1/kpi/by-platform` | 신규 |
| `GET /api/v1/kpi/compare-yesterday` | 신규 |
| `GET /api/v1/kpi/summary` | 유지 (Phase 2-1) |
| `GET /api/v1/kpi/daily` | 유지 (Phase 2-1) |

### Vue

| 항목 | server 모드 |
|------|-------------|
| 플랫폼 KPI split 표 | `serverPlatformKpiRows` |
| 전일 대비 표 | `serverDayOverDayRows` |
| 대시보드 KPI 카드 | `serverKpiBucket` (2-1) |
| 일별 차트 | `serverDailyChartBuckets` (2-1) |

### Adapter

- `src/services/adapters/platformKpiAdapter.js` — by-platform / compare-yesterday → 기존 컴포넌트 prop 구조
- `src/services/adapters/kpiAdapter.js` — `buildKpiQueryFromFilters`에 `date` 추가

### 회귀

```bash
npm run regression:phase-2-2
```

## 3. KPI 집계 기준 정리

### 291,737,783 vs 191,423,799

| 숫자 | 의미 |
|------|------|
| **291,737,783** | PG `sales_records` **전체 detail 행**의 `SUM(sales)`. 반품·엑셀 시트 합계 행·음수 매출/수량 행 **포함**. Phase 1-3/1-5 raw 검증 기준 |
| **191,423,799** | **Esser 대시보드 KPI** — 상품 행만 합산. Phase 2-1 `GET /kpi/summary`·회귀 기준 |

**차이 원인 (~100M):**

1. **반품·취소** (`transaction_type=return` 또는 sales/qty 음수) — raw 합에 포함, KPI에서 제외
2. **엑셀 시트 합계 행** (`isEsserSheetTotal=true`) — raw 합에 매출 포함 가능, KPI 매출 합에서는 제외 (광고비만 별도 합산)
3. **기간/upload_kind/platform 필터 없음** — 위 두 숫자 모두 **전체 데이터** 기준

### API별 집계 범위

| 질문 | by-platform / compare-yesterday / summary / daily |
|------|-----------------------------------------------------|
| 전체 sales_records? | **detail** (`record_type=detail`)만 |
| detail record만? | **예** |
| upload_kind 필터? | 기본 없음. 쿼리 시에만 |
| platform / sales_method? | 쿼리 시에만 |
| 기간 필터? | `from`/`to`/`date` — **집계 후 JS** (adapter 날짜 호환) |
| Esser KPI 전용? | **예** — 반품·합계 행 제외, `esserKpiAggregate.js` |

## 4. 추가된 API

### `GET /api/v1/kpi/by-platform`

플랫폼별 KPI split. 화면 행: **쿠팡, 스마트스토어, 자사몰** + `totalRow`(종합).

**필터:** `from`, `to`, `platform`, `sales_method`, `store_name`, `upload_kind`, `upload_format`

### `GET /api/v1/kpi/compare-yesterday`

전일 대비 KPI. 기본 라벨: **쿠팡, 스마트스토어, 종합**.

**필터:** `date` (기준일), 또는 `from`/`to` (기준일 = `to`), `compare_from`/`compare_to` (예약), `platform`, `sales_method`, `store_name`, `upload_kind`, `upload_format`

## 5. API 요청/응답 예시

```bash
curl "http://localhost:3002/api/v1/kpi/by-platform"
curl "http://localhost:3002/api/v1/kpi/by-platform?platform=쿠팡&from=2026-06-01&to=2026-06-09"
curl "http://localhost:3002/api/v1/kpi/compare-yesterday"
curl "http://localhost:3002/api/v1/kpi/compare-yesterday?date=2026-06-09"
```

**by-platform 응답:**

```json
{
  "items": [
    {
      "platform": "쿠팡",
      "salesTotal": 1000000,
      "quantityTotal": 100,
      "recordCount": 20,
      "netProfitTotal": 0,
      "adSpendTotal": 0,
      "costTotal": 0,
      "marginRate": 0,
      "averageOrderValue": 10000
    }
  ],
  "total": 3,
  "totalRow": { "platform": "종합", "salesTotal": 3000000, "quantityTotal": 300, "recordCount": 60 },
  "filters": {}
}
```

**compare-yesterday 응답:**

```json
{
  "items": [
    {
      "label": "종합",
      "current": { "date": "2026-06-09", "salesTotal": 3910092, "quantityTotal": 120 },
      "previous": { "date": "2026-06-08", "salesTotal": 4870000, "quantityTotal": 140 },
      "diff": { "salesDiff": -959908, "salesDiffRate": -19.7, "quantityDiff": -20, "quantityDiffRate": -14.29 }
    }
  ],
  "current": { "date": "2026-06-09", "salesTotal": 3910092 },
  "previous": { "date": "2026-06-08", "salesTotal": 4870000 },
  "diff": { "salesDiff": -959908, "salesDiffRate": -19.7 },
  "filters": {}
}
```

## 6. client 계산과 server 계산 비교

`npm run regression:phase-2-2` 검증 항목:

| 항목 | client | server |
|------|--------|--------|
| Platform split | `buildPlatformKpiSplitRows` (수기 광고 없음) | `/kpi/by-platform` |
| 전일 대비 | `computeDayOverDaySales` (수기 광고 없음) | `/kpi/compare-yesterday` |
| salesTotal | `profit.sales` | `salesTotal` |
| quantityTotal | `profit.salesQty` | `quantityTotal` |
| recordCount | `rowCount` | `recordCount` |
| diff / diffRate | `changePct` | `diff.salesDiffRate` |

### 알려진 차이

| 항목 | client | server |
|------|--------|--------|
| 수기 광고 행 | Meta/GFA 등 별도 행 | **미포함** (Phase 2-3) |
| 종합 행 | 상품 3플랫폼 + 수기 광고 | 상품 3플랫폼만 |
| 스마트스토어 원가 | `estimateCostFromMargin` | adapter에서 동일 플래그 |

## 7. platform split 집계 기준

1. **상품 행만** — 반품·`isEsserSheetTotal` 제외
2. **플랫폼 판별** — `platformDetect.resolveRecordPlatform` 포팅 (`resolvePlatformFromRow`)
   - `channelKind` / 파일명 / `platform`·`channel` 컬럼
   - `네이버` → `스마트스토어`
   - 미식별 → `미지정` (응답 `unknown` 필드, 화면 행에는 3대 플랫폼만)
3. **기간 필터** — `resolveAggregationDate` 기준 집계 후 `from`/`to` 적용
4. **종합** — 쿠팡+스마트스토어+자사몰 합 (수기 광고 제외)
5. **`recordCount`** — `buildPlatformRow`와 동일: **반품 포함**, `isEsserSheetTotal`만 제외 (매출 합산과 별도)

## 8. 전일 대비 계산 기준

### 날짜 키

전일 대비는 **일별 차트(daily)와 다른 규칙**을 따릅니다 (client `dayOverDaySales` 호환).

| 우선순위 | 필드 |
|----------|------|
| 1 | `data.date` / `data.contextDate` / adapter `row.date` |
| 2 | *(없음 — business_date·period_from 폴백 **사용 안 함**)* |

일별 KPI(`daily`)는 `order_date`·`business_date`·`period_from` 폴백을 사용합니다.

### 기준일·전일

| 항목 | 규칙 |
|------|------|
| 기준일 (`referenceDate`) | `date` 쿼리 → `to` → `from` → 데이터 내 최대 일자 |
| 전일 | 기준일 - 1일 |
| 전일 데이터 없음 | `previous.salesTotal = 0`, `quantityTotal = 0` |
| `salesDiffRate` | `previous > 0` → `(current-previous)/previous×100`; `previous=0` & `current>0` → `100`; 둘 다 0 → `0` |
| 0 나누기 | 위 규칙으로 회피 |

### 수기 광고

client는 `aggregateEsserByDayWithManual`로 일별 버킷에 수기 광고를 merge. server compare-yesterday는 **상품 행만** (Phase 2-3).

## 9. 성능 개선 효과

| 모드 | 대시보드 진입 시 HTTP |
|------|----------------------|
| pg + client | `/records` 페이지네이션 ~9회 (4,350건) |
| pg + server | **4회** — summary, daily, by-platform, compare-yesterday (병렬) |

records 전량 로드 **생략** (`ensureDashboardReady` → `loadServerKpiForScope`만).

### Lazy load (다음 단계)

데이터 탭(상세/채널/상품 테이블)은 server 모드에서 **아직 records 미로드**. Phase 2-3에서:

1. `ensureDetailCache(scope)` — 탭 진입 시에만 `fetchSalesRecords`
2. export·수기 입력은 기존 legacy 경로 유지

## 10. 아직 client 계산으로 남은 영역

- 상품별·채널별 상세 표
- 주간/월간 차트
- 수기 광고 KPI merge (summary/daily/platform/dod)
- 엑셀 export KPI
- settings·업로드·record 수정 (legacy)

## 11. 발견된 이슈

1. **수기 광고 미반영** — server KPI 전반
2. **날짜 규칙 이원화** — daily vs compare-yesterday (의도적 client 호환)
3. **`recordsAdapter` 10자 truncate** — daily·DOD 모두 동일 호환 적용
4. **데이터 탭 빈 표** — server 모드 대시보드만 볼 때 records 없음

## 12. Phase 2-3 제안

1. settings 기반 수기 광고 server merge
2. `ensureDetailCache` lazy records 로드
3. `getKpiDaily` / platform SQL 집계 + 날짜 정규화 마이그레이션
4. 주간/월간 KPI API (`/kpi/weekly`, `/kpi/monthly`)
5. `recordsAdapter.toDateString` truncate 버그 근본 수정 (회귀 갱신)

---

### 검증

```bash
docker compose up -d --build api
npm run regression:phase-2-1
npm run regression:phase-2-2
```

### 수동 확인

```env
VITE_API_MODE=pg
VITE_KPI_SOURCE=server
```

Network: `/kpi/summary`, `/kpi/daily`, `/kpi/by-platform`, `/kpi/compare-yesterday` — `/records` 없음.
