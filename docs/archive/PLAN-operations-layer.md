# Operations Layer — "Abro el proyecto y sé si todo funciona"

## El Problema de Fondo

El dashboard tiene 15+ páginas CRUD (agents, channels, secrets, MCP, prompts...) pero **ninguna te dice si el sistema está funcionando**. Cada página es independiente: agents no sabe de channels, channels no sabe de agents, y el project overview es una tabla de links. El resultado:

- No sabés si un agente está activo en Telegram o WhatsApp
- No sabés si un canal está conectado o caído
- Configurar WAHA requiere tocar Docker, APIs, y la UI por separado
- Los MCP muestran solo config custom (hay catálogo pero sin templates reales)
- No hay un lugar que diga **"todo OK"** o **"algo se rompió"**

## La Solución: Un Layer de Operaciones

**Un solo cambio conceptual**: cada página que muestra agentes o canales ahora también muestra su estado operativo. No son features nuevas — es hacer que lo que ya existe se comunique entre sí.

### Lo que ya está hecho (sesión anterior)
- Breadcrumbs: CUIDs → nombres reales ✅
- WAHA adapter + provider registration ✅
- WhatsApp (QR) en selector de Channels ✅
- 16 tests WAHA pasando ✅

---

## Fase 1: WAHA Completamente Automático

**Meta**: El usuario va a Channels → elige WhatsApp (QR) → ve el QR en pantalla → escanea → listo. Sin Docker, sin APIs, sin ir a `localhost:3003`.

### 1A. Docker: auto-reconnect ✅

**`docker-compose.yml`** — env vars en servicio `waha`:
```yaml
WHATSAPP_RESTART_ALL_SESSIONS: "True"   # reconecta automáticamente al reiniciar
```

### 1B. Backend: auto-setup al crear integración ✅

**`src/api/routes/integrations.ts`** — en el handler de `POST /projects/:projectId/integrations`, después de crear una integración `whatsapp-waha`:

1. Crear/iniciar sesión WAHA: `POST {wahaBaseUrl}/api/sessions` con `{ name: sessionName }`
2. Configurar webhook: el session config incluye `webhooks: [{ url: "{NEXUS_PUBLIC_URL}/api/v1/webhooks/whatsapp-waha/{integrationId}", events: ["message"] }]`

Necesita nueva env var: `NEXUS_PUBLIC_URL` (la URL pública del servidor, ej: `https://nexus.fomo.com.ar`).

### 1C. Backend: proxy endpoints para WAHA ✅

**`src/api/routes/integrations.ts`** — 3 rutas nuevas (solo para `whatsapp-waha`):

| Endpoint | Qué hace |
|----------|----------|
| `GET .../integrations/:id/waha/status` | Devuelve estado de sesión (WORKING, SCAN_QR_CODE, FAILED) |
| `GET .../integrations/:id/waha/qr` | Devuelve imagen QR (proxy de WAHA, evita CORS) |
| `POST .../integrations/:id/waha/session` | Acción: `start` / `stop` / `restart` |

El dashboard NUNCA habla directo con WAHA — siempre a través de Nexus. Así funciona aunque WAHA no sea público.

### 1D. Dashboard: QR inline en página de Channels 🔲

**`dashboard/src/app/projects/[projectId]/integrations/page.tsx`**

Para integraciones `whatsapp-waha`, el `IntegrationRow` muestra info extra:
- Badge de estado WAHA: **Working** (verde), **Scan QR** (amarillo pulsante), **Failed** (rojo)
- Cuando necesita QR: sección expandible con la imagen QR + instrucciones "Escaneá con WhatsApp"
- Botones: "Reiniciar Sesión" cuando está caída
- Polling cada 5s cuando está en modo QR (se actualiza solo cuando el teléfono escanea)

**Nuevos hooks**: `useWahaStatus()`, `useWahaQr()`, `useWahaSessionAction()`
**Nuevo componente**: `WahaStatusPanel`

**Archivos nuevos/modificados:**
- `dashboard/src/lib/api/integrations.ts` — funciones API para WAHA
- `dashboard/src/lib/hooks/use-integrations.ts` — hooks para WAHA
- `dashboard/src/components/dashboard/waha-status-panel.tsx` — **NUEVO**
- `dashboard/src/app/projects/[projectId]/integrations/page.tsx` — integrar panel

---

## Fase 2: Project Overview → Centro de Operaciones

**Meta**: Abro el proyecto y veo inmediatamente: qué agentes tengo, en qué canales están, y si están funcionando.

### 2A. Backend: endpoint de resumen operativo 🔲

**`src/api/routes/operations-summary.ts`** — **NUEVO**

`GET /api/v1/projects/:projectId/operations-summary`

Lógica:
1. Buscar todos los agentes del proyecto
2. Buscar todas las integraciones del proyecto
3. Por cada agente, cruzar `channelConfig.allowedChannels` + `modes[].channelMapping` contra las integraciones
4. Health check de cada integración (cacheado 60s en memoria para no martillar WAHA/Telegram)

```typescript
// Respuesta
{
  agents: [{
    id: "abc",
    name: "Asistente Fomo",
    status: "active",
    channels: [
      { provider: "telegram", status: "connected" },       // integración existe + healthy
      { provider: "whatsapp-waha", status: "needs_qr" },  // existe pero necesita escanear
    ]
  }],
  summary: {
    totalChannels: 2,
    healthy: 1,
    needsAttention: 1
  }
}
```

Registrar en `src/main.ts`.

### 2B. Dashboard: componente ChannelBadges 🔲

**`dashboard/src/components/dashboard/channel-badges.tsx`** — **NUEVO**

Píldoras chicas con icono de canal + indicador de color:
- WhatsApp (verde) = conectado y funcionando
- Telegram (verde) = conectado y funcionando
- WhatsApp (amarillo) = necesita QR
- WhatsApp (gris) = agente lo referencia pero no hay integración

### 2C. Rediseño del project overview 🔲

**`dashboard/src/app/projects/[projectId]/page.tsx`** — reescribir

**Layout nuevo:**

