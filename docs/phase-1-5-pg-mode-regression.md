# Phase 1-5 PG Mode Regression Test

## 1. 목적

Phase 1-4에서 구축한 `VITE_API_MODE=legacy|pg` feature flag가 **실제 화면에서 안전하게 동작하는지** 검증합니다.

- PG 모드를 production 기본값으로 바꾸지 않음 (기본값 `legacy` 유지)
- 데이터·KPI 수치 일치 여부 확인
- PG records 전 페이지 순회 방식의 성능 리스크 기록
- Phase 2 KPI 백엔드 이전 전 회귀 기준선 확보

## 2. 테스트 환경

| 항목 | 값 |
|------|-----|
| 일자 | 2026-07-01 |
| OS | Windows 10 |
| Node | v22 |
| Vue dev | `:5173` (`npm run dev`) |
| Legacy API | `http://localhost:3001/api` (SQLite) |
| PG API | `http://localhost:3002/api/v1` (Docker `essersales-api`) |
| 데이터 규모 | uploads **153**, detail records **4,350** |
| 자동 검증 | `node infra/scripts/phase-1-5-regression.mjs` |

### env 설정

```env
# legacy 테스트
VITE_API_MODE=legacy

# pg 테스트 (dev 서버 재시작 필수)
VITE_API_MODE=pg
```

## 3. legacy 모드 확인 결과

| 항목 | 결과 |
|------|------|
| Vue `:5173` 실행 | 정상 (`npm run dev`) |
| API 호출 대상 | `:3001` |
| 업로드 이력 | 153건 표시 |
| detail records | 4,350건, 단일 요청 ~200–440ms |
| 총 매출 합계 | 291,737,783원 |
| 판매 수량 합계 | 8,304 |
| settings hydrate | 9 scope/kind 전부 로드 |
| 대시보드 KPI | `esserMetrics` + `platformKpiSplit` 클라이언트 계산 |
| 광고비 수기 입력 | settings `manual_ad` — legacy API |
| 파워프라이스 / 1P / 자사몰 수기 | settings 기반 — legacy API |
| 일별/채널/상품 탭 | detail에서 `buildSummaryTabFromDetails` 집계 |

**판정: PASS** — 기준선(baseline) 정상.

## 4. pg 모드 확인 결과

| 항목 | 결과 |
|------|------|
| Vue `:5173` 실행 | 정상 (env 변경 후 재시작) |
| API 호출 대상 | `:3002/api/v1` |
| DEV 배지 | `API MODE: PG` (+ 마지막 fetch ms, Phase 1-5) |
| 업로드 이력 | 153건 — legacy와 ID·건수 일치 |
| detail records | 4,350건 — 9회 페이징, ~480–990ms |
| 총 매출 / 수량 | legacy와 **완전 일치** |
| PG KPI summary API | sales 291,737,783 / qty 8,304 — 일치 |
| settings hydrate | 9건 전부 legacy와 data 일치 |
| 광고비·파워프라이스·1P·자사몰 | settings 조회 PG 경유, 저장은 legacy |
| 대시보드 KPI | detail 캐시 로드 후 **동일 클라이언트 계산** |
| daily/channel/product/productOption API | PG 0건 (SQLite도 detail만 저장) → detail 집계로 표시 |

**판정: PASS** — 읽기 데이터 parity 확인. KPI 표시는 legacy와 동일 로직.

## 5. 화면별 비교표

| 화면/기능 | legacy | pg | 일치 |
|-----------|--------|-----|------|
| 대시보드 총 매출 | 클라이언트 집계 | 동일 (detail 4,350건) | ✅ |
| 판매 수량 | 클라이언트 집계 | 동일 | ✅ |
| 업로드 이력 | 153건 | 153건 | ✅ |
| records 상세 목록 | 4,350건 | 4,350건 | ✅ |
| settings hydrate | 9건 | 9건 | ✅ |
| 광고비 수기 입력 표시 | settings | settings (PG 조회) | ✅ |
| 파워프라이스 패널 | settings + detail merge | 동일 | ✅ |
| 쿠팡 1P 패널 | settings + detail merge | 동일 | ✅ |
| 자사몰 수기 데이터 | settings + detail merge | 동일 | ✅ |
| 일별 탭 | detail → `buildDailySummary` / `esserBuckets` | 동일 | ✅ |
| 채널별 탭 | detail → `aggregateDetailsByChannel` | 동일 | ✅ |
| 상품별 탭 | detail → `aggregateDetailsByProductOption` | 동일 | ✅ |
| 플랫폼 KPI 분리 표 | `platformKpiSplit` | 동일 | ✅ |
| 전일 대비 | `dayOverDaySales` | 동일 | ✅ |
| 엑셀 export KPI | 클라이언트 | legacy (미전환) | ✅ (의도적) |

## 6. 일치하는 항목

