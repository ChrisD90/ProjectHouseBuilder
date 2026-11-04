#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo 'Bitte zuerst die Werte in .env (LAN_HOST und Passwoerter) bearbeiten.'
  exit 1
fi
mkdir -p private/documents backups
chmod 700 private backups
if grep -Eq '(BITTE_|192\.168\.178\.50)' .env; then
  echo 'Bitte zuerst .env bearbeiten (LAN_HOST und Passwoerter).'
  exit 1
fi
docker compose up --build -d
echo 'Fertig. Oeffne https://<LAN_HOST> (aus .env).'
