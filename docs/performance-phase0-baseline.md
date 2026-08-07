# Phase 0 — 성능 Before 측정 (Baseline)

> 측정일: 2026-08-03  
> 근거 HAR: `docs/192.168.0.245.har`  
> 지시서: 성능(렉) 개선 작업 지시서 / `docs/performance-remediation-guide.md`

## 시나리오 (HAR에 포함된 구간)

- NAS `192.168.0.245` 접속
- 기간 `2026-07-27` ~ `2026-08-02`
- `platform` + `combined_daily` KPI 호출이 혼재 (탭 왕복·필터 변경 포함)

## Before 수치

| 항목 | Before |
|------|--------|
| 전체 Network span | **~54초** |
| `/api/v1/records` detail | **57건** |
| detail pagination | **19페이지** (limit 500) |
| detail 반복 라운드 | **~3회** |
| detail 대략 행 수 | **~9,000~9,500** |
| 페이지당 payload | **~850KB** (마지막 ~450KB) |
| KPI 총 호출 | **60건** |
| `platform` KPI 4종 | 각 **8회** |
| `combined_daily` KPI 4종 | 각 **7회** |
| 느린 KPI 응답 | **15~22초** (`compare-yesterday` 등) |
| settings `own_mall_manual` | **~613KB × 3회** |

## Phase 1 목표 (이 문서 대비)

| 항목 | 목표 |
|------|------|
| detail pagination 라운드 | **최대 1** |
| 동일 KPI key 중복 | **제거** (TTL 캐시 + single-flight) |
| 기간 연속 변경 | **마지막 조건만** 요청 |
| settings 동일 URL | 탭 이동만으로 **재호출 없음** |

## After (Phase 1 — HAR 2026-08-03T02:46, `SalesDataView-9Q4G7rIO.js`)

| 항목 | Before | After | 판정 |
|------|--------|-------|------|
| 전체 Network span | ~54초 | **~23초** | ✅ 약 57% 감소 |
| KPI 총 호출 | 60건 | **8건** (platform 4 + combined 4, 각 1회) | ✅ |
| 느린 KPI | 15~22초 | **~3초** | ✅ |
| own_mall 반복 | 3회+ | **0회** (해당 캡처) | ✅ |
| records | 57건 · 19p×3 | **57건 · 19p×3** | ❌ 미개선 |
| Phase 1 JS | — | `SalesDataView-9Q4G7rIO.js` 확인 | ✅ |

### records 3라운드가 남은 이유 (다음 작업)
`ensureDetailCache` single-flight와 별도로 `loadRecordsForScope`가 `activeTab === 'detail'`일 때 `/records`를 **다시 전량 fetch**한다. 통합 진입 시 detail 로드가 겹치면 라운드가 늘어난다 → Phase 2에서 detail 캐시 재사용으로 정리.

## After (Phase 2~4 — HAR 2026-08-03T04:42, `SalesDataView-Mk90oCNZ.js` / `useSalesData-AEkhyRCt.js`)

기간 `2026-07-27` ~ `2026-08-02`, platform + combined_daily.

| 항목 | Before | Phase 1 | Phase 2~4 | 판정 |
|------|--------|---------|-----------|------|
| 전체 Network span | ~54초 | ~23초 | **~6.8초** | ✅ |
| records 건수 / 라운드 | 57 · 19p×3 | 57 · 19p×3 | **19 · 19p×1** | ✅ |
| `include_data` | true (~850KB) | true | **lean** (중앙값 ~461KB, max ~475KB) | ✅ |
| KPI 총 호출 | 60 | 8 | **8** (각 scope×4 1회) | ✅ |
| 느린 KPI wait | 15~22초 | ~3초 | **~0.03~0.17초** (대부분 304) | ✅ |
| own_mall_manual | ~613KB ×3 | — | **~166KB ×1** (`omit_sources=1`) | ✅ |
| Phase JS | — | `9Q4G7rIO` | `Mk90oCNZ` / `AEkhyRCt` | ✅ |

참고: 이번 HAR의 KPI는 status **304**가 많아 브라우저 캐시 hit 비중이 큼. 콜드 로드에서는 wait가 조금 더 길 수 있으나, records 1라운드·lean·omit_sources·번들 해시로 Phase 2~4 배포는 확인됨.
