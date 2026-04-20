# Onboarding para Claude — Contexto del Proyecto FOMO

> **Propósito**: este documento es el primer archivo que Claude (o cualquier IA/dev nuevo) debería leer al abrir una sesión sobre este repo. Contiene el mapa completo de arquitectura, deploy, estado actual, y objetivos. Actualizalo cuando cambien cosas materiales.
>
> **Última actualización**: 2026-04-19 · **Mantenedor**: Mariano Berton

---

## 1. ¿Qué es esto?

**FOMO** es una agencia/consultora de automatización con IA. Construye agentes multicanal para clientes (WhatsApp, Telegram, Slack) desde su propia plataforma **Nexus Core** (este repo = `fomo-core`).

### Modelo de negocio
- Cliente = un **Project** con N agentes especializados + 1 manager (copilot)
- Cada cliente tiene sus canales, su base de conocimiento, sus integraciones (CRM, calendar, etc.)
- Dos modelos de deploy: **shared** (varios clientes en una instancia de fomo-core) y **dedicated** (un container fomo-core por cliente, orquestado vía Dokploy)
- El **Dashboard** es para uso interno del equipo FOMO (no es cliente-facing)

### Componentes principales
| Componente | Qué hace |
|---|---|
| `fomo-core` | Backend Fastify + agente runner + 40+ tools + BullMQ + WAHA |
| `fomo-core-dashboard` | Next.js admin panel (submódulo git aparte) |
| `fomo-admin` | Agente interno (Claude Opus 4.6) que opera la plataforma vía chat/CLI |
| `nexus-admin` CLI | CLI local para hablarle a fomo-admin |
| WAHA | Bundled para WhatsApp (QR scan → sesión) |
| Dokploy | Orquestador que deploy containers en VPS |

---

## 2. Stack técnico (resumen)

**Backend (`fomo-core`)**
- Node.js 22 LTS · TypeScript strict · pnpm
- Fastify + @fastify/websocket · PostgreSQL 16 + pgvector · BullMQ + Redis
- Zod (validación) · Vitest · pino (logging)
- **Prohibido**: LangChain, AutoGen, CrewAI, Semantic Kernel

**Dashboard (`fomo-core/dashboard`, submódulo)**
- Next.js 16 · React 19 · Tailwind 4 · shadcn/ui
- React Query · Recharts · Monaco Editor
- **Sin restricciones de libs** — es UI interna

**Infra**
- VPS con **Dokploy** (PaaS tipo Coolify sobre Docker)
- Docker Compose productivo: `docker-compose.prod.yml`
- Imágenes en `ghcr.io` (GitHub Container Registry)

---

## 3. Arquitectura — directorio por directorio

```
src/
├── core/            # AgentRunner (el loop del agente)
├── providers/       # Anthropic, OpenAI, Google, OpenRouter
├── tools/           # 40+ tools (admin/, knowledge/, external APIs/)
├── memory/          # 4 layers + pgvector semantic search
├── prompts/         # 3 layers: identity / instructions / safety (versionados)
├── scheduling/      # BullMQ + cron
├── cost/            # CostGuard + usage tracking
├── security/        # ApprovalGate, InputSanitizer, RBAC, ApiKeyService
├── channels/
│   └── adapters/    # WAHA, WhatsApp Meta, Telegram, Slack, Chatwoot
├── agents/          # Registry, comms entre agentes, fomo-internal/
├── mcp/             # MCP client + adapter
├── secrets/         # Credenciales encriptadas por project
├── knowledge/       # RAG con pgvector
├── api/
│   ├── routes/      # 30+ routes REST + WebSocket
│   ├── admin-auth.ts  # Master-key guard (fomo-admin)
│   └── sandbox/     # WS sandbox + stateless runner
└── provisioning/    # Dokploy API client, auto-deploy de clientes

dashboard/           # Submódulo git separado → fomo-core-dashboard repo
cli/nexus-admin/     # CLI para hablarle a fomo-admin por terminal
docs/                # Esta carpeta — guías y planes
prisma/              # Schema + migrations + seed
templates/           # Templates de containers para provisioning de clientes
```

