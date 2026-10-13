#!/usr/bin/env bash
# essersales Phase 5 — NAS 데이터 복원 (NAS 호스트에서 실행)
#
# Usage ( /volume1/docker/essersales/ ):
#   chmod +x infra/scripts/restore-nas-from-backup.sh
#   ./infra/scripts/restore-nas-from-backup.sh <백업폴더 또는 .dump/.sql 파일>
#
#   예) ./infra/scripts/restore-nas-from-backup.sh /volume1/docker/essersales-backups/db/daily
#       ./infra/scripts/restore-nas-from-backup.sh /volume1/docker/essersales-backups/db/daily/essersales-daily-20261007-0330.dump
#
# .dump (nas-daily-backup.sh, pg_dump -Fc) → pg_restore --clean --if-exists
# .sql  (구 backup-postgres.sh)            → 스키마를 비운 뒤 psql
#
# Prereq: docker compose -f docker-compose.nas.yml up -d db (healthy)

set -euo pipefail

TARGET="${1:-./data/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.nas.yml}"
DB_NAME="${POSTGRES_DB:-essersales}"
DB_USER="${POSTGRES_USER:-essersales}"

if [ -f "$TARGET" ]; then
  DUMP="$TARGET"
  BACKUP_DIR="$(dirname "$TARGET")"
else
  BACKUP_DIR="$TARGET"
  DUMP="$(ls -t "$BACKUP_DIR"/essersales-*.dump 2>/dev/null | head -1 || true)"
  if [ -z "$DUMP" ]; then
    DUMP="$(ls -t "$BACKUP_DIR"/essersales-pg-*.sql 2>/dev/null | head -1 || true)"
  fi
fi

if [ -z "${DUMP:-}" ] || [ ! -f "$DUMP" ]; then
  echo "[FAIL] dump not found: $TARGET"
  exit 1
fi

echo "[..] 복원 대상: $DUMP"
read -r -p "현재 DB를 이 백업으로 덮어씁니다. 계속하려면 YES 입력: " ans
[ "$ans" = "YES" ] || { echo "취소"; exit 1; }

echo "[..] Stopping api/proxy..."
docker compose -f "$COMPOSE_FILE" stop api proxy 2>/dev/null || true

case "$DUMP" in
  *.dump)
    echo "[..] pg_restore --clean --if-exists"
    docker compose -f "$COMPOSE_FILE" exec -T db \
      pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --no-acl \
      < "$DUMP"
    ;;
  *.sql)
    echo "[..] reset public schema + psql"
    docker compose -f "$COMPOSE_FILE" exec -T db \
      psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
      -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    docker compose -f "$COMPOSE_FILE" exec -T db \
      psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$DUMP"
    ;;
  *)
    echo "[FAIL] unknown dump type: $DUMP"
    exit 1
    ;;
esac

# 구 backup-postgres.sh tar 는 `-C data uploads` 로 만들어 uploads/ 경로를 포함 → ./data 에 풀어야 함
for label in uploads exports; do
  ARCHIVE="$(ls -t "${BACKUP_DIR}"/essersales-${label}-*.tar.gz 2>/dev/null | head -1 || true)"
  if [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    echo "[..] Restoring ${label} from $ARCHIVE"
    mkdir -p ./data
    tar -xzf "$ARCHIVE" -C ./data
    echo "[OK] ${label} restored"
  fi
done

echo "[..] Starting full stack..."
docker compose -f "$COMPOSE_FILE" up -d

echo "[OK] Restore complete. Check:"
echo "     curl http://localhost:\${HTTP_PORT:-8080}/api/v1/health"
