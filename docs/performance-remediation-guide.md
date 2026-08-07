# 성능(렉) 개선 가이드 — 전체 수정 로드맵

> **목적:** 2026-08 HAR(`docs/192.168.0.245.har`)와 현재 코드 구조를 바탕으로,  
> **무엇을·왜·어떤 순서로** 고칠지 정리한다.  
> **이 문서는 가이드이며, 문서 작성만으로는 코드가 바뀌지 않는다.**

관련:

- [kpi-excel-delay-guide.md](./kpi-excel-delay-guide.md) — KPI가 늦게 뜨는 이슈
- [phase-2-3-lazy-detail-manual-ads.md](./phase-2-3-lazy-detail-manual-ads.md) — detail 지연 로드 설계
- [current-structure.md](./current-structure.md) §11 성능 병목

---

## 1. 증상

| 체감 | 설명 |
|------|------|
| 탭 전환·기간 변경 시 수 초~수십 초 멈춤 | 특히 **통합** 탭 |
| KPI 숫자가 한동안 비었다가 채워지거나 중간에 바뀜 | 서버 KPI → detail 재집계 순서 |
| 필터만 살짝 바꿔도 다시 느려짐 | KPI/records 중복 호출 |
| 엑셀 다운로드 시 UI 정지 | ExcelJS + 전량 재조립 |

---

## 2. HAR로 확인된 사실 (근거)

캡처: `docs/192.168.0.245.har` (전체 Network 약 **54초**)

### 2.1 detail `/api/v1/records`

| 항목 | 측정값 |
|------|--------|
| 페이지 | **1~19** (`limit=500`) |
| 대략 행 수 | **~9,000~9,500건** |
| 페이지당 payload | **~850KB** (마지막 ~450KB) |
| 첫 로드 | page 1~3이 **2~3초**급 |
| 이후 | 304 캐시로 **0.1~0.2초** |
| **중복** | 같은 19페이지를 **약 3번** 재요청 (records 요청 57건) |
| records 구간 | span **~26초** |

요청 형태:

```text
/api/v1/records?page=N&limit=500&record_type=detail&include_data=true&sort=created_at&order=asc
```

`scope` 쿼리 없이 **전체 detail**을 페이지네이션으로 받는다.

### 2.2 KPI `/api/v1/kpi/*`

| 항목 | 측정값 |
|------|--------|
| 총 KPI 요청 | **60건** |
| `platform` 4종 | 각 **8회** 반복 |
| `combined_daily` 4종 | 각 **7회** 반복 |
| 느린 응답 | **15~22초** (`compare-yesterday`, `summary` 등) |
| KPI 구간 | span **~33초**, 개별 합산 비정상적으로 큼 (큐잉·경합) |

엔드포인트: `summary`, `daily`, `by-platform`, `compare-yesterday`

### 2.3 기타

| 요청 | 이슈 |
|------|------|
| `/settings/company_b/own_mall_manual` | **~613KB** × **3회** |
| status 대부분 `304` | 캐시는 타지만, **요청 자체·파싱·대기열**은 남음 |

### 2.4 한 줄 진단

> 렉의 본질 = **(detail 전량 × 중복 로드) + (KPI 폭주/중복) + (클라 재집계)**  
> 네트워크만 느린 게 아니라 **같은 일을 여러 번** 한다.

---

## 3. 코드 쪽 원인 맵

| # | 원인 | 주요 위치 | HAR 대응 |
|---|------|-----------|----------|
| A | 통합 탭이 detail 전량을 **await** | `useSalesData.js` → `ensureDashboardReady` | records 19p |
| B | detail 캐시 무효/재진입 시 **전체 재페이지** | `ensureDetailCache`, `loadDetailCache` | 3회 반복 |
| C | 필터·스코프 watch가 KPI를 **연발** | `SalesDataView.vue` deep watch → `reloadServerKpi` | KPI 60회 |
| D | 서버 KPI 후에도 **클라 스냅샷 재집계** | `syncDashboardKpiSnapshot`, `buildCombinedKpiSplitRows` | 숫자 재계산·메인스레드 |
| E | detail에 `include_data=true` 전량 JSON | records API / 클라이언트 fetch | 페이지당 850KB |
| F | 설정 blob 대용량 반복 hydrate | `own_mall_manual` 등 | 613KB ×3 |
| G | 엑셀 export가 전량 재조립 | `dashboardExporter.js`, ExcelJS | (HAR 외, 체감 정지) |

