#!/usr/bin/env bash
# essersales — NAS PostgreSQL / uploads / exports backup
# Usage (on NAS host, project root):
#   chmod +x infra/scripts/backup-postgres.sh
#   ./infra/scripts/backup-postgres.sh
#
# Requires: docker compose -f docker-compose.nas.yml running

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.nas.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-./data/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_NAME="${POSTGRES_DB:-essersales}"
DB_USER="${POSTGRES_USER:-essersales}"

mkdir -p "$BACKUP_ROOT"

echo "[backup] PostgreSQL dump → $BACKUP_ROOT/essersales-pg-${TIMESTAMP}.sql"
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl \
  > "$BACKUP_ROOT/essersales-pg-${TIMESTAMP}.sql"

if [ -d "./data/uploads" ]; then
  echo "[backup] uploads → $BACKUP_ROOT/essersales-uploads-${TIMESTAMP}.tar.gz"
  tar -czf "$BACKUP_ROOT/essersales-uploads-${TIMESTAMP}.tar.gz" -C data uploads
fi

if [ -d "./data/exports" ]; then
  echo "[backup] exports → $BACKUP_ROOT/essersales-exports-${TIMESTAMP}.tar.gz"
  tar -czf "$BACKUP_ROOT/essersales-exports-${TIMESTAMP}.tar.gz" -C data exports
fi

if [ -d "./archive/legacy-sqlite-server" ]; then
  echo "[backup] legacy archive snapshot → $BACKUP_ROOT/essersales-legacy-archive-${TIMESTAMP}.tar.gz"
  tar -czf "$BACKUP_ROOT/essersales-legacy-archive-${TIMESTAMP}.tar.gz" -C archive legacy-sqlite-server
fi

ln -sf "essersales-pg-${TIMESTAMP}.sql" "$BACKUP_ROOT/essersales-pg-latest.sql" 2>/dev/null || true

echo "[backup] Done. Files in $BACKUP_ROOT"
echo "[backup] NOTE: .env is NOT included — store credentials separately and securely."
