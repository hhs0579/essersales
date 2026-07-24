# KPI에 엑셀 업로드 값이 늦게 뜨는 이슈 — 해결 가이드

> **목적:** 증상·원인·해결 방향만 정리한다. **이 문서는 코드 수정을 포함하지 않는다.**  
> 관련 코드: `src/composables/useSalesData.js`, KPI API (`/api/v1/kpi/*`), `/api/v1/records`  
> 참고: [phase-2-3-lazy-detail-manual-ads.md](./phase-2-3-lazy-detail-manual-ads.md)

---

## 1. 증상

| 관찰 | 설명 |
|------|------|
| 대시보드 첫 화면 | KPI 카드·플랫폼 표가 **먼저** 뜬다 |
| 엑셀로 올린 매출 | **수 초~수십 초 뒤**에 KPI/합계가 바뀌거나 채워진다 |
| 수기 입력(파워프라이스·수동광고 등) | 상대적으로 **빨리** 보이거나, 엑셀보다 먼저 합쳐져 보인다 |
| 통합 탭 | 특히 체감이 크다 (detail 행 수가 많음, ~수천 건) |

사용자가 느끼는 “엑셀 값이 늦게 뜬다”는 **버그라기보다 현재 로딩 순서의 결과**다.

---

## 2. 현재 데이터 흐름 (원인)

운영 모드는 `VITE_KPI_SOURCE=server` + PG API다.

```text
대시보드 진입
    │
    ├─① KPI API 4종 (빠름) ──────────────► 화면 KPI 표시
    │     /kpi/summary
    │     /kpi/daily
    │     /kpi/by-platform
    │     /kpi/compare-yesterday
    │     + app_settings 수기 merge
    │
    └─② 상세 records 백그라운드 로드 ──► 엑셀 행이 클라이언트에 도착한 뒤
          /records?record_type=detail        KPI 스냅샷 재계산·보강
          (500건씩 여러 페이지)
          requestIdleCallback / setTimeout
```

### 왜 엑셀만 늦게 보이나

| 데이터 | 저장 위치 | 대시보드에서 쓰이는 경로 |
|--------|-----------|--------------------------|
| 플랫폼 엑셀 업로드 | PostgreSQL `sales_records` / `uploads` | ① KPI API **또는** ② detail 전량 로드 후 클라이언트 집계 |
| 수기(파워프라이스·수동광고·1P 등) | `app_settings` (± localStorage) | KPI 직후 **settings merge**로 빨리 붙음 |

엑셀 본문 숫자는 **detail 페이지네이션이 끝나야** 브라우저에 전부 있고, 통합 탭 등은 detail이 채워진 뒤 스냅샷을 다시 맞추는 구간이 있어 “갑자기 숫자가 바뀌는” 느낌이 난다.

렉을 줄이려고 KPI를 먼저 띄우고 detail을 뒤로 미룬 설계(Phase 2-3 계열)가 **지연의 직접 원인**이다.

---

## 3. 해결 전에 확인할 것 (코드 없이)

1. **Network**  
   - 진입 직후: `/api/v1/kpi/*` 응답 시간과 payload  
   - 이후: `/api/v1/records?...record_type=detail` 가 **여러 번**(page=1,2,…) 도는지, 총 소요 시간  
2. **건수**  
   - NAS DB: `sales_records` 에서 `platform_daily` / `sales_daily_b` 건수  
   - 건수가 클수록 ②가 길어진다  
3. **어느 UI가 늦게 채워지는지**  
   - KPI 카드만 / 브랜드·플랫폼 split 표 / 엑셀 다운로드 직전  
4. **업로드 직후인지, 탭 재진입인지**  
   - 업로드 직후면 서버 KPI 캐시·클라이언트 detail 캐시 무효화 타이밍도 겹칠 수 있다  

---

## 4. 해결 방향 (옵션)

공통 목표: **“첫 페인트에 보이는 KPI”와 “엑셀이 반영된 최종 KPI”의 간극을 없애거나, 간극이 있어도 사용자가 기다리는지 알 수 있게 한다.**

### A. 서버 KPI만으로 완성한다 (권장 — 구조적으로 맞음)

**요지:** 화면에 보이는 KPI가 **항상** `/kpi/*` 결과(+수기 merge)만 쓰게 하고, detail 전량 로드는 **판매 데이터 표·엑셀 생성**에만 쓴다.

| 장점 | 단점 |
|------|------|
| 엑셀 값이 “늦게 채워지는” 현상 자체가 사라짐 (첫 응답 = 최종) | KPI API가 엑셀 집계를 **완전히** 커버하는지 검증 필요 |
| 화면이 detail 완료를 기다리지 않음 | 통합·특판·수기 merge 규칙을 API와 클라이언트에서 **동일**하게 맞춰야 함 |
| 렉과 지연을 동시에 완화하기 좋음 | API/집계 버그는 즉시 화면에 노출 |

**작업 가이드 (구현 시):**

1. 통합·베스트하임·사본느리·월별에서 **대시보드 KPI 소스가 서버 bucket/rows만인지** 추적  
2. detail 로드 후 `syncDashboardKpiSnapshot` 등으로 **서버 KPI를 클라이언트 재집계로 덮어쓰는 경로**가 있으면 제거·가드  
3. “엑셀 업로드 직후 KPI”는 `refreshAfterUpload` → `loadServerKpiForScope` 만으로 충분한지 스모크  
4. 판매데이터 펼침·엑셀 다운로드만 `ensureDetailCache` 유지  

