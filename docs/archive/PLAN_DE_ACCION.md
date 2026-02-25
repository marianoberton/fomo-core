# Plan de Acción: Integración Nexus Core ↔ Fomo Platform

**Fecha**: 2026-02-15
**Estado**: Planificación completada, pendiente ejecución

---

## Resumen Ejecutivo

### Proyectos Involucrados

| Proyecto | Ubicación | Estado | Stack |
|----------|-----------|--------|-------|
| **Nexus Core** | `C:\Users\Mariano\Documents\fomo-core` | Backend 100% completo | Fastify + Prisma + PostgreSQL + Redis (port 3002) |
| **Fomo Platform** | `C:\Users\Mariano\Documents\plataforma\marketpaper-demo` | Producción activa (cliente INTED) | Next.js 15 + Supabase + LangChain + HubSpot |

### Objetivo

Integrar Nexus Core (motor de agentes autónomos) con Fomo Platform (CRM/Tareas empresarial) mediante:

1. **Admin UI** en Fomo Platform para gestionar agentes de Nexus Core
2. **MCP Server** en Fomo Platform para exponer CRM/Tareas a agentes de Nexus
3. **Canales completos** (completar tests de Slack)
4. **Agentes de prueba** pre-configurados para testing intensivo

---

## Arquitectura de Integración

```
┌─────────────────────────────────────────────────────────────┐
│                     FOMO PLATFORM                           │
│           (marketpaper-demo - Next.js 15)                   │
│                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐   │
│  │   Admin UI Nexus     │      │    MCP Server        │   │
│  │  /admin/nexus/*      │      │  (stdio transport)   │   │
│  │                      │      │                      │   │
│  │  - Agents CRUD       │      │  Tools:              │   │
│  │  - Projects CRUD     │      │  - create-task       │   │
│  │  - Prompts CRUD      │      │  - get-contacts      │   │
│  │  - Tasks CRUD        │      │  - update-opportunity│   │
│  │  - Integrations      │      │  - search-companies  │   │
│  └──────────┬───────────┘      └─────────┬────────────┘   │
│             │                            │                 │
│             │ HTTP (port 3002)           │ stdio           │
│             │                            │                 │
└─────────────┼────────────────────────────┼─────────────────┘
              │                            │
              ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      NEXUS CORE                             │
│              (fomo-core - Fastify API)                      │
│                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐   │
│  │   REST API           │      │   MCP Manager        │   │
│  │   (port 3002)        │      │                      │   │
│  │                      │      │  - Connect to MCP    │   │
│  │  /projects           │      │  - Discover tools    │   │
│  │  /agents             │      │  - Execute tools     │   │
│  │  /prompts            │      │                      │   │
│  │  /scheduled-tasks    │      │                      │   │
│  └──────────────────────┘      └──────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Agent Runner (core loop)                │  │
│  │  - Build prompt → LLM → Parse → Execute tools       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Flujo de uso**:
1. Admin crea agente en Fomo Platform UI (`/admin/nexus/agents`)
2. UI llama API de Nexus Core (HTTP `POST /agents`)
3. Agente se configura con MCP tools de Fomo Platform
4. Usuario conversa con agente (vía Chatwoot/WhatsApp/Telegram/Slack)
5. Agente llama herramientas MCP (ej: `create-task`)
6. MCP server ejecuta `POST /api/workspace/temas/:id/tasks` en Fomo Platform
7. Tarea creada en Supabase, visible en UI de Fomo Platform

---

## Plan de Implementación

### Fase 1: Migrar Dashboard Existente (1 día) ⚡ **REDUCIDO DE 3-4 DÍAS**

**Ubicación origen**: `C:\Users\Mariano\Documents\fomo-core-dashboard` (Next.js 16, shadcn/ui, React Query)
**Ubicación destino**: `C:\Users\Mariano\Documents\plataforma\marketpaper-demo\app\admin\nexus\`

**Objetivo**: Migrar dashboard completo ya existente. **El 90% del código está listo** - solo necesita integración.

**Features ya implementados en dashboard** (16 páginas, ~4000 LOC):
✅ Dashboard home con métricas (projects, agents, sessions, costs)
✅ Projects CRUD + wizard de creación (5 steps: basics, identity, integrations, limits, review)
✅ Agents management + **live chat con WebSocket real-time**
✅ Prompt layer editor (Monaco) con versionado + historia
✅ Approvals queue con aprobación/rechazo de tools
✅ Integrations manager (credentials, MCP servers, channels)
✅ Cost analysis con gráficos (Recharts)
✅ Responsive design (mobile/tablet/desktop)

**Tareas de migración** (simple copy-paste + config):

1. ✅ **Setup Inicial** (30 min)
   - Copiar directorios completos:
     - `fomo-core-dashboard/src/components/` → `marketpaper-demo/components/nexus/`
     - `fomo-core-dashboard/src/lib/` → `marketpaper-demo/lib/nexus/`
     - `fomo-core-dashboard/src/app/*` → `marketpaper-demo/app/admin/nexus/`
   - Actualizar path aliases (`@/components` → `@/components/nexus`)
   - Cambiar URLs:
     - API: `http://localhost:3002` (Nexus Core)
     - WebSocket: `ws://localhost:3002/ws`

2. ✅ **Auth Bridge** (1h)
   - Integrar con sistema de auth existente de marketpaper (Supabase)
   - Obtener API key de Nexus Core (`POST /auth/token`)
   - Guardar en session server-side (no localStorage)

3. ✅ **Data Integration** (2h)
   - Reemplazar mock data con queries reales:
     - Dashboard stats: GET `/stats`
     - Projects: GET/POST `/projects`
     - Agents: GET/POST `/projects/:id/agents`
     - Prompts: GET/POST `/projects/:id/prompt-layers`
     - Approvals: GET/POST `/approvals`
     - Integrations: GET/PATCH `/projects/:id/integrations`
     - Costs: GET `/projects/:id/usage`
     - Tasks: GET/POST `/scheduled-tasks`

4. ✅ **Polish & Testing** (1h)
   - Ajustar branding de marketpaper
   - Breadcrumbs contextuales
   - Test end-to-end (login → dashboard → create project → chat → approvals)

**Tech stack** (YA compatible con marketpaper-demo):
- Next.js 16 (App Router)
- shadcn/ui (Radix + Tailwind)
- React Query (TanStack)
- Monaco Editor (prompts)
- Recharts (gráficos)
- Sonner (toasts)

**Verificación**:
- [ ] Dashboard home muestra stats reales
- [ ] Crear proyecto desde wizard → aparece en Nexus Core DB
- [ ] Live chat funciona (WebSocket conectado)
- [ ] Prompt editor guarda cambios → nueva versión en DB
- [ ] Approvals queue funcional
- [ ] Cost analysis muestra datos reales

---

### Fase 2: Slack Tests + Docs (1 día)

**Objetivo**: Completar testing de Slack adapter (único canal sin tests).

**Tareas**:
1. ✅ **Slack Tests** (`fomo-core/src/channels/adapters/slack.test.ts`)
   - 20+ tests cubriendo:
     - Schema validation
     - send() success/errors
     - parseInbound() texto/threads
     - isHealthy() success/failure
     - URL verification challenge
   - Pattern: duplicar `telegram.test.ts`

2. ✅ **Slack Setup Docs** (`fomo-core/docs/SLACK_SETUP.md`)
   - Crear Slack App
   - Configurar Bot Token Scopes
   - Event Subscriptions
   - Webhook URL setup
   - Testing con curl

**Verificación**:
- [ ] `pnpm test src/channels/adapters/slack.test.ts` → todos pasan
- [ ] Leer docs → guía clara y completa
- [ ] Test manual con Slack real → mensaje enviado y recibido

---

### Fase 3: MCP Server en Fomo Platform (2-3 días)

**Objetivo**: Crear MCP server que exponga APIs de Fomo Platform para Nexus Core.

**Ubicación**: `C:\Users\Mariano\Documents\plataforma\marketpaper-demo\mcp-server\`

**Tareas**:
1. ✅ **Setup MCP Server**
   - `mcp-server/package.json` - Dependencies (@modelcontextprotocol/sdk)
   - `mcp-server/tsconfig.json` - TypeScript config
   - Build script: `tsc` → `dist/index.js`

2. ✅ **MCP Server Main** (`mcp-server/index.ts`)
   - Server con 4 herramientas:
     - `create-task` → POST `/api/workspace/temas/:id/tasks`
     - `get-contacts` → GET `/api/workspace/crm-fomo/contacts`
     - `update-opportunity` → PATCH `/api/workspace/oportunidades/:id/stage`
     - `search-companies` → GET `/api/workspace/crm`
   - Transport: stdio (subprocess)

3. ✅ **API Client** (`mcp-server/api-client.ts`)
   - Wrapper que llama Next.js API routes con `fetch`
   - Autenticación: Supabase Service Role Key

4. ✅ **Configurar en Nexus Core** (`fomo-core/prisma/seed.ts`)
   - Crear proyecto "Fomo Platform Assistant"
   - Config mcpServers apuntando a `marketpaper-demo/mcp-server/dist/index.js`
   - allowedTools: `mcp:fomo-platform:create-task`, etc.

5. ✅ **Integration Tests** (`fomo-core/src/mcp/fomo-platform.integration.test.ts`)
   - Connect to MCP server
   - List tools (debe retornar 4)
   - Call create-task → tarea creada en Supabase
   - Call get-contacts → contactos retornados

**Verificación**:
- [ ] Iniciar MCP server → `node mcp-server/dist/index.js` sin crashes
- [ ] Nexus Core conecta → tools descubiertas en logs
- [ ] Call `create-task` → tarea visible en Fomo Platform UI
- [ ] Call `get-contacts` → contactos retornados correctamente

---

### Fase 4: MCP Documentation (1 día)

**Objetivo**: Documentar cómo conectar MCPs externos (Google Calendar, GitHub, Fomo).

**Tareas**:
1. ✅ **MCP Guide** (`fomo-core/docs/MCP_GUIDE.md`)
   - Qué es MCP
   - Cómo funciona en Nexus Core
   - Ejemplo: Google Calendar MCP
   - Ejemplo: GitHub MCP
   - Ejemplo: Fomo Platform MCP (custom)
   - Debugging tips

2. ✅ **Ejemplos en seed.ts** (`fomo-core/prisma/seed.ts`)
   - Proyecto "Calendar Assistant" con Google Calendar MCP
   - Proyecto "GitHub Bot" con GitHub MCP
   - Proyecto "Fomo Assistant" con Fomo Platform MCP (ya incluido en Fase 3)

**Verificación**:
- [ ] Leer `MCP_GUIDE.md` → guía completa
- [ ] Seguir ejemplo Google Calendar → funciona
- [ ] Seguir ejemplo GitHub → funciona

---

### Fase 5: Agentes de Prueba (1-2 días)

**Objetivo**: Crear agentes pre-configurados para testing intensivo.

**Tareas**:
1. ✅ **Seed Agentes Verticales** (`fomo-core/prisma/seed.ts`)
   - **Ferretería Mayorista**: catalog-search, catalog-order, calculator
   - **Concesionaria**: vehicle-lead-score, catalog-search, propose-scheduled-task
   - **Hotel Boutique**: hotel-detect-language, hotel-seasonal-pricing
   - **Fomo Assistant**: Todos los MCP tools de Fomo Platform

2. ✅ **Cargar Catálogos Demo** (`fomo-core/scripts/load-demo-catalogs.ts`)
   - Ferretería: 500 productos (ya existe `test-data/ferreteria-catalog.csv`)
   - Concesionaria: 50 vehículos
   - Hotel: 15 habitaciones + servicios

3. ✅ **E2E Tests** (`fomo-core/tests/e2e/agent-scenarios.test.ts`)
   - Ferretería: Usuario pide tornillos → catalog-search → retorna productos
   - Concesionaria: Lead pregunta precio → vehicle-lead-score → califica
   - Hotel: Huésped reserva → seasonal-pricing → cotiza
   - Fomo Assistant: Crear tarea → MCP → tarea en Supabase

**Verificación**:
- [ ] `pnpm db:seed` → 4 agentes creados
- [ ] Conversación con Ferretería → catalog-search funciona
- [ ] Conversación con Fomo Assistant → MCP tools funcionan
- [ ] E2E tests → `pnpm test tests/e2e/agent-scenarios.test.ts` → pasan

---

### Fase 6: Mejoras UX (2 días - OPCIONAL)

**Objetivo**: Pulir dashboard para demos (baja prioridad).

**Tareas**:
1. ✅ **Onboarding Wizard** (`marketpaper-demo/app/admin/nexus/onboarding/page.tsx`)
   - Step 1: Seleccionar vertical (ferretería, concesionaria, hotel, custom)
   - Step 2: Configurar provider (API key, model)
   - Step 3: Conectar canales (Chatwoot, WhatsApp, Slack)
   - Step 4: Subir catálogo (si vertical lo requiere)
   - Step 5: Test conversación

2. ✅ **Integrations Page** (`marketpaper-demo/app/admin/nexus/integrations/page.tsx`)
   - List webhooks activos
   - Create webhook form
   - Channel config (Chatwoot/WhatsApp/Telegram/Slack)
   - Test connection buttons

**Verificación**:
- [ ] Wizard completa flujo end-to-end
- [ ] Integrations page crea webhook y conecta canal

---

## Estimación de Esfuerzo

| Fase | Días | Complejidad | Prioridad | Notas |
|------|------|-------------|-----------|-------|
| 1. Migrar Dashboard | **1** ⚡ | Baja (copy-paste) | ⚡ CRÍTICA | **Reducido de 3-4 días** - código ya existe |
| 2. Slack Tests + Docs | 1 | Baja | ⚡ CRÍTICA | Tests + setup docs |
| 3. MCP Server Fomo | 2-3 | Media | ⚡ CRÍTICA | Nuevo servidor MCP |
| 4. MCP Documentation | 1 | Baja | 🔥 ALTA | Guías y ejemplos |
| 5. Agentes de Prueba | 1-2 | Media | 🔥 ALTA | Seed + E2E tests |
| 6. Mejoras UX | 2 | Media | 📝 OPCIONAL | Wizard + polish |
| **TOTAL** | **8-10 días** ⚡ | - | - | **Ahorro: 2-3 días** |

**Timeline**: **1.5-2 semanas calendario** con foco full-time (vs 2-3 semanas original).

---

## Decisiones Técnicas

### 1. MCP Transport: stdio vs SSE

**Decisión**: Empezar con **stdio** (subprocess)

**Razones**:
- ✅ Más simple para desarrollo local
- ✅ Sin dependencias de red
- ✅ Suficiente para MVP

**Migrar a SSE** si:
- Múltiples instancias de Nexus Core necesitan conectarse al mismo MCP
- Fomo MCP debe correr como servicio independiente

### 2. Admin UI: ¿Dónde ubicarlo?

**Decisión**: Dentro de Fomo Platform (`/admin/nexus`)

**Razones**:
- ✅ Ya tiene shadcn/ui setup
- ✅ Ya tiene autenticación Supabase
- ✅ Ya está en producción (no crear repo nuevo)
- ✅ Fácil deploy (mismo Vercel que marketpaper-demo)

### 3. Canales Adicionales: ¿Cuándo?

**Decisión**: Después de Fase 5

**Razones**:
- Slack tests cubren patrones de todos los canales
- Teams/Discord/SMS/Email son similares
- Priorizar integración Fomo + agentes de prueba primero

---

## Riesgos y Mitigaciones

| Riesgo | Impacto | Probabilidad | Mitigación |
|--------|---------|--------------|------------|
| **Conflicto de ports** (Nexus 3002 vs otros servicios) | Medio | Baja | Verificar ports antes de iniciar |
| **MCP server crashes** en stdio | Alto | Media | Logs robustos + restart automático |
| **Datos de producción** en Fomo Platform | CRÍTICO | Baja | **NUNCA testear con cliente INTED**, usar tenant de test |
| **Breaking changes** en Next.js API routes | Medio | Baja | Versionado de API + tests de integración |
| **Supabase RLS** bloquea MCP server | Medio | Media | Usar service role key (bypassa RLS) |

---

## Variables de Entorno Requeridas

### Nexus Core (`fomo-core/.env`)
```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5433/nexus_core
REDIS_URL=redis://localhost:6380

# LLM Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Fomo Platform MCP
SUPABASE_SERVICE_KEY=<service_role_key de marketpaper-demo>
```

### Fomo Platform (`marketpaper-demo/.env.local`)
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...

# Nexus Core API
NEXT_PUBLIC_NEXUS_API_URL=http://localhost:3002
```

### MCP Server (`marketpaper-demo/mcp-server/.env`)
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=<same as above>
```

---

## Verificación Final

### Checklist de Testing

**Admin UI**:
- [ ] Crear agente desde UI → aparece en Nexus Core DB
- [ ] Editar agente → cambios persisten
- [ ] Pausar agente → status cambia a "paused"
- [ ] Crear proyecto → redirige a agents
- [ ] Crear prompt layer → aparece en listado

**MCP Integration**:
- [ ] Iniciar MCP server → no crashes
- [ ] Nexus conecta → tools descubiertas en logs
- [ ] Call `create-task` → tarea en Supabase
- [ ] Call `get-contacts` → contactos retornados

**Canales**:
- [ ] Slack tests → `pnpm test slack.test.ts` → pasan
- [ ] Test manual Slack → mensaje enviado/recibido

**Agentes de Prueba**:
- [ ] `pnpm db:seed` → 4 agentes creados
- [ ] Conversación Ferretería → catalog-search funciona
- [ ] Conversación Fomo Assistant → MCP funciona
- [ ] E2E tests → todos pasan

### Demo Flow (End-to-End)

1. Usuario admin abre `http://localhost:3000/admin/nexus/agents`
2. Crea agente "Asistente Fomo" con MCP tools
3. Usuario cliente envía mensaje por WhatsApp: "Crear tarea: Llamar a Juan mañana"
4. Webhook llega a Nexus Core → procesado por agente
5. Agente llama `mcp:fomo-platform:create-task`
6. MCP server ejecuta `POST /api/workspace/temas/:id/tasks`
7. Tarea creada en Supabase, visible en `/tareas`
8. Agente responde: "✅ Tarea creada: Llamar a Juan - Vencimiento: mañana"

---

## Próximos Pasos

1. **Confirmar arquitectura** con el equipo
2. **Iniciar Fase 1** (Admin UI) - Mayor valor inmediato
3. **Paralelizar Fase 2** (Slack tests) - Independiente de Fase 1
4. **Ejecutar Fases 3-5** en orden - Son dependientes
5. **Evaluar Fase 6** según feedback de testing

---

## Contacto y Soporte

**Proyecto**: Nexus Core + Fomo Platform Integration
**Owner**: Mariano (Fomo)
**Repositorios**:
- Nexus Core: `C:\Users\Mariano\Documents\fomo-core`
- Fomo Platform: `C:\Users\Mariano\Documents\plataforma\marketpaper-demo`

**Documentación**:
- Plan detallado: `C:\Users\Mariano\.claude\plans\keen-skipping-locket.md`
- Este plan de acción: `C:\Users\Mariano\Documents\fomo-core\PLAN_DE_ACCION.md`
