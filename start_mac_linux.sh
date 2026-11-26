#!/bin/sh
set -eu
cd "$(dirname "$0")"
sh scripts/ensure_ocr.sh
python3 -m venv .venv
. .venv/bin/activate
# Use binary packages for identity checks and image codecs. HEIC support must not
# depend on a local Homebrew/libheif source build, including on Intel Macs.
python -m pip install --only-binary=cryptography,Pillow,pillow-heif -r requirements.txt
# Fail closed: migrations & required verified backups must succeed before server start.
python schema_manager.py
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-5055}"
printf "\nProjectHouseBuilder lokal: http://127.0.0.1:%s\n" "$PORT"
printf "Port 5000 wird auf macOS haeufig durch AirPlay belegt.\n\n"
exec python app.py
