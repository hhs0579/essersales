# Phase 2-1 Server KPI API

## 1. 목적

Vue가 **전체 records(4,350건+)를 로드한 뒤 클라이언트에서 KPI·일별 차트를 계산**하던 구조를 줄이고, PostgreSQL 백엔드 KPI API로 **대시보드 상단 KPI·일별 차트**만 점진 이전합니다.

- `VITE_API_MODE=legacy` — 기본값 유지
- `VITE_KPI_SOURCE=client` — 기본값 유지
- `pg` + `server` 조합에서만 서버 KPI 사용

## 2. 구현 범위

### 백엔드 (P0)

| API | 상태 |
|-----|------|
| `GET /api/v1/kpi/summary` | 확장 (margin, adSpend, cost 등) |
| `GET /api/v1/kpi/daily` | 신규 |

### Vue

| 항목 | 상태 |
|------|------|
| `VITE_KPI_SOURCE` feature flag | 추가 |
| `fetchKpiSummary` / `fetchKpiDaily` | 추가 |
| 대시보드 KPI 카드 | server 모드 연동 |
| 일별 차트 (esser daily) | server 모드 연동 |
| records 전량 로드 | server 모드 대시보드 진입 시 **생략** |

### 미구현 (의도적)

- 플랫폼 KPI split, 전일 대비, 주/월별, export, 쓰기 API

## 3. KPI 집계 기준 정리

대시보드·KPI API에서 쓰는 **sales total**은 여러 “합계”가 공존합니다. 숫자만 보면 불일치처럼 보일 수 있으므로, 아래 기준을 Phase 2-2 문서와 동일하게 유지합니다.

| 기준 | salesTotal (현재 데이터) | 설명 |
|------|--------------------------|------|
| **PG 전체 raw 합** | **291,737,783** | `sales_records` **전체 행** `SUM(sales)`. 반품·엑셀 합계 행·음수 매출 포함. Phase 1-3 `compare:read-api`, Phase 1-5 회귀 검증 기준 |
| **Esser 대시보드 KPI** | **191,423,799** | `record_type=detail` 중 **상품 행만**: 반품 제외, `isEsserSheetTotal` 제외. `summarizeEsserKpis` / `getKpiSummary` `productRowsOnly` |
| **차이 (~100M)** | — | 반품·취소, 엑셀 시트 합계 행, 음수 qty/sales 행이 raw 합에만 포함됨 |

### 적용 여부 (필터·범위)

| 항목 | Esser KPI API (summary/daily/by-platform/compare) |
|------|---------------------------------------------------|
| 전체 `sales_records` vs detail만 | **detail** (`record_type=detail`) |
| 상품 행 vs 합계 행 | **상품 행만** (반품·`isEsserSheetTotal` 제외) |
| `upload_kind` | 기본 **필터 없음** (전체 업로드 종류) |
| `platform` / `sales_method` | 쿼리 파라미터 지정 시에만 적용 |
| 기간 (`from`/`to`) | daily·by-platform·compare는 **집계 후** JS 필터 (SQL 날짜 컬럼과 adapter 날짜 불일치 방지) |
| Esser KPI 전용 규칙 | **예** — 클라이언트 `esserMetrics` / `platformKpiSplit` / `dayOverDaySales` 포팅 |

`GET /api/v1/kpi/summary`의 `recordCount`는 **전체 detail 행 수**(반품 포함). `salesTotal`은 **상품 행만** 합산합니다.

## 4. 추가된 API

### `GET /api/v1/kpi/summary`

**필터:** `from`, `to`, `platform`, `sales_method`, `store_name`, `upload_kind`, `upload_format`

**응답 필드:**

| 필드 | 설명 |
|------|------|
| `salesTotal`, `quantityTotal` | 상품 행 합 (반품·엑셀 합계 행 제외) |
| `recordCount` | 전체 행 수 (반품 포함) |
| `uploadCount` | DISTINCT upload_id |
| `netProfitTotal` | `net_profit` 컬럼 합 |
| `adSpendTotal` | 상품 행 ad_spend + 엑셀 합계 행 광고 |
| `adSalesTotal` | JSONB `adSales` (합계 행) |
| `costTotal` | `sales - net_profit` 역산 (net_profit 있는 행만) |
| `marginRate` | netProfit / sales × 100 |
| `averageOrderValue` | sales / quantity |

### `GET /api/v1/kpi/daily`

**필터:** summary와 동일 (날짜 필터는 **집계 후** JS 적용)

**응답:**

```json
{
  "items": [
    {
      "date": "2026-06-01",
      "salesTotal": 42234412,
      "quantityTotal": 1360,
      "recordCount": 1200,
      "netProfitTotal": 0,
      "adSpendTotal": 0
    }
  ],
  "total": 10,
  "filters": {}
}
```

