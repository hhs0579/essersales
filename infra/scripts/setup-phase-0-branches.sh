#!/usr/bin/env bash
# Phase 0 — Git 브랜치 생성 (로컬에서 git 사용 가능할 때 실행)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git이 설치되어 있지 않습니다."
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Git 저장소가 아닙니다. 먼저 git init 또는 clone 하세요."
  exit 1
fi

CURRENT="$(git branch --show-current)"
echo "Current branch: ${CURRENT}"

if git show-ref --verify --quiet refs/heads/backup/current-vue-version; then
  echo "Branch backup/current-vue-version already exists."
else
  git branch backup/current-vue-version
  echo "Created branch: backup/current-vue-version"
fi

if git show-ref --verify --quiet refs/heads/feature/phase-0-docker-pg; then
  echo "Branch feature/phase-0-docker-pg already exists."
  git checkout feature/phase-0-docker-pg
else
  git checkout -b feature/phase-0-docker-pg
  echo "Created and checked out: feature/phase-0-docker-pg"
fi

echo "Done. backup/current-vue-version = pre-Phase-0 snapshot pointer."
