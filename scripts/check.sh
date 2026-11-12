#!/usr/bin/env bash
# Fast checks for every pull request (CI job "check"): typecheck, lint and unit tests.
# Packages opt in by defining "typecheck", "lint" or "test" scripts.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== commit hygiene self-test"
node --test "scripts/**/*.test.mjs"

echo "== typecheck"
pnpm -r --if-present typecheck

echo "== lint"
pnpm -r --if-present lint

echo "== unit tests (TypeScript)"
pnpm -r --if-present test

if [ -f services/ml/pyproject.toml ]; then
  echo "== ML service: ruff and pytest"
  (cd services/ml && uv run --frozen ruff check . && uv run --frozen pytest -q)
fi
