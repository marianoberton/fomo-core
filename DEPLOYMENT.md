# Nexus Core — Deployment Guide

---

## Option A: Docker Compose (Recommended)

The simplest and recommended deployment. One command starts everything: Nexus Core, PostgreSQL, Redis, and WAHA (WhatsApp gateway).

### Requirements

- A VPS with Docker + Docker Compose installed (Ubuntu 22.04 LTS recommended)
- Minimum 2 GB RAM, 20 GB disk
- A domain name with an A record pointing to your server (for HTTPS + webhooks)

### 1. Clone the Repository

```bash
git clone --recurse-submodules https://github.com/your-org/fomo-core.git
cd fomo-core
```

### 2. Configure Environment

```bash
cp .env.example .env
nano .env
```

Minimum required configuration:

```env
# LLM Providers (add at least one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...  # Optional

# Public URL — enables webhook auto-configuration for channels
NEXUS_PUBLIC_URL=https://your-domain.com

# CORS — allow dashboard to call API
CORS_ORIGIN=https://your-dashboard-domain.com

# WAHA API Key (set a strong key for production)
WAHA_API_KEY=your-strong-api-key-here
```

Everything else (database, Redis, ports) has working defaults in `docker-compose.yml`.

### 3. Start the Stack

```bash
docker compose up -d
```

Services started:

| Service | Container | External Port |
|---------|-----------|--------------|
| PostgreSQL + pgvector | `nexus-postgres` | 5433 |
| Redis | `nexus-redis` | 6380 |
| Nexus Core API | `nexus-app` | 3002 |
| WAHA (WhatsApp) | `nexus-waha` | 3003 |

### 4. Run Database Migrations + Seed

```bash
# Migrations (run once on first deploy, and after each update with new migrations)
docker exec nexus-app pnpm prisma migrate deploy

# Seed demo data (optional — only for first-time setup)
docker exec nexus-app pnpm db:seed
```

### 5. Verify

```bash
# API health check
curl https://your-domain.com/health
# Expected: { "status": "ok", "timestamp": "..." }

# Check containers
docker compose ps
```

### 6. HTTPS with Nginx + Let's Encrypt

Set up Nginx as a reverse proxy in front of port 3002:

```nginx
# /etc/nginx/sites-available/nexus-core
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/nexus-core /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL
sudo certbot --nginx -d your-domain.com
```

### Subsequent Deployments

```bash
# Pull latest code
git pull origin main

# Restart with new image
docker compose up -d --build

# Run any new migrations
docker exec nexus-app pnpm prisma migrate deploy

# Verify
curl https://your-domain.com/health
```

---

## Option B: Bare-Metal VPS (Advanced)

For deployments that don't use Docker.

### Requirements

- Ubuntu/Debian VPS
- Node.js 22 LTS
- PostgreSQL 14+ with pgvector extension
- Redis 7+
- PM2 (process manager)
- Nginx (reverse proxy)

### 1. Install Dependencies

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm

# PM2
npm install -g pm2

# PostgreSQL + pgvector
sudo apt install postgresql postgresql-contrib
# Install pgvector: https://github.com/pgvector/pgvector#installation

# Redis
sudo apt install redis-server
```

### 2. Configure Environment

```env
DATABASE_URL=postgresql://nexus:password@localhost:5432/nexus_core?schema=public
REDIS_URL=redis://localhost:6379
PORT=3002
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

NEXUS_PUBLIC_URL=https://your-domain.com

# WAHA runs as a separate Docker container (recommended even in bare-metal)
WAHA_DEFAULT_URL=http://localhost:3003
WAHA_API_KEY=your-api-key
```

### 3. Build and Deploy

```bash
cd /path/to/fomo-core
pnpm install
pnpm build
pnpm prisma migrate deploy
pnpm prisma generate
```

### 4. Start with PM2

```bash
# First time
pm2 start dist/main.js --name nexus-core
pm2 save
pm2 startup  # Follow the output instructions

# Subsequent deployments
pm2 restart nexus-core

