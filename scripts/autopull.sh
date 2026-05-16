#!/bin/bash
# PapiCoach Auto-Deploy Script
# Checks GitHub for new commits, pulls and rebuilds if found.
# Run via cron every 3 minutes:
#   */3 * * * * /root/Papi_planer/scripts/autopull.sh >> /var/log/papicoach-deploy.log 2>&1

REPO_DIR="/root/Papi_planer"
COMPOSE_FILE="docker-compose.prod.yml"
LOCK_FILE="/tmp/papicoach-deploy.lock"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE") ))
  if [ "$LOCK_AGE" -gt 600 ]; then
    echo "[$(date)] Stale lock file (${LOCK_AGE}s old), removing"
    rm -f "$LOCK_FILE"
  else
    exit 0
  fi
fi

trap 'rm -f "$LOCK_FILE"' EXIT
touch "$LOCK_FILE"

cd "$REPO_DIR" || exit 1

# Fetch latest from GitHub
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date)] New commits detected: $LOCAL -> $REMOTE"

# Pull changes
git reset --hard origin/main

echo "[$(date)] Building and deploying..."

# Check which compose file exists
if [ -f "$COMPOSE_FILE" ]; then
  docker compose -f "$COMPOSE_FILE" up -d --build
elif [ -f "docker-compose.app.yml" ]; then
  docker compose -f docker-compose.app.yml up -d --build
else
  docker compose up -d --build
fi

echo "[$(date)] Deploy complete. Container status:"
docker ps --filter "name=papicoach" --format "{{.Names}}: {{.Status}}"
