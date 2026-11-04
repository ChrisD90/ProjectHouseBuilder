#!/bin/sh
# Synology SSH / Aufgabenplaner: im Projektordner ausfuehren.
# Das Backup enthaelt sensible Dokumente und sollte nur in geschuetzten Freigaben liegen.
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
stamp=$(date +%Y%m%d-%H%M%S)
compose='compose.synology.yaml'
check_db="backups/db-$stamp.dump"
check_private="backups/private-$stamp.tar.gz"
trap 'rm -f "$check_db" "$check_private"' HUP INT TERM
# Das Image postgres:17-alpine enthaelt pg_dump.
docker compose -f "$compose" exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U sanierung -d sanierung -Fc' > "$check_db"
docker compose -f "$compose" exec -T app tar -czf - -C /app private > "$check_private"
chmod 600 "$check_db" "$check_private"
printf 'Backup erstellt: %s und %s\n' "$check_db" "$check_private"
printf 'Beide Dateien zusaetzlich extern sichern und eine Wiederherstellung testen.\n'
