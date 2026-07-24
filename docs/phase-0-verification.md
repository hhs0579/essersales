# Phase 0 검증 보고서

> 검증 일시: 2026-07-01  
> 검증 환경: Windows 10 + WSL 2 + Docker Desktop  
> 프로젝트 경로: `C:\Users\Esser\Desktop\esser dev\essersales`  
> **Phase 1 코드는 작성하지 않음**

---

## 1. 검증 요약

| 항목 | 결과 |
|------|------|
| Docker Compose 기동 | **성공** |
| PostgreSQL 컨테이너 | **성공** (healthy) |
| Node.js API 컨테이너 | **성공** |
| nginx 컨테이너 | **성공** |
| Health `:3002` | **성공** (`ok: true`, `db.connected: true`, `migrationVersion: 1`) |
| Health `:8080` | **성공** (동일) |
| PostgreSQL 테이블 6개 | **성공** |
| `npm run dev` → Vue `:5173` | **성공** (HTTP 200) |
| 레거시 SQLite API `:3001` | **성공** (`ok: true`) |
| `:3001` vs `:3002` 포트 충돌 | **없음** (동시 기동 확인) |
| **Phase 1 진행 가능** | **가능** |

**결론:** Phase 0 Docker·PostgreSQL·API·nginx 골격이 **로컬에서 정상 검증 완료**. Phase 1 (SQLite → PostgreSQL 데이터 이전) 착수 가능.

---

## 2. 환경 버전

### Docker / WSL

```text
Docker version 29.6.1, build 8900f1d
Docker Compose version v5.1.4
```

```text
NAME              STATE           VERSION
* Ubuntu            Running         2
  docker-desktop    Running         2
```

---

## 3. `.env` 확인

### 실행

```powershell
cd "C:\Users\Esser\Desktop\esser dev\essersales"
# .env가 비어 있어 .env.example 내용으로 복사함
Copy-Item .env.example .env -Force
Get-Content .env
```

### 결과

| 변수 | 값 | 상태 |
|------|-----|------|
| `DB_HOST` | `db` | OK |
| `DB_PORT` | `5432` | OK |
| `DB_NAME` | `essersales` | OK |
| `DB_USER` | `essersales` | OK |
| `DB_PASSWORD` | `change_me_in_production` | OK (개발용, **운영 전 변경 권장**) |
| `API_PORT` | `3002` | OK |
| `UPLOAD_DIR` | `./uploads` | OK |
| `EXPORT_DIR` | `./exports` | OK |
| `HTTP_PORT` | `8080` | OK |

**조치:** 검증 시 `.env` 파일이 **비어 있어** `.env.example`에서 복사하여 채움. 필수 변수 누락 없음.

---

## 4. 실행한 명령어

```powershell
cd "C:\Users\Esser\Desktop\esser dev\essersales"

Copy-Item .env.example .env -Force

docker compose up -d --build

docker ps

Invoke-RestMethod http://localhost:3002/api/v1/health
Invoke-RestMethod http://localhost:8080/api/v1/health

docker compose exec -T db psql -U essersales -d essersales -c "\dt"

npm run dev
# 별도 확인:
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:3002/api/v1/health
curl.exe -s -o NUL -w "%{http_code}" http://localhost:5173/
```

---

## 5. Docker Compose 실행 결과

```powershell
docker compose up -d --build
```

**결과:** 성공

- 이미지 pull: `postgres:16-alpine`, `nginx:1.27-alpine`
- API 이미지 빌드: `essersales-api`
- 볼륨 생성: `essersales-pgdata`, `essersales-uploads`, `essersales-exports`
- 컨테이너: `essersales-db` → healthy → `essersales-api` → `essersales-proxy` 순 기동

---

## 6. 컨테이너 목록

```powershell
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

| NAMES | IMAGE | STATUS | PORTS |
|-------|-------|--------|-------|
| `essersales-proxy` | `nginx:1.27-alpine` | Up | `0.0.0.0:8080->80/tcp` |
| `essersales-api` | `essersales-api` | Up | `0.0.0.0:3002->3001/tcp` |
| `essersales-db` | `postgres:16-alpine` | Up (healthy) | `0.0.0.0:5432->5432/tcp` |

---

## 7. Health check 응답 결과

### `http://localhost:3002/api/v1/health` — **200 OK**

```json
{
  "ok": true,
  "service": "essersales-api",
  "apiVersion": "v1",
  "phase": 0,
  "timestamp": "2026-07-01T04:55:50.943Z",
  "db": {
    "connected": true,
    "serverTime": "2026-07-01T04:55:50.940Z",
    "migrationVersion": 1
  }
}
```

