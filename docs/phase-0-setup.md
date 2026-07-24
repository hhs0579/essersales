# Phase 0 — Docker + PostgreSQL + API 골격 설정

> **범위:** 신규 `backend/`, `infra/`, Docker Compose만 추가.  
> 기존 Vue·SQLite 서버(`server/`)、파싱·KPI·export 로직은 **변경 없음**.

---

## 1. 사전 요구 사항

| 도구 | 용도 |
|------|------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (또는 Docker Engine + Compose v2) | DB·API·nginx 컨테이너 |
| Node.js 20+ | (선택) 호스트에서 API만 단독 실행 |
| Git | 브랜치 생성 |

---

## 2. Git 브랜치 생성

Phase 0 작업 전 현재 상태를 백업 브랜치로 남깁니다.

**Windows**

```cmd
infra\scripts\setup-phase-0-branches.cmd
```

**macOS / Linux**

```bash
chmod +x infra/scripts/setup-phase-0-branches.sh
./infra/scripts/setup-phase-0-branches.sh
```

생성되는 브랜치:

| 브랜치 | 설명 |
|--------|------|
| `backup/current-vue-version` | Phase 0 이전 스냅샷 포인터 |
| `feature/phase-0-docker-pg` | Phase 0 작업 브랜치 (체크아웃됨) |

수동 실행 예:

```bash
git branch backup/current-vue-version
git checkout -b feature/phase-0-docker-pg
```

---

## 3. 환경 변수 설정

프로젝트 루트에서:

```bash
copy .env.example .env
```

`.env`에서 최소한 `DB_PASSWORD`를 변경하세요. 기본값 예:

| 변수 | 기본값 (예시) | 설명 |
|------|---------------|------|
| `DB_HOST` | `db` | Compose 내부 호스트명 |
| `DB_PORT` | `5432` | 호스트에 노출되는 Postgres 포트 |
| `DB_NAME` | `essersales` | 데이터베이스 이름 |
| `DB_USER` | `essersales` | DB 사용자 |
| `DB_PASSWORD` | *(직접 설정)* | DB 비밀번호 |
| `API_PORT` | `3002` | API 직접 접속 포트 (호스트 → 컨테이너 3001) |
| `UPLOAD_DIR` | `./uploads` | 로컬 dev 경로 (Compose에서는 볼륨) |
| `EXPORT_DIR` | `./exports` | 로컬 dev 경로 (Compose에서는 볼륨) |
| `HTTP_PORT` | `8080` | nginx 프록시 포트 |

---

## 4. Docker Compose 실행

프로젝트 루트에서:

```bash
docker compose up -d --build
```

서비스:

| 서비스 | 컨테이너명 | 역할 |
|--------|------------|------|
| `db` | `essersales-db` | PostgreSQL 16 |
| `api` | `essersales-api` | Node.js Express API |
| `proxy` | `essersales-proxy` | nginx → API 프록시 |

볼륨 (데이터 분리):

| 볼륨 | 용도 |
|------|------|
| `essersales-pgdata` | PostgreSQL 데이터 |
| `essersales-uploads` | 업로드 원본 (Phase 3+) |
| `essersales-exports` | export 산출물 (Phase 4+) |

최초 `db` 기동 시 `infra/db/001_initial.sql`이 자동 적용됩니다.

로그 확인:

```bash
docker compose logs -f api
docker compose logs -f db
```

---

## 5. DB 접속 정보

**Compose 네트워크 내부 (api 컨테이너 → db)**

```
Host: db
Port: 5432
Database: essersales  (또는 .env의 DB_NAME)
User: essersales      (또는 .env의 DB_USER)
Password: .env의 DB_PASSWORD
```

**호스트 PC에서 psql / DBeaver 등**

```
Host: localhost
Port: 5432  (또는 .env의 DB_PORT)
```

접속 예:

```bash
docker compose exec db psql -U essersales -d essersales -c "\dt"
```

초기 테이블: `uploads`, `upload_files`, `sales_records`, `app_settings`, `export_jobs`, `schema_migrations`

---

## 6. Health check 확인

### 6.1 API 직접 (권장)

```bash
curl http://localhost:3002/api/v1/health
```

또는 PowerShell:

```powershell
Invoke-RestMethod http://localhost:3002/api/v1/health
```

**성공 예시 (`200 OK`):**

```json
{
  "ok": true,
  "service": "essersales-api",
  "apiVersion": "v1",
  "phase": 0,
  "timestamp": "2026-06-29T12:00:00.000Z",
  "db": {
    "connected": true,
    "serverTime": "2026-06-29T12:00:00.000Z",
    "migrationVersion": 1
  }
}
```

DB 미연결 시 `503` + `"db": { "connected": false, "error": "..." }`

### 6.2 nginx 경유

```bash
curl http://localhost:8080/api/v1/health
```

루트 `/` 는 Phase 0 안내 JSON을 반환합니다 (Vue 미포함).

### 6.3 API 컨테이너 로그

성공 시:

```
[startup] essersales API listening on port 3001 (production)
[startup] PostgreSQL connected (server_time=..., migration=1)
```

실패 시:

```
[startup] PostgreSQL connection FAILED: ...
```

---

## 7. 기존 Vue 프로그램 실행 (변경 없음)

Phase 0 스택과 **별도**로 기존 앱을 그대로 사용합니다.

```bash
npm run dev
```

- Vue: `http://localhost:5173`
- 레거시 API (SQLite): `http://localhost:3001`

신규 PostgreSQL API는 **포트 3002** (기본)로 분리되어 충돌하지 않습니다.

---

## 8. 컨테이너 중지

```bash
docker compose stop
```

컨테이너 제거 (볼륨 유지):

```bash
docker compose down
```

---

## 9. 초기화 (데이터 전부 삭제)

> **주의:** PostgreSQL 데이터·업로드·export 볼륨이 삭제됩니다.

```bash
docker compose down -v
docker compose up -d --build
```

`-v` 옵션으로 named volume (`essersales-pgdata`, `essersales-uploads`, `essersales-exports`)이 제거되며, DB는 `001_initial.sql`부터 다시 생성됩니다.

---

## 10. 호스트에서 API만 단독 실행 (선택)

DB 컨테이너만 띄운 뒤:

```bash
docker compose up -d db
cd backend
npm install
set DB_HOST=localhost
set DB_PORT=5432
set DB_NAME=essersales
set DB_USER=essersales
set DB_PASSWORD=your_password
npm run dev
```

---

## 11. 문제 해결

| 증상 | 확인 |
|------|------|
| `503` health | `docker compose logs db` — DB 기동 완료 여부 |
| 포트 충돌 | `.env`에서 `DB_PORT`, `API_PORT`, `HTTP_PORT` 변경 |
| migrationVersion `null` | `docker compose down -v` 후 재기동 (init SQL 재적용) |
| API 빌드 실패 | `cd backend && npm install` 로컬 확인 |

---

## 12. Phase 0 완료 체크리스트

- [ ] `backup/current-vue-version`, `feature/phase-0-docker-pg` 브랜치 생성
- [ ] `docker compose up -d --build` 성공
- [ ] `GET /api/v1/health` → `db.connected: true`, `migrationVersion: 1`
- [ ] `\dt` 로 6개 테이블 확인
- [ ] 기존 `npm run dev` 정상 동작 (Vue + SQLite 서버)

다음 단계: [target-architecture.md](./target-architecture.md) **Phase 1** — SQLite → PostgreSQL 데이터 이전.
