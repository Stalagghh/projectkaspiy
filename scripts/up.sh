#!/usr/bin/env bash
# One command to start the whole demo stack. Run from anywhere:  ./scripts/up.sh
# 1) creates .env with random secrets (once), 2) checks the data that is not in git,
# 3) builds the images, 4) applies migrations and the seed, 5) waits until every
# service reports healthy, then prints the address.
set -euo pipefail
cd "$(dirname "$0")/.."

# Docker: use it directly, or through the docker group with `sg` right after `usermod -aG docker`.
dkr() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sg docker -c "$(printf '%q ' docker "$@")"
  fi
}
if ! docker info >/dev/null 2>&1 && ! sg docker -c "docker info" >/dev/null 2>&1; then
  echo "Docker недоступен. Запустите: sudo systemctl enable --now docker" >&2
  exit 1
fi

# 1. Secrets for this laptop only. Never committed (.gitignore).
if [ ! -f .env ]; then
  # The umask stays inside the subshell so that downloaded data keeps normal permissions.
  (
    umask 077
    {
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
      echo "ML_API_TOKEN=$(openssl rand -hex 32)"
      echo "SIM_CONTROL_TOKEN=$(openssl rand -hex 32)"
    } > .env
  )
  echo "up: создан .env со случайными секретами"
fi

# 2. Model, offline map tiles and demo clips (fetched once, verified by checksum).
./scripts/fetch-data.sh

# 3–5. Build, migrate and seed, start, wait for health checks.
dkr compose build
dkr compose up -d --wait db mqtt ml
dkr compose run --rm migrate
dkr compose up -d --wait ingest simulator web

echo
echo "up: всё запущено. Дашборд: http://localhost:3000"
echo "up: сценарий «Ночной браконьер»: кнопка на дашборде или  pnpm demo:start"
