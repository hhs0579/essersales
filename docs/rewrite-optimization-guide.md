# essersales 재설계·최적화 가이드

> **목적:** “기능을 얹고 얹은” 현재 구조를 정리하고, **기능은 유지**한 채 구조를 갈아엎을 때의 원칙·범위·순서를 고정한다.  
> **이 문서는 가이드다. 작성만으로 코드가 바뀌지 않는다.**  
> 기준일: 2026-08 · 스택: Vue 3 + Express/PG + NAS Docker  
> **기능 동결:** R1(서버 by-segment) 골든 통과 전까지 신규 비즈니스 기능 추가 금지. 버그픽스·숫자 회귀만 허용.  
> 골든 체크리스트: [golden/checklist.md](./golden/checklist.md)

관련 문서:

- [target-architecture.md](./target-architecture.md) — 원래 목표 아키텍처 (Vue=표시, 서버=집계)
- [performance-remediation-guide.md](./performance-remediation-guide.md) — 성능 Phase 로드맵
- [excel-export-column-dictionary.md](./excel-export-column-dictionary.md) — 엑셀 컬럼 계약
- [combined-comments-concurrency-guide.md](./combined-comments-concurrency-guide.md) — 코멘트 동시 저장
- [golden/checklist.md](./golden/checklist.md) — G1–G8 골든 숫자

---

## 0. 한 줄 진단

| 질문 | 답 |
|------|-----|
| 왜 복잡한가? | PG 이전 + 서버 KPI + lazy detail + 클라 세그먼트/엑셀 폴백이 **동시에** 살아 있음 |
| 목표와 거리는? | `target-architecture`는 “Vue는 표시만”인데, 현실은 **하이브리드** |
| 갈아엎을 때 지켜야 할 것? | **화면 기능·숫자 계약** (탭·세그먼트·수기·엑셀 양식) |
| 추천 방식? | 빅뱅 폐기 ❌ → **기능을 고정한 채 레이어를 하나씩 옮기는 교체(Strangler)** |

---

## 1. 현재 상태 분석

### 1.1 스택 (실제로 쓰는 것)

| 층 | 기술 | 진입점 |
|----|------|--------|
| Frontend | Vue 3.5 + Vite 6 | `src/main.js` → `App.vue` |
| Backend | Express (`backend/`) | `backend/src/index.js` |
| DB | PostgreSQL 16 | `infra/db/*.sql` |
| NAS | `docker-compose.nas.yml` + nginx `dist/` | `:8080` |

> `docs/current-structure.md`는 SQLite 시대 서술이 남아 있어 **정본으로 쓰지 말 것.**

### 1.2 유저 기능 인벤토리 (유지 대상)

| 영역 | 내용 |
|------|------|
| 업로드 | 베스트하임/사본느리 일·월 엑셀, 특판·폐쇄몰 엑셀 |
| 수기 | 외부광고(Meta/GFA/AD/구글), 파워프라이스, 쿠팡 1P, 자사몰, 특판 |
| 대시보드 | 채널별 일·월 KPI, 차트, 판매내역 표, 전일·전주·전월 대비 |
| 통합 | 브랜드 세그먼트 표 + 합계 + 통합 손익 엑셀 |
| 통합코멘트 | 날짜별 **5칸** (베스트하임·사본느리·파워프라이스·**폐쇄몰**·마케팅) |
| 배포 | NAS Compose, `deploy-to-nas.ps1` |

### 1.3 데이터 흐름 (지금)

```text
엑셀/수기
  → (대부분) 브라우저 파싱 또는 settings JSON
  → PG uploads / sales_records / app_settings
       ├─ GET /kpi/*          → 상단 KPI·일부 표 (서버)
       ├─ GET /records        → detail 전역 캐시 → 클라 scope·기간 필터
       │                         → 통합 브랜드 세그먼트 재집계
       └─ GET|POST /exports/* → 통합 엑셀 (서버 우선, 실패 시 클라 ExcelJS)
```

**핵심 문제:** 같은 숫자가 **서버 KPI**와 **클라 detail 재집계** 두 곳에서 나올 수 있다.  
성능 패치·lean/full·합계 패치가 겹치면서 “이전과 숫자가 다르다” 이슈가 반복됐다.

### 1.4 복잡도 핫스팟 (줄 수 대략)

