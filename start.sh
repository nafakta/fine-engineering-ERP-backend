#!/bin/sh
set -e

echo "🚀 Starting backend server..."

# Fix permission issue
mkdir -p /tmp/logs /usr/src/app/logs 2>/dev/null || true
chmod -R 777 /tmp/logs /usr/src/app/logs 2>/dev/null || true
export LOG_DIR=/tmp/logs

# Start application
node dist/index.js