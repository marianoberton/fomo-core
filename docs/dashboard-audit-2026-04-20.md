# Dashboard Audit — 2026-04-20

Auditoría completa del dashboard (`dashboard/`) contra el estado actual del backend (`src/api/routes/`).  
Objetivo: encontrar qué no representa bien al backend, qué confunde a un QA tester, y dónde hay deuda técnica.

---

## 1. Problemas Críticos

### `/conversations` global usa mock data pura

**Archivo:** `dashboard/src/lib/api/conversations.ts`

El sidebar global tiene un link a `/conversations` y `/conversations/[sessionId]`.  
Ambas páginas no hacen ninguna llamada real al backend — consumen datos de `lib/mock-data.ts`.

```typescript
// conversations.ts (API client)
import type { MockConversation, MockMessage } from '@/lib/mock-data';
// No real API calls — uses mock data directly
```

**Impacto:** Cualquier tester que haga QA sobre conversaciones en esa ruta estará mirando datos inventados, sin saberlo.

**Backend real:** El endpoint `/projects/:projectId/inbox` (con su implementación en `src/api/routes/inbox.ts`) sí devuelve sesiones reales.

**Fix:** Eliminar `/conversations` del sidebar global o redirigirlo al inbox por proyecto. La página global no tiene razón de existir mientras no haya un endpoint cross-project de sesiones.

---

### `NEXT_PUBLIC_USE_MOCKS` — Código path alternativo en toda la app

Varios módulos tienen bifurcación por env var:

```typescript
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';
if (USE_MOCK) {
  return mockAnalytics; // datos falsos
}
```

**Archivos afectados:** `use-analytics.ts`, `use-approvals.ts`, `use-conversations.ts`, `use-costs.ts`, `use-projects.ts`, `use-websocket.ts`, `settings/page.tsx`, `layout/mode-indicator.tsx`.

**Riesgo:** Si esta variable se filtra en producción (o si alguien la activa sin darse cuenta), el dashboard muestra datos falsos sin advertencia visible.

---

## 2. Problemas del Inbox

**Página:** `dashboard/src/app/projects/[projectId]/inbox/page.tsx`

El inbox sí está conectado al backend real (`GET /projects/:projectId/inbox` y `GET /projects/:projectId/inbox/:sessionId`), pero tiene varios problemas de usabilidad:

### 2.1 Sin paginación UI

El listado trae hasta 50 sesiones con `limit: 50` hardcodeado. No hay botón "ver más", ni paginación, ni scroll infinito. Si un proyecto tiene 200 conversaciones, 150 son invisibles.

### 2.2 Sin actualizaciones en tiempo real

Usa React Query con polling estático, no WebSocket. Una sesión activa no se actualiza sola. El tester tiene que refrescar la página para ver nuevos mensajes.

El backend tiene soporte WebSocket (Fastify + `@fastify/websocket`), pero el inbox no lo aprovecha.

### 2.3 No hay forma de responder manualmente

El inbox muestra los mensajes pero no tiene input para responder. Para un QA tester que quiere simular un intercambio, es un dead end. 

El backend ya tiene el endpoint: `POST /agents/:agentId/message` (y `POST /projects/:projectId/agents/:agentId/chat`).

### 2.4 Métricas técnicas mezcladas con la conversación

El panel de detalle muestra, en la misma vista:
- Los mensajes del cliente/agente
- Trace count, total tokens, total cost USD

Para un tester funcional eso es ruido. Para un desarrollador es útil, pero debería estar en un tab separado o colapsable.

### 2.5 Media proxy hardcodeada inline

```typescript
const API_BASE = process.env.NEXT_PUBLIC_FOMO_API_URL ?? 'http://localhost:3002'
// construye la URL del proxy inline en el componente
```

Si la URL del backend cambia o el endpoint de media se mueve, falla silenciosamente. Debería estar en el API client centralizado.

### Fix propuesto para Inbox

- Separar traza/costos en un tab o sección colapsable ("Ver métricas")
- Agregar input de respuesta manual (llama a `POST /agents/:agentId/message`)
- Load-more button al final de la lista o paginación visible
- Polling cada 5s en la sesión seleccionada (o conectar WebSocket)
- Mover proxy de media al API client