```
┌─────────────────────────────────────────────────────┐
│  Fomo Assistant                          [Active ●]  │
│  Asistente de ventas para fomo.com.ar               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────┐  ┌──────────────────┐         │
│  │ ● All channels   │  │   2 Agents       │         │
│  │   healthy        │  │   1 active       │         │
│  └──────────────────┘  └──────────────────┘         │
│                                                      │
│  AGENTS                                [+ New Agent] │
│  ┌─────────────────────────────────────────────┐    │
│  │ Asistente Fomo                    [active]   │    │
│  │    WhatsApp ●  Telegram ●                    │    │
│  │    "Asistente de ventas..."                   │    │
│  │                          [Test] [Configure →] │    │
│  ├─────────────────────────────────────────────┤    │
│  │ Soporte Técnico                   [active]   │    │
│  │    WhatsApp (QR) ⚠                           │    │
│  │    "Soporte técnico..."                       │    │
│  │                          [Test] [Configure →] │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ▸ Configuration (Knowledge, Files, Secrets...)     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Cambios concretos vs. la página actual:**
1. **Stats cards**: reemplazar "Active Sessions: 0" y "Cost Today: $0" con datos reales del operations-summary
2. **Agent cards**: agregar fila de `ChannelBadges` debajo del nombre — muestra canales con estado
3. **Banner de salud**: arriba de los agents, un banner que dice "All channels healthy" (verde) o "1 channel needs attention" (amarillo, clickable → va a integrations)
4. **Configuration grid**: colapsable, default cerrado — es útil pero secundario a operaciones

### 2D. Agents list page: mismos badges 🔲

**`dashboard/src/app/projects/[projectId]/agents/page.tsx`**

Agregar `ChannelBadges` a cada agent card. Usa `useIntegrations(projectId)` + agent data para cruzar client-side.

### 2E. Agent detail: sidebar "Connected Channels" 🔲

**`dashboard/src/app/projects/[projectId]/agents/[agentId]/page.tsx`**

En el sidebar derecho, nueva sección entre "Quick Actions" y "Agent Info":
- Lista de canales con icono + nombre + dot de estado
- "No channels configured" si no hay

---

## Fase 3: MCP Templates Reales

**Meta**: Abro MCP Servers y veo HubSpot, GitHub, Google Calendar listos para un click.

### 3A. Seed templates populares 🔲

**`prisma/seed.ts`** (o `prisma/seed-fomo.ts`) — agregar templates idempotentemente:

| Template | Categoría | Package npm |
|----------|-----------|-------------|
| HubSpot (Official) | CRM | `@hubspot/mcp-server` |
| Twenty CRM | CRM | `twenty-mcp-server` |
| GitHub | Productivity | `@modelcontextprotocol/server-github` |
| Google Calendar | Productivity | `@anthropic/mcp-google-calendar` |
| Slack (MCP) | Communication | `@modelcontextprotocol/server-slack` |
| PostgreSQL | Custom | `@modelcontextprotocol/server-postgres` |

### 3B. Fix filtro de categorías 🔲

**`dashboard/src/app/projects/[projectId]/mcp-servers/page.tsx`**

Falta `communication` en el dropdown (el badge styling ya lo soporta). Agregar:
```tsx
<SelectItem value="communication">Communication</SelectItem>
```

### Respuestas a preguntas frecuentes sobre MCP:

**"¿Siempre custom?"** — No. Ya existe un catálogo de templates. Solo falta llenarlo con templates reales (3A).

**"¿Puedo compartir MCP entre proyectos?"** — Cada proyecto tiene sus propias instancias (por seguridad — cada uno puede tener distintas API keys). Pero los templates hacen que crear la misma config en otro proyecto sea un click.

**"¿Tengo que levantar el MCP?"** — No. Los MCP de tipo `stdio` (la mayoría) se levantan solos cuando un agente los necesita (first chat). Nexus ejecuta `npx @hubspot/mcp-server` automáticamente. Los de tipo `sse` sí necesitan un servidor corriendo (pero son menos comunes).

---

## Archivos a Crear/Modificar

### Backend
| Archivo | Cambio | Estado |
|---------|--------|--------|
| `docker-compose.yml` | WAHA auto-reconnect env | ✅ |
| `src/api/routes/integrations.ts` | WAHA proxy endpoints + auto-setup al crear | ✅ |
| `src/api/routes/operations-summary.ts` | **NUEVO** — resumen operativo | 🔲 |
| `src/main.ts` | Registrar operations-summary route | 🔲 |
| `prisma/seed.ts` o `prisma/seed-fomo.ts` | MCP templates reales | 🔲 |

### Dashboard
| Archivo | Cambio | Estado |
|---------|--------|--------|
| `src/lib/api/integrations.ts` | Funciones API para WAHA | 🔲 |
| `src/lib/api/operations.ts` | **NUEVO** — API operations summary | 🔲 |
| `src/lib/hooks/use-integrations.ts` | Hooks WAHA | 🔲 |
| `src/lib/hooks/use-operations.ts` | **NUEVO** — hook operations summary | 🔲 |
| `src/components/dashboard/channel-badges.tsx` | **NUEVO** — badges de canal | 🔲 |
| `src/components/dashboard/waha-status-panel.tsx` | **NUEVO** — QR inline + control sesión | 🔲 |
| `src/app/projects/[projectId]/page.tsx` | Rediseño → centro de operaciones | 🔲 |
| `src/app/projects/[projectId]/agents/page.tsx` | Channel badges en agent cards | 🔲 |
| `src/app/projects/[projectId]/agents/[agentId]/page.tsx` | Sidebar "Connected Channels" | 🔲 |
| `src/app/projects/[projectId]/integrations/page.tsx` | WAHA status panel | 🔲 |
| `src/app/projects/[projectId]/mcp-servers/page.tsx` | Filtro `communication` | 🔲 |

---

## Orden de Implementación

| # | Fase | Qué resuelve |
|---|------|-------------|
| 1 | WAHA automático (backend + dashboard) | "Configuro WhatsApp QR desde la UI, veo el QR, escaneo, listo" |
| 2 | Centro de operaciones (backend + dashboard) | "Abro el proyecto y sé si todo funciona" |
| 3 | MCP templates (seed + filtro) | "Veo HubSpot listo para usar, un click" |

Las 3 fases son independientes. La Fase 2 es la más grande pero la más impactante.

---

## Verificación

1. **WAHA E2E**: Crear integración WhatsApp (QR) desde dashboard → QR aparece inline → escanear → estado cambia a Working → mandar mensaje desde WhatsApp → agente responde
2. **Reconexión**: Reiniciar Docker → WAHA reconecta sin QR (si la sesión persiste)
3. **Project overview**: Abrir proyecto → ver agentes con badges de canal → ver "All channels healthy" o advertencia
4. **Agent cards**: En lista de agents, cada card muestra canales conectados
5. **Agent detail**: Sidebar muestra "Connected Channels" con estado
6. **MCP catalog**: Abrir MCP Servers → ver HubSpot, GitHub en catálogo → crear con un click
7. **Build**: `cd dashboard && npm run build` pasa
8. **Tests**: `npx vitest run src` — todos pasan (tests para operations-summary + WAHA proxy)
