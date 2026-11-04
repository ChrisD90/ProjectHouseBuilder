#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
[ -f .env.dev ] || { echo '.env.dev fehlt' >&2; exit 1; }
if [ "${1:-}" != '--delete-test-data' ]; then
  echo 'Testdaten unwiderruflich loeschen: sh dev/reset.sh --delete-test-data' >&2
  exit 1
fi
printf 'Alle lokalen Docker-TESTdaten (PostgreSQL und Belege) loeschen? Tippe TESTDATEN: '
read -r confirmation
[ "$confirmation" = TESTDATEN ] || { echo 'Abgebrochen'; exit 1; }
docker compose --env-file .env.dev -f compose.dev.yaml down --volumes
printf 'Lokale Testdaten geloescht. Synology/Produktionsdaten bleiben unberuehrt.\n'