**완료 기준:** detail Network가 끝나기 전·후 KPI 숫자가 **동일**.

---

### B. detail을 KPI보다 먼저(또는 동시에) 끝낸다

**요지:** `ensureDashboardReady`에서 KPI와 무관하게 **detail을 await**하거나, idle 지연 없이 **즉시** 로드한 뒤 KPI를 그린다.

| 장점 | 단점 |
|------|------|
| 클라이언트 집계 경로를 유지해도 “늦게 뜸”이 줄어듦 | 통합 탭처럼 수천 행이면 **첫 화면 렉·백지**가 다시 커짐 |
| 구현이 단순 | Phase 2-3의 “빠른 KPI” 목적과 충돌 |

**작업 가이드:**  
`loadDetailInBackground` / `requestIdleCallback` 제거 여부, KPI 표시 전 `ensureDetailCache` await 여부를 제품(렉 허용 한도)과 합의 후 결정.

**완료 기준:** KPI 첫 표시 시점에 이미 detail 로드 완료(또는 로딩 오버레이가 KPI와 같이 끝날 때까지 유지).

---

### C. UX로 간극을 명시한다 (단기·보조)

**요지:** 느린 로드를 없애기보다, “집계 중 / 엑셀 반영 전”을 보여 준다.

| 예시 | 효과 |
|------|------|
| KPI 영역에 `상세 반영 중…` (detailCacheLoading) | “빈 값 → 갑자기 채워짐” 혼란 감소 |
| detail 완료 전 엑셀 다운로드 비활성 또는 대기 | 다운로드 직전에 숫자가 바뀌는 사고 감소 |
| 스켈레톤 / stale 표시 | 최종값 도착을 예측 가능하게 |

A 또는 B와 **함께** 쓰기 좋다. C만으로는 대기 시간은 남는다.

---

## 5. 권장 결정

| 우선순위 | 선택 | 이유 |
|----------|------|------|
| 1 | **A. 서버 KPI = 화면 KPI 단일 소스** | 지연·렉·이중 집계를 한 번에 줄임 |
| 2 | **C. 로딩/반영 중 UI** | A 작업 중·예외 경로 완화 |
| 3 | B | A가 어렵고 렉을 감수할 때만 |

렉을 줄이면서 “엑셀이 늦게 뜸”만 없애려면 **A가 맞고**, B로 돌아가면 예전에 겪은 30초급 렉이 다시 올 수 있다.

---

## 6. 구현 착수 전 체크리스트

- [ ] 문제 재현 탭: 통합 / 베스트하임 / 사본느리 / 월별 중 어디인지  
- [ ] “늦게 뜨는” 지표: 매출·광고매출·ROAS·플랫폼 split 행 등  
- [ ] Network에서 KPI 완료 시각 vs records 마지막 페이지 완료 시각  
- [ ] 서버 KPI만으로도 엑셀 업로드 건수가 맞는지 (업로드 전/후 summary 비교)  
- [ ] detail 로드 전후 KPI diff가 있는지 (있으면 A의 대상)  
- [ ] NAS `sales_records` 건수·페이지 수(limit 500) 대략치  

---

## 7. 검증 시나리오 (수정 후)

1. 하드 새로고침 → KPI가 **한 번에** 최종값으로 보이는지 (중간에 숫자가 뛰지 않는지)  
2. 엑셀 업로드 → 대시보드 재진입 → 업로드분 반영 시간  
3. 판매데이터는 접힌 채로도 KPI가 완전한지  
4. 엑셀 다운로드 숫자 = 화면 KPI  
5. 통합 탭에서 렉이 이전 수준으로 악화되지 않았는지  

---

## 8. 하지 말 것

- detail 전량 로드를 “무조건 먼저 await”만 하고 성능 기준 없이 배포 (B를 검증 없이 A 대신 쓰기)  
- 서버 KPI와 클라이언트 재집계를 **둘 다** 화면 소스로 유지한 채 idle만 조정 (지연은 남고 원인만 흐려짐)  
- NAS `dist`만 덮고 경로/`grep index-*.js` 확인 없이 “안 바뀜”으로 판단 (배포 이슈와 로딩 이슈 혼동)

---

## 9. 관련 위치 (구현 시 참고만)

| 구분 | 위치 |
|------|------|
| 대시보드 ready / 백그라운드 detail | `useSalesData.js` → `ensureDashboardReady`, `loadDetailInBackground` |
| 서버 KPI 로드·수기 merge | `loadServerKpiForScope` |
| detail 캐시 | `ensureDetailCache`, `fetchSalesRecords('detail')` |
| 화면 KPI 스냅샷 | `SalesDataView.vue` → `syncDashboardKpiSnapshot` 등 |
| 설계 원안 | `docs/phase-2-3-lazy-detail-manual-ads.md` |

---

## 10. 한 줄 요약

엑셀 값이 늦게 뜨는 이유는 **KPI API를 먼저 그리고, 엑셀 본문(detail)은 뒤에서 받기 때문**이다.  
근본 해결은 **화면에 보이는 KPI를 서버 KPI로 통일(A)** 하는 것이고, detail은 표·다운로드용으로만 쓰며, 그전엔 **반영 중 UI(C)** 로 간극을 드러내는 것이 안전하다.