### Endpoints REST principales (bajo `/api/v1/`)
- `/projects`, `/agents`, `/sessions`, `/prompt-layers`, `/traces`
- `/approvals`, `/tools`, `/chat`, `/chat-stream`, `/scheduled-tasks`
- `/contacts`, `/webhooks`, `/files`, `/secrets`, `/knowledge`
- `/integrations`, `/inbox`, `/campaigns`, `/verticals`, `/cost`
- `/mcp-servers`, `/models`, `/api-keys`, `/provisioning`
- `/admin/invoke`, `/admin/sessions/:id`, `/admin/audit` (master-key only)
- `/openclaw/*` — compat con OpenClaw externo
- `/manychat/*` — webhook de ManyChat

---

## 4. Deploy en VPS — cómo está montado

> ⚠️ **Completar estos datos** — son los que Claude necesita para ayudarte con ops.

### Infraestructura
- **Proveedor VPS**: `<COMPLETAR>` (ej: Hetzner / DigitalOcean)
- **IP pública**: `<COMPLETAR>`
- **OS**: `<COMPLETAR>` (ej: Ubuntu 22.04)
- **Recursos**: `<COMPLETAR>` (RAM / CPU / disco)

### Dokploy
- **URL admin**: `<COMPLETAR>` (ej: https://dokploy.fomo.tech:3001)
- **User admin**: `<COMPLETAR>` (email)
- **Auth**: password-based (no OAuth)

### Servicios deployados en Dokploy
| Servicio | Nombre en Dokploy | Dominio público | Puerto interno | Estado |
|---|---|---|---|---|
| Backend API | `<fomo-core-prod?>` | `<COMPLETAR>` (ej: api.fomo.tech) | 3002 | ✅ verde |
| Dashboard | `<fomo-dashboard?>` | `<COMPLETAR>` (ej: dashboard.fomo.tech) | 3000 | ✅ verde pero login falla |
| PostgreSQL | `<COMPLETAR>` | n/a (interno) | 5432 | ✅ |
| Redis | `<COMPLETAR>` | n/a (interno) | 6379 | ✅ |
| WAHA | `<COMPLETAR>` | `<COMPLETAR>` (si expuesto) | 3000 | ✅ |

### Env vars críticas (dónde viven)

En Dokploy, cada app tiene su bloque de env vars. Las más importantes:

**fomo-core (backend)**
- `DATABASE_URL` — conexión a Postgres
- `REDIS_URL` — Redis para BullMQ
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENROUTER_API_KEY`
- `NEXUS_API_KEY` — master key para el backend (legacy, hoy se usa DB-stored keys)
- `SECRETS_ENCRYPTION_KEY` — 32 bytes hex (¡NO perder!)
- `NEXUS_PUBLIC_URL` — URL pública del API (para webhooks)
- `CORS_ORIGIN` — dominio del dashboard (para CORS)
- `DOKPLOY_API_KEY`, `DOKPLOY_URL`, `DOKPLOY_PROJECT_ID` — para provisioning de clientes
- `HOST=::` · `PORT=3002`

**fomo-dashboard (Next.js)**
- `ADMIN_PASSWORD` — password para login del dashboard ⚠️ **requerido**
- `NEXT_PUBLIC_FOMO_API_URL` — URL pública del backend (ej: https://api.fomo.tech)
- `NEXT_PUBLIC_FOMO_WS_URL` — WS URL (wss://api.fomo.tech)
- `NEXT_PUBLIC_APP_NAME=FOMO Dashboard`

---

## 5. Estado actual (2026-04-19)

### Lo que anda
- ✅ Backend arriba en Dokploy
- ✅ Dashboard arriba en Dokploy
- ✅ WAHA conectada con QR escaneado (al menos una sesión WA activa)
- ✅ HubSpot integrado (`search-deals` tool + OAuth/token)
- ✅ Telegram + Slack + Chatwoot con adapters funcionando
- ✅ **fomo-admin agent completo** (11/11 steps) — ver [fomo-admin-plan.md](fomo-admin-plan.md)
  - 32 admin tools · master-key auth · audit log · CLI `nexus-admin` · seed script listo
  - **Pendiente en VPS**: correr migration `20260416000000_add_admin_audit_log` + seed del agente

### Lo que está roto / pendiente
- 🚨 **Login al dashboard falla**: "ADMIN_PASSWORD not configured on server"
  - **Fix**: setear `ADMIN_PASSWORD=<pw-fuerte>` en env vars de la app `<fomo-dashboard>` en Dokploy → Redeploy
- ⏳ **Market Paper todavía no empezado** — es el próximo objetivo
- ⏳ **fomo-admin no probado en prod** — migration + seed pendientes

### Clientes activos (en DB del seed)
- `fomo-internal` — interno de FOMO
- `demo` — proyecto demo
- `market-paper` — seedado pero no configurado (HubSpot token + WAHA pendientes)
- Otros listados en [../prisma/seed.ts](../prisma/seed.ts)

---

## 6. Objetivos a corto plazo

### P0 — Desbloquear acceso al dashboard (hoy)
1. Setear `ADMIN_PASSWORD` en env de `<fomo-dashboard>` en Dokploy
2. Redeploy del servicio dashboard
3. Verificar login: `POST https://<DASHBOARD_URL>/api/auth/login` con `{email, password}` → 200

### P1 — Verificar fomo-admin en VPS (esta semana)
1. Correr migration en el contenedor de backend: `pnpm db:migrate` (la nueva `20260416000000_add_admin_audit_log`)
2. Regenerar Prisma client: `pnpm db:generate`
3. Correr seed: `npx tsx src/agents/fomo-internal/seed.ts` (crea FOMO-Admin agent + 3 scheduled tasks)
4. Crear master API key vía `POST /api/v1/api-keys` (si no hay una)
5. Smoke test: `POST /api/v1/admin/invoke` con prompt "listá los agentes de fomo-internal"
6. Ver runbook completo en [../C:\Users\Mariano\.claude\plans\snuggly-chasing-bachman.md] (plan local de Mariano)

### P2 — Onboardear Market Paper (días siguientes)
1. Cargar HubSpot access token en secrets del project `market-paper`
2. Configurar WAHA outbound number para Market Paper
3. Revisar prompts del agente Reactivadora Market Paper
4. Test: simular un lead entrando por HubSpot → agente lo contacta por WhatsApp
5. Ver [market-paper-agent.md](market-paper-agent.md) y [cuestionario-market-paper.md](cuestionario-market-paper.md) para el contexto completo

---

## 7. Cómo arrancar una sesión con Claude productiva

Cuando abras Claude Code en este repo:

1. **Asegurate de que lea este archivo primero**: `Read docs/CLAUDE-ONBOARDING.md`
2. **Pedile que lea también**:
   - `CLAUDE.md` (raíz) — reglas de código del backend
   - `dashboard/CLAUDE.md` — reglas del dashboard
3. **Decile tu objetivo en la primera línea**:
   - ✅ "necesito onboardear Market Paper en producción"
   - ✅ "debug: el login del dashboard falla con 500"
   - ❌ "ayudame con esto" (demasiado vago)
4. **Si el tema es infra/Dokploy**:
   - Claude **no tiene SSH** al VPS — te va a dar comandos para que vos los corras
   - Pasale los logs/errores textualmente (copy-paste)
   - Sacá captura de la UI de Dokploy si es config de env vars

### Memoria persistente
Claude tiene un sistema de memoria en `C:\Users\Mariano\.claude\projects\...\memory\` que recuerda contexto entre sesiones. No hace falta repetir cosas básicas (stack, quién sos).

---

## 8. Comandos útiles (referencia rápida)

### Local
```bash
pnpm dev              # Dev server con hot reload (puerto 3002)
pnpm typecheck        # TS sin emit
pnpm test:unit        # Tests unitarios
pnpm db:migrate       # Prisma migrate
pnpm db:seed          # Seed dev data
```

### Dashboard (submódulo)
```bash
cd dashboard
npm run dev           # Puerto 3000
npm run build         # Prod build
```

### CLI admin (nuevo)
```bash
cd cli/nexus-admin
pnpm install && pnpm build
NEXUS_API_KEY=<master-key> NEXUS_API_URL=https://<api-url> \
  node dist/index.js "listá los agentes"
```

### En Dokploy (vía UI)
- **Redeploy**: app → botón "Redeploy" (rebuilds desde git)
- **Logs**: app → pestaña "Logs" (stdout del container)
- **Env**: app → pestaña "Environment" → agregar/editar → Save → Redeploy
- **Exec**: algunas versiones tienen terminal embebido; sino SSH al VPS y `docker exec -it <container> sh`

---

## 9. Gotchas conocidos (NO repetir errores)

- **Windows PowerShell v5** no soporta `&&` — usar `;` entre comandos
- **`localhost` en Windows** resuelve IPv6 primero → usar `HOST=::`
- **Prisma 7.x tiene drift bug con pgvector** — quedarse en 6.x
- **Puerto 3000 conflicto local**: fomo-core corre en 3002 (Windows), 3000 es del dashboard
- **`ADMIN_PASSWORD` es runtime** (no `NEXT_PUBLIC_*`) — basta con restart, no rebuild
- **`NEXT_PUBLIC_*` son build-time** — si cambiás `NEXT_PUBLIC_FOMO_API_URL` hay que **rebuild** el dashboard (no solo restart)
- **Dashboard es un submódulo** — commits pushan al repo separado `fomo-core-dashboard`
- **Secrets encryption key**: si se pierde `SECRETS_ENCRYPTION_KEY`, TODOS los secrets encriptados son irrecuperables → hacer backup

---

## 10. Contactos / recursos externos

- **Repo backend**: https://github.com/marianoberton/fomo-core (este)
- **Repo dashboard**: https://github.com/marianoberton/fomo-core-dashboard
- **Dokploy docs**: https://docs.dokploy.com
- **WAHA docs**: https://waha.devlike.pro/docs/

---

## 11. Links a docs más profundos

- [CLAUDE.md](../CLAUDE.md) — reglas de código backend
- [dashboard/CLAUDE.md](../dashboard/CLAUDE.md) — reglas dashboard
- [PLATFORM-OVERVIEW.md](PLATFORM-OVERVIEW.md) — overview técnico general
- [ARQUITECTURA-AUDIT-2026-03.md](ARQUITECTURA-AUDIT-2026-03.md) — auditoría arquitectura
- [PROVISIONING-SPEC-2026-03.md](PROVISIONING-SPEC-2026-03.md) — cómo provisionar clientes
- [fomo-admin-plan.md](fomo-admin-plan.md) — plan completo del agente admin
- [market-paper-agent.md](market-paper-agent.md) — setup de Market Paper
- [WAHA_SETUP.md](WAHA_SETUP.md) · [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md) — canales WA
- [QUICKSTART.md](QUICKSTART.md) — dev setup local

---

**Checklist para completar este doc después**:
- [ ] Llenar IP / proveedor VPS (sección 4)
- [ ] Llenar URL Dokploy + nombres exactos de apps
- [ ] Llenar dominios públicos de dashboard + API
- [ ] Confirmar env vars que faltan (ej: ADMIN_PASSWORD no seteado)
- [ ] Actualizar sección 5 cuando Market Paper empiece