| 줄 수 | 파일 | 역할 |
|------:|------|------|
| ~1470 | `src/composables/useSalesData.js` | 전역 캐시·KPI·업로드·export 허브 |
| ~1390 | `src/utils/dashboardExporter.js` | 엑셀 조립 |
| ~1340 | `src/components/SalesDataView.vue` | 대시보드 화면 거의 전부 |
| ~1330 | `src/utils/excelWorkbookStyle.js` | 엑셀 스타일 |
| ~920 | `OwnMallManualPanel.vue` | 자사몰 UI |
| ~850 | `profitLossReportExporter.js` | 통합 손익 리포트 |
| ~575 | `platformKpiSplit.js` | 세그먼트 KPI |

한 composable·한 뷰가 **너무 많은 책임**을 진다 → 기능 추가가 전부 여기로 몰린다.

### 1.5 “추가추가”가 생긴 구조적 이유

1. **이중 진실 소스** — 서버 KPI vs 클라 `buildCombined*` / `syncDashboardKpiSnapshot`
2. **전역 detail 캐시** — scope·기간 없이 전량 로드 후 클라 필터 (통합이 특히 무거움)
3. **설정 JSON 비대화** — 자사몰·파워·광고·코멘트가 `app_settings` 한 덩어리
4. **플래그 누적** — `VITE_SERVER_KPI_ONLY`, `VITE_LAZY_DETAIL_LOAD`, lean/full 이 코드와 문서가 어긋남
5. **표시용 정규화가 원본을 덮음** — 예: 스토어명 `에쎄르`→`사본느리` (이미 수정했으나 같은 패턴 잔존 가능)
6. **문서 분열** — Phase 0~5 + 성능 가이드 + 구 current-structure 혼재

### 1.6 성능 (이미 측정된 것)

| 지표 | Before (HAR) | Phase 개선 후(문서) |
|------|--------------|---------------------|
| Network span | ~54초 | ~6.8초 |
| detail 중복 | 19p × 3 | 19p × 1 |
| KPI 호출 | ~60 | ~8 |

**남은 병목:** 통합 세그먼트 클라 재집계, detail `full` 페이로드, 엑셀 폴백 ExcelJS, 자사몰 settings 용량.

---

## 2. 재설계 원칙 (절대 규칙)

### 2.1 기능 동결 (Freeze)

재작성 기간 동안 **새 비즈니스 기능 추가 금지**.  
버그픽스·숫자 회귀만 허용. UI 카피/스타일 소소한 수정은 OK.

### 2.2 숫자 계약 (Golden Numbers)

갈아엎기의 합격 기준은 “코드가 예뻐짐”이 아니라 **동일 기간·동일 필터에서 숫자가 같음**.

필수 골든 케이스 (예시 — 실제 날짜는 NAS 실데이터로 채움):

| ID | 탭 | 검증 |
|----|-----|------|
| G1 | 베스트하임 일별 | 합계 매출·마진·광고비·원가 |
| G2 | 사본느리 일별 | 동일 + 자사몰 반영 |
| G3 | 파워프라이스 | 수수료 7% 반영 KPI |
| G4 | 쿠팡 1P | 로켓 세그먼트/베스트하임 쿠팡 합산 |
| G5 | 기타 판매처 | 판매처별 행 |
| G6 | 통합 | 세그먼트별 매출·합계 = 행 합 (이중계상 없음) |
| G7 | 통합 엑셀 | ①요약리포트 레이아웃 + 담당 코멘트 5칸·일자별 |
| G8 | 통합코멘트 | 5칸 저장/조회, 레거시 4칸 마이그레이션 |

각 케이스마다 **Before 스크린샷/엑셀 스냅샷**을 `docs/golden/`에 고정한다.

### 2.3 단일 진실 소스 (Single Source of Truth)

| 데이터 | 정본 |
|--------|------|
| 화면 상단 KPI·세그먼트 표·전일대비 | **서버 `/kpi/*`만** |
| 판매 내역 표 | 서버 `/records` (scope+기간 쿼리) |
| 통합/채널 엑셀 | **서버 export만** (클라 ExcelJS 제거 목표) |
| 수기(광고·PP·1P·자사몰·코멘트) | `app_settings` (또는 정규 테이블로 이전) |
| 파싱·판매방식·플랫폼 판별 | **백엔드만** |

Vue는 **표시·입력·업로드 트리거**만. 재집계 금지.

### 2.4 깨면 안 되는 비즈니스 규칙

`src/config/*` + `combinedKpiSegments.js`를 계약으로 본다.

- 통합 세그먼트: BH(판매자+그로스/로켓/스스), SBN(판매자+그로스/스스/자사몰), 파워, 동적 폐쇄몰 행
- 수동광고 채널: Meta / GFA / AD / 구글 트래픽
- 폐쇄몰: 에쎄르·베스트하임, `특판 폐쇄몰`
- 파워프라이스 수수료 **7%**, 자사몰 카드 **3.3%**
- 1P 로켓 → 베스트하임 로켓/쿠팡 KPI
- 통합코멘트 5칸 + 레거시 4칸 마이그레이션
- 엑셀 양식 버전 (`INTEGRATED_REPORT_LAYOUT_VER` 등)

