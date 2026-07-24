# Phase 2-4 Settings Write API Migration

## 1. 목적

settings 저장(수기 광고비, 파워프라이스, 1P, 자사몰 수기, 담당자 메모, 특판 등)을 **PostgreSQL API로 이전**할 수 있도록 쓰기 API와 feature flag를 추가합니다.

- NAS 배포는 **보류** — legacy 기능 전체 이전 후 마지막 단계에서 진행
- 이번 단계: **settings PUT/GET detail** + `VITE_WRITE_API_MODE`

## 2. 기존 legacy settings 구조

| 항목 | 내용 |
|------|------|
| API | `GET/PUT /api/settings/:scope/:kind` (`:3001`) |
| 테이블 | SQLite `app_settings` — PK `(scope, kind)`, `data` TEXT JSON |
| body | `{ "data": <any JSON> }` |
| 응답 GET | `{ ok, data, updatedAt }` |
| 응답 PUT | `{ ok, updatedAt }` |

**허용 scope:** `platform`, `company_b`, `platform_monthly`, `company_b_monthly`, `power_price`, `coupang_1p_rocket`, `sales_report`, `combined_daily`, `combined_monthly`

**허용 kind:** `staff_memo`, `power_price`, `coupang_1p_rocket`, `manual_ad`, `profit_loss_template`, `own_mall_manual`, `special_sale`, `combined_comments`

## 3. 신규 PG settings API 구조

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/settings?scope=&kind=` | 목록 (Phase 1-3) |
| GET | `/api/v1/settings/:scope/:kind` | 단건 조회 |
| PUT | `/api/v1/settings/:scope/:kind` | 저장 (upsert) |

**PUT 응답:**

```json
{
  "ok": true,
  "scope": "platform",
  "kind": "manual_ad",
  "data": [],
  "updatedAt": "2026-07-01T00:00:00.000Z"
}
```

**회귀용 추가 키:** `scope=__test__`, `kind=settings_write_regression`

## 4. app_settings 테이블 저장 기준

PostgreSQL `app_settings`:

```sql
scope TEXT, kind TEXT, data JSONB, updated_at TIMESTAMPTZ
PRIMARY KEY (scope, kind)
```

- `INSERT ... ON CONFLICT DO UPDATE` — 없으면 생성, 있으면 갱신
- `data`는 요청 JSON **그대로** JSONB 저장 (구조 변경 없음)
- `updated_at`은 저장 시 `NOW()`

## 5. VITE_WRITE_API_MODE 구조

```env
VITE_API_MODE=legacy          # 읽기 API (기본 legacy)
VITE_KPI_SOURCE=client
VITE_WRITE_API_MODE=legacy    # 쓰기 API (기본 legacy)
```

| READ (`VITE_API_MODE`) | WRITE (`VITE_WRITE_API_MODE`) | settings 저장 |
|------------------------|-------------------------------|---------------|
| legacy | legacy | `:3001` |
| pg | legacy | `:3001` (읽기만 PG 가능) |
| pg | pg | `:3002` PUT + GET 재확인 |

DEV 배지: `API MODE: PG · KPI: SERVER · WRITE: PG`

## 6. Vue 연동 방식

**service 계층 분기** (`src/services/appSettingsApi.js`):

```text
saveAppSetting(scope, kind, data)
  → isPgWriteMode() ? pgPutAppSetting : legacy PUT
  → fetchAppSetting(scope, kind)   // 저장 후 GET 재확인
  → return GET 결과
```

**optimistic update 없음** — composable `persist*` 함수는 `saveAppSetting` 반환값으로 로컬 상태 갱신.

| 파일 | 역할 |
|------|------|
| `writeApiMode.js` | `VITE_WRITE_API_MODE` 해석 |
| `pgApiClient.js` | `pgPutAppSetting`, `pgFetchAppSettingByPath` |
| `adapters/settingsAdapter.js` | PG 응답 → legacy 형식 |
| `apiClient.js` | 읽기는 기존 `VITE_API_MODE` 분기 유지 |

## 7. 테스트 방법

```bash
docker compose up -d --build api
npm run regression:phase-2-4
```

**안전 규칙:**

- 쓰기 테스트는 `__test__` scope만 사용
- `platform/manual_ad` 등 운영 데이터 **덮어쓰지 않음**
- 테스트 후 `__test__` 행 원복/정리

수동 확인:

```env
VITE_API_MODE=pg
VITE_WRITE_API_MODE=pg
```

수기 광고 패널에서 저장 → Network `PUT /api/v1/settings/...` → `GET` 재조회

## 8. 회귀 검증 결과

`npm run regression:phase-2-4` 항목:

| 항목 | 설명 |
|------|------|
| PG settings GET list | OK |
| PG settings PUT | OK |
| PUT 후 GET 일치 | OK |
| manual_ad / power_price / own_mall_manual | `__test__` scope |
| legacy/SQLite | 운영 키 read-only (필수 일치) |
| PG/legacy | 일치 필수; drift 시 WARN (migrate 재실행 검토) |
| test scope cleanup | OK |

### 알려진 이슈

- `company_b/own_mall_manual` 등 일부 키는 PG 마이그레이션 시점과 legacy SQLite 간 **내용 drift** 가능 (ID 재생성 등). 쓰기 API 자체와 무관 — `npm run migrate:pg` 재동기화로 해결.

## 9. 아직 legacy에 남은 기능

| 기능 | 상태 |
|------|------|
| settings **읽기** (legacy 모드) | legacy |
| settings **쓰기** (`WRITE=legacy`) | legacy |
| 엑셀 업로드/파싱 | legacy |
| record 수정/삭제 | legacy |
| 업로드 삭제 | legacy |
| 통합 엑셀 export | legacy |
| SQLite DB | 유지 |

## 10. Phase 2-5 제안

1. **엑셀 업로드** PG API 전환 (`POST /api/v1/uploads/...`)
2. record 수정/삭제 PG 전환
3. 업로드 삭제 PG 전환
4. 통합 export PG 전환
5. `VITE_WRITE_API_MODE=pg` 프로덕션 전환 검토 (전 기능 이전 후)
6. legacy SQLite API 단계적 제거 계획

---

### 금지사항 (Phase 2-4)

- NAS 배포 / staging compose
- legacy API 삭제
- 엑셀 업로드·export·record 쓰기 PG 전환
- 기본값 `pg` 변경
