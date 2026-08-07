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

Write-Host "[2/3] NAS login ($smbUser)..." -ForegroundColor Yellow
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
$plainPass = $null

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
    @{ Src = "backend"; Dst = "backend" },
    @{ Src = "infra\db"; Dst = "infra\db" }
  )

  foreach ($item in $copyItems) {
    $src = Join-Path $LocalRoot $item.Src
    $dst = Join-Path $NasRoot $item.Dst
    if (-not (Test-Path -LiteralPath $src)) {
      throw ("Missing local path: " + $src)
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
$sshTarget = $sshUser + "@" + $NasHost
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