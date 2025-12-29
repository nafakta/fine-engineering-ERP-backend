#!/usr/bin/env bash
set -euo pipefail

cd /root/compresscrmbackend

echo "👉 Pulling latest image..."
docker compose pull compress-crm

echo "👉 Taking DB backup..."
./scripts/backup_db.sh

echo "👉 Recreating app container..."
docker compose up -d compress-crm

# optional: thoda logs dikha do for quick sanity
sleep 2
echo "👉 Recent app logs:"
docker logs --tail=80 compress-crm || true

echo "✅ Deploy complete (no health check)."