---

## 3. 목표 아키텍처 (간단히)

`target-architecture.md`와 동일 방향. 재작성 후 모습:

```text
┌──────────────────────────────────────────┐
│ Vue                                       │
│  탭·필터·차트·표·수기 폼                   │
│  API 응답을 그대로 렌더 (재계산 없음)       │
│  파일 선택 → multipart 업로드              │
│  엑셀 = API Blob 저장                      │
└──────────────────┬───────────────────────┘
                   │ JSON / multipart
┌──────────────────▼───────────────────────┐
│ Backend                                   │
│  파싱 · 정규화 · KPI/세그먼트 · Export     │
│  캐시(TTL) · scope/기간 SQL                │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│ PostgreSQL                                │
│  uploads · sales_records · settings       │
└──────────────────────────────────────────┘
```

### 3.1 프론트 모듈 분해 (useSalesData 해체)

| 모듈 | 책임 |
|------|------|
| `useUploads` | 업로드 목록·선택 |
| `useServerKpi` | KPI API + TTL/Abort |
| `useRecordsQuery` | 기간·scope 페이지 records (표용) |
| `useManualSettings` | 광고/PP/1P/자사몰/코멘트 |
| `useExport` | export API만 |
| `SalesDataView` | 레이아웃·필터 UI만 (비즈니스 계산 없음) |

### 3.2 백엔드 API 계약 확장

| API | 역할 |
|-----|------|
| `GET /kpi/summary` 등 | 유지 + **통합 by-segment** 추가 |
| `GET /kpi/by-segment?scope=combined_*` | 브랜드 세그먼트 표 (클라 `buildCombined` 대체) |
| `GET /records` | **필수** `scope` + `from`/`to` (전역 로드 금지) |
| `POST /uploads` | 서버 파싱 단일 경로 |
| `POST /exports/integrated` | 유일 엑셀 경로 |
| settings | 가능하면 종류별 정규화·페이지네이션 |

---

## 4. 실행 로드맵 (권장 순서)

빅뱅으로 `src/`를 지우지 않는다. **한 레이어씩 서버로 옮기고 클라 중복을 삭제**한다.

### Phase R0 — 동결·측정 (1~2일)

- [x] 골든 케이스 G1~G8 체크리스트 템플릿 ([golden/checklist.md](./golden/checklist.md))
- [x] 기능 동결 선언
- [ ] 골든 스냅샷 실측 기입 (NAS 기간·Before/After)
- [x] 플래그 실측: `.env.production.example` 기준 표 고정

**완료 기준:** “다시 만들면 이 숫자와 같아야 함” 체크리스트가 존재함.

### Phase R1 — 숫자 단일화 (최우선, 1~2주)

목표: **통합 포함 화면 KPI·세그먼트 = 서버만.**

- [x] 서버 `GET /kpi/by-segment` — 브랜드·폐쇄몰·수동광고·합계
- [x] 통합 탭: `adaptServerSegmentKpiRows` 사용 (`buildCombined`는 폴백만)
- [x] 통합 detail prefetch 제거 (lazy + 서버 세그먼트)
- [x] 합계 행 = 서버 세그먼트 totalRow (summary 패치 혼용 금지)
- [ ] G6 골든 숫자 일치 (수동 검증)

**완료 기준:** 통합 탭 기간 변경 시 detail 전량 없이도 표가 채워지고, 행 합 = 합계.

### Phase R2 — Records 범위 축소 (1주)

- [ ] `GET /records`에 scope+from+to **필수**(또는 기본 강제)
- [ ] `loadDetailCache` 전역 로드 삭제 → 탭/표 펼침 시에만 페이지 로드
- [ ] 표용 lean / 다운로드용 full 역할 분리 (문서와 코드 일치)
- [ ] G1~G5 표 건수·샘플 행 일치

**완료 기준:** 통합 진입 시 9천 행 × full JSON 을 받지 않음.

### Phase R3 — Export 서버 전용 (1주)

- [ ] 통합·채널 엑셀 100% `/exports/*`
- [ ] 클라 `dashboardExporter` / `excelWorkbookStyle` 폴백 경로 제거(또는 dead code)
- [ ] 코멘트 5칸·일자별 가독성 스타일은 서버 생성기에 이식
- [ ] G7 골든 엑셀 diff

