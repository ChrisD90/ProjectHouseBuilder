#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 -m venv .venv
. .venv/bin/activate
# Avoid a source build of cryptography on unsupported macOS/Python combinations.
# RS256 ChatGPT identity checks require this dependency; never omit it.
python -m pip install --only-binary=cryptography -r requirements.txt
# Fail closed: migrations & required verified backups must succeed before server start.
python schema_manager.py
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-5055}"
printf "\nProjectHouseBuilder lokal: http://127.0.0.1:%s\n" "$PORT"
printf "Port 5000 wird auf macOS haeufig durch AirPlay belegt.\n\n"
exec python app.py
