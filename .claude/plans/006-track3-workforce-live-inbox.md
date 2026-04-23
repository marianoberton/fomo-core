# Track 3 — Workforce Live Inbox + Handoff UX + Channel Config Wizard

**Repo**: `c:\Users\Mariano\Documents\plataforma\marketpaper-demo`
**Branch**: `feat/t3-workforce-live`
**Deliverable**: el cliente ve mensajes en vivo (<2s de latencia), toma control de conversaciones con audit trail, configura canales (WhatsApp, Telegram, Slack, Chatwoot) desde wizard UI sin pegar curls.

---

## Context

- El módulo workforce de marketpaper-demo ya tiene 10/12 páginas conectadas a fomo-core via el proxy `/api/workspace/workforce` ([route.ts](../app/api/workspace/workforce/route.ts)) con `FOMO_API_KEY` server-side.
- El inbox (`conversations/client-page.tsx`, 697 líneas) ya renderiza mensajes, contacto, traces, approvals — pero **solo por polling**. Refrescar manualmente mata UX de handoff.
- La página `channels/client-page.tsx` dice "coming soon" — hay que desbloquearla. fomo-core ya expone `POST /projects/:projectId/integrations` con discriminated union por provider.
- Este track **depende** del WebSocket/SSE de T2. Puede desarrollarse contra polling primero (React Query `refetchInterval: 3000`) y cambiarse a events cuando T2 merge.
- Operator message ya existe en `lib/fomo-api.ts` (`sendOperatorMessage`) — reutilizar.

---

## Files to Read First

1. [`lib/fomo-api.ts`](../../lib/fomo-api.ts) — 974 líneas, cliente completo. Agregar métodos al final.
2. [`app/api/workspace/workforce/route.ts`](../../app/api/workspace/workforce/route.ts) — patrón del proxy + auth Supabase + validación de project ownership.
3. [`app/(workspace)/workspace/workforce/conversations/client-page.tsx`](../../app/(workspace)/workspace/workforce/conversations/client-page.tsx) — inbox actual (a extender).
4. [`app/(workspace)/workspace/workforce/channels/client-page.tsx`](../../app/(workspace)/workspace/workforce/channels/client-page.tsx) — placeholder actual (a reemplazar).
5. [`lib/hooks/use-workforce-project.ts`](../../lib/hooks/use-workforce-project.ts) — hook de projectId resolution.
6. fomo-core `src/api/routes/integrations.ts` — los endpoints que vamos a consumir para wizard.
7. fomo-core `src/api/events/event-bus.ts` (post-T2) — tipo `ProjectEvent` a replicar en este repo.

---

## Scope & Files to Touch

### A. Live Events Client

**Nuevo**: `lib/fomo-live-events.ts`

```ts
export type ProjectEvent = /* copiar del tipo de T2 */;

export function subscribeToProject(
  projectId: string,
  onEvent: (e: ProjectEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  // 1. Intentar WebSocket via proxy /api/workspace/workforce/ws-proxy
  //    (el proxy server-side conecta a fomo-core WS con FOMO_API_KEY)
  // 2. Si falla 3 veces con backoff exponencial → fallback a SSE via /api/workspace/workforce/sse-proxy
  // 3. Return unsubscribe function
}
```

Detalles:
- Reconexión exponencial: 1s, 2s, 4s, 8s, max 30s.
- Tras 3 fallos consecutivos, cambia a SSE automáticamente.
- Heartbeat: recibir ping/ok cada <60s; sino reconectar.

**Nuevo**: `lib/types/fomo-events.ts` — el tipo `ProjectEvent` copiado de fomo-core. Mantener sincronizado manualmente por ahora.

**Nuevo**: `lib/hooks/use-project-events.ts`

```ts
export function useProjectEvents(
  projectId: string | undefined,
  handlers: {
    onMessage?: (e: ProjectEvent) => void,
    onApproval?: (e: ProjectEvent) => void,
    onHandoff?: (e: ProjectEvent) => void,
    onCampaign?: (e: ProjectEvent) => void,
  },
) {
  useEffect(() => {
    if (!projectId) return;
    return subscribeToProject(projectId, (e) => {
      if (e.kind.startsWith('message.')) handlers.onMessage?.(e);
      if (e.kind.startsWith('approval.')) handlers.onApproval?.(e);
      if (e.kind.startsWith('handoff.')) handlers.onHandoff?.(e);
      if (e.kind.startsWith('campaign.')) handlers.onCampaign?.(e);
    });
  }, [projectId]); // handlers intencionalmente fuera de deps — que sean stable via useCallback
}
```

### B. SSE Proxy (Next.js server-side)

**Nuevo**: `app/api/workspace/workforce/sse-proxy/route.ts`

Next.js App Router no soporta WebSocket server nativamente. Solución: SSE.