---

## 4. 목표 상태 (Done 기준)

| 지표 | 현재(HAR) | 목표 |
|------|-----------|------|
| detail 페이지(동일 세션) | 19p × ~3회 | **1회**만 (캐시 hit 시 0회 네트워크) |
| KPI 4종(탭 1회 진입) | 7~8회 반복 | **각 1회** (디바운스 후) |
| 통합 탭 첫 KPI 표시 | detail 대기 포함 수십 초 | **서버 KPI만으로 &lt; 2~3초** |
| detail 용도 | KPI·표·엑셀 공용 | **표·엑셀·폐쇄몰 세그먼트만** |
| 필터 변경 | KPI/records 폭주 | **디바운스 300~500ms, in-flight 취소** |
| 화면 KPI 소스 | 서버 → 클라 덮어쓰기 혼재 | **서버 KPI 단일 소스** (예외 최소화) |

---

## 5. 수정 로드맵 (Phase)

### Phase 0 — 측정 고정 (0.5일, 코드 최소)

수정 전에 재현·비교 기준을 남긴다.

- [ ] 통합 일별/월별, 베스트하임 각각 HAR 1회씩 저장
- [ ] `sales_records` detail 총 건수 기록 (NAS/로컬)
- [ ] “첫 페인트까지 초”, “records 마지막 page 완료 초”, “KPI 호출 횟수” 표로 남김
- [ ] 수정 후 같은 시나리오로 HAR 비교

**완료:** Before 숫자표가 문서/이슈에 있다.

---

### Phase 1 — 요청 폭주 차단 (최우선, 1~2일)

HAR상 **가장 ROI 큼**. KPI를 줄이면 체감이 바로 좋아진다.

#### 1-1. KPI 디바운스 + in-flight 가드

- `SalesDataView`의 `manualFilterCtx` / scope deep watch → `reloadServerKpi`에  
  **디바운스(권장 300~500ms)** + **이전 AbortController 취소**
- 동일 `(scope, from, to, …)` 키면 **캐시된 결과 재사용** (메모리 TTL 30~60초)
- 탭 전환 시 이전 scope 요청이 완료돼도 **UI에 적용하지 않기** (stale 응답 무시)

**완료 기준:** 기간을 연속 클릭해도 KPI 4종이 **버스트 1세트**만 나감.

#### 1-2. detail 중복 로드 방지

- `ensureDetailCache` / `loadDetailCache`에 **single-flight** (진행 중이면 동일 Promise 공유)
- `detailCacheLoaded === true`이면 재호출 금지 (강제 refresh 플래그만 예외)
- 업로드 후 refresh도 “전체 19p 무조건”이 아니라 **무효화 후 1회만**

**완료 기준:** 한 세션에서 detail 19p가 **최대 1라운드**.

#### 1-3. settings hydrate 중복 제거

- `own_mall_manual` 등 대용량 settings는 scope별 **1회 hydrate** 후 메모리 유지
- 탭 전환마다 재GET 하지 않기 (버전/etag 또는 dirty 플래그)

**완료 기준:** HAR에서 동일 settings URL이 탭 이동마다 반복되지 않음.

---

### Phase 2 — 화면 KPI = 서버 단일 소스 (구조, 3~5일)

[kpi-excel-delay-guide.md](./kpi-excel-delay-guide.md)의 **A안**. 렉·지연을 동시에 줄이는 본게임.

#### 2-1. 통합 탭도 detail await 제거

현재:

```text
ensureDashboardReady(combined)
  → loadServerKpi
  → await ensureDetailCache()   ← 여기가 통합 렉의 직접 원인
  → loadRecordsForScope
```

목표:

```text
ensureDashboardReady(combined)
  → loadServerKpi (+ 수기 settings merge)
  → 화면 KPI 표시
  → detail은 백그라운드 또는 “판매데이터/엑셀/폐쇄몰 표” 필요 시만
```

