#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
# Fail closed: migrations & required verified backups must succeed before server start.
python schema_manager.py
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-5055}"
printf "\nProjectHouseBuilder lokal: http://127.0.0.1:%s\n" "$PORT"
printf "Port 5000 wird auf macOS haeufig durch AirPlay belegt.\n\n"
exec python app.py
