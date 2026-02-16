# Nexus Core - Deployment Guide

## 📦 Deployment al VPS

### Pre-requisitos

- VPS con Ubuntu/Debian
- Node.js 22 LTS instalado
- PostgreSQL 14+ con extensión pgvector
- Redis (opcional, solo si usas scheduled tasks)
- PM2 o systemd para process management
- Nginx como reverse proxy (recomendado)

---

## 🚀 Deployment Steps

### 1. En el VPS (SSH)

```bash
# Navegar al directorio del proyecto
cd /path/to/fomo-core

# Pull latest changes
git pull origin main

# Instalar/actualizar dependencias
pnpm install

# Build TypeScript
pnpm build

# CRÍTICO: Ejecutar migraciones de DB
pnpm prisma migrate deploy

# Verificar que las migraciones se aplicaron correctamente
pnpm prisma migrate status

# Generar Prisma Client
pnpm prisma generate
```

### 2. Variables de Entorno

**Archivo**: `/path/to/fomo-core/.env`

```env
# Database
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/nexus_core?schema=public"

# Redis (opcional, solo para scheduled tasks)
REDIS_URL="redis://localhost:6379"

# Server
NODE_ENV=production
PORT=3002
HOST=0.0.0.0

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Otros
LOG_LEVEL=info
```

### 3. Reiniciar Server

#### Opción A: Con PM2 (recomendado)

```bash
# Primera vez (setup)
pm2 start dist/main.js --name nexus-core --node-args="--experimental-specifier-resolution=node"
pm2 save
pm2 startup

# Deployments subsiguientes
pm2 restart nexus-core

# Ver logs
pm2 logs nexus-core

# Monitorear
pm2 monit
```

#### Opción B: Con systemd

**Archivo**: `/etc/systemd/system/nexus-core.service`

```ini
[Unit]
Description=Nexus Core API
After=network.target postgresql.service

[Service]
Type=simple
User=nexus
WorkingDirectory=/path/to/fomo-core
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable + start
sudo systemctl enable nexus-core
sudo systemctl start nexus-core

# Check status
sudo systemctl status nexus-core

# Ver logs
sudo journalctl -u nexus-core -f
```

### 4. Nginx Reverse Proxy (opcional pero recomendado)

**Archivo**: `/etc/nginx/sites-available/nexus-core`

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

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

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3002/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/nexus-core /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Setup SSL with Let's Encrypt (recomendado)
sudo certbot --nginx -d tu-dominio.com
```

### 5. Firewall

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow direct port (opcional, solo si no usas nginx)
sudo ufw allow 3002/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## 🔗 Conectar marketpaper-demo al VPS

### En tu máquina local (marketpaper-demo)

**Archivo**: `marketpaper-demo/.env.local`

```env
# Cambiar de localhost a VPS
NEXT_PUBLIC_NEXUS_API_URL=https://tu-dominio.com

# O si usas IP + puerto directo:
# NEXT_PUBLIC_NEXUS_API_URL=http://IP_DEL_VPS:3002
```

**Reiniciar dev server**:

```bash
cd marketpaper-demo
npm run dev
```

**Verificar conexión**:
- Abrir `http://localhost:3000/admin/nexus`
- Debería cargar proyectos desde el VPS

---

## ✅ Verificación Post-Deployment

### 1. Health Check

```bash
# Desde cualquier máquina
curl https://tu-dominio.com/health

# Respuesta esperada:
# {"status":"ok","timestamp":"2026-02-16T..."}
```

### 2. Verificar DB Migration

```bash
# En el VPS
psql -U nexus -d nexus_core

# En psql:
\d channel_integrations

# Debería mostrar la estructura de la tabla
```

### 3. Test API

```bash
# List projects
curl https://tu-dominio.com/api/v1/projects

# Debería retornar JSON con proyectos
```

### 4. Test desde marketpaper-demo

```bash
# En tu máquina local
cd marketpaper-demo
npm run dev

# Abrir browser:
# http://localhost:3000/admin/nexus
# Verificar que carga datos del VPS
```

---

## 🚨 Troubleshooting

### Migración falla

**Error**: "Drift detected"

```bash
# Ver estado detallado
pnpm prisma migrate status

# Si la tabla ya existe (creada con db push), marcar como aplicada:
pnpm prisma migrate resolve --applied 20260216020000_add_channel_integrations

# Reintentar:
pnpm prisma migrate deploy
```

**Error**: "Table already exists"

La migración es idempotente (usa `IF NOT EXISTS`), pero si falla:

```bash
# Ver qué falló
pnpm prisma migrate status

# Si necesitas forzar:
psql -U nexus -d nexus_core -f prisma/migrations/20260216020000_add_channel_integrations/migration.sql
```