### `http://localhost:8080/api/v1/health` — **200 OK** (nginx 프록시)

```json
{
  "ok": true,
  "service": "essersales-api",
  "apiVersion": "v1",
  "phase": 0,
  "timestamp": "2026-07-01T04:55:51.137Z",
  "db": {
    "connected": true,
    "serverTime": "2026-07-01T04:55:51.135Z",
    "migrationVersion": 1
  }
}
```

| 기준 | `:3002` | `:8080` |
|------|---------|---------|
| `ok: true` | ✅ | ✅ |
| `db.connected: true` | ✅ | ✅ |
| `migrationVersion: 1` | ✅ | ✅ |

---

## 8. PostgreSQL 테이블 목록

```powershell
docker compose exec -T db psql -U essersales -d essersales -c "\dt"
```

```
 Schema |       Name        | Type  |   Owner
--------+-------------------+-------+------------
 public | app_settings      | table | essersales
 public | export_jobs       | table | essersales
 public | sales_records     | table | essersales
 public | schema_migrations | table | essersales
 public | upload_files      | table | essersales
 public | uploads           | table | essersales
(6 rows)
```

| 요청 테이블 | 존재 |
|-------------|------|
| `uploads` | ✅ |
| `upload_files` | ✅ |
| `sales_records` | ✅ |
| `app_settings` | ✅ |
| `export_jobs` | ✅ |
| `schema_migrations` | ✅ |

---

## 9. 기존 Vue · 레거시 서버 확인

### `npm run dev` 실행 로그

```
[api] essersales — 로컬 http://localhost:3001
[api] SQLite: C:\Users\Esser\Desktop\esser dev\essersales\server\data\essersales.db
[web] VITE ... (http://localhost:5173)
```

### 동시 포트 확인 (Docker + dev 병행)

| 포트 | 서비스 | 결과 |
|------|--------|------|
| `:5173` | Vue (Vite) | HTTP **200** |
| `:3001` | 레거시 SQLite API | `ok: true`, `apiVersion: 6` |
| `:3002` | 신규 PostgreSQL API | `ok: true`, `db.connected: true` |

**포트 충돌:** 없음 — `:3001`(레거시)과 `:3002`(신규) 분리 설계대로 동시 리스닝 확인.

### 레거시 API 응답 (`:3001`)

```json
{
  "ok": true,
  "dbPath": "C:\\Users\\Esser\\Desktop\\esser dev\\essersales\\server\\data\\essersales.db",
  "apiVersion": 6,
  "uiBuild": 123
}
```

**기존 SQLite 서버:** Phase 0 추가 후에도 **정상 유지** (Vue dev가 `:3001` 사용).

---

## 10. 기존 코드 변경 여부

Phase 0 검증 과정에서 **의도적으로 변경한 것:**

| 파일 | 변경 |
|------|------|
| `.env` | 비어 있던 파일을 `.env.example` 기준으로 채움 (로컬 실행용) |
| `docs/phase-0-verification.md` | 본 문서 갱신 |

**변경하지 않은 영역 (확인):**

| 영역 | 상태 |
|------|------|
| Vue 화면 (`src/components/**`, `App.vue`) | 미수정 |
| `src/utils` 파싱·KPI·export | 미수정 |
| `server/` SQLite 서버 | 미수정 |

---

## 11. 발견된 문제

| # | 문제 | 심각도 | 조치 |
|---|------|--------|------|
| 1 | `.env`가 비어 있었음 | 중간 | `.env.example` 복사로 해결 — **운영 전 `DB_PASSWORD` 변경 권장** |
| 2 | (없음) Docker / Health / DB / Vue 동시 검증 통과 | — | — |

---

## 12. Phase 1 진행 가능 여부

| 판단 | **진행 가능** |
|------|----------------|
| 근거 | Docker 3종 컨테이너 정상 · Health 양 포트 통과 · DB 테이블 6개 · 레거시 Vue/SQLite 병행 정상 |
| 다음 작업 | Phase 1: `infra/scripts/migrate-sqlite-to-pg.mjs` 및 SQLite → PostgreSQL 데이터 이전 |
| 선행 권장 | Git 브랜치 `backup/current-vue-version`, `feature/phase-0-docker-pg` 생성 (미완료 시 `infra\scripts\setup-phase-0-branches.cmd`) |

---

## 13. 참고 문서

- [phase-0-setup.md](./phase-0-setup.md)
- [target-architecture.md](./target-architecture.md)
- [current-structure.md](./current-structure.md)

---

*최종 검증: 2026-07-01 — WSL 2 + Docker Desktop 환경에서 Phase 0 전 항목 통과.*
