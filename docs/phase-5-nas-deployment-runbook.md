# Phase 5 NAS Deployment Runbook

> **목적:** 로컬 PC에서 빌드·백업을 준비한 뒤, NAS에서 실제 배포·데이터 복원·기능 검증을 수행한다.  
> **이 문서는 로컬 준비 단계와 NAS 실행 단계를 명확히 분리**한다.

---

## 개요

| 구분 | 실행 위치 | 담당 작업 |
|------|----------|----------|
| **A. 로컬 준비** | 개발 PC (Windows) | 빌드, 백업, NAS 복사 목록 |
| **B. NAS 실행** | Synology NAS | 파일 배치, Docker 기동, 복원, 검증 |

**사전 조건 (Phase 3-4B / Phase 4 완료):**

- PG 단일 스택 (`Vue + PG API + PostgreSQL`)
- legacy SQLite API 미사용
- `docker-compose.nas.yml`, `infra/nginx/nas.conf` 준비 완료

---

# A. 로컬 PC 준비 단계

> **NAS에 접속하지 않습니다.** 로컬에서 빌드·백업·복사 목록만 준비합니다.

## A-1. 사전 확인

```powershell
cd "C:\Users\Esser\Desktop\esser dev\essersales"

# 로컬 dev PG 스택 (실제 데이터) 가동
docker compose up -d api db
docker compose ps
```

`essersales-db`, `essersales-api`가 **Up** 상태여야 합니다.

## A-2. Production build 생성

```powershell
npm install
npm run build:production
```

- 모드: `production` → `.env.production` 로드
- `VITE_PG_API_BASE=/api/v1` (NAS nginx same-origin)

## A-3. dist/ 생성 확인

```powershell
Test-Path dist\index.html          # True
(Get-ChildItem dist -Recurse).Count  # 27+ 파일
```

또는:

```powershell
npm run prepare:phase5-local   # dist 확인 포함
```

## A-4. 로컬 PostgreSQL 백업

### 자동 (권장)

```powershell
npm run prepare:phase5-local
```

출력 예:

```text
deploy/nas-transfer/20260702-104831/backups/
  essersales-pg-20260702-104831.sql
  essersales-pg-latest.sql
```

### 수동

```powershell
docker compose exec -T db pg_dump -U essersales -d essersales --no-owner --no-acl `
  > deploy\nas-transfer\manual\essersales-pg-manual.sql
```

## A-5. uploads / exports 백업

`prepare:phase5-local`이 Docker named volume에서 자동 백업합니다.

| 볼륨 | 백업 파일 |
|------|----------|
| `essersales-uploads` | `essersales-uploads-YYYYMMDD-HHMMSS.tar.gz` |
| `essersales-exports` | `essersales-exports-YYYYMMDD-HHMMSS.tar.gz` |

수동 (참고):

```powershell
docker run --rm -v essersales-uploads:/data:ro alpine:3.20 tar czf - -C /data . `
  > deploy\nas-transfer\manual\uploads.tar.gz
```

## A-6. NAS로 복사할 파일 목록

최신 목록: [`deploy/nas-transfer/NAS-COPY-LIST-latest.md`](../deploy/nas-transfer/NAS-COPY-LIST-latest.md)

### 필수 복사 항목

```text
docker-compose.nas.yml
.env.production.example          → NAS에서 .env 로 복사·편집
dist/                            (전체)
backend/                         (Dockerfile, package.json, src/)
infra/nginx/nas.conf
infra/db/                        (migration SQL)
infra/scripts/restore-nas-from-backup.sh  (복원용, 권장)
package.json
package-lock.json
src/utils/
src/config/
src/constants/

deploy/nas-transfer/<timestamp>/backups/
  essersales-pg-latest.sql
  essersales-uploads-*.tar.gz
  essersales-exports-*.tar.gz
```

### 복사하지 않음

```text
node_modules/
.git/
src/components/     (dist에 포함)
.env (로컬 dev)     (NAS용 .env 별도 작성)
```

### 로컬 준비 완료 체크리스트

- [ ] `npm run build:production` 성공
- [ ] `dist/index.html` 존재
- [ ] `essersales-pg-latest.sql` 생성 (수 MB 이상)
- [ ] uploads/exports tar 생성 (또는 EMPTY 표시 확인)
- [ ] `NAS-COPY-LIST-latest.md` 확인
- [ ] NAS SMB/File Station으로 복사 준비

---

# B. NAS 실행 단계

> **로컬 준비(A)가 완료된 후**, Synology NAS에서 실행합니다.

## B-1. 폴더 생성

SSH 또는 File Station:

```bash
mkdir -p /volume1/docker/essersales
cd /volume1/docker/essersales

mkdir -p data/postgres data/uploads data/exports data/backups
```

## B-2. 파일 복사