---

## 3. Problemas del Wizard de Agente

**Página:** `dashboard/src/app/projects/[projectId]/agents/new/page.tsx` (835 líneas)

El wizard tiene dos pasos: elegir arquetipo → llenar formulario con 6 secciones colapsables. El arquetipo pre-llena los campos, lo cual está bien, pero varios detalles confunden a un QA tester.

### 3.1 Lista de modelos hardcodeada

```typescript
const PROVIDER_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  ],
  // ...
};
```

El backend tiene `GET /api/v1/models` que devuelve los 15 modelos curados con metadata actualizada (`src/api/routes/models.ts`). El dashboard ignora ese endpoint y mantiene su propia lista estática que puede quedar desincronizada.

### 3.2 Manager archetype en español (inconsistencia de idioma)

El arquetipo "Manager Agent" tiene todos sus prompts pre-llenados en español:

```typescript
// Archetype: Manager
identity: 'Sos el manager de este negocio...'
instructions: '..cuando recibas una consulta..'
safety: 'Tenés acceso total..'
```

El resto de la UI está en inglés. Confunde especialmente a un tester que no sabe si eso es intencional o un bug.

### 3.3 "¿Tiene manager?" sin contexto

El campo `managerAgentId` aparece en la sección "Advanced Settings" con el label "Manager Agent" y un badge "Auto-wired". Un QA tester sin contexto de la arquitectura multi-agente no entiende qué es ni por qué debería configurarlo.

### 3.4 Error handling solo por toast

```typescript
if (error instanceof ApiError && error.code === 'CHANNEL_COLLISION') {
  toast.error(error.message);
} else {
  toast.error('Failed to create agent'); // siempre este mensaje genérico
}
```

Cualquier error de validación del backend (nombre duplicado, identity vacía, canal ocupado) muestra el mismo mensaje genérico. El tester no sabe qué campo corregir.

### 3.5 Sin borrador / draft saving

El formulario de 835 líneas no guarda estado en `localStorage`. Si el usuario navega para atrás (o el browser falla), pierde todo. Especialmente problemático cuando se está configurando MCP servers o herramientas manualmente.

### 3.6 MCP Servers sin validación

Se pueden agregar configuraciones de MCP server al agente sin ningún test previo. Si la URL o el comando son incorrectos, el agente falla en runtime sin pista clara de por qué.

El backend tiene `POST /mcp-servers/:id/test` pero el wizard no lo expone.

### 3.7 Flujo demasiado plano para un QA tester

El formulario expone demasiadas opciones al mismo tiempo. Un tester que quiere crear un agente de prueba rápido tiene que navegar 6 secciones colapsables antes de poder guardar.

**Fix propuesto para el wizard:**
- **Step 1:** Elegir arquetipo (ya existe, funciona)
- **Step 2:** Solo Nombre + Canal + Prompt de identidad (mínimo para crear)
- **Step 3 (opcional / Advanced):** Modelo, herramientas, límites, MCP, managerAgentId
- Cargar modelos desde `GET /api/v1/models`
- Traducir el manager archetype a inglés
- Inline errors por campo, no solo toast global
- Guardar borrador en `localStorage` al navegar entre steps

---

## 4. Deuda Técnica

### 4.1 `analytics.ts` es un stub de 3 líneas

La página de analytics del dashboard no funciona. El API client `analytics.ts` tiene solo 3 líneas sin implementación real. La página muestra o un loading infinito o datos vacíos.

### 4.2 `/clients` routes — arquitectura vieja

Las rutas `/clients`, `/clients/new`, `/clients/[id]` son de una arquitectura previa. Hoy la entidad central es `Project`, no `Client`. El sidebar las sigue mostrando (o puede mostrarlas) generando confusión de navegación.

### 4.3 Sin tests en el dashboard

No hay ningún archivo de test en `dashboard/`. Ninguna cobertura sobre el wizard, el inbox, ni el API client. Dado que hay lógica de negocio en el wizard (pre-fills de arquetipo, channel modes, validaciones) esto es deuda concreta.

