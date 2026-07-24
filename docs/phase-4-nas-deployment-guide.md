# Phase 4 NAS Deployment Guide

## 1. 목적

Phase 3-4B에서 PG 단일 스택 전환이 완료되었으므로, **NAS에 올릴 수 있는 운영용 Docker/Nginx/빌드 구조**를 정리한다.

이번 Phase 4에서는 **실제 NAS 배포를 실행하지 않는다.**  
패키징·문서·로컬 검증만 수행하고, 실제 배포는 **Phase 5**에서 진행한다.

---

## 2. 최종 운영 스택

```text
Browser
   ↓
nginx (proxy :8080)
   ├── /           → Vue dist (정적 SPA)
   └── /api/v1/*   → Node.js PG API (:3001 internal)
                        ↓
                   PostgreSQL 16 (internal)
```

| 구성 | 역할 |
|------|------|
| `proxy` | Vue `dist/` 서빙 + API reverse proxy |
| `api` | Express PG API, uploads/exports 처리 |
| `db` | PostgreSQL, pgdata 영구 저장 |

**legacy SQLite API는 사용하지 않습니다.**

---

## 3. NAS 폴더 구조

권장 경로 (Synology 예시):

```text
/volume1/docker/essersales/
├── docker-compose.nas.yml
├── .env                          # git 제외
├── dist/                         # npm run build:production
├── infra/
│   ├── nginx/nas.conf
│   └── db/
├── backend/
├── archive/
│   └── legacy-sqlite-server/
└── data/
    ├── postgres/                 # PostgreSQL data
    ├── uploads/                  # 업로드 원본
    ├── exports/                  # export 임시/캐시
    ├── backups/                  # pg_dump, tar 백업
    └── logs/                     # (선택) 운영 로그
```

프로젝트 전체를 NAS에 복사하거나, git clone 후 `dist/`만 빌드해서 배치합니다.

---

## 4. 운영 env 설정

`.env.production.example`을 `.env`로 복사하고 **반드시 비밀번호 변경**:

```env
POSTGRES_DB=essersales
POSTGRES_USER=essersales
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD

DB_HOST=db
DB_PORT=5432
DB_NAME=essersales
DB_USER=essersales
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD

NODE_ENV=production
API_PORT=3001
UPLOAD_DIR=/app/data/uploads
EXPORT_DIR=/app/data/exports

HTTP_PORT=8080

VITE_API_MODE=pg
VITE_KPI_SOURCE=server
VITE_WRITE_API_MODE=pg
VITE_EXPORT_API_MODE=pg
VITE_PG_API_BASE=/api/v1
```

주의:

- `.env`는 **git에 커밋하지 않음**
- `POSTGRES_PASSWORD`와 `DB_PASSWORD`는 **동일 값** 권장
- `VITE_LEGACY_API_BASE`는 운영 env에 포함하지 않음 (롤백은 archive 문서 참조)

---

## 5. Vue production build

호스트(개발 PC 또는 NAS)에서:

```bash
npm install
npm run build:production
```

확인:

```bash
ls dist/index.html
```

빌드 시 `.env.production`이 로드되어 `VITE_PG_API_BASE=/api/v1`이 번들에 포함됩니다.  
브라우저는 nginx와 **same-origin**으로 API를 호출합니다.

---

## 6. Docker Compose NAS 실행

### Phase 5 (NAS) 실행 명령

```bash
cd /volume1/docker/essersales
npm run build:production
docker compose -f docker-compose.nas.yml up -d --build
```

### 서비스 구성

| 서비스 | 외부 노출 | 설명 |
|--------|----------|------|
| `proxy` | `HTTP_PORT` (기본 8080) | 유일한 외부 진입점 |
| `api` | 없음 | internal network only (`API_PORT=3001` 고정, `.env`의 `API_PORT=3002` 무시) |
| `db` | 없음 | internal network only |

### 로컬 사전 검증 (Phase 4)

```bash
cp .env.production.example .env
# .env 에 POSTGRES_PASSWORD / DB_PASSWORD 설정

npm run build:production
npm run nas:up
npm run verify:production-compose
```

---

## 7. Nginx proxy 구조

설정 파일: `infra/nginx/nas.conf`

```nginx
location / {
  try_files $uri $uri/ /index.html;
}

location /api/v1/ {
  proxy_pass http://api:3001/api/v1/;
}
```

기능:

- SPA fallback (`index.html`)
- `/api/v1` → `api:3001`
- 업로드 `client_max_body_size 50m`
- export `proxy_read_timeout 600s`
- gzip 적용
- `/api/v1/health` health check

---

## 8. Health check

```bash
curl http://NAS_IP:8080/api/v1/health
```

기대 응답: `{"ok":true,...}`

Docker healthcheck:

- `api`: `GET /api/v1/health` (컨테이너 내부)
- `db`: `pg_isready`
- `proxy`: `api` healthy 후 기동

---

## 9. 업로드/다운로드 확인

### 업로드

1. 브라우저 `http://NAS_IP:8080/` 접속
2. 플랫폼 업로드 페이지에서 엑셀 업로드
3. Network 탭: `POST /api/v1/uploads/...` 확인

### Export

1. 대시보드에서 export 실행
2. Network 탭: `GET /api/v1/exports/integrated` 확인
3. `.xlsx` 파일 다운로드 확인

---

## 10. PostgreSQL 데이터 확인

