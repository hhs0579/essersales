# essersales -> Synology NAS file deploy (Windows PowerShell 5.1+)
# Usage:
#   powershell -ExecutionPolicy Bypass -File infra\scripts\deploy-to-nas.ps1
#   powershell -ExecutionPolicy Bypass -File infra\scripts\deploy-to-nas.ps1 -SkipBuild -SkipDocker
#
# IMPORTANT: Use DSM login ID (English/numbers), NOT Korean display name.

param(
  [string]$NasHost = "192.168.0.245",
  [string]$NasShare = "docker",
  [string]$NasUser = "",
  [string]$LocalRoot = "",
  [switch]$SkipBuild,
  [switch]$SkipDocker
)

function Resolve-JsRuntime {
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if ($bun) {
    return @{ Name = "bun"; Exe = $bun.Source }
  }
  $bunHome = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path -LiteralPath $bunHome) {
    return @{ Name = "bun"; Exe = $bunHome }
  }
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) {
    return @{ Name = "npm"; Exe = $npm.Source }
  }
  return $null
}

function Invoke-ProductionBuild {
  param([string]$Root)
  $rt = Resolve-JsRuntime
  if (-not $rt) {
    throw "bun/npm not found. This PC uses bun — install bun, or open a terminal where `bun -v` works, then rerun."
  }
  Write-Host ("  using " + $rt.Name + " (" + $rt.Exe + ")") -ForegroundColor DarkGray
  Push-Location $Root
  try {
    & $rt.Exe run build:production
    if ($LASTEXITCODE -ne 0) { throw "build:production failed (exit $LASTEXITCODE)" }
  }
  finally {
    Pop-Location
  }
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-NetUseQuiet {
  param([string]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    cmd.exe /c ("net use " + $Arguments) 1>$null 2>$null
    return $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $prev
  }
}

if (-not $LocalRoot) {
  $LocalRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

if (-not $NasUser) {
  $NasUser = [string]$env:NAS_USER
}
if (-not $NasUser) {
  Write-Host "Use DSM login ID from Control Panel > User (often English like admin)." -ForegroundColor Yellow
  Write-Host "Korean name like display name usually FAILS for SMB." -ForegroundColor Yellow
  $NasUser = Read-Host "NAS DSM login ID"
}

$smbUser = $NasUser.Trim()
if ($smbUser -match '[\uAC00-\uD7A3]') {
  Write-Host ""
  Write-Host "WARNING: login ID contains Hangul. SMB usually needs the account NAME (영문 ID)," -ForegroundColor Red
  Write-Host "not the 'description/display name'. Check DSM > Control Panel > User." -ForegroundColor Red
  Write-Host ""
}

if ($smbUser -notmatch '[\\/]') {
  $smbUser = $NasHost + '\' + $smbUser
}
$smbUser = $smbUser -replace '/', '\'

$NasShareUnc = '\\' + $NasHost + '\' + $NasShare
$NasUnc = $NasShareUnc + '\essersales'

Write-Host "=== essersales NAS deploy ===" -ForegroundColor Cyan
Write-Host "Local: $LocalRoot"
Write-Host "NAS:   $NasUnc"
Write-Host "SMB user: $smbUser"
Write-Host ""

if (-not $SkipBuild) {
  Write-Host "[1/3] Production build..." -ForegroundColor Yellow
  Invoke-ProductionBuild -Root $LocalRoot
  Write-Host "Build OK" -ForegroundColor Green
}
else {
  Write-Host "[1/3] Build skipped (-SkipBuild)" -ForegroundColor DarkGray
}

Write-Host "[2/3] NAS login ($smbUser)..." -ForegroundColor Yellow
$plainPass = [string]$env:NAS_PASSWORD
if (-not $plainPass) {
  Write-Host "  Enter DSM password then Enter (no echo while typing)" -ForegroundColor DarkGray
  $securePass = Read-Host "NAS DSM password" -AsSecureString
  if (-not $securePass -or $securePass.Length -eq 0) {
    throw "Password is empty"
  }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
  try {
    $plainPass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
  }
}

Write-Host "[2/3] Map drive and copy..." -ForegroundColor Yellow
$driveName = "Z"
$existing = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
if ($existing) {
  Remove-PSDrive -Name $driveName -Force -ErrorAction SilentlyContinue
}

# Cleanup old mappings (exit 2 = not found = OK)
[void](Invoke-NetUseQuiet ($NasShareUnc + ' /delete /y'))
[void](Invoke-NetUseQuiet ('\\' + $NasHost + '\IPC$ /delete /y'))
[void](Invoke-NetUseQuiet ($driveName + ': /delete /y'))

$prevEa = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$netArgs = $driveName + ': "' + $NasUnc + '" /user:' + $smbUser + ' "' + $plainPass + '" /persistent:no'
$netOut = cmd.exe /c ("net use " + $netArgs) 2>&1
$netCode = $LASTEXITCODE
$ErrorActionPreference = $prevEa

if ($netCode -ne 0) {
  Write-Host ($netOut | Out-String) -ForegroundColor Red
  Write-Host ""
  Write-Host "SMB login failed. Check:" -ForegroundColor Yellow
  Write-Host "  1) Use DSM login ID (Control Panel > User > Name column), not Korean display name"
  Write-Host ("  2) Explorer: \\" + $NasHost + "\" + $NasShare)
  Write-Host "  3) Shared folder docker must allow this user R/W"
  Write-Host ("  4) Clear Credential Manager for " + $NasHost)
  Write-Host "  5) If 2FA is on, SMB may need an app password"
  throw ("net use failed (exit " + $netCode + ")")
}

$NasRoot = $driveName + ':\'

try {
  $copyItems = @(
    @{ Src = "dist"; Dst = "dist" },
    @{ Src = "src\utils"; Dst = "src\utils" },
    @{ Src = "src\config"; Dst = "src\config" },
    @{ Src = "src\constants"; Dst = "src\constants" },
    @{ Src = "src\services\adapters"; Dst = "src\services\adapters" },
    @{ Src = "backend"; Dst = "backend" },
    @{ Src = "infra\db"; Dst = "infra\db" },
    @{ Src = "infra\nginx"; Dst = "infra\nginx" },
    @{ Src = "infra\scripts\nas-daily-backup.sh"; Dst = "infra\scripts\nas-daily-backup.sh" },
    @{ Src = "infra\scripts\restore-nas-from-backup.sh"; Dst = "infra\scripts\restore-nas-from-backup.sh" },
    @{ Src = "docker-compose.nas.yml"; Dst = "docker-compose.nas.yml" }
  )

  foreach ($item in $copyItems) {
    $src = Join-Path $LocalRoot $item.Src
    if (-not (Test-Path -LiteralPath $src)) {
      throw ("Missing local path: " + $src)
    }
    Write-Host ("  -> " + $item.Dst)

    if (Test-Path -LiteralPath $src -PathType Leaf) {
      $dstFile = Join-Path $NasRoot $item.Dst
      $dstParent = Split-Path -Parent $dstFile
      if ($dstParent -and -not (Test-Path -LiteralPath $dstParent)) {
        New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
      }
      Copy-Item -LiteralPath $src -Destination $dstFile -Force
      continue
    }

    $dst = Join-Path $NasRoot $item.Dst
    if (-not (Test-Path -LiteralPath $dst)) {
      New-Item -ItemType Directory -Path $dst -Force | Out-Null
    }
    $roboDst = Join-Path $NasUnc $item.Dst
    $roboArgs = @($src, $roboDst, '/E', '/MT:8', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/DCOPY:DAT')
    if ($item.Src -eq 'backend') {
      $roboArgs += @('/XD', 'node_modules')
    }
    & robocopy @roboArgs | Out-Null
    $rc = $LASTEXITCODE
    if ($rc -ge 8) {
      throw ("robocopy failed for " + $item.Dst + " (exit " + $rc + ")")
    }
  }
}
finally {
  [void](Invoke-NetUseQuiet ($driveName + ': /delete /y'))
  Remove-PSDrive -Name $driveName -Force -ErrorAction SilentlyContinue
}

Write-Host "Copy OK" -ForegroundColor Green

$sshUser = $NasUser.Trim()
if ($sshUser -match '[\\/]') {
  $sshUser = ($sshUser -split '[\\/]')[-1]
}

if ($SkipDocker) {
  Write-Host "[3/3] Docker restart skipped (-SkipDocker)" -ForegroundColor DarkGray
  Write-Host "NAS SSH:" -ForegroundColor Cyan
  Write-Host "  cd /volume1/docker/essersales"
  Write-Host "  sudo docker compose -f docker-compose.nas.yml up -d --build"
  exit 0
}

Write-Host "[3/3] NAS Docker restart (SSH)..." -ForegroundColor Yellow
Write-Host "  'Could not chdir to home directory' on Synology SSH is harmless." -ForegroundColor DarkGray
Write-Host "  api/proxy restart only (source mounted) - usually under 1 minute." -ForegroundColor DarkGray
$sshTarget = $sshUser + "@" + $NasHost
$remoteInner = @(
  "export PATH=`$PATH:/usr/local/bin:/usr/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Docker/target/usr/bin"
  "cd /volume1/docker/essersales || exit 7"
  "sed -i 's/\r`$//' infra/scripts/*.sh"
  "echo '[deploy] pre-deploy DB dump'"
  "BACKUP_PREFIX=predeploy bash infra/scripts/nas-daily-backup.sh || { echo '[deploy] backup FAILED - abort'; exit 9; }"
  "docker compose -f docker-compose.nas.yml up -d --force-recreate api proxy"
  "ok=; for i in `$(seq 1 40); do if curl -fsS http://127.0.0.1:`${HTTP_PORT:-8080}/api/v1/health >/dev/null 2>&1; then ok=1; break; fi; sleep 3; done"
  "docker compose -f docker-compose.nas.yml ps"
  "if [ -z `$ok ]; then echo '[deploy] health check FAILED'; docker compose -f docker-compose.nas.yml logs --tail 60 api; exit 8; fi"
  "echo '[deploy] health OK'"
) -join "; "
$remoteCmd = "printf '%s\n' " + "'" + ($plainPass -replace "'", "'\''") + "'" + " | sudo -S -p '' bash -lc " + "'" + $remoteInner.Replace("'", "'\''") + "'"

$env:NAS_SSH_PASS = $plainPass
$askCmd = Join-Path $env:TEMP "essersales-ssh-askpass.cmd"
$bunAsk = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
if (-not (Test-Path -LiteralPath $bunAsk)) {
  $bunAsk = "bun"
}
@(
  "@echo off"
  ("`"" + $bunAsk + "`" -e `"process.stdout.write(process.env.NAS_SSH_PASS||'')`"")
) | Set-Content -LiteralPath $askCmd -Encoding ASCII
$env:SSH_ASKPASS = $askCmd
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "127.0.0.1:0"
try {
  ssh -o BatchMode=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=60 $sshTarget $remoteCmd
  $sshCode = $LASTEXITCODE
}
finally {
  $plainPass = $null
  $env:NAS_SSH_PASS = $null
  $env:SSH_ASKPASS = $null
  $env:SSH_ASKPASS_REQUIRE = $null
  Remove-Item -LiteralPath $askCmd -Force -ErrorAction SilentlyContinue
}
if ($sshCode -ne 0) {
  Write-Host "SSH failed. Copy is done - run manually on NAS:" -ForegroundColor Yellow
  Write-Host "  cd /volume1/docker/essersales"
  Write-Host "  sudo docker compose -f docker-compose.nas.yml up -d --build"
  exit 1
}

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green
Write-Host ("Open http://" + $NasHost + ":8080 and press Ctrl+F5")