@echo off
REM Phase 0 — Git 브랜치 생성 (Windows)
cd /d "%~dp0\..\.."

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git이 PATH에 없습니다. Git for Windows 설치 후 다시 실행하세요.
  exit /b 1
)

git rev-parse --git-dir >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git 저장소가 아닙니다.
  exit /b 1
)

for /f %%i in ('git branch --show-current') do set CURRENT=%%i
echo Current branch: %CURRENT%

git show-ref --verify --quiet refs/heads/backup/current-vue-version
if errorlevel 1 (
  git branch backup/current-vue-version
  echo Created branch: backup/current-vue-version
) else (
  echo Branch backup/current-vue-version already exists.
)

git show-ref --verify --quiet refs/heads/feature/phase-0-docker-pg
if errorlevel 1 (
  git checkout -b feature/phase-0-docker-pg
  echo Created and checked out: feature/phase-0-docker-pg
) else (
  git checkout feature/phase-0-docker-pg
  echo Checked out: feature/phase-0-docker-pg
)

echo Done.