```ts
export async function GET(req: Request) {
  // 1. Validar user Supabase + company_id
  // 2. Resolver projectId de query y verificar core_project_links
  // 3. Hacer fetch con stream: fetch(`${FOMO_API_URL}/api/v1/platform/events?projectId=${projectId}`, { headers: { Authorization: `Bearer ${FOMO_API_KEY}` } })
  // 4. Passthrough del ReadableStream como SSE al cliente
  // Return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' }})
}
```

`FOMO_API_KEY` nunca sale al cliente.

### C. Conversations Page — Live + Handoff

**Modificar**: `app/(workspace)/workspace/workforce/conversations/client-page.tsx`

1. Agregar `useProjectEvents(projectId, { onMessage, onApproval, onHandoff })`:
   - `onMessage`: invalidar React Query `['inbox', projectId]` y `['conversation', sessionId]` — el inbox y el detalle se refrescan solos.
   - `onApproval`: toast `"Aprobación pendiente: ${tool}"` + invalidar `['approvals', projectId]`.
   - `onHandoff`: si es `handoff.requested` del session actual → badge cambia a "Escalado"; si es `handoff.resumed` → "Bot activo".
2. Indicador "Agent typing...":
   - Cuando llega `message.outbound` con sessionId actual → mostrar spinner animado en el chat por 10s o hasta próximo mensaje.
3. Auto-scroll-to-bottom: si el usuario está a <100px del final, hacer scroll al recibir mensaje nuevo. Sino, mostrar toast clickeable "Nuevo mensaje ↓".
4. Handoff block (nueva sección en el sidebar o toolbar):
   - Badge: `"Bot activo"` (default) | `"Humano en control"` (si el último `handoff.requested` no tiene `handoff.resumed` posterior) | `"Escalado (esperando)"`.
   - Botón "Tomar control": pide nombre de operador (modal corto), llama `takeoverConversation(sessionId, operatorName)`.
   - Botón "Devolver al bot": llama `releaseConversation(sessionId)`.
   - Historial: expandable que lista los handoff events del session (componente nuevo abajo).

**Nuevo**: `components/workforce/handoff-audit-log.tsx`

- Props: `sessionId`.
- Llama `listHandoffEvents(sessionId)` → lista ordenada cronológicamente.
- Cada entry: timestamp, quién tomó, por qué, duración.

### D. Channel Config Wizard

**Modificar**: `app/(workspace)/workspace/workforce/channels/client-page.tsx`

Reemplazar el placeholder por lista + botón "Agregar canal":

- Lista: usa `fomoApi.getIntegrations()` (ya existe).
- Card por integración: provider icon, estado (active/paused/error), última actividad, botón health check, botón ver detalle, botón borrar.
- Botón "Agregar canal" → abre dialog con wizard.

**Nuevo**: `components/workforce/channel-wizard/index.tsx`

Wizard de 3 pasos:
1. **Elegir proveedor**: grid con cards: WhatsApp Meta, WhatsApp WAHA, Telegram, Slack, **Chatwoot**. Cada card con logo + breve descripción.
2. **Credenciales**: componente específico por proveedor (ver abajo). Validación inline.
3. **Confirmar**: preview de config, botón "Crear" → llama `POST /projects/:projectId/integrations` (fomo-core ya lo expone).

Post-creación: muestra URL del webhook para pegar en el proveedor externo (ej. Telegram `setWebhook`, Chatwoot webhook settings, WhatsApp Cloud API webhook URL).

Health check button: llama `GET /integrations/:id/health`.

**Nuevos**: componentes por proveedor:
- `components/workforce/channel-wizard/whatsapp-meta-step.tsx`: phoneNumberId, accessToken (hides after save), businessAccountId, appSecret.
- `components/workforce/channel-wizard/whatsapp-waha-step.tsx`: apiUrl, sessionName. Tras crear, botón "Obtener QR" → render del QR desde `GET /integrations/:id/waha/qr`, polling de `/waha/status` hasta `scanned`.
- `components/workforce/channel-wizard/chatwoot-step.tsx`: baseUrl, accountId, inboxId, agentBotId, apiToken (hidden after save), webhookSecret.
- `components/workforce/channel-wizard/telegram-step.tsx`: botToken (hidden).
- `components/workforce/channel-wizard/slack-step.tsx`: botToken, signingSecret.

Usar shadcn/ui: `Dialog`, `Tabs` (para el step indicator), `Input`, `Button`, `Card`, `Badge`.

### E. fomo-api.ts Extensions

**Modificar**: `lib/fomo-api.ts` — agregar al final:

