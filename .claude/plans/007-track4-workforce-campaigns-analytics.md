# Track 4 — Workforce Campaigns v2 + Traces Drill-down + Analytics

**Repos**: `c:\Users\Mariano\Documents\plataforma\marketpaper-demo` (frontend principal) + `c:\Users\Mariano\Documents\fomo-core` (backend endpoints nuevos)
**Branch**: `feat/t4-workforce-campaigns` en ambos repos
**Deliverable**: campañas editables con preview de dry-run, templates reusables con variable mapper, traces filtrables con drill-down, analytics comparativa por agente, importación CSV de contactos.

---

## Context

- La página actual de campaigns (`campaigns/client-page.tsx`) solo permite CREATE + EXECUTE. No hay EDIT, CLONE, DELETE, PAUSE UI.
- No hay preview antes de ejecutar — un error de template manda mensajes mal formados a toda la audiencia.
- No hay página de traces standalone — hoy solo se ven embedded en una conversación.
- La página de reports tiene gráficos generales pero no drill-down por agente ni comparativa.
- No hay importación de contactos por CSV.
- Este track toca **ambos repos** — es responsabilidad de un solo agente mergear ambos PRs en orden: fomo-core primero (endpoints), luego marketpaper-demo (UI).

---

## Files to Read First

### marketpaper-demo

1. [`app/(workspace)/workspace/workforce/campaigns/client-page.tsx`](../../app/(workspace)/workspace/workforce/campaigns/client-page.tsx) — estado actual de la página.
2. [`app/(workspace)/workspace/workforce/reports/client-page.tsx`](../../app/(workspace)/workspace/workforce/reports/client-page.tsx) — patrones Recharts existentes.
3. [`app/(workspace)/workspace/workforce/contacts/client-page.tsx`](../../app/(workspace)/workspace/workforce/contacts/client-page.tsx) — CRUD actual de contactos.
4. [`lib/fomo-api.ts`](../../lib/fomo-api.ts) — agregar métodos al final.

### fomo-core

1. [`src/api/routes/campaigns.ts`](../src/api/routes/campaigns.ts) — CRUD + execute + A/B testing ya existente.
2. [`src/api/routes/cost.ts`](../src/api/routes/cost.ts) — aggregaciones existentes.
3. [`src/api/routes/contacts.ts`](../src/api/routes/contacts.ts) — CRUD existente.
4. [`src/api/routes/traces.ts`](../src/api/routes/traces.ts) — listing existente.
5. [`prisma/schema.prisma`](../prisma/schema.prisma) — modelos `Campaign`, `CampaignSendStatus`, `CampaignReply`, `Contact`, `ExecutionTrace`, `UsageRecord`.
6. [`src/campaigns/`](../src/campaigns/) — servicios existentes (campaign-manager, executor, a-b-testing).

---

## Scope & Files to Touch

### A. Backend (fomo-core) — endpoints nuevos

**Modificar**: `src/api/routes/campaigns.ts`

Agregar:

- `POST /projects/:projectId/campaigns/:id/dry-run`
  - Toma primeros 10 contactos que matcheen `audienceFilter`.
  - Renderiza el template con los placeholders de cada contacto.
  - Estimación de costo total: `totalContacts * avgTokensPerMessage * modelCostPerToken` — usar stats existentes.
  - Response: `{ previews: [{ contactId, rendered, channel, estimatedTokens }], totalAudience, estimatedTotalCostUsd, coverage: { withPhone: N, withEmail: M } }`.
  - **NO envía mensajes**.

**Nuevo**: `src/api/routes/campaign-templates.ts`

- CRUD de `CampaignTemplate`:
  - `POST /projects/:projectId/campaign-templates` — `{ name, body, variables: string[], channel, description? }`.
  - `GET /projects/:projectId/campaign-templates`.
  - `GET /projects/:projectId/campaign-templates/:id`.
  - `PUT /projects/:projectId/campaign-templates/:id`.
  - `DELETE /projects/:projectId/campaign-templates/:id`.

**Nueva migration Prisma**: `add_campaign_templates`:

```prisma
model CampaignTemplate {
  id          String   @id @default(cuid())
  projectId   String   @map("project_id")
  name        String
  description String?
  body        String   @db.Text
  variables   String[] // placeholders extraídos del body, e.g. ['nombre', 'pedido']
  channel     String   // 'whatsapp' | 'telegram' | 'slack' | 'email'
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, name])
  @@index([projectId])
  @@map("campaign_templates")
}
```

Agregar `campaignTemplates CampaignTemplate[]` al modelo `Project`.

**Modificar**: `src/api/routes/contacts.ts`

Agregar:

- `POST /projects/:projectId/contacts/bulk-import`
  - Body: `{ contacts: ContactInput[] }` (max 5000 por batch).
  - Estrategia: upsert por `(projectId, phone)` o `(projectId, email)` — skipDuplicates.
  - Response: `{ created: N, updated: M, skipped: K, errors: [{ index, reason }] }`.
  - Zod schema estricto; inputs inválidos se acumulan en `errors`, no tiran 400 global.

**Nuevo**: `src/api/routes/performance.ts`

- `GET /agents/:agentId/performance?range=7d|30d|90d`
  - Auth: requireProjectAccessFromAgent (similar a T2 helpers).
  - Aggregación desde `Session`, `UsageRecord`, `ExecutionTrace`:
    - `avgResponseMs`: promedio de tiempo entre user message y assistant response en sessions activas.
    - `resolutionRate`: sessions cerradas sin escalation / total sessions.
    - `sessionsPerDay`: timeseries diaria.
    - `costPerSession`: total cost / N sessions.
    - `topTools`: top 10 tools usados con % y count.
    - `byChannel`: breakdown % por canal.
  - Response: todo arriba en un objeto anidado.

Registrar todas las rutas nuevas en `src/api/index.ts`.

### B. Frontend (marketpaper-demo) — Campaigns v2

**Modificar**: `app/(workspace)/workspace/workforce/campaigns/client-page.tsx`

Expandir la lista de campañas:

- Por cada campaña, agregar dropdown menu (shadcn `DropdownMenu`) con:
  - "Editar" → reabre el dialog en modo edit con datos precargados; submit llama `updateCampaign`.
  - "Duplicar" → abre dialog con todos los datos menos id + status=`draft`; submit llama `createCampaign`.
  - "Preview (Dry-run)" → navigate a `/campaigns/[id]/preview`.
  - "Pausar" / "Reanudar" → optimistic update + llama `pauseCampaign`/`resumeCampaign`.
  - "Eliminar" → AlertDialog confirmación → `deleteCampaign`.
- Badge de status actualiza en tiempo real via `useProjectEvents` (T3) o fallback polling.

**Nuevo**: `app/(workspace)/workspace/workforce/campaigns/[id]/preview/page.tsx` + `client-page.tsx`

- Llama `fomoApi.dryRunCampaign(id)` al mount.
- Muestra:
  - Summary card: total audiencia, costo estimado, cobertura (% con phone, % con email).
  - Grid de 10 previews: avatar del contacto, mensaje renderizado, canal, tokens estimados.
  - Botón "Confirmar y ejecutar" → dialog de confirmación ("¿Enviar a N contactos?") → `executeCampaign(id)` → toast → navigate a la campaña.
  - Botón "Editar" → volver al dialog de edición.
- Guard: si audiencia >100 y no hizo dry-run, el botón execute está disabled con tooltip.

**Nuevo**: `components/workforce/campaign-template-builder/`

- `template-builder.tsx`:
  - Editor de texto plain (textarea con monospace) con syntax highlight para `{{variable}}`.
  - Extrae variables on-the-fly con regex `/\{\{\s*(\w+)\s*\}\}/g`.
  - Preview en vivo: selector de Contact de ejemplo → render del template con los values de ese contacto.
  - Botón "Guardar como template" → llama `saveCampaignTemplate`.
  - Botón "Cargar template" → dropdown con `listCampaignTemplates`.
- `variable-mapper.tsx`:
  - Tabla de 2 columnas: variable (del template) → campo de Contact (dropdown con name, phone, email, role, tags, metadata keys).
  - Permite custom literals (default value si el contacto no tiene el campo).
- Integrar en el dialog de create/edit de campaigns.

### C. Frontend — Traces Drill-down