## 5. API 요청/응답 예시

```bash
curl "http://localhost:3002/api/v1/kpi/summary"
curl "http://localhost:3002/api/v1/kpi/daily?from=2026-06-01&to=2026-06-09"
curl "http://localhost:3002/api/v1/kpi/summary?platform=쿠팡"
```

## 6. VITE_KPI_SOURCE 구조

```env
VITE_API_MODE=legacy      # 기본
VITE_KPI_SOURCE=client    # 기본
```

| API_MODE | KPI_SOURCE | 동작 |
|----------|------------|------|
| legacy | * | 항상 클라이언트 계산 (`:3001`) |
| pg | client | PG records 로드 → 클라이언트 KPI |
| pg | server | `/kpi/summary` + `/kpi/daily` → 대시보드·일별 차트 |

DEV 배지: `API MODE: PG · KPI: SERVER`

## 7. client 계산과 server 계산 비교

`npm run regression:phase-2-1` 결과 (현재 데이터):

| 항목 | 결과 |
|------|------|
| summary salesTotal | OK (191,423,799) |
| summary quantityTotal | OK (5,227) |
| daily rows | OK (10) |
| daily sales/qty by date | OK |
| 필터 (from/to) | OK |

### 알려진 차이·주의

| 항목 | client | server | 비고 |
|------|--------|--------|------|
| `recordCount` in summary | 전체 4,350 | 동일 | KPI 매출은 **상품 행만** |
| 수기 광고 merge | `summarizeEsserKpisWithManual` | 미포함 | Phase 2-2 |
| 플랫폼 split 종합 행 | client | server bucket 단일 | split 미이전 |
| `recordsAdapter` 날짜 10자 truncate | `"2026. 6. 30"` → `"2026. 6. 3"` | daily 집계에 **동일 규칙 적용** | 버그 호환 의도적 |

원시 컬럼 합계(291,737,783)는 반품·합계 행 포함 — **대시보드 KPI와 다름**.

## 8. 일별 집계 기준

1. `data.date` / `contextDate` — `recordsAdapter.toDateString` 동일 10자 truncate 후 파싱
2. `order_date` 컬럼
3. `business_date`
4. `period_from` (단일일/동일 기간)

반품·`isEsserSheetTotal` 행 제외.  
날짜 필터(`from`/`to`)는 SQL이 아닌 **집계 단계**에서 적용 (adapter 날짜와 order_date 불일치 방지).

## 9. 성능 개선 효과

| 모드 | 대시보드 진입 시 |
|------|------------------|
| pg + client | detail 4,350건 × 9 req ≈ 480–990ms |
| pg + server | `/kpi/summary` + `/kpi/daily` ≈ **2 req, ~50–150ms** |

records 전량 로드 **불필요** (대시보드·일별 차트만 볼 때).

`getKpiDaily`는 필터된 product 행을 DB에서 읽어 Node 집계 (~4,350행 — 현재 규모 OK). Phase 2-2에서 SQL 집계·캐시 검토.

## 10. 아직 client 계산으로 남은 영역

- 플랫폼 KPI split 표 (`platformKpiSplit`)
- 전일 대비 (`dayOverDaySales`)
- 주간/월간 차트 탭
- 수기 광고 KPI 반영
- 데이터 탭 상세/채널/상품 (records 필요 — 새로고침 시 로드)
- 엑셀 export KPI

## 11. 발견된 이슈

1. **`recordsAdapter.toDateString` 10자 절단** — `"2026. 6. 30"`이 `"2026. 6. 3"`으로 잘림. server daily가 동일 규칙을 따라 client와 일치. 근본 수정은 별도 이슈.
2. **수기 광고 미반영** — server summary에 manual ad 없음 → 대시보드 광고 카드 차이 가능.
3. **데이터 탭** — server 모드 대시보드 진입 후 상세 표는 비어 있음 → 「새로고침」 또는 Phase 2-2 lazy load.

## 12. Phase 2-2 제안

1. `GET /api/v1/kpi/by-platform` — 플랫폼 split 표
2. `GET /api/v1/kpi/compare-yesterday`
3. settings 기반 수기 광고 merge (summary/daily)
4. `getKpiDaily` SQL 집계 + 날짜 정규화 마이그레이션
5. 데이터 탭 lazy `ensureDetailCache`
6. `recordsAdapter` 날짜 truncate 버그 수정 (회귀 테스트 갱신)

---

### 검증

```bash
docker compose up -d api
npm run regression:phase-2-1
```

### 수동 확인

```env
VITE_API_MODE=pg
VITE_KPI_SOURCE=server
```

`npm run dev` 재시작 → 매출 대시보드 → Network에 `/kpi/summary`, `/kpi/daily`만 확인 (records 9회 요청 없음).