로컬 PC → NAS (`\\NAS_IP\docker\essersales\` 또는 File Station):

A-6 목록대로 복사.

백업 파일 배치:

```bash
# 예: NAS 프로젝트 루트
cp -r deploy/nas-transfer/20260702-104831/backups/* data/backups/
```

## B-3. 운영 .env 작성

```bash
cp .env.production.example .env
nano .env   # 또는 DSM 텍스트 편집기
```

**반드시 변경:**

```env
POSTGRES_PASSWORD=<강력한_비밀번호>
DB_PASSWORD=<동일_값>
HTTP_PORT=8080
```

`.env`는 git에 포함하지 않습니다.

## B-4. Docker Compose 기동 (최초)

```bash
cd /volume1/docker/essersales
docker compose -f docker-compose.nas.yml up -d --build
```

- `db` → `api` → `proxy` 순서 기동
- 최초 `db` 기동 시 `data/postgres/` 초기화 + `001_initial.sql` 적용

상태 확인:

```bash
docker compose -f docker-compose.nas.yml ps
```

## B-5. PostgreSQL 데이터 복원

**api/proxy 중지 후 복원 권장:**

```bash
docker compose -f docker-compose.nas.yml stop api proxy

cat data/backups/essersales-pg-latest.sql | \
  docker compose -f docker-compose.nas.yml exec -T db \
  psql -U essersales -d essersales -v ON_ERROR_STOP=1
```

또는 복원 스크립트:

```bash
chmod +x infra/scripts/restore-nas-from-backup.sh
./infra/scripts/restore-nas-from-backup.sh data/backups
```

> **주의:** 빈 DB에 dump를 덮어쓰면 기존 NAS 초기 데이터는 대체됩니다.  
> 최초 배포 시에는 B-4 직후 B-5를 바로 실행하면 됩니다.

## B-6. uploads / exports 복원

```bash
mkdir -p data/uploads data/exports

tar -xzf data/backups/essersales-uploads-*.tar.gz -C data/uploads
tar -xzf data/backups/essersales-exports-*.tar.gz -C data/exports
```

## B-7. 전체 스택 재기동

```bash
docker compose -f docker-compose.nas.yml up -d
```

## B-8. Health check

```bash
curl http://localhost:8080/api/v1/health
# 또는 브라우저: http://NAS_IP:8080/api/v1/health
```

기대 응답:

```json
{"ok":true,"service":"essersales-api",...}
```

## B-9. 프론트엔드 접속

브라우저: **http://NAS_IP:8080/**

DEV 배지 없음 (production build).  
Network 탭에서 API 호출이 `/api/v1/...` 인지 확인.

## B-10. 기능 검증 체크리스트

| # | 항목 | 확인 방법 | PASS |
|---|------|----------|------|
| 1 | Health | `/api/v1/health` → `ok: true` | [ ] |
| 2 | 대시보드 KPI | 매출 대시보드 → KPI 카드 표시 | [ ] |
| 3 | 상세 데이터 lazy load | 상세 탭 스크롤 → records 로드 | [ ] |
| 4 | 엑셀 업로드 | 플랫폼 업로드 → POST `/api/v1/uploads` | [ ] |
| 5 | 수기입력 (settings) | 파워프라이스/메모 저장 → PUT settings | [ ] |
| 6 | Export | 통합 export → GET `/api/v1/exports/integrated` | [ ] |
| 7 | legacy 미사용 | Network에 `:3001` 없음 | [ ] |

### DB 건수 확인 (선택)

```bash
docker compose -f docker-compose.nas.yml exec db \
  psql -U essersales -d essersales -c "SELECT COUNT(*) FROM sales_records;"
```

---

## NAS 실행 완료 체크리스트

- [ ] `/volume1/docker/essersales/` 구조 완성
- [ ] `.env` 비밀번호 변경
- [ ] `docker compose -f docker-compose.nas.yml ps` — 3서비스 Up
- [ ] PG dump 복원 완료
- [ ] uploads/exports 복원 완료
- [ ] http://NAS_IP:8080 접속 OK
- [ ] B-10 기능 검증 PASS

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|------|------|------|
| api unhealthy | `.env`의 `API_PORT=3002` 혼동 | NAS compose는 내부 3001 고정 — `.env`에서 `API_PORT` 제거 또는 무시 |
| 빈 대시보드 | PG 복원 안 됨 | B-5 dump 복원 재실행 |
| 502 on /api/v1 | api 미기동 | `docker compose logs api` |
| 업로드 실패 | uploads 권한 | `data/uploads` 소유권 확인 |
| export NO_DATA | 필터/데이터 없음 | DB 복원·필터 기간 확인 |

---

## 롤백

1. `docker compose -f docker-compose.nas.yml down`
2. `data/postgres/` 백업본으로 교체 (배포 전 스냅샷)
3. 이전 `dist/` 복원 후 `up -d`

legacy SQLite 롤백: [`phase-3-4b-legacy-removal.md`](phase-3-4b-legacy-removal.md) §12

---

## 외부 접속 (Phase 5 범위 외 — 문서만)

실제 설정은 하지 않습니다. Phase 6 또는 운영 시:

- [ ] 공유기 포트포워딩 (외부 → NAS 8080)
- [ ] NAS 방화벽 규칙
- [ ] Synology Reverse Proxy
- [ ] 도메인 DNS
- [ ] HTTPS 인증서 (Let's Encrypt)
- [ ] 백업 자동화 (Task Scheduler)
- [ ] 접근 권한·개인정보 검토

---

## 관련 문서

| 문서 | 내용 |
|------|------|
| [phase-4-nas-deployment-guide.md](phase-4-nas-deployment-guide.md) | 운영 아키텍처·볼륨·백업 |
| [phase-3-4b-legacy-removal.md](phase-3-4b-legacy-removal.md) | Legacy archive·롤백 |
| [deploy/nas-transfer/NAS-COPY-LIST-latest.md](../deploy/nas-transfer/NAS-COPY-LIST-latest.md) | 복사 파일 목록 |

---

## 부록: 로컬 준비 일괄 명령 (Windows)

```powershell
cd "C:\Users\Esser\Desktop\esser dev\essersales"
docker compose up -d api db
npm run build:production
npm run prepare:phase5-local
# → deploy/nas-transfer/<timestamp>/ 확인 후 NAS로 복사
```

## 부록: NAS 배포 일괄 명령

```bash
cd /volume1/docker/essersales
cp .env.production.example .env && nano .env
docker compose -f docker-compose.nas.yml up -d --build
./infra/scripts/restore-nas-from-backup.sh data/backups
curl http://localhost:8080/api/v1/health
```