**Nuevo**: `app/(workspace)/workspace/workforce/traces/page.tsx` (+ `client-page.tsx`)

Página nueva con filtros y lista:

- Filtros (shadcn `Select`, `DatePicker`, `Input`):
  - Agente (dropdown con todos los del proyecto).
  - Session ID (input text).
  - Tool usado (dropdown — fetchear lista de tools del proyecto).
  - Status (success / error / all).
  - Rango de fechas (last 24h, 7d, 30d, custom).
- Lista paginada: timestamp, agente, tool, status badge, duration, cost, sessionId (link al inbox del session).
- Click en fila → drawer (shadcn `Sheet`):
  - Tool calls expandibles.
  - Input → agent response.
  - LLM usage (tokens, cost).
  - **NUNCA mostrar system prompt layers** (seguridad).
- Botón "Export CSV" — genera CSV del filtrado actual client-side.

Uses `fomoApi.listTraces(projectId, filters)`.

### D. Frontend — Analytics Drill-down

**Modificar**: `app/(workspace)/workspace/workforce/reports/client-page.tsx`

Agregar sección "Comparativa de agentes":

- Multi-select de agentes (1-4).
- Gráficos side-by-side (Recharts):
  - `sessionsPerDay` — line chart overlaid.
  - `costPerSession` — bar chart grouped.
  - `resolutionRate` — gauge charts individuales.
- Stacked bar chart "Mensajes por canal" (WhatsApp vs Telegram vs Chatwoot vs Slack).

**Nuevo**: `app/(workspace)/workspace/workforce/reports/agents/[agentId]/page.tsx` (+ client-page)

Detalle por agente:

- Header: nombre, status, canal principal, tools habilitadas.
- Cards KPI: sessions, avg response time, resolution rate, cost.
- Gráficos:
  - Sessions per day (7/30/90d).
  - Top 10 tools (bar horizontal).
  - Cost breakdown por tipo (LLM vs tools).
- Link "Ver traces de este agente" → `/workforce/traces?agent=<id>`.

### E. Frontend — Contact Import

**Nuevo**: `app/(workspace)/workspace/workforce/contacts/import/page.tsx` (+ client-page)

Wizard CSV:

1. **Upload**: drop zone (react-dropzone o similar; shadcn no tiene — confirmar lib o usar input[type=file] con drag-drop).
2. **Mapping**: detect headers → muestra tabla `CSV column → Contact field` (dropdown). Previene enviar si `phone` no está mapeado.
3. **Preview**: primeras 20 rows con el mapping aplicado. Valida que phone tiene formato E.164. Errores inline.
4. **Confirm**: `POST /projects/:projectId/contacts/bulk-import` con batches de 500. Progress bar.
5. **Summary**: `{ created, updated, skipped, errors }` con link a lista de contactos.

Usa `fomoApi.bulkImportContacts(projectId, contactsArray)`.

### F. fomo-api.ts Extensions

**Modificar**: `lib/fomo-api.ts` append al final:

```ts
async updateCampaign(id: string, patch: Partial<Campaign>): Promise<Campaign> {}
async deleteCampaign(id: string): Promise<void> {}
async pauseCampaign(id: string): Promise<void> {}
async resumeCampaign(id: string): Promise<void> {}
async dryRunCampaign(id: string): Promise<DryRunResult> {}
async listCampaignTemplates(projectId: string): Promise<CampaignTemplate[]> {}
async getCampaignTemplate(projectId: string, id: string): Promise<CampaignTemplate> {}
async saveCampaignTemplate(projectId: string, data: CampaignTemplateInput): Promise<CampaignTemplate> {}
async updateCampaignTemplate(projectId: string, id: string, patch: Partial<CampaignTemplateInput>): Promise<CampaignTemplate> {}
async deleteCampaignTemplate(projectId: string, id: string): Promise<void> {}
async listTraces(projectId: string, filters: TraceFilters): Promise<{ items: Trace[], total: number, page: number }> {}
async getAgentPerformance(agentId: string, range: '7d'|'30d'|'90d'): Promise<AgentPerformance> {}
async bulkImportContacts(projectId: string, contacts: ContactInput[]): Promise<BulkImportResult> {}
```