### Phase R4 — 파싱 서버 이전 (2~3주)

- [ ] 업로드: 파일만 올리고 서버가 `*Parser` 실행
- [ ] Vue 파서는 `backend`로 이동(또는 shared 패키지) 후 프론트 삭제
- [ ] Worker 파싱은 서버 사이드/큐로 대체 가능

### Phase R5 — 프론트 정리·폴더 구조 (1~2주)

- [ ] `useSalesData` 해체 → R1~R3 모듈
- [ ] `SalesDataView`를 필터 셸 + 자식 컴포넌트로 분할
- [ ] (선택) `frontend/` / `backend/` 모노레포 정리 (`target-architecture` §2)
- [ ] 죽은 플래그·레거시 scope·미사용 Phase 스크립트 정리

### Phase R6 — 데이터 모델 정리 (여유 시)

- [ ] `own_mall_manual` 등 거대 JSON → 정규 테이블
- [ ] records의 집계 필수 컬럼을 JSONB가 아닌 컬럼으로 승격 (원가 등)
- [ ] settings 동시편집 충돌 규칙 통일 (코멘트 merge 패턴 재사용)

---

## 5. 하지 말 것 (안티패턴)

| 하지 말 것 | 이유 |
|------------|------|
| “일단 클론해서 새 레포에 UI부터” | 숫자 계약 없이 외형만 복제 → 또 어긋남 |
| 서버 KPI + 클라 세그먼트 병행 유지 | 지금 고통의 원인 |
| lean으로 원가 빼고 클라에서 역산 확장 | 숫자 정책이 탭마다 달라짐 |
| 상세 표에 집계용 `normalizeStoreLabel` 적용 | 브랜드가 바뀌어 보임 |
| 기능 동결 없이 재작성 | 영원히 추가추가 |

---

## 6. 작업 단위 PR 규칙

1. **한 PR = 한 Phase 슬라이스** (예: “통합 by-segment API + 클라 buildCombined 제거”)
2. PR마다 G* 골든 중 관련 항목 체크
3. NAS 배포 후 Ctrl+F5 스모크 (업로드 1건·통합 엑셀 1건)
4. 롤백: 이전 `dist` + compose 이미지 태그 유지

---

## 7. 성공 정의

재설계가 끝났다고 말할 수 있는 조건:

1. Vue 번들에 **KPI 재집계·엑셀 생성·대용량 파서**가 없다 (또는 dead code 0)
2. 통합 포함 모든 대시보드 숫자가 **서버 응답과 1:1**
3. G1~G8 골든이 CI 또는 수동 체크리스트로 통과
4. NAS 콜드 로드가 “탭 전환·기간 변경에 UI  Freeze 없음” 수준 (목표: 체감 1초대 KPI)
5. `useSalesData`급 신의 composable이 없다

---

## 8. 실행 상태 (R0 → R1)

| 단계 | 상태 | 산출물 |
|------|------|--------|
| R0 골든 체크리스트·플래그·동결 | **완료** | [golden/checklist.md](./golden/checklist.md) |
| R1 `GET /kpi/by-segment` | **완료** (G6 수동 검증 남음) | 서버 세그먼트 + 통합 UI 서버 단일 소스 |
| R2 records scope+기간 | 대기 | — |
| R3 export 서버 전용 | 대기 | — |

### 프로덕션 플래그 (`.env.production.example`)

| Flag | 값 |
|------|-----|
| `VITE_KPI_SOURCE` | `server` |
| `VITE_SERVER_KPI_ONLY` | `true` |
| `VITE_LAZY_DETAIL_LOAD` | `true` |
| `VITE_EXPORT_API_MODE` | `pg` |

### R1 수동 검증

1. 통합 탭 → DevTools Network에 `/kpi/by-segment`  
2. detail 전량 prefetch 없음  
3. [G6](./golden/checklist.md) 세그먼트 합 = 합계

### 탭 전환 (SWR + idle prefetch)

1. 대시보드 진입 후 2~3초 대기 → 다른 채널 탭 클릭 → KPI가 **즉시** 표시 (Network에 해당 scope가 이미 완료됐거나 캐시)
2. 탭 왕복 → `loading` 전체 차단 없음, summary/by-segment는 TTL(45s) 내 재요청 생략
3. 통합 포함 prefetch 대상 — G6 회귀 없음

### 통합 매출·원가·마진 SoT

- 단일 기준: `buildCombinedKpiSplitRows` **합계** 행 (화면 KPI·손익요약·엑셀)
- 로컬 검증: `npm run verify:combined-kpi`
- 엑셀 양식 `v32` 이상인지 확인 (①요약리포트 헤더)