```ts
async takeoverConversation(sessionId: string, operator: { id: string, name: string, reason?: string }) { /* POST /platform/conversations/:sessionId/takeover */ }
async releaseConversation(sessionId: string) { /* POST /platform/conversations/:sessionId/release */ }
async listHandoffEvents(sessionId: string) { /* GET /platform/conversations/:sessionId/handoffs */ }
async getIntegrationHealth(projectId: string, integrationId: string) { /* GET /projects/:projectId/integrations/:id/health */ }
async getWahaQR(projectId: string, integrationId: string) { /* GET .../waha/qr */ }
async getWahaStatus(projectId: string, integrationId: string) { /* GET .../waha/status */ }
```

Nota sobre takeover/release: fomo-core hoy tiene `POST /platform/conversations/:sessionId/escalate`. Necesitamos agregar 2 endpoints nuevos en fomo-core (`takeover`, `release`) — **esto debe coordinarse con T2** (T2 agrega los endpoints en backend cuando hace hardening). Documentar en T2 como dependencia inversa.

Si T2 aún no existe: usar el endpoint `escalate` con un flag nuevo en body `{ takeBy: { id, name, reason } }` y que el backend lo tratee como handoff + registre quién lo tomó. El endpoint `release` sí es nuevo — en ese caso, stub con throw temporal + TODO.

---

## Tests

### Unit

- `lib/fomo-live-events.test.ts`: reconexión exponencial, fallback a SSE tras 3 fallos, unsubscribe limpia timers.
- `lib/hooks/use-project-events.test.tsx`: handlers se llaman con eventos del tipo correcto.

### Component

- `app/(workspace)/workspace/workforce/conversations/client-page.test.tsx`:
  - Emit `message.inbound` mockeado → React Query invalidate → UI actualiza.
  - Handoff badge cambia tras `handoff.requested`/`handoff.resumed`.
- `components/workforce/channel-wizard/index.test.tsx`:
  - Flujo completo WhatsApp Meta: selección → form → crear → webhook URL visible.
  - Flujo Chatwoot: ídem.
  - Validación: baseUrl inválida → error inline.

### Manual E2E

1. Login → `/workspace/workforce/conversations`.
2. Enviar WhatsApp desde Chatwoot (post-T1) → mensaje aparece en <2s.
3. Click "Tomar control" → ingresar nombre → badge cambia.
4. Escribir mensaje como operador → llega al cliente por WhatsApp.
5. Click "Devolver al bot" → próximo mensaje del cliente lo responde el agente.
6. `/workspace/workforce/channels` → agregar Telegram → pegar bot token → health OK → webhook URL copiable.

---

## Verificación

- [ ] `pnpm lint && pnpm typecheck` verdes (en marketpaper-demo, revisar comandos exactos).
- [ ] `pnpm dev` y login funciona sin errores de consola.
- [ ] Mensaje live <2s.
- [ ] Handoff flow completo E2E.
- [ ] Wizard crea integración y la integración realmente funciona (el provider externo recibe webhook).
- [ ] Zero copy de `FOMO_API_KEY` al cliente (verificar DevTools Network: ninguna request del browser lleva el key).

---

## Rules

- **SSE fallback OBLIGATORIO**. Networks corporativas bloquean WS.
- **`FOMO_API_KEY` nunca sale del server Next**. Todo proxy.
- **Español rioplatense** en todos los toasts, labels, tooltips: "Mensaje nuevo", "Aprobación pendiente", "Humano en control", etc.
- **React Query**: invalidación, no refetch manual. `invalidateQueries` es la herramienta.
- **shadcn/ui components first**. Si falta, pedir autorización antes de agregar otra lib.
- **Zero stale UI**: si user estuvo 5min sin foco, al volver hacer refetch fresco (`refetchOnWindowFocus: true`).
- Loading states + empty states + error states en toda página nueva.

---

## Out of Scope

- Handoff rules engine (auto-escalar por sentimiento/keywords) — futura iteración.
- Operator assignment queue (round-robin entre operators) — out of scope.
- Mobile-optimized layout del inbox (focus en desktop primero).
- Push notifications del browser (future: web push API).
- Chatwoot setup avanzado (templates, labels) — solo lo básico en wizard.

---

## Coordination with Other Tracks

- **T1**: cuando T1 esté mergeado en prod, el agente "Fomo WhatsApp" responde a Chatwoot. Este track entonces tiene data real para el inbox live.
- **T2**: consume el WS/SSE endpoint. Si T2 no merge todavía, desarrollar contra polling:
  - React Query `refetchInterval: 3000` en `['inbox', projectId]` y `['conversation', sessionId]`.
  - En `use-project-events.ts` poner un flag `useWebSocket = false` y que el hook sea no-op.
  - Cuando T2 merge, flip del flag.
- **T2** también debe agregar endpoints `takeover` y `release` al platform-bridge. Coordinar antes de PR.
- **T4**: no hay conflictos directos. Ambos tocan `lib/fomo-api.ts` pero append-only al final → merge trivial.
