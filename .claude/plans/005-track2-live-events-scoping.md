# Track 2 — WebSocket Live Events + projectId Scoping Hardening

**Repo**: `c:\Users\Mariano\Documents\fomo-core`
**Branch**: `feat/t2-live-events`
**Deliverable**: WebSocket `/api/v1/ws/project/:projectId` que empuja eventos en tiempo real (mensajes, aprobaciones, traces, handoffs, campañas) autenticado por API key scopeada. Enforcement de projectId en todas las rutas `/:id` vulnerables.

---

## Context

- El workforce module necesita **vista en vivo** — hoy solo polling. La latencia >5s rompe la experiencia de handoff.
- Hay rutas (`/sessions/:id`, `/traces/:id`, `/approvals/:id`, etc.) que no validan que el `projectId` de la entidad coincida con el `apiKeyProjectId` — una API key scopeada al proyecto A puede leer datos del proyecto B si adivina el ID. Riesgo de data leak multi-tenant.
- El exploration report (`006-workforce-integration-index.md` si existiera) identificó ~8 rutas vulnerables.
- Existe `ws-dashboard.ts` pero es para chat interactivo del dashboard interno, no para push de eventos por proyecto.

---

## Files to Read First

1. [src/api/routes/ws-dashboard.ts](../src/api/routes/ws-dashboard.ts) — patrón de WS + auth por API key.
2. [src/api/auth-middleware.ts](../src/api/auth-middleware.ts) — cómo se setea `request.apiKeyProjectId`.
3. [src/api/routes/api-keys.ts](../src/api/routes/api-keys.ts) — `ApiKeyService.validate()` API.
4. [src/api/routes/platform-bridge.ts](../src/api/routes/platform-bridge.ts) — ejemplos de endpoints project-scoped que funcionan.
5. [src/api/routes/sessions.ts](../src/api/routes/sessions.ts), [traces.ts](../src/api/routes/traces.ts), [approvals.ts](../src/api/routes/approvals.ts), [cost.ts](../src/api/routes/cost.ts) — rutas a hardening.
6. [src/channels/inbound-processor.ts](../src/channels/inbound-processor.ts), [channel-router.ts](../src/channels/channel-router.ts) — puntos donde emitir eventos.
7. [src/security/approval-gate.ts](../src/security/approval-gate.ts) — emit `approval.created` y `approval.resolved`.
8. [src/channels/handoff.ts](../src/channels/handoff.ts) — emit `handoff.requested` y `handoff.resumed`.
9. [src/campaigns/](../src/campaigns/) (si existe; sino buscar por `CampaignSendStatus`) — emit `campaign.progress`.

---

## Scope & Files to Touch

### A. Event Bus

**Nuevo**: `src/api/events/event-bus.ts`

EventEmitter tipado que emite `ProjectEvent` filtrable por `projectId`:

```ts
import { EventEmitter } from 'node:events';
import type { ProjectId, SessionId, AgentId, ApprovalId, TraceId, ContactId } from '@/core/types.js';

export type ProjectEvent =
  | { kind: 'message.inbound'; projectId: ProjectId; sessionId: SessionId; agentId: AgentId; contactId?: ContactId; text: string; channel: string; ts: number }
  | { kind: 'message.outbound'; projectId: ProjectId; sessionId: SessionId; agentId: AgentId; text: string; channel: string; ts: number }
  | { kind: 'approval.created'; projectId: ProjectId; approvalId: ApprovalId; tool: string; sessionId: SessionId; ts: number }
  | { kind: 'approval.resolved'; projectId: ProjectId; approvalId: ApprovalId; decision: 'approved' | 'denied'; ts: number }
  | { kind: 'trace.created'; projectId: ProjectId; traceId: TraceId; sessionId: SessionId; ts: number }
  | { kind: 'handoff.requested'; projectId: ProjectId; sessionId: SessionId; reason: string; ts: number }
  | { kind: 'handoff.resumed'; projectId: ProjectId; sessionId: SessionId; ts: number }
  | { kind: 'session.status_changed'; projectId: ProjectId; sessionId: SessionId; from: string; to: string; ts: number }
  | { kind: 'campaign.progress'; projectId: ProjectId; campaignId: string; sent: number; failed: number; replied: number; ts: number };

export function createProjectEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(1000);
  return {
    emit(event: ProjectEvent) { emitter.emit(event.projectId, event); },
    subscribe(projectId: ProjectId, listener: (e: ProjectEvent) => void) {
      emitter.on(projectId, listener);
      return () => emitter.off(projectId, listener);
    },
  };
}
export type ProjectEventBus = ReturnType<typeof createProjectEventBus>;
```

Wire-up: singleton en `src/main.ts`, inyectado por DI a los productores de eventos.

### B. Event Producers

Instrumentar los siguientes archivos con llamadas a `eventBus.emit(...)`:

