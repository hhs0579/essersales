#!/usr/bin/env bash
# essersales — 일일 DB 백업 (Synology 작업 스케줄러용)
#
# DSM > 제어판 > 작업 스케줄러 > 생성 > 예약된 작업 > 사용자 정의 스크립트
#   사용자: root / 매일 03:30
#   스크립트: bash /volume1/docker/essersales/infra/scripts/nas-daily-backup.sh
#
# 환경변수(선택):
#   BACKUP_ROOT     기본 /volume1/docker/essersales-backups (프로젝트 폴더 밖)
#   KEEP_DAILY      일일 덤프 보존 개수 (기본 14)
#   KEEP_MONTHLY    매월 1일 덤프 보존 개수 (기본 12)
#   DB_CONTAINER    기본 essersales-nas-db-1

set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

BACKUP_ROOT="${BACKUP_ROOT:-/volume1/docker/essersales-backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
DB_CONTAINER="${DB_CONTAINER:-essersales-nas-db-1}"
DB_NAME="${POSTGRES_DB:-essersales}"
DB_USER="${POSTGRES_USER:-essersales}"
PREFIX="${BACKUP_PREFIX:-daily}"

TS="$(date +%Y%m%d-%H%M)"
DAILY_DIR="$BACKUP_ROOT/db/daily"
MONTHLY_DIR="$BACKUP_ROOT/db/monthly"
mkdir -p "$DAILY_DIR" "$MONTHLY_DIR" "$BACKUP_ROOT/uploads"

OUT="$DAILY_DIR/essersales-${PREFIX}-${TS}.dump"
TMP="$OUT.tmp"

log() { echo "[backup $(date +%H:%M:%S)] $*"; }

log "pg_dump -> $OUT"
rm -f "$TMP"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -Z6 --no-owner --no-acl > "$TMP"

SIZE="$(wc -c < "$TMP" | tr -d ' ')"
if [ "${SIZE:-0}" -lt 1024 ]; then
  rm -f "$TMP"
  log "ERR: dump too small (${SIZE} bytes)"
  exit 2
fi

if ! docker exec -i "$DB_CONTAINER" pg_restore -l < "$TMP" > /dev/null; then
  rm -f "$TMP"
  log "ERR: dump is not readable by pg_restore"
  exit 3
fi
mv "$TMP" "$OUT"
log "OK ${SIZE} bytes"

if [ "$PREFIX" = "daily" ] && [ "$(date +%d)" = "01" ]; then
  cp "$OUT" "$MONTHLY_DIR/"
  log "monthly copy saved"
fi

# 업로드 원본 복사는 보조 — Synology ACL 공유폴더에서 소유자·권한 복사가 실패할 수 있어
# 내용·시각만 복사하고, 실패해도 DB 덤프 성공은 유지(경고만)
if [ -d "$PROJECT_DIR/data/uploads" ]; then
  log "uploads copy"
  if command -v rsync > /dev/null 2>&1; then
    rsync -rt --no-perms --no-owner --no-group "$PROJECT_DIR/data/uploads/" "$BACKUP_ROOT/uploads/" \
      || log "WARN: uploads rsync failed (exit $?) - DB dump is OK"
  else
    cp -r "$PROJECT_DIR/data/uploads/." "$BACKUP_ROOT/uploads/" \
      || log "WARN: uploads cp failed - DB dump is OK"
  fi
fi

# 일치 파일이 없으면 ls가 실패 코드를 내므로(pipefail) 정리 단계는 실패로 취급하지 않음
prune() {
  local dir="$1" keep="$2" pattern="$3"
  local files
  files="$(ls -1t "$dir"/$pattern 2>/dev/null || true)"
  [ -z "$files" ] && return 0
  printf '%s\n' "$files" | tail -n +"$((keep + 1))" | while read -r f; do
    [ -n "$f" ] || continue
    rm -f "$f"
    log "pruned $(basename "$f")"
  done
  return 0
}
prune "$DAILY_DIR" "$KEEP_DAILY" "essersales-daily-*.dump"
prune "$DAILY_DIR" "$KEEP_DAILY" "essersales-predeploy-*.dump"
prune "$MONTHLY_DIR" "$KEEP_MONTHLY" "essersales-*.dump"

log "done -> $BACKUP_ROOT"
