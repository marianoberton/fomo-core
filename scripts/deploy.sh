#!/usr/bin/env bash
# deploy.sh — Pull, build, migrate, and deploy fomo-core with rollback on failure.
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="http://localhost:3002/health"
MAX_RETRIES=5
RETRY_DELAY=5

log() { echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# ─── Pull latest code ───────────────────────────────────────────

log "Pulling latest code from GitHub..."
git pull origin main

# ─── Save current image tag for rollback ─────────────────────────

CURRENT_IMAGE=$(docker compose -f "$COMPOSE_FILE" images app --format json 2>/dev/null | head -1 | grep -o '"ID":"[^"]*"' | head -1 || echo "")
log "Current image reference: ${CURRENT_IMAGE:-none}"

# ─── Build Docker image ─────────────────────────────────────────

log "Building Docker image..."
docker compose -f "$COMPOSE_FILE" build app

# ─── Run database migrations ────────────────────────────────────

log "Running Prisma migrations..."
docker compose -f "$COMPOSE_FILE" run --rm app npx prisma migrate deploy

# ─── Deploy with rolling update ─────────────────────────────────

log "Starting services..."
docker compose -f "$COMPOSE_FILE" up -d --build

# ─── Post-deploy health check ───────────────────────────────────

log "Waiting for health check..."
HEALTHY=false

for i in $(seq 1 "$MAX_RETRIES"); do
  sleep "$RETRY_DELAY"
  HTTP_STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000")

  if [ "$HTTP_STATUS" = "200" ]; then
    HEALTHY=true
    log "Health check passed (attempt $i/$MAX_RETRIES)"
    break
  fi

  log "Health check failed with status $HTTP_STATUS (attempt $i/$MAX_RETRIES)"
done

if [ "$HEALTHY" = true ]; then
  log "Deploy successful!"
  docker compose -f "$COMPOSE_FILE" ps
  exit 0
fi

# ─── Rollback ────────────────────────────────────────────────────

log "ERROR: Health check failed after $MAX_RETRIES attempts. Rolling back..."

# Stop the failed deployment
docker compose -f "$COMPOSE_FILE" down app 2>/dev/null || true

# Restart with previous image (Docker will use cached layers)
log "Restarting previous version..."
docker compose -f "$COMPOSE_FILE" up -d

# Verify rollback health
sleep "$RETRY_DELAY"
ROLLBACK_STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$ROLLBACK_STATUS" = "200" ]; then
  log "Rollback successful. Previous version is healthy."
else
  log "WARNING: Rollback health check returned $ROLLBACK_STATUS. Manual intervention may be required."
fi

exit 1