- `src/channels/inbound-processor.ts` — tras persistir un mensaje entrante, emitir `message.inbound`.
- `src/channels/channel-router.ts` — tras enviar exitosamente (o donde se envíen outbound messages; confirmar con un grep `send\(OutboundMessage` o `adapter.send`), emitir `message.outbound`.
- `src/security/approval-gate.ts` — al crear pending approval, emitir `approval.created`. Al resolver, `approval.resolved`.
- `src/infrastructure/repositories/execution-trace-repository.ts` — en `create()`, emitir `trace.created`.
- `src/channels/handoff.ts` — en `escalate()` emitir `handoff.requested`, en `resume()` emitir `handoff.resumed`.
- `src/campaigns/campaign-executor.ts` (o equivalente) — cada N sends, emitir `campaign.progress`.

Todo el emit es **sync** + **fire-and-forget** desde el productor (EventEmitter es sync). Si un listener hace I/O, debe envolver en `queueMicrotask` o similar.

### C. WebSocket Endpoint

**Nuevo**: `src/api/routes/ws-project.ts`

```ts
import { FastifyInstance } from 'fastify';
// Usar @fastify/websocket que ya está en el proyecto
export function wsProjectRoutes(fastify: FastifyInstance, deps: { eventBus, apiKeyService }) {
  fastify.get('/ws/project/:projectId', { websocket: true }, async (socket, req) => {
    const { projectId } = req.params as { projectId: string };
    const apiKey = (req.query as any).apiKey ?? req.headers.authorization?.replace('Bearer ', '');
    const validation = await deps.apiKeyService.validate(apiKey);
    if (!validation.valid) { socket.close(1008, 'unauthorized'); return; }
    const apiKeyProjectId = validation.projectId; // null = master
    if (apiKeyProjectId !== null && apiKeyProjectId !== projectId) { socket.close(1008, 'forbidden'); return; }

    const unsubscribe = deps.eventBus.subscribe(projectId as ProjectId, (event) => {
      socket.send(JSON.stringify(event));
    });

    const heartbeat = setInterval(() => socket.ping(), 30_000);
    socket.on('close', () => { unsubscribe(); clearInterval(heartbeat); });
  });
}
```

**Modificar**: `src/api/index.ts` para registrar.

Notas:
- Backpressure simple: si `socket.bufferedAmount > 1MB` por más de 5s, cerrar con 1008.
- No aceptamos mensajes del cliente — es read-only stream.
- Logs: `component: 'ws-project'` con projectId + conectar/desconectar.

### D. SSE Fallback

**Modificar**: `src/api/routes/platform-bridge.ts` — agregar `GET /platform/events?projectId=X`:
- Auth por Bearer (middleware normal).
- Sin body; responde con `Content-Type: text/event-stream`.
- Misma suscripción al event bus, formatea cada evento como `data: ${JSON.stringify(event)}\n\n`.
- Heartbeat `: ping\n\n` cada 30s.
- Cierra el stream cuando cliente se desconecta o suscripción falla.

### E. projectId Access Middleware

**Nuevo**: `src/api/middleware/require-project-access.ts`

```ts
export async function requireProjectAccess(req, reply, projectId: string) {
  const apiKeyProjectId = req.apiKeyProjectId; // null = master
  if (apiKeyProjectId === null) return; // master pasa
  if (apiKeyProjectId !== projectId) { reply.code(403).send({ error: 'forbidden' }); throw new Error('forbidden'); }
}

export async function requireProjectAccessFromSession(req, reply, sessionId, prisma) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { projectId: true } });
  if (!session) { reply.code(404).send({ error: 'not_found' }); throw new Error('not_found'); }
  await requireProjectAccess(req, reply, session.projectId);
}

export async function requireProjectAccessFromApproval(req, reply, approvalId, prisma) { /* similar lookup via session */ }
export async function requireProjectAccessFromTrace(req, reply, traceId, prisma) { /* lookup via session */ }
```

Usar en cada ruta vulnerable como `preHandler` o inline antes del handler.

### F. Routes to Harden

Aplicar el middleware a los siguientes endpoints (del exploration report):

- [src/api/routes/sessions.ts](../src/api/routes/sessions.ts): `GET /sessions/:id`, `PATCH /sessions/:id/status`, `GET /sessions/:id/messages` → `requireProjectAccessFromSession(:id)`.
- [src/api/routes/traces.ts](../src/api/routes/traces.ts): `GET /sessions/:sessionId/traces`, `GET /traces/:id` → lookup por trace→session→project.
- [src/api/routes/approvals.ts](../src/api/routes/approvals.ts): `GET /approvals/:id`, `POST /approvals/:id/resolve`, `POST /approvals/:id/decide` → lookup por approval→session→project.
- [src/api/routes/cost.ts](../src/api/routes/cost.ts): `GET /cost/projects/:projectId`, `POST /cost/clients/:clientId/budget` → middleware directo o por clientId lookup.
- [src/api/routes/contacts.ts](../src/api/routes/contacts.ts): unificar a `/projects/:projectId/contacts/:contactId` (deprecar `/contacts/:contactId` con warning log por 2 semanas, redirect 301).
- [src/api/routes/platform-bridge.ts](../src/api/routes/platform-bridge.ts): `GET /agents/:agentId/detail`, `GET /conversations/:sessionId/messages`, `POST /conversations/:sessionId/escalate` → middleware.