### Server no inicia

```bash
# Verificar logs
pm2 logs nexus-core --lines 100
# o
sudo journalctl -u nexus-core -f

# Causas comunes:
# 1. Puerto 3002 ocupado
sudo lsof -i :3002
sudo kill -9 <PID>

# 2. PostgreSQL no corriendo
sudo systemctl status postgresql
sudo systemctl start postgresql

# 3. Redis no corriendo (si usas scheduled tasks)
sudo systemctl status redis
sudo systemctl start redis

# 4. Variables de entorno incorrectas
cat .env | grep DATABASE_URL
```

### marketpaper-demo no conecta

**Error**: CORS o Network Error

1. Verificar CORS en fomo-core `src/main.ts`:
   ```typescript
   await server.register(cors, {
     origin: [
       'http://localhost:3000',
       'https://tu-dominio-marketpaper.com'
     ],
     credentials: true
   });
   ```

2. Verificar firewall:
   ```bash
   sudo ufw status
   # Asegurar que puerto 3002 o 80/443 estén abiertos
   ```

3. Test directo:
   ```bash
   # Desde tu máquina local
   curl https://tu-dominio.com/api/v1/projects
   ```

### WebSocket no conecta

**Error**: WebSocket connection failed

1. Verificar Nginx config (si usas nginx):
   - Debe tener `proxy_http_version 1.1`
   - Debe tener `Upgrade` y `Connection` headers

2. Test WebSocket:
   ```bash
   # Instalar wscat
   npm install -g wscat

   # Test conexión
   wscat -c wss://tu-dominio.com/ws
   ```

---

## 🔄 Workflow de Deployment Futuro

Para deployments subsiguientes:

```bash
# 1. En tu máquina local (push changes)
git add .
git commit -m "feat: nueva feature"
git push origin main

# 2. En el VPS (pull + deploy)
cd /path/to/fomo-core
git pull origin main
pnpm install
pnpm build
pnpm prisma migrate deploy  # Solo si hay nuevas migraciones
pm2 restart nexus-core

# 3. Verificar
curl https://tu-dominio.com/health
pm2 logs nexus-core
```

---

## 📊 Monitoring

### Logs

```bash
# PM2
pm2 logs nexus-core --lines 100
pm2 logs nexus-core --err  # Solo errores

# systemd
sudo journalctl -u nexus-core -f
sudo journalctl -u nexus-core --since "1 hour ago"
```

### Métricas

```bash
# PM2 monit
pm2 monit

# Status
pm2 status

# Resource usage
pm2 show nexus-core
```

### Database

```bash
# Conexiones activas
psql -U nexus -d nexus_core -c "SELECT count(*) FROM pg_stat_activity WHERE datname='nexus_core';"

# Tamaño de DB
psql -U nexus -d nexus_core -c "SELECT pg_size_pretty(pg_database_size('nexus_core'));"

# Tablas más grandes
psql -U nexus -d nexus_core -c "SELECT schemaname,tablename,pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 10;"
```

---

## 🔐 Security Checklist

- [ ] Firewall configurado (solo puertos necesarios abiertos)
- [ ] SSL/TLS con certificado válido (Let's Encrypt)
- [ ] Variables de entorno NO committed a git
- [ ] PostgreSQL con usuario dedicado (no `postgres`)
- [ ] API keys guardadas en `.env` con permisos `600`
- [ ] Nginx configurado con rate limiting
- [ ] Logs rotados (logrotate)
- [ ] Backups automáticos de DB configurados

---

## 📝 Migración Importante: channel_integrations

**Commit**: `b291e73` - feat: stabilization + channel_integrations migration (VPS-ready)

**Migración**: `20260216020000_add_channel_integrations`

Esta migración:
- ✅ Es idempotente (usa `IF NOT EXISTS`)
- ✅ Safe para bases de datos existentes
- ✅ Agrega tabla `channel_integrations` para Chatwoot/WhatsApp/Telegram/Slack
- ✅ Incluye índices para performance
- ✅ Foreign key a `projects`

**Se ejecuta automáticamente con**: `pnpm prisma migrate deploy`

---

## 🆘 Support

Si encuentras problemas durante deployment:

1. Verificar logs: `pm2 logs nexus-core --err`
2. Verificar DB: `pnpm prisma migrate status`
3. Verificar health: `curl https://tu-dominio.com/health`
4. Revisar este documento: `DEPLOYMENT.md`
5. Revisar docs: `docs/` (MCP_GUIDE.md, SLACK_SETUP.md, etc.)

---

**Última actualización**: 2026-02-16
**Versión Nexus Core**: 1.0.0 (stabilization release)
**Node.js requerido**: 22 LTS
**PostgreSQL requerido**: 14+ (con pgvector)