```bash
docker compose -f docker-compose.nas.yml exec db \
  psql -U essersales -d essersales -c "SELECT COUNT(*) FROM sales_records;"
```

데이터 파일: `./data/postgres/`

---

## 11. 백업 방법

### 자동 스크립트

```bash
chmod +x infra/scripts/backup-postgres.sh
./infra/scripts/backup-postgres.sh
```

Windows:

```powershell
powershell -File infra/scripts/backup-postgres.ps1
```

### 백업 대상

| 대상 | 파일명 예시 |
|------|------------|
| PostgreSQL | `essersales-pg-YYYYMMDD-HHmmss.sql` |
| uploads | `essersales-uploads-YYYYMMDD-HHmmss.tar.gz` |
| exports | `essersales-exports-YYYYMMDD-HHmmss.tar.gz` |
| legacy archive | `essersales-legacy-archive-YYYYMMDD-HHmmss.tar.gz` |

저장 위치: `./data/backups/`

`.env`는 백업에 **포함하지 않음** — 별도 안전 보관.

### 권장 주기

- PostgreSQL: 매일 1회 이상
- uploads/exports: 주 1회 또는 용량 기준
- 배포 전·후: 수동 스냅샷

---

## 12. 복구 방법

### PostgreSQL 복구

```bash
docker compose -f docker-compose.nas.yml stop api
cat data/backups/essersales-pg-YYYYMMDD-HHmmss.sql | \
  docker compose -f docker-compose.nas.yml exec -T db \
  psql -U essersales -d essersales
docker compose -f docker-compose.nas.yml start api
```

### uploads / exports 복구

```bash
tar -xzf data/backups/essersales-uploads-YYYYMMDD-HHmmss.tar.gz -C data
tar -xzf data/backups/essersales-exports-YYYYMMDD-HHmmss.tar.gz -C data
```

---

## 13. 롤백 방법

### A. 이전 Vue/API 빌드로 롤백

1. 이전 `dist/` 백업 복원
2. `docker compose -f docker-compose.nas.yml up -d --build api proxy`

### B. legacy SQLite로 롤백 (비권장)

`archive/legacy-sqlite-server/` 복원 — Phase 3-4B 문서 §12 참조.  
NAS 운영에서는 PG 롤백(A)만 권장.

### C. DB 스냅샷 롤백

§12 PostgreSQL 복구 절차 사용.

---

## 14. 외부 접속 전 체크리스트

이번 Phase 4에서는 **실제 설정하지 않음**. Phase 5/운영 시 확인:

- [ ] 공유기 포트포워딩 (외부 → NAS `HTTP_PORT`)
- [ ] NAS 방화벽 (허용 IP 대역 제한 검토)
- [ ] Reverse Proxy (Synology DSM / nginx)
- [ ] 도메인 DNS A/AAAA 레코드
- [ ] HTTPS 인증서 (Let's Encrypt / Synology)
- [ ] 관리자 계정·SSH 키 보안
- [ ] 백업 자동화 (Task Scheduler / cron)
- [ ] 외부 공개 전 개인정보·매출 데이터 접근 권한 검토
- [ ] 기본 비밀번호 변경 완료
- [ ] `db`·`api` 포트 외부 미노출 확인

---

## 15. HTTPS/도메인 연결 시 주의사항

- nginx 앞단에 Synology Reverse Proxy 또는 별도 TLS termination 권장
- `VITE_PG_API_BASE=/api/v1` (상대 경로)이므로 도메인 변경 시 **Vue 재빌드 불필요** (same-origin 유지 시)
- `X-Forwarded-Proto`는 `nas.conf`에서 설정됨
- Cloudflare Tunnel 사용 시 `HTTP_PORT` 대신 tunnel endpoint 연결
- HSTS·인증서 자동 갱신 모니터링 설정

---

## 16. 운영 전 최종 체크리스트

### 빌드·배포

- [ ] `npm run build:production` 성공
- [ ] `dist/index.html` 존재
- [ ] `.env` 비밀번호 변경 완료
- [ ] `docker compose -f docker-compose.nas.yml config` 오류 없음
- [ ] `npm run verify:production-compose` PASS

### 기능

- [ ] `/api/v1/health` OK
- [ ] KPI summary/daily 정상
- [ ] 엑셀 업로드 정상
- [ ] 통합 export 다운로드 정상
- [ ] settings 저장 정상
- [ ] legacy API 호출 0회

### 데이터·보안

- [ ] `data/postgres` 볼륨 마운트 확인
- [ ] 초기 백업 1회 실행
- [ ] `.env` git 미포함 확인
- [ ] `db`·`api` 외부 포트 미노출

### Phase 5 (실제 NAS)

- [ ] 프로젝트 NAS 복사 / git pull
- [ ] `docker compose -f docker-compose.nas.yml up -d --build`
- [ ] 팀원 브라우저 접속 테스트
- [ ] 백업 스케줄 등록

---

## 부록: 로컬 vs NAS compose 비교

| 항목 | `docker-compose.yml` (dev) | `docker-compose.nas.yml` (운영) |
|------|---------------------------|--------------------------------|
| Vue | 별도 `npm run dev` | nginx가 `dist/` 서빙 |
| API 포트 | `:3002` 노출 | internal only |
| DB 포트 | `:5432` 노출 | internal only |
| 볼륨 | named volumes | `./data/*` bind mounts |
| 진입점 | API 직접 / dev Vite | proxy `:8080` |
