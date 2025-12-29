#!/usr/bin/env bash
set -euo pipefail
mkdir -p /root/compresscrmbackend/backups
TS=$(date +"%Y%m%d_%H%M%S")
OUT="/root/compresscrmbackend/backups/compresscrm_${TS}.sql"

echo "📦 pg_dump -> $OUT"
docker compose exec -T db \
  pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-compresscrmbackend}" > "$OUT"
echo "✅ Backup done"
