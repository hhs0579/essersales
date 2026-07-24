@echo off
chcp 65001 >nul
title essersales PG dev

set "NVM_HOME=%LOCALAPPDATA%\nvm"
set "NVM_SYMLINK=C:\nvm4w\nodejs"
set "PATH=%NVM_SYMLINK%;%NVM_HOME%;%PATH%"

if not exist "%NVM_HOME%\nvm.exe" (
  echo NVM이 없습니다. Node 22 LTS를 https://nodejs.org/ 에서 설치하세요.
  pause
  exit /b 1
)

call "%NVM_HOME%\nvm.exe" use 22.22.3 >nul 2>&1
set "PATH=%NVM_SYMLINK%;%PATH%"

cd /d "%~dp0"

echo.
echo [Phase 3-4B] PG 단일 스택 개발 모드
echo.
echo 1) Docker PG API 시작:
echo    docker compose up -d --build api db
echo.
echo 2) Vue dev (http://localhost:5173):
echo    npm run dev
echo.
echo API health: http://localhost:3002/api/v1/health
echo.
echo legacy SQLite API (:3001)는 archive/legacy-sqlite-server/ 에 보관됨
echo.

call "%NVM_SYMLINK%\npm.cmd" run dev

pause
