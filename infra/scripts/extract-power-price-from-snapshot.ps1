# Synology 스냅샷에서 파워프라이스 설정(app_settings power_price)만 꺼내 docs\power_price_restore.json 으로 저장
# 운영 DB는 건드리지 않음 (스냅샷 복사본으로 임시 postgres 컨테이너를 띄워 조회 후 삭제)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File infra\scripts\extract-power-price-from-snapshot.ps1
#   powershell -ExecutionPolicy Bypass -File infra\scripts\extract-power-price-from-snapshot.ps1 -Before "2026-10-06 09:19"
#
# 비밀번호는 SSH 접속 1회 + sudo 1회 + 파일 받기 1회 입력

param(
  [string]$NasHost = "192.168.0.245",
  [string]$NasUser = "",
  [string]$Before = "2026-10-06 09:19",
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if (-not $NasUser) { $NasUser = [string]$env:NAS_USER }
if (-not $NasUser) { $NasUser = Read-Host "NAS DSM login ID (English)" }
$NasUser = $NasUser.Trim()

$LocalRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $OutFile) { $OutFile = Join-Path $LocalRoot "docs\power_price_restore.json" }

$beforeKey = ($Before -replace '[^0-9]', '')
if ($beforeKey.Length -lt 12) { throw "-Before must look like 'YYYY-MM-DD HH:MM'" }
$beforeKey = $beforeKey.Substring(0, 12)

$remote = @'
set -u
BEFORE="__BEFORE__"
D="$(command -v docker || echo /usr/local/bin/docker)"

ROOTS=""
for v in /volume*; do
  [ -d "$v/docker/#snapshot" ] && ROOTS="$ROOTS $v/docker/#snapshot"
  [ -d "$v/@sharesnap/docker" ] && ROOTS="$ROOTS $v/@sharesnap/docker"
done

echo "snapshot roots:${ROOTS:- (none)}"
if [ -z "$ROOTS" ]; then
  echo "--- diagnostics ---"
  for v in /volume*; do
    echo "[$v]"; ls -d "$v"/docker "$v"/@sharesnap 2>/dev/null
    [ -d "$v/@sharesnap" ] && ls "$v/@sharesnap"
  done
  echo "ERR: no snapshot folder for share 'docker'. Check DSM > Snapshot Replication > Snapshots > docker."
  exit 2
fi

PICK=""
PICKKEY=""
for r in $ROOTS; do
  echo "== $r"; ls "$r"
  for p in "$r"/*; do
    [ -d "$p/essersales/data/postgres" ] || continue
    name="$(basename "$p")"
    key="$(echo "$name" | sed 's/^GMT[+-][0-9]*-//' | tr -cd '0-9' | cut -c1-12)"
    [ ${#key} -eq 12 ] || continue
    if [ "$key" \< "$BEFORE" ] && { [ -z "$PICKKEY" ] || [ "$key" \> "$PICKKEY" ]; }; then
      PICK="$p"; PICKKEY="$key"
    fi
  done
done

WORK="/volume1/docker/pp-restore"
if [ -z "$PICK" ]; then
  echo "ERR: no snapshot before $BEFORE with essersales/data/postgres"
  exit 3
fi
echo "PICKED: $(basename "$PICK")"

"$D" rm -f pp-restore >/dev/null 2>&1 || true
rm -rf "$WORK"
mkdir -p "$WORK"
cp -a "$PICK/essersales/data/postgres" "$WORK/postgres"
rm -f "$WORK/postgres/postmaster.pid"

"$D" run -d --name pp-restore -e POSTGRES_PASSWORD=x \
  -v "$WORK/postgres:/var/lib/postgresql/data" postgres:16-alpine >/dev/null

ok=""
i=0
while [ $i -lt 60 ]; do
  if "$D" exec pp-restore pg_isready -U essersales -d essersales >/dev/null 2>&1; then ok=1; break; fi
  i=$((i + 1))
  sleep 2
done
if [ -z "$ok" ]; then
  echo "ERR: temp postgres did not start"; "$D" logs --tail 30 pp-restore; "$D" rm -f pp-restore >/dev/null 2>&1
  exit 4
fi

Q="from app_settings where scope='power_price' and kind='power_price'"
echo "SUMMARY(updated_at|confirmLines|costMaster|costsFilled):"
"$D" exec pp-restore psql -U essersales -d essersales -At -c \
  "select updated_at, coalesce(jsonb_array_length(data->'confirmLines'),0), coalesce(jsonb_array_length(data->'costMaster'),0), (select count(*) from jsonb_array_elements(coalesce(data->'costMaster','[]'::jsonb)) e where coalesce(e->>'unitCost','') <> '') $Q"
"$D" exec pp-restore psql -U essersales -d essersales -At -c "select data $Q" > "$WORK/power_price.json"
"$D" rm -f pp-restore >/dev/null 2>&1
chmod 755 "$WORK"; chmod 644 "$WORK/power_price.json"
echo "BYTES: $(wc -c < "$WORK/power_price.json")"
echo "DONE"
'@
$remote = $remote.Replace("__BEFORE__", $beforeKey).Replace("`r`n", "`n")
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))

Write-Host "=== 1/2 NAS: snapshot before $Before -> temp postgres -> extract ===" -ForegroundColor Cyan
Write-Host "SSH password, then sudo password (same DSM password) will be asked." -ForegroundColor Yellow
& ssh -t "$NasUser@$NasHost" "echo $b64 | base64 -d > /tmp/pp-extract.sh && sudo bash /tmp/pp-extract.sh; rc=`$?; rm -f /tmp/pp-extract.sh; exit `$rc"
if ($LASTEXITCODE -ne 0) { throw "NAS extract failed (exit $LASTEXITCODE). See messages above." }

Write-Host "=== 2/2 download -> $OutFile ===" -ForegroundColor Cyan
Write-Host "SSH password will be asked once more." -ForegroundColor Yellow
$encoded = & ssh "$NasUser@$NasHost" "base64 /volume1/docker/pp-restore/power_price.json | tr -d '\n'"
if ($LASTEXITCODE -ne 0 -or -not $encoded) { throw "download failed (exit $LASTEXITCODE)" }
$bytes = [Convert]::FromBase64String(($encoded -join '').Trim())
[IO.File]::WriteAllBytes($OutFile, $bytes)
Write-Host ("saved {0} bytes -> {1}" -f $bytes.Length, $OutFile) -ForegroundColor Green
