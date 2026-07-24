# essersales — 에쎄르 영업팀 매출 대시보드

플랫폼별 일일 엑셀 업로드 → **PostgreSQL** 저장 → 일·주·월 매출 시각화

## 프로젝트 개요

- 플랫폼별 일일/월간/기간 엑셀 업로드 (쿠팡, 네이버, 자사몰 등)
- 통합 매출 리포트 엑셀 업로드·다운로드
- 일·주·월 대시보드, 플랫폼 취합/개별 보기
- 담당자 메모·파워프라이스 (PostgreSQL `app_settings`)
- 서버 KPI API (summary / daily / platform / 전일대비)

## 현재 최종 스택 (Phase 3-4B+)

| 구성 | 기술 |
|------|------|
| Frontend | Vue 3 + Vite (production → `dist/`) |
| API | Node.js Express (`backend/`) |
| Database | PostgreSQL 16 |
| Reverse proxy | nginx (NAS 운영) |
| 데이터 | `uploads`, `exports`, `pgdata` 볼륨 |

**legacy SQLite API (`:3001`)는 사용하지 않습니다.**  
이전 코드·DB는 `archive/legacy-sqlite-server/`에 보관됩니다.

## Node.js 버전

**Node 20 LTS 이상, 24 미만** (권장: Node 22 LTS)

```powershell
nvm use 22.22.3
node -v
```

## 로컬 개발

### 1) Docker PG API + DB

```bash
docker compose up -d --build api db
# 또는
npm run api
```

API health: http://localhost:3002/api/v1/health

### 2) Vue dev 서버

```bash
npm install
npm run dev
```

브라우저: http://localhost:5173

### 환경 변수 (로컬 dev)

`.env.example`을 `.env`로 복사 후 사용:

```env
VITE_API_MODE=pg
VITE_PG_API_BASE=http://localhost:3002/api/v1
VITE_KPI_SOURCE=server
VITE_WRITE_API_MODE=pg
VITE_EXPORT_API_MODE=pg
```

## Production build

NAS/nginx same-origin 배포용 빌드:

```bash
npm run build:production
```

- 산출물: `dist/`
- API base: `/api/v1` (nginx 프록시와 동일 origin)
- 설정 파일: `.env.production` (VITE_* only, 비밀값 없음)

일반 빌드: `npm run build` (로컬 `.env` 기준)

## 회귀 테스트

```bash
docker compose up -d api db
npm run regression:phase-3-3    # API E2E
npm run smoke:full-pg           # 브라우저 UI smoke
npm run regression:full-pg      # 위 두 가지 통합
```

검증 기준: health OK, upload/export/KPI OK, **legacy API 호출 0회**

## NAS 배포 개요 (Phase 4)

실제 NAS 배포는 **Phase 5**에서 진행합니다.  
Phase 4에서는 운영 패키징·문서만 완료합니다.

### NAS 폴더 구조 (권장)

```text
/volume1/docker/essersales/
  docker-compose.nas.yml
  .env                    # git 제외, .env.production.example 참고
  dist/                   # npm run build:production 결과

  data/
    postgres/
    uploads/
    exports/
    backups/
    logs/

  archive/
    legacy-sqlite-server/
```

### Phase 5 NAS 배포 (로컬 준비 → NAS 실행)

**로컬 PC:**

```bash
npm run build:production
npm run prepare:phase5-local
# deploy/nas-transfer/<timestamp>/ → NAS로 복사
```

**NAS:**

```bash
docker compose -f docker-compose.nas.yml up -d --build
./infra/scripts/restore-nas-from-backup.sh data/backups
```

상세: [`docs/phase-5-nas-deployment-runbook.md`](docs/phase-5-nas-deployment-runbook.md)

### 로컬 운영 compose 검증 (NAS 배포 전)

```bash
cp .env.production.example .env   # 비밀번호 설정
npm run build:production
npm run nas:up
npm run verify:production-compose
```

## 백업

```bash
# PostgreSQL dump + uploads/exports/archive
./infra/scripts/backup-postgres.sh
# Windows
powershell -File infra/scripts/backup-postgres.ps1
```

## 스크립트 요약

| 명령 | 설명 |
|------|------|
| `npm run dev` | Vue dev (PG API 연동) |
| `npm run api` | Docker PG API + DB (로컬 dev) |
| `npm run build:production` | NAS용 Vue 빌드 (`/api/v1`) |
| `npm run nas:up` | NAS 운영 compose 기동 |
| `npm run prepare:phase5-local` | NAS 배포 전 로컬 빌드·백업·복사 목록 |
| `npm run verify:production-compose` | 운영 compose 로컬 검증 |
| `npm run regression:full-pg` | Full PG 회귀 테스트 |
| `npm run smoke:full-pg` | 브라우저 PG 스모크 |

## Legacy archive & 롤백

| 항목 | 위치 |
|------|------|
| legacy SQLite server | `archive/legacy-sqlite-server/server/` |
| SQLite DB 원본 | `archive/legacy-sqlite-server/server/data/essersales.db` |
| legacy Vue client | `archive/legacy-sqlite-server/src-services/` |
| 백업 로그 | `archive/legacy-sqlite-server/BACKUP.log` |

**롤백 (비권장):** archive에서 `server/` 복원 + legacy env 설정.  
상세: [`docs/phase-3-4b-legacy-removal.md`](docs/phase-3-4b-legacy-removal.md) §12

## 문서

| 문서 | 내용 |
|------|------|
| `docs/phase-5-nas-deployment-runbook.md` | Phase 5 NAS 배포 실행 (로컬/NAS 분리) |
| `docs/phase-4-nas-deployment-guide.md` | NAS 운영 아키텍처 |
| `docs/phase-3-4b-legacy-removal.md` | Legacy 제거 기록 |
| `docs/phase-3-4a-full-pg-ui-smoke.md` | UI smoke 테스트 |
| `docs/target-architecture.md` | 목표 아키텍처 |
