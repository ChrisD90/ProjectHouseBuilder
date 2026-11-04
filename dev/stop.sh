#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
[ -f .env.dev ] || { echo '.env.dev fehlt' >&2; exit 1; }
docker compose --env-file .env.dev -f compose.dev.yaml down
echo 'Gestoppt. Testdatenbank und hochgeladene Dokumente bleiben erhalten.'