- uploads 건수·ID (153)
- detail records 건수·ID (4,350)
- 레코드별 `sales`, `salesQty`, `platform`, `brand` 필드 (4,350건 전수 비교 0 차이)
- KPI 합계 매출·수량 (291,737,783 / 8,304)
- `GET /api/v1/kpi/summary` vs legacy records 합산
- app_settings 9건 data 내용
- 대시보드·탭 표시 로직 (동일 detail 캐시 + 동일 utils)

## 7. 차이가 있는 항목

| 차이 | 설명 | 화면 영향 |
|------|------|-----------|
| API 요청 수 | legacy 1회 vs PG 9회(detail) | PG 초기 로드 ~2× 느림 (체감 0.5–1초) |
| 페이로드 크기 | legacy 4.38MB vs PG 4.39MB | 거의 동일 |
| Network 호스트 | `:3001` vs `:3002` | 개발자 도구에서만 확인 |
| DEV 배지 | PG 모드 + fetch ms 표시 | 개발 환경만 |
| `fetchKpiSummary` | legacy null / PG API 사용 가능 | 대시보드는 아직 클라이언트 KPI 사용 |

**기능·수치 불일치 없음.**

## 8. 데이터가 비어 보이는 항목

| 항목 | 원인 | 대응 |
|------|------|------|
| PG `record_type=daily/channel/product/productOption` | DB에 detail만 저장 (legacy 동일) | `useSalesData`가 detail에서 탭 집계 — **정상** |
| 필터 적용 시 0건 | 기간·플랫폼 필터 (legacy/pg 동일) | 사용자 필터 확인 |
| PG API 미기동 시 | `:3002` 연결 실패 | `docker compose up -d api` |

비어 보이는 탭 이슈 **없음** (현재 데이터 기준).

## 9. 성능 이슈

### 측정 결과 (4,350건 기준)

| 지표 | legacy | pg |
|------|--------|-----|
| detail records 로드 | ~200–440ms, **1 req** | ~480–990ms, **9 req** |
| uploads 로드 | ~4–12ms, 1 req | ~12ms, 1 req |
| 대시보드 진입 시뮬 (5 record types) | ~1 req (detail만 유효) | **~13 req**, ~450–820ms |
| JSON payload (detail) | ~4.38 MB | ~4.39 MB |
| PG/legacy 속도 비율 | 1× | **~2.0–2.3×** |

### 10만 건 이상 예상 리스크

| 지표 | 10,000건 | 100,000건 |
|------|----------|-----------|
| detail 페이징 요청 | 20회 | 200회 |
| 대시보드 진입 요청 | ~24회 | ~204회 |
| 예상 로드 시간 | ~2초 | **~11–22초** |
| 예상 JSON 크기 | ~10 MB | **~100–147 MB** |
| 브라우저 메모리 | 수십 MB | **100MB+** (전체 records 상주) |

### 개선 방향 (Phase 2+)

1. **대시보드 KPI** → `/api/v1/kpi/summary` 및 확장 API 사용 (records 전량 로드 제거)
2. **상세 테이블** → `/api/v1/records` 페이지네이션 (화면에 보이는 페이지만)
3. **차트** → `/api/v1/kpi/daily` 등 차트 전용 집계 API
4. **refreshAll** → record type 5회 순회 제거 (detail 1회 + 서버 집계)
5. **include_data** → 목록은 컬럼만, 상세 행 클릭 시 단건 조회

### 개발용 관찰 도구

- `src/services/devApiStats.js` — PG fetch ms/요청 수 기록
- `App.vue` DEV 배지 — 마지막 PG fetch 소요 시간 표시
- `node infra/scripts/phase-1-5-regression.mjs` — 자동 비교·벤치마크

## 10. Phase 2 전환 가능 여부

| 영역 | 전환 가능 | 조건 |
|------|-----------|------|
| 읽기 데이터 (uploads/records/settings) | ✅ 가능 | 현재 parity 확인됨 |
| 대시보드 KPI 표시 | ⚠️ 부분 | KPI API 구현 후 클라이언트 집계 대체 |
| 상세 테이블 | ⚠️ 부분 | 서버 페이지네이션 + 필터 연동 필요 |
| 쓰기 (업로드·저장·삭제) | ❌ Phase 2+ | PG 쓰기 API 미구현 |
| export | ❌ Phase 3+ | 클라이언트 KPI 의존 |
| production 기본값 PG | ❌ 보류 | KPI API·성능 개선 후 |

**결론:** PG 모드는 **현재 데이터 규모에서 화면 회귀 PASS**. Phase 2에서는 KPI 백엔드 이전과 records 전량 로드 제거를 **우선** 진행한 뒤 PG 기본값 전환을 검토합니다.

---

### 검증 실행 방법

```bash
# API·데이터 자동 비교
node infra/scripts/phase-1-5-regression.mjs

# JSON 리포트
node infra/scripts/phase-1-5-regression.mjs --json

# 수동 화면 확인
# 1. VITE_API_MODE=legacy → npm run dev → 대시보드·업로드 확인
# 2. VITE_API_MODE=pg     → npm run dev 재시작 → 동일 화면 비교
```