# Logs
pm2 logs nexus-core
pm2 monit
```

### 5. Run WAHA

Even in bare-metal deployments, run WAHA as a Docker container:

```bash
docker run -d \
  --name nexus-waha \
  --restart unless-stopped \
  -p 3003:3000 \
  -e WHATSAPP_DEFAULT_ENGINE=NOWEB \
  -e WAHA_API_KEY=your-api-key \
  -v wahadata:/app/.sessions \
  devlikeapro/waha
```

---

## Dashboard

The dashboard (`dashboard/`) is a Next.js app deployed separately.

```bash
cd dashboard
npm install
npm run build
npm start  # Runs on port 3000
```

Or deploy to Vercel / any Node.js hosting. Set:

```env
# dashboard/.env.local or hosting env vars
NEXT_PUBLIC_API_URL=https://your-domain.com
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string (for BullMQ scheduled tasks) |
| `PORT` | No | API port (default: 3002) |
| `HOST` | No | Bind address (default: `0.0.0.0`, use `::` on Windows) |
| `NODE_ENV` | No | `production` or `development` |
| `LOG_LEVEL` | No | `info`, `debug`, `warn`, `error` |
| `OPENAI_API_KEY` | ✅ (one LLM needed) | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude API key |
| `GOOGLE_AI_API_KEY` | No | Google Gemini API key |
| `NEXUS_PUBLIC_URL` | No | Public URL for webhook auto-configuration |
| `CORS_ORIGIN` | No | Allowed CORS origin for dashboard |
| `WAHA_DEFAULT_URL` | No | WAHA base URL (default: `http://waha:3000` in Docker) |
| `WAHA_API_KEY` | No | WAHA authentication key (default: `nexus`) |
| `FILE_STORAGE_PATH` | No | Directory for uploaded files |

---

## Security Checklist

- [ ] `WAHA_API_KEY` set to a strong random value (not the default `nexus`)
- [ ] All API keys in `.env` with permissions `chmod 600 .env`
- [ ] HTTPS enabled (Let's Encrypt)
- [ ] Firewall: only ports 80, 443, and SSH open externally
- [ ] PostgreSQL: dedicated user (not `postgres`), password set
- [ ] Redis: bound to localhost only (not exposed externally)
- [ ] `NEXUS_PUBLIC_URL` set for webhook auto-configuration
- [ ] Regular DB backups configured

---

## Monitoring

### Docker Compose

```bash
# Check container status
docker compose ps

# Follow all logs
docker compose logs -f

# Follow specific service
docker logs nexus-app -f
docker logs nexus-waha -f

# Resource usage
docker stats
```

### Database

```bash
# Active connections
docker exec nexus-postgres psql -U nexus -d nexus_core \
  -c "SELECT count(*) FROM pg_stat_activity WHERE datname='nexus_core';"

# DB size
docker exec nexus-postgres psql -U nexus -d nexus_core \
  -c "SELECT pg_size_pretty(pg_database_size('nexus_core'));"
```

---

## Troubleshooting

### Container Won't Start

```bash
docker compose logs nexus-app
```

Common causes:
- `DATABASE_URL` incorrect or PostgreSQL not ready → wait for health checks
- Port 3002 already in use → `sudo lsof -i :3002` and kill the process

### Migration Fails

```bash
docker exec nexus-app pnpm prisma migrate status
```

If "drift detected" (table exists but migration not recorded):
```bash
docker exec nexus-app pnpm prisma migrate resolve --applied <migration_name>
docker exec nexus-app pnpm prisma migrate deploy
```

### WAHA Not Accessible

```bash
# From host
curl http://localhost:3003/api/server/status -H "X-Api-Key: nexus"

# From nexus-app container
docker exec nexus-app curl http://waha:3000/api/server/status -H "X-Api-Key: nexus"
```

### WebSocket Not Working Through Nginx

Verify the Nginx config has both headers:
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "Upgrade";
```

---

**Last updated**: 2026-02-24
**Node.js required**: 22 LTS
**PostgreSQL required**: 14+ with pgvector
