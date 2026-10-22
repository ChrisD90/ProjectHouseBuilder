#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
[ -f .env.dev ] || { echo '.env.dev fehlt' >&2; exit 1; }
# Login-Seite als schneller Verfuegbarkeitstest, keine Authentifizierung hier.
port=$(sed -n 's/^DEV_PORT=//p' .env.dev | tail -1)
port=${port:-5080}
curl --fail --silent --show-error --output /dev/null "http://127.0.0.1:$port/login"
echo "OK: http://localhost:$port/login"