### 4.4 Rutas del backend sin UI en el dashboard

Funcionalidades implementadas en el backend que no tienen página en el dashboard:

| Ruta backend | Funcionalidad | Estado dashboard |
|---|---|---|
| `src/api/routes/campaigns.ts` | Campañas + A/B testing | Sin página |
| `src/api/routes/proactive.ts` | Mensajes proactivos | Sin página |
| `src/api/routes/whatsapp-templates.ts` | Templates de WhatsApp Business | Sin página |
| `src/api/routes/workforce-metrics.ts` | Métricas por vertical | Sin página |
| `src/api/routes/verticals.ts` | Configuración de verticales | Sin página |
| `src/api/routes/onboarding.ts` | Flujo de onboarding | Sin página |
| `src/api/routes/models.ts` | Catálogo de modelos LLM | Ignorado (lista hardcodeada) |
| `src/api/routes/operator-message.ts` | Mensajes del operador | Sin página |
| `src/api/routes/reactivation-campaign.ts` | Campañas de reactivación | Sin página |

### 4.5 Sidebar mixto: global + por proyecto

El sidebar muestra items globales (`/conversations`, `/analytics`) junto con items de proyecto (`/inbox`, `/agents`). La transición entre ambos contextos no está claramente delimitada visualmente, lo que puede confundir a un tester que no sabe si está viendo datos de un proyecto o del sistema completo.

---

## 5. Lo que Funciona Bien

- **API client (`lib/api/`):** 26 módulos bien organizados, con autenticación Bearer, manejo de errores y envoltura del response envelope. Patrón limpio y consistente.
- **React Query:** Query keys bien definidos, invalidación correcta post-mutación.
- **Inbox detail:** El panel de detalle de sesión trae mensajes reales, info de contacto, y soporte de media (aunque con los problemas mencionados).
- **Skills, MCP Servers, Contacts, Knowledge, Files, Catalog, Webhooks:** Todos conectados al backend real con CRUD completo.
- **Agent creation backend alignment:** El payload que construye el wizard coincide exactamente con el Zod schema del backend. No hay mismatch en los tipos.
- **Shadcn/ui + Tailwind 4:** Componentes consistentes, sin CSS propio mezclado.
- **API Keys management:** CRUD completo con reveal-once modal, bien implementado.
- **Error code handling puntual:** El wizard ya detecta `CHANNEL_COLLISION` específicamente (aunque el fallback es genérico).

---

## 6. Plan Sugerido por Prioridad

### P0 — Corrección inmediata (no mostrar datos falsos)

1. **Sacar `/conversations` global del sidebar** o redirigir a inbox por proyecto. La UI actual miente.
2. **Auditar `NEXT_PUBLIC_USE_MOCKS`** — asegurarse que no esté activo en ningún entorno compartido o de QA.

### P1 — Usabilidad para QA tester (una semana)

3. **Inbox: agregar input de respuesta manual** — llama a `POST /agents/:agentId/message`.
4. **Inbox: separar métricas en tab colapsable** — la conversación queda limpia.
5. **Inbox: paginación visible** — load-more button.
6. **Wizard: conectar `/api/v1/models`** — eliminar lista hardcodeada.
7. **Wizard: traducir manager archetype** a inglés.
8. **Wizard: inline errors por campo** en lugar de solo toast genérico.

### P2 — Calidad y confiabilidad (dos semanas)

9. **Wizard: guardar borrador en `localStorage`**.
10. **Wizard: simplificar steps** — step básico + advanced opcional.
11. **Eliminar `/clients` routes** del sidebar y navegación.
12. **Implementar `analytics.ts`** con datos reales del backend.
13. **Mover media proxy** al API client centralizado.

### P3 — Funcionalidades faltantes (roadmap)

14. **Página de Campaigns** — backend completo, sin UI.
15. **Página de Proactive messaging**.
16. **WhatsApp Templates management**.
17. **Workforce metrics / vertical reporting**.
18. **Tests en dashboard** — empezar por wizard y inbox.

---

*Generado: 2026-04-20 | Auditor: Claude Sonnet 4.6*
