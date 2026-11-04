#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U sanierung -d sanierung -Fc' > "backups/db-$stamp.dump"
tar -czf "backups/documents-$stamp.tar.gz" private
printf 'Backup erstellt: %s (DB + private/)\n' "$stamp"
