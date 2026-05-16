#!/bin/bash
# PapiCoach Auto-Deploy Script
# Checks GitHub for new commits, pulls and rebuilds via Docker.
# Run via cron every 3 minutes:
#   */3 * * * * /root/Papi_planer/scripts/autopull.sh >> /var/log/papicoach-deploy.log 2>&1

set -e

REPO_DIR="/root/Papi_planer"
COMPOSE_FILE="docker-compose.app.yml"
LOCK_FILE="/tmp/papicoach-deploy.lock"

# Prevent concurrent runs (stale lock cleared after 10 min)
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE") ))
  if [ "$LOCK_AGE" -gt 600 ]; then
    echo "[$(date)] Stale lock (${LOCK_AGE}s), removing"
    rm -f "$LOCK_FILE"
  else
    exit 0
  fi
fi

trap 'rm -f "$LOCK_FILE"' EXIT
touch "$LOCK_FILE"

cd "$REPO_DIR" || { echo "Repo not found"; exit 1; }

# Fetch latest from GitHub
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

# No new commits — done
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date)] New commits: $LOCAL -> $REMOTE"

# Force pull (override any local changes from previous bad merges)
git reset --hard origin/main

# Verify compose file exists
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: $COMPOSE_FILE not found"
  exit 1
fi

echo "[$(date)] Rebuilding Docker..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[$(date)] Deploy complete:"
docker ps --filter "name=papicoach" --format "{{.Names}}: {{.Status}}"
