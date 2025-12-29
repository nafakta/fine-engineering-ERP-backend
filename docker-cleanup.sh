#!/bin/bash

echo "⚠️  WARNING: This will remove all Docker containers, images, volumes, and networks."
read -p "Are you sure you want to continue? [y/N] " confirm

if [[ $confirm != "y" && $confirm != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

echo "🔽 Stopping and removing all containers, networks, volumes, and images..."
docker-compose down -v --remove-orphans

echo "🧹 Pruning unused data..."
docker system prune -af
docker system prune -a --volumes -f

echo "🗑️ Removing all dangling images..."
docker image prune -af

echo "🗑️ Removing all unused volumes..."
docker volume prune -f

echo "🗑️ Removing all unused networks..."
docker network prune -f

echo "🧼 Full cleanup complete ✅"