Nuevos tipos en el mismo archivo: `DryRunResult`, `CampaignTemplate`, `CampaignTemplateInput`, `TraceFilters`, `AgentPerformance`, `BulkImportResult`.

---

## Tests

### Backend (fomo-core)

- `src/api/routes/campaigns.test.ts` — extender con dry-run:
  - Dry run con 5 contactos matcheando → 5 previews, cost estimado > 0.
  - Dry run con audience vacía → previews=[], totalAudience=0.
  - Dry run con template malformado → 400.
- `src/api/routes/campaign-templates.test.ts` — CRUD completo + unique constraint.
- `src/api/routes/contacts.test.ts` — extender con bulk-import:
  - 100 contactos válidos → created=100.
  - Mix de duplicados y nuevos → upsert correcto.
  - >5000 → 400 con mensaje claro.
  - Formato inválido en algunos → errors array, no fallo global.
- `src/api/routes/performance.test.ts` — agent performance con fixtures.
- Migration: `pnpm db:migrate` en test DB → rollback limpio.

### Frontend (marketpaper-demo)

- Component tests para:
  - `campaigns/client-page.test.tsx`: dropdown actions (edit, duplicate, delete, pause).
  - `campaigns/[id]/preview/client-page.test.tsx`: dry-run render + execute.
  - `components/workforce/campaign-template-builder/template-builder.test.tsx`: variable extraction, preview.
  - `traces/client-page.test.tsx`: filtros + drill-down drawer.
  - `contacts/import/client-page.test.tsx`: wizard E2E con CSV mockeado.

### Manual E2E

1. Crear campaña con template `"Hola {{nombre}}, gracias por tu pedido {{pedido}}"`.
2. Guardar como template reusable.
3. Preview: ver 10 contactos con mensaje renderizado.
4. Ejecutar. Ver progreso live (via T2 events si disponible).
5. Editar campaña en curso, duplicar una completed.
6. Ir a Traces → filtrar por agente Fomo WhatsApp → ver trace → export CSV.
7. Reports → comparar Fomo WhatsApp vs otro agente.
8. Contacts → importar CSV de 50 contactos → summary correcto.

---

## Verificación

- [ ] Migration corre limpia: `pnpm db:migrate` local + rollback.
- [ ] `pnpm test` en fomo-core verde.
- [ ] `pnpm typecheck && pnpm lint` en ambos repos.
- [ ] Build: `pnpm build` en fomo-core verde; pre-push checklist (`timeout 10 node dist/main.js`) sin crashes.
- [ ] E2E manual: los 8 checks de arriba pasan.
- [ ] Performance: lista de traces con 10k rows pagina sin freezar UI.
- [ ] CSV import de 1000 contactos <5s.

---

## Rules

- **Dry-run obligatorio** en UI antes de execute cuando audience >100. Warning visible en <100.
- **Bulk import**: hard cap 5000 por request. UI divide CSVs grandes en batches de 500 client-side.
- **Traces**: nunca exponer system prompt layers. Filtrar en el backend o en el serializer.
- **CSVs**: validar encoding (UTF-8) y BOM. Phone format E.164.
- **Templates**: variables siempre lowercase snake_case en UI (`{{nombre_cliente}}`, no `{{nombreCliente}}`).
- **Recharts**: reusar paleta existente de reports actual.
- **Todo en español rioplatense**.

---

## Out of Scope

- Webhooks outbound desde fomo-core cuando una campaña completa (puede ser T5).
- A/B testing UI profunda (ya existe el API; hoy solo lo mostramos en campaign detail).
- Scheduled campaigns con recurrencia cron (hoy solo one-shot o delayed).
- Rate-limit per-campaign de sends.
- Multi-channel campaigns (un mismo campaign manda por WhatsApp + email según disponibilidad del contact).

---

## Coordination with Other Tracks

- **T2**: este track emite `campaign.progress` desde el executor. Si T2 no está mergeado, envolver emit en `try { eventBus?.emit(...) } catch {}` para no romper.
- **T3**: ambos tocan `lib/fomo-api.ts`. Append-only al final → conflict trivial.
- **T1**: sin overlap.
- Merge order recomendado de este track: primero PR en fomo-core (endpoints nuevos + migration), deploy, luego PR en marketpaper-demo.
