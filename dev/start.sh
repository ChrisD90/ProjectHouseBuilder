#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Desktop mit Docker Compose v2 wird benoetigt.' >&2
  exit 1
fi
if [ ! -f .env.dev ]; then
  cp .env.dev.example .env.dev
  chmod 600 .env.dev
  echo 'Bitte zuerst .env.dev bearbeiten und drei sichere, verschiedene Geheimnisse setzen.' >&2
  exit 1
fi
if grep -Eq '^DEV_(POSTGRES_PASSWORD|APP_PASSWORD|APP_SECRET_KEY)=HIER_' .env.dev; then
  echo 'Bitte die Platzhalter in .env.dev durch echte Geheimnisse ersetzen.' >&2
  exit 1
fi
docker compose --env-file .env.dev -f compose.dev.yaml up --build -d
echo 'Lokaler ProjectHouseBuilder: http://localhost:5080 (oder DEV_PORT in .env.dev)'
