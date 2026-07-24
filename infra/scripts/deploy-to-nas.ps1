# essersales -> Synology NAS file deploy (Windows PowerShell 5.1+)
# Usage:
#   powershell -ExecutionPolicy Bypass -File infra\scripts\deploy-to-nas.ps1
#   powershell -ExecutionPolicy Bypass -File infra\scripts\deploy-to-nas.ps1 -SkipBuild -SkipDocker

param(
  [string]$NasHost = "192.168.0.245",
  [string]$NasShare = "docker",
  [string]$NasUser = "",
  [string]$LocalRoot = "",
  [switch]$SkipBuild,
  [switch]$SkipDocker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $LocalRoot) {
  $LocalRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

if (-not $NasUser) {
  $NasUser = Read-Host "NAS DSM username"
}

$NasUnc = "\\$NasHost\$NasShare\essersales"

Write-Host "=== essersales NAS deploy ===" -ForegroundColor Cyan
Write-Host "Local: $LocalRoot"
Write-Host "NAS:   $NasUnc"
Write-Host ""

if (-not $SkipBuild) {
  Write-Host "[1/3] Production build..." -ForegroundColor Yellow
  Push-Location $LocalRoot
  try {
    npm run build:production
    if ($LASTEXITCODE -ne 0) { throw "build:production failed (exit $LASTEXITCODE)" }
  }
  finally {
    Pop-Location
  }
  Write-Host "Build OK" -ForegroundColor Green
}
else {
  Write-Host "[1/3] Build skipped (-SkipBuild)" -ForegroundColor DarkGray
}

# Get-Credential GUI는 Cursor/VS Code 터미널에서 뒤에 숨거나 멈춰 보일 수 있음 → 콘솔 입력 사용
Write-Host "[2/3] NAS login ($NasUser@$NasHost)..." -ForegroundColor Yellow
Write-Host "  DSM 비밀번호를 입력한 뒤 Enter (입력 중에는 글자가 안 보입니다)" -ForegroundColor DarkGray
$securePass = Read-Host "NAS DSM password" -AsSecureString
if (-not $securePass -or $securePass.Length -eq 0) {
  throw "Password is empty"
}
$cred = New-Object System.Management.Automation.PSCredential ($NasUser, $securePass)

Write-Host "[2/3] Map drive and copy..." -ForegroundColor Yellow
$driveName = "Z"
$existing = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
if ($existing) {
  Remove-PSDrive -Name $driveName -Force -ErrorAction SilentlyContinue
}

New-PSDrive -Name $driveName -PSProvider FileSystem -Root $NasUnc -Credential $cred -Scope Script | Out-Null
$NasRoot = "${driveName}:\"

try {
  $copyItems = @(
    @{ Src = "dist"; Dst = "dist" },
    @{ Src = "src\utils"; Dst = "src\utils" },
    @{ Src = "src\config"; Dst = "src\config" },
    @{ Src = "src\constants"; Dst = "src\constants" },
    @{ Src = "backend"; Dst = "backend" },
    @{ Src = "infra\db"; Dst = "infra\db" }
  )

  foreach ($item in $copyItems) {
    $src = Join-Path $LocalRoot $item.Src
    $dst = Join-Path $NasRoot $item.Dst
    if (-not (Test-Path -LiteralPath $src)) {
      throw "Missing local path: $src"
    }
    Write-Host ("  -> " + $item.Dst)
    if (-not (Test-Path -LiteralPath $dst)) {
      New-Item -ItemType Directory -Path $dst -Force | Out-Null
    }
    $roboDst = Join-Path $NasUnc $item.Dst
    robocopy $src $roboDst /E /MT:8 /R:2 /W:2 /NFL /NDL /NJH /NJS /NP /DCOPY:DAT | Out-Null
    $rc = $LASTEXITCODE
    if ($rc -ge 8) {
      throw ("robocopy failed for " + $item.Dst + " (exit " + $rc + ")")
    }
  }
}
finally {
  Remove-PSDrive -Name $driveName -Force -ErrorAction SilentlyContinue
}

Write-Host "Copy OK" -ForegroundColor Green

if ($SkipDocker) {
  Write-Host "[3/3] Docker restart skipped (-SkipDocker)" -ForegroundColor DarkGray
  Write-Host "NAS SSH:" -ForegroundColor Cyan
  Write-Host "  cd /volume1/docker/essersales"
  Write-Host "  sudo docker compose -f docker-compose.nas.yml up -d --build"
  exit 0
}

Write-Host "[3/3] NAS Docker restart (SSH)..." -ForegroundColor Yellow
$sshTarget = ($NasUser + "@" + $NasHost)
$remoteCmd = "sudo -i bash -c 'export PATH=`$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Docker/target/usr/bin; cd /volume1/docker/essersales && docker stop essersales-proxy-1 essersales-api-1 essersales-db-1 2>/dev/null; docker rm essersales-proxy-1 essersales-api-1 essersales-db-1 2>/dev/null; docker compose -f docker-compose.nas.yml up -d --build; docker compose -f docker-compose.nas.yml ps'"

ssh -t -o StrictHostKeyChecking=accept-new $sshTarget $remoteCmd
if ($LASTEXITCODE -ne 0) {
  Write-Host "SSH failed. Copy is done - run manually on NAS:" -ForegroundColor Yellow
  Write-Host "  cd /volume1/docker/essersales"
  Write-Host "  sudo docker compose -f docker-compose.nas.yml up -d --build"
  exit 1
}

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green
Write-Host ("Open http://" + $NasHost + ":8080 and press Ctrl+F5")
