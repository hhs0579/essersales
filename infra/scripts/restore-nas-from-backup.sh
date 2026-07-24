#!/usr/bin/env bash
# essersales Phase 5 — NAS 데이터 복원 (NAS 호스트에서 실행)
#
# Usage ( /volume1/docker/essersales/ ):
#   chmod +x infra/scripts/restore-nas-from-backup.sh
#   ./infra/scripts/restore-nas-from-backup.sh deploy/nas-transfer/YYYYMMDD-HHMMSS/backups
#
# Prereq:
#   docker compose -f docker-compose.nas.yml up -d db
#   db healthy 후 실행 (api는 복원 중 stop 권장)

set -euo pipefail

BACKUP_DIR="${1:-./data/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.nas.yml}"
DB_NAME="${POSTGRES_DB:-essersales}"
DB_USER="${POSTGRES_USER:-essersales}"

PG_SQL="${BACKUP_DIR}/essersales-pg-latest.sql"
if [ ! -f "$PG_SQL" ]; then
  PG_SQL="$(ls -t "${BACKUP_DIR}"/essersales-pg-*.sql 2>/dev/null | head -1)"
fi

if [ -z "$PG_SQL" ] || [ ! -f "$PG_SQL" ]; then
  echo "[FAIL] PostgreSQL dump not found in $BACKUP_DIR"
  exit 1
fi

echo "[..] Stopping api (if running)..."
docker compose -f "$COMPOSE_FILE" stop api proxy 2>/dev/null || true

echo "[..] Restoring PostgreSQL from $PG_SQL"
cat "$PG_SQL" | docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1

for label in uploads exports; do
  ARCHIVE="$(ls -t "${BACKUP_DIR}"/essersales-${label}-*.tar.gz 2>/dev/null | head -1)"
  if [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    echo "[..] Restoring ${label} from $ARCHIVE"
    mkdir -p "./data/${label}"
    tar -xzf "$ARCHIVE" -C "./data/${label}"
    echo "[OK] ${label} restored"
  else
    echo "[SKIP] No ${label} archive in $BACKUP_DIR"
  fi
done

echo "[..] Starting full stack..."
docker compose -f "$COMPOSE_FILE" up -d

echo "[OK] Restore complete. Check:"
echo "     curl http://localhost:\${HTTP_PORT:-8080}/api/v1/health"