예외로 detail이 **당장** 필요한 것:

- 기타·폐쇄몰 판매처 행이 **서버 KPI에 아직 없으면** → 서버 API에 넣거나, 해당 블록만 lazy
- 판매 데이터 표 펼침
- 엑셀 다운로드

#### 2-2. `syncDashboardKpiSnapshot`이 서버 KPI를 덮지 않게

- detail 도착 후 클라 `buildCombinedKpiSplitRows`로 **합계 KPI를 덮어쓰는 경로** 제거/가드
- 클라 재집계는 “서버에 없는 보조 표”에만 사용

**완료 기준:** detail Network 전·후 **KPI 숫자 동일**.  
(이게 깨지면 서버 KPI 커버리지부터 채움 — Phase 3)

#### 2-3. UX (단기 보조)

- `detailCacheLoading`일 때 “상세 반영 중…” / 다운로드 대기
- stale KPI 표시(회색) 후 최종값 확정

---

### Phase 3 — API·payload 다이어트 (2~4일)

요청 횟수를 줄인 뒤, **1회 비용**을 줄인다.

#### 3-1. records payload

| 개선 | 설명 |
|------|------|
| 대시보드용 lean 필드 | `include_data=false` 또는 필수 컬럼만 |
| scope/기간 필터를 API에 | 전체 9천 행 대신 **조회 구간만** |
| limit 조정 | 500→1000은 페이지 수↓ / 메모리↑ 트레이드오프 — lean과 함께 측정 |

#### 3-2. KPI API

| 개선 | 설명 |
|------|------|
| `compare-yesterday` 최적화 | HAR 최다 지연 — 쿼리·인덱스·캐시 점검 |
| 서버 캐시 TTL | 동일 필터 60초 내 재사용 |
| 통합 scope 전용 엔드포인트 | 클라이언트가 platform+combined를 이중으로 치지 않게 |

#### 3-3. settings

| 개선 | 설명 |
|------|------|
| own_mall 분할/압축 | 613KB 단일 blob 지양 |
| 기간 슬라이스 API | 대시보드에 필요한 날짜만 |

---

### Phase 4 — 메인 스레드·UX (병행 가능, 2~3일)

네트워크가 줄어도 **JSON 파싱·표·엑셀**이 남는다.

| 항목 | 가이드 |
|------|--------|
| 가상 스크롤 | 판매표는 유지·강화 (`VirtualScrollTableBody`) |
| 무거운 computed 분리 | 필터 debounce 후에도 불필요 재계산 없는지 프로파일 |
| 엑셀 export | 가능하면 **서버 export**만 (이미 PG export 경로 있음) — 클라 ExcelJS는 fallback |
| 업로드 파싱 | Web Worker 또는 서버 파싱 (대용량 빅셀) |

---

## 6. 권장 작업 순서 (한 눈에)

```text
Phase 0 측정
    ↓
Phase 1 폭주 차단 (KPI debounce + detail single-flight + settings 1회)
    ↓  ← 여기만 해도 HAR 60 KPI / 3×19p 가 크게 줄어듦
Phase 2 통합 KPI 서버 단일 소스 (detail await 제거)
    ↓
Phase 3 payload·느린 KPI 쿼리 최적화
    ↓
Phase 4 메인스레드·export
```

**하지 말 것**

- detail을 “무조건 먼저 await”로 되돌려 렉을 키우기 (B안만 단독)
- 서버 KPI + 클라 덮어쓰기를 둘 다 화면 소스로 유지한 채 debounce만 하기
- Phase 3(쿼리 튜닝)만 하고 Phase 1(중복 호출)을 건너뛰기

---

## 7. 파일별 착수 체크리스트

### Phase 1

- [ ] `src/composables/useSalesData.js` — `ensureDetailCache` single-flight, refresh 플래그
- [ ] `src/composables/useSalesData.js` — `loadServerKpiForScope` Abort + 결과 키 캐시
- [ ] `src/components/SalesDataView.vue` — KPI reload debounce, stale 가드
- [ ] settings hydrate (`hydrateAppSettings` / `useOwnMallManual` 등) — 중복 GET 제거

### Phase 2