**No romper rutas actuales**: si una request era válida con master key, sigue siéndolo. Si era válida con scoped key para el mismo proyecto, sigue siéndolo. Solo bloqueamos el cross-project que antes era un bug.

### G. Campaign Reply Tracker

**Nuevo**: `src/campaigns/reply-tracker.ts`

Listener del bus que, al recibir `message.inbound`:
1. Busca `CampaignSendStatus` donde `contactId + projectId` + status `sent` en últimas 72h.
2. Si existe, marca `replied` con timestamp + pushea `campaign.progress` con métricas actualizadas.

Gap detectado en exploration — hoy no se trackea replies.

Wire-up en `main.ts`.

---

## Tests

### Unit

- `src/api/events/event-bus.test.ts`:
  - Emit + subscribe filtrado por projectId (listener del proyecto A no recibe eventos del B).
  - Unsubscribe limpia listener.
  - 1000 listeners paralelos no tiran error de `maxListeners`.
- `src/api/middleware/require-project-access.test.ts`:
  - Master (apiKeyProjectId=null) pasa siempre.
  - Scoped match pasa.
  - Scoped mismatch → 403.
  - Session no encontrada → 404.

### Integration

- `src/api/routes/ws-project.test.ts`:
  - Conectar con API key master → recibe eventos de cualquier proyecto.
  - Conectar con scoped key del mismo proyecto → recibe.
  - Conectar con scoped key de proyecto distinto → 1008 close.
  - Heartbeat ping funciona.
  - Al emitir evento desde el bus, llega al socket.
- `src/campaigns/reply-tracker.test.ts`:
  - Setup: campaña con send `sent` al contacto X hace 1h.
  - Emit `message.inbound` de contacto X → status pasa a `replied`.
  - Send de hace 80h → NO se marca (out of window).
- Regression: todos los tests de las rutas modificadas siguen verdes (~30 tests).

### Manual E2E

```bash
# Instalar wscat si no está: npm i -g wscat
wscat -c "ws://localhost:3002/api/v1/ws/project/<PID>?apiKey=nx_..."
# En otra terminal, hacer POST al webhook chatwoot con un mensaje de prueba
# → wscat debe imprimir un JSON con kind: 'message.inbound'
```

---

## Verificación

- [ ] `pnpm build && pnpm typecheck && pnpm lint` verdes.
- [ ] `pnpm test` verde. 1724 tests previos + nuevos.
- [ ] WS funciona E2E con wscat.
- [ ] SSE fallback funciona con curl: `curl -N "http://localhost:3002/api/v1/platform/events?projectId=X" -H "Authorization: Bearer $KEY"`.
- [ ] Cross-project query con scoped key → 403.
- [ ] Mismo-project query con scoped key → 200.
- [ ] Master key → acceso total.
- [ ] No breaking: dashboard interno sigue funcionando (usa master key).

---

## Rules

- El event bus es **in-process**. Si en el futuro se escala a múltiples workers → Redis pub/sub. Documentar como TODO en `event-bus.ts`, no implementar ahora.
- **No rate-limit** al WS en este track (out of scope; agregar en track de hardening posterior).
- **No schema changes** en este track (event bus es in-memory, rutas solo leen).
- Soft-deprecation de rutas viejas: loggear warning con IP + API key ID por 2 semanas, luego remover.
- Events no llevan PII sensible más allá de lo estrictamente necesario (text de mensajes va OK; passwords o tokens NUNCA).

---

## Out of Scope

- Redis pub/sub para escalar event bus.
- Rate-limit por API key en el WS.
- Replay de eventos históricos (solo events en vivo).
- Signed WS tokens con TTL corto (hoy usamos API key directa).
- WS nativo desde Next.js (T3 usa SSE como proxy).

---

## Coordination with Other Tracks

- **T1** también toca `src/api/index.ts` — merge trivial (cada uno registra un router distinto).
- **T3** consume el WS de este track. Mientras T2 no mergea, T3 puede desarrollar contra polling (React Query `refetchInterval: 3000`).
- **T4** emite `campaign.progress` desde su dry-run / execute. Si T4 mergea antes de T2, el event bus aún no existe → usar el patrón try/catch optional con `if (eventBus) eventBus.emit(...)` para no romper.

## Runbook (post-merge)

```bash
git push origin main
# Wait for deploy
ssh hostinger-fomo "docker ps --format '{{.Names}}\t{{.Status}}' | grep fqoeno"
# Test WS handshake
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 sh -c \
  "wget -S --header=\"Upgrade: websocket\" --header=\"Connection: Upgrade\" \
   --header=\"Sec-WebSocket-Version: 13\" --header=\"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\" \
   \"http://127.0.0.1:3002/api/v1/ws/project/test?apiKey=$NEXUS_API_KEY\" 2>&1 | head -5"'
# Expect 101 Switching Protocols
```
