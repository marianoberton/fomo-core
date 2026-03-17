#!/bin/bash
set -euo pipefail

# First-time deploy script for fomo-core on a fresh VPS
# Run once, then use GitHub Actions for subsequent deploys

INSTALL_DIR="/opt/fomo-core"
REPO_URL="https://github.com/marianoberton/fomo-core.git"

echo "=== fomo-core: First Deploy ==="

# 1. Clone the repo
if [ -d "$INSTALL_DIR" ]; then
  echo "[!] $INSTALL_DIR already exists. Aborting."
  echo "    If you want to redeploy, remove it first: rm -rf $INSTALL_DIR"
  exit 1
fi

echo "[1/6] Cloning repo to $INSTALL_DIR..."
git clone "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 2. Create .env from example
echo "[2/6] Creating .env from .env.example..."
cp .env.example .env
echo "    >>> EDIT $INSTALL_DIR/.env with your production values before continuing <<<"
echo "    Press Enter when ready..."
read -r

# 3. Create Docker network for client containers
echo "[3/6] Creating Docker network fomo-network..."
docker network create fomo-network 2>/dev/null || echo "    Network fomo-network already exists"

# 4. Pull images
echo "[4/6] Pulling Docker images..."
docker compose -f docker-compose.prod.yml pull

# 5. Run database migrations
echo "[5/6] Running Prisma migrations..."
# Start just postgres first for migrations
docker compose -f docker-compose.prod.yml up -d postgres
sleep 5
# Load env and run migrations against the running postgres
export DB_PASSWORD=$(grep DB_PASSWORD .env | cut -d= -f2)
DATABASE_URL="postgresql://nexus:${DB_PASSWORD}@localhost:5432/nexus_core?schema=public" npx prisma migrate deploy

# 6. Start all services
echo "[6/6] Starting all services..."
docker compose -f docker-compose.prod.yml up -d

# Verify health
echo ""
echo "Waiting for services to start..."
sleep 15

if curl -sf http://localhost:3002/health > /dev/null 2>&1; then
  echo "=== Deploy successful! fomo-core is running ==="
  echo "    Health: http://localhost:3002/health"
else
  echo "=== WARNING: Health check failed ==="
  echo "    Check logs: docker compose -f docker-compose.prod.yml logs app"
  exit 1
fi