- [x] `ensureDashboardReady` — combined에서 `await ensureDetailCache` 제거·조건부화 (`VITE_LAZY_DETAIL_LOAD`)
- [x] `SalesPeriodDashboard` — `serverKpiBucket` 단일 소스 + 합계 서버 패치 (`VITE_SERVER_KPI_ONLY`)
- [x] `loadRecordsForScope` — detail 캐시 재사용 (records 3라운드 방지)
- [ ] 폐쇄몰·특판 행: 서버 KPI 포함 여부 확인 → 미포함 시 API 확장 (detail lazy 후 클라 보조)
- [x] 로딩 UI (`detailCacheLoading` — 대시보드·판매데이터 분리 표시)

### Phase 3

- [x] `backend` records list — `include_data=lean` + `scope` (`upload_kind`)
- [x] 프론트 `loadDetailCache` — lean 기본 (글로벌 detail 캐시에 from/to 미적용)
- [x] `compare-yesterday` — ref/prev 2일 SQL 윈도우; daily/by-platform `kpi_date` 푸시다운
- [x] KPI 응답 캐시 — 프로세스 메모리 60초 TTL + 업로드/설정/records 쓰기 시 invalidate
- [x] own_mall — `omit_sources=1` (base64 제외) + hydrate fallback
- [ ] 통합 KPI 전용 엔드포인트 / limit 1000 실험 (후속)

### Phase 4

- [x] export — 통합 포함 PG `/exports/integrated` 우선, ExcelJS는 실패 시 fallback (`downloadDashboardExport`)
- [x] 가상 스크롤 — threshold 80, 폐쇄몰 미리보기 적용
- [x] 무거운 스냅샷 — 비통합+서버 KPI 시 `syncDashboardKpiSnapshot` 스킵
- [x] 업로드 파싱 — 플랫폼 일/월/기간 Worker 오프로드 (`parseExcelInWorker`)
- [ ] Performance 패널로 long task 남은지 확인 (배포 후 수동)

---

## 8. 검증 시나리오 (수정 후 필수)

1. **하드 새로고침 → 통합 일별**  
   - KPI 4종 각 1회  
   - detail 19p가 0회(불필요) 또는 백그라운드 1라운드만  
   - records에 `include_data=lean` — 페이지당 payload가 full JSONB보다 작음  
2. **기간을 연속 변경**  
   - KPI가 디바운스되어 마지막 기간만 1세트  
   - 60초 내 동일 필터 재조회 시 서버 KPI 캐시 hit(응답 즉시)  
3. **베스트하임 ↔ 통합 탭 왕복**  
   - detail/settings 재폭주 없음  
   - `own_mall_manual` 요청이 omit_sources로 작아짐  
4. **엑셀 업로드 후 KPI**  
   - 최종값이 detail 완료를 기다리지 않고 맞음 (Phase 2 후)  
   - 업로드 직후 KPI 캐시가 무효화되어 새 숫자 반영  
5. **엑셀 다운로드 = 화면 KPI**  
6. 전일대비·플랫폼별 KPI 숫자가 Phase 2와 동일 수준인지 스모크  
7. 새 HAR로 Before/After 표 갱신

---

## 9. 우선순위 요약

| 순위 | 작업 | 기대 효과 |
|------|------|-----------|
| 1 | KPI 중복 호출 차단 | 15~22초급 요청 폭주 제거 |
| 2 | detail 3회 → 1회 | records 26초 구간 대폭 축소 |
| 3 | 통합 detail await 제거 + 서버 KPI 단일화 | 첫 화면 렉 구조적 해결 |
| 4 | records lean / 기간 필터 | 페이지당 850KB·19p 자체 축소 |
| 5 | compare-yesterday·settings blob | 꼬리 지연 제거 |
| 6 | export·파싱 오프로드 | “클릭 시 정지” 완화 |

---

## 10. 한 줄 요약

**지금 렉은 “데이터가 많아서”만이 아니라 “같은 detail·KPI를 여러 번 치고, 통합은 그 detail이 끝나야 화면이 도는” 구조다.**  
먼저 **요청 폭주를 막고**, 이어서 **화면 KPI를 서버만 쓰게** 바꾼 다음, payload·쿼리를 줄이면 된다.
