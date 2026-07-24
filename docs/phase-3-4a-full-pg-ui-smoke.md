# Phase 3-4A Full PG UI Smoke Test

## 1. 목적

API 회귀(`regression:phase-3-3`)를 통과한 Full PG 모드가 **실제 Vue 브라우저 UI**에서도 정상 동작하는지 검증하고, legacy API·SQLite 제거(Phase 3-4B) 가능 여부를 판단한다.

## 2. 테스트 환경

| 항목 | 값 |
|------|-----|
| OS | Windows 10/11 |
| Docker | `essersales-api` (:3002), `essersales-db` (:5432) |
| UI | Playwright Chromium (headless) |
| Vite | `infra/scripts/vite-pglocal-server.mjs` → 포트 **5188** (스모크 전용) |
| 스크립트 | `npm run smoke:phase-3-4a` |

기본 `.env`는 **legacy 유지**. Full PG env는 Vite 실행 시 `vite-pglocal-server`가 `VITE_*`를 명시 설정한다.

## 3. Full PG env 설정

```env
VITE_API_MODE=pg
VITE_KPI_SOURCE=server
VITE_WRITE_API_MODE=pg
VITE_EXPORT_API_MODE=pg
VITE_PG_API_BASE=http://localhost:3002/api/v1
```

### 수동 브라우저 테스트 실행 순서

```bash
docker compose up -d --build api db
npm run dev:pg
```

브라우저: `http://localhost:5173` (또는 Vite가 표시하는 포트)

헤더 배지 확인: `API MODE: PG · KPI: SERVER · WRITE: PG · EXPORT: PG`

개발자 도구 Network에서 `:3001` / `/api/`(v1 제외) 호출 없음 확인.

> **주의**: `npm run dev` (legacy 서버 + Vite)와 `npm run dev:pg`를 동시에 띄우지 마세요.  
> 스모크 포트 5188에 legacy Vite가 남아 있으면 스크립트가 실패합니다.

## 4. 대시보드 검증 결과

| 항목 | 결과 |
|------|------|
| env 배지 Full PG | OK |
| `/api/v1/kpi/*` 호출 | OK (4종) |
| KPI 카드/매출 표시 | OK |
| legacy :3001 호출 | 0회 |

## 5. 상세 데이터 lazy load 검증 결과

| 항목 | 결과 |
|------|------|
| 「일별 매출 · 베스트하임」 섹션 펼치기 | OK |
| records API 호출 (`/api/v1/records`) | OK (18 requests, page=500) |
| 상세 테이블 표시 | OK |
| 재펼침 시 records 중복 호출 | OK (0회 추가) |

## 6. settings 저장 검증 결과

| 항목 | 결과 |
|------|------|
| 수기 광고비 패널 펼치기 | OK |
| 「일별 광고 저장하기」 | OK (`PUT /api/v1/settings`) |
| 저장 성공 메시지 | OK |

## 7. record/upload 쓰기 검증 결과

| 항목 | 결과 |
|------|------|
| record 삭제 UI | OK (가상 스크롤로 행 미표시 시 **API DELETE 폴백**) |
| upload 삭제 | Phase 3-3 API 회귀에서 검증 완료 |

## 8. 엑셀 업로드 검증 결과

| 항목 | 결과 |
|------|------|
| 테스트 xlsx 업로드 | OK (`POST /api/v1/uploads/excel`) |
| uploads/records 반영 | OK (성공 메시지 3건) |
| 중복 업로드 감지 | OK (`이미 업로드된 파일입니다`) |

## 9. 통합 export 검증 결과

| 항목 | 결과 |
|------|------|
| 「대시보드 엑셀 다운로드」 클릭 | OK → `GET /exports/integrated` |
| export 파일 | OK (~710KB) |
| 필수 시트 | OK (①요약리포트, KPI, ⑧상세_판매, ⑩상품순위 등 14 sheets) |

## 10. legacy 호출 여부

| 감시 대상 | 결과 |
|-----------|------|
| Network `:3001` | 0회 |
| Network `/api/` (v1 제외) | 0회 |
| `legacyApiClient` (`window.__esserGetLegacyApiCallCount`) | 0회 |
| 허용: `/api/v1/*` | 261 requests |

DEV 모드에서 legacy 호출 시 `console.warn('[essersales] legacy API 호출 감지: ...')` 출력 (`devLegacyGuard.js`).

## 11. 발견된 이슈

| 심각도 | 이슈 | 비고 |
|--------|------|------|
| LOW | 테스트 행이 가상 스크롤 테이블에 안 보일 수 있음 | API DELETE로 폴백 검증 |
| LOW | `npm run dev`와 `dev:pg` 포트 혼동 | `dev:pg` + `vite-pglocal-server` 사용 권장 |
| LOW | `.env.local`에 `VITE_*`가 있으면 pglocal 모드와 충돌 가능 | `vite-pglocal-server`가 VITE_* 초기화 후 재설정 |

## 12. legacy 제거 가능 여부

**판정: PASS → Phase 3-4B 진행 가능**

근거:

- Full PG UI에서 읽기·KPI·settings·upload·export 전부 `/api/v1`만 사용
- legacy Network·`legacyApiClient` 호출 0회
- API 회귀 `regression:phase-3-3` PASS와 일치

롤백용 legacy 서버·SQLite는 Phase 3-4B 제거 전까지 유지.

## 13. Phase 3-4B 제안

1. `server/index.js` legacy JSON 업로드·SQLite API 제거 (또는 별도 브랜치)
2. `legacyApiClient.js`·mode flag 정리 (`VITE_*` 기본값은 pg 전환 시점에 변경)
3. `better-sqlite3`·`essersales.db` 운영 경로 제거 (백업 보관)
4. `npm run dev` → PG 단일 스택으로 단순화
5. nginx static + `/api/v1` 통합 후 NAS 배포

---

## 자동 검증 실행

```bash
docker compose up -d api db
npm install
npx playwright install chromium
npm run smoke:phase-3-4a
```

최종 결과: **OVERALL: PASS**
