# Phase 2-3 Lazy Detail Cache & Manual Ads Merge

## 1. 목적

`pg + server` 모드에서:

1. **대시보드**는 KPI API 4종만으로 빠르게 표시 (records 전량 로드 생략)
2. **상세/채널/상품 탭** 진입 시에만 `ensureDetailCache()`로 records lazy load
3. **settings 수기 광고비**를 server KPI API에 merge

기본값 `legacy` + `client` 유지.

## 2. 구현 범위

| 영역 | 내용 |
|------|------|
| `ensureDetailCache` | 로딩 상태·에러·캐시·중복 요청 방지 |
| `CollapsibleSection` | `@expand` 이벤트 — 데이터/차트 섹션 펼칠 때 lazy load |
| KPI API | `manualAdSpendTotal`, `netProfitAfterManualAd`, `marginRateAfterManualAd` |
| 쿼리 | `scope`, `include_manual_ads` (기본 `true`) |
| 회귀 | `npm run regression:phase-2-3` |

## 3. ensureDetailCache 구조

**위치:** `src/composables/useSalesData.js`

```text
detailCacheLoaded      — 최초 로드 완료
detailCacheLoading     — 로드 중
detailCacheError       — 실패 메시지
detailCacheLoadedAt    — ISO 타임스탬프
detailCachePromise     — 동시 호출 dedupe
```

**동작:**

| 모드 | 대시보드 진입 | 상세 탭 |
|------|--------------|---------|
| legacy | records 로드 (기존) | 기존 |
| pg + client | records 로드 (기존) | 기존 |
| pg + server | KPI 4 API만 | `ensureDetailCache()` → records 1회 |

`ensureDetailForScope(scope)` = `ensureDetailCache()` + `loadRecordsForScope(scope)`

## 4. 대시보드 최초 로드 API 요청 변화

| 항목 | pg + client | pg + server |
|------|-------------|-------------|
| `/kpi/summary` | — | 1 |
| `/kpi/daily` | — | 1 |
| `/kpi/by-platform` | — | 1 |
| `/kpi/compare-yesterday` | — | 1 |
| `/records` (detail) | ~9 페이지 | **0** |

## 5. 상세 탭 lazy load 동작

1. 데이터 섹션(`CollapsibleSection` lazy) 펼침 → `@expand` → `ensureDetailForScope()`
2. 탭 클릭(`switchTab`) → `ensureDetailCache()` + aggregate cache
3. 차트 섹션 펼침 → 주/월·breakdown용 records lazy load

UI (최소):

- `상세 데이터를 불러오는 중입니다.`
- `상세 데이터 로드 실패` + **다시 시도**

## 6. records 캐시 정책

- 최초 `ensureDetailCache()` 성공 후 `detailCacheLoaded=true` → 재호출 시 API skip
- `refreshAll()` / 업로드·수정 후 캐시 무효화 후 전량 재로드
- aggregate cache (daily/channel/product)는 detail과 별도 플래그

## 7. 수기 광고비 settings 구조

**테이블:** `app_settings` — PK `(scope, kind)`

| kind | `manual_ad` |
|------|-------------|
| scope 예 | `platform`, `platform_monthly`, `company_b`, `power_price`, … |
| data | `ManualAdEntry[]` JSON 배열 |

**Entry 필드:**

```json
{
  "id": "uuid",
  "date": "YYYY-MM-DD",
  "adSpend": "12345",
  "adSales": "67890",
  "source": "meta|gfa|ad|google_traffic"
}
```

**채널:** Meta, GFA, AD, 구글 트래픽 — 플랫폼 split에서 별도 KPI 행

**날짜 필터:** `manualAdEntryInView` — `from`/`to`/`year`/`month`

**통합 scope:** `combined_daily` → `platform` + `company_b` + `power_price` settings 병합

## 8. server KPI 수기 광고비 merge 기준

**백엔드:** `backend/src/utils/manualAdKpiMerge.js`

```text
adSpendTotal = 원천 광고비 + 수기 광고비
netProfitAfterManualAd = netProfitTotal - 수기 광고비
marginRateAfterManualAd = netProfitAfterManualAd / salesTotal × 100
```

| API | merge 내용 |
|-----|------------|
| summary | 전체 기간 수기 광고 합 |
| daily | 일별 `manualAdByDay` 가산 |
| by-platform | `manualAdItems` (source별) + `totalRow` 반영 |
| compare-yesterday | 기준일/전일 `manualAdSpendTotal` (매출 diff는 변경 없음) |

**쿼리:**

```text
scope=platform
include_manual_ads=true   # 기본
include_manual_ads=false  # 수기 광고 제외
```

## 9. client 계산과 server 계산 비교

| 항목 | 일치 | 차이 가능 |
|------|------|-----------|
| summary `manualAdSpendTotal` | `totalManualAdSpend` | scope 미지정 시 server 기본 `platform` |
| summary `adSpendTotal` | `summarizeEsserKpisWithManual` | — |
| daily 수기 합 | `aggregateEsserByDayWithManual` | 날짜 파싱 edge (M.D 형식) |
| platform 외부광고 행 | source별 행 | client `sales: null` vs server `0` 표시 |
| compare-yesterday 매출 | 동일 | 수기 광고는 매출에 미반영 (양쪽 동일) |
| 파워프라이스 SpendOnly | client `SpendOnly` 변형 | server는 scope별 entries 단순 합 |

## 10. 성능 개선 효과

측정 (`regression:phase-2-3`):

| 지표 | pg + server |
|------|-------------|
| 대시보드 KPI 요청 | 4회 |
| 대시보드 records | 0회 |
| 상세 섹션 최초 펼침 | records 페이지네이션 (~9회, ~5–15초 환경 의존) |
| 재진입 | records 추가 요청 없음 |

## 11. 발견된 이슈

1. **export/엑셀** — server 모드에서도 export 시 `ensureDetailForScope` 필요 (records lazy)
2. **외부광고 행 UI** — server adapter `sales=0`, client `sales=null` (N/A 표시 차이)
3. **settings 저장** — 여전히 legacy PUT (Phase 2-4)
4. **scope 쿼리 필수** — 수기 광고 merge 정확도를 위해 Vue에서 `scope` 전달

## 12. Phase 2-4 제안

1. settings 저장 PG API 전환
2. `getKpiDaily` SQL 집계 + 날짜 정규화
3. record 수정/삭제 PG 전환
4. export lazy load 명시적 `ensureDetailCache` 가드
5. `recordsAdapter.toDateString` truncate 근본 수정

---

### 검증

```bash
docker compose up -d --build api
npm run regression:phase-2-1
npm run regression:phase-2-2
npm run regression:phase-2-3
```

### 수동 확인

```env
VITE_API_MODE=pg
VITE_KPI_SOURCE=server
```

1. 대시보드 진입 — Network: KPI 4종만, `/records` 없음
2. 데이터 섹션 펼치기 — `/records` 요청 시작
3. 다시 접었다 펼치기 — `/records` 추가 없음
4. 수기 광고 입력 후 필터 변경 — KPI API 재호출, `manualAdSpendTotal` 반영
