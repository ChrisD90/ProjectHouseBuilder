#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
# Fail closed: migrations & required verified backups must succeed before server start.
python schema_manager.py
exec python app.py
