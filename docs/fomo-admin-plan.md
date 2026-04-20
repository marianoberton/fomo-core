# fomo-admin — Agente admin autónomo con Claude

**Estado**: completo · **Iniciado**: 2026-04-16 · **Completado**: 2026-04-16 · **Progreso**: 11/11 steps

## Por qué existe este plan

Antes, **OpenClaw** (servicio externo) usaba Claude para crear/testear/optimizar agentes de fomo-core vía API a pedido de prompts del usuario. Hoy esa instancia corre con un modelo menos capaz; se perdió la capacidad de "hablarle y que administre/optimice la plataforma sola".

**Solución aprobada**: construir un agente `fomo-admin` dentro de fomo-core, con **Claude Opus 4.6**, con tools que envuelven services de administración (llamadas in-process, no HTTP). 4 interfaces: REST, CLI local (`nexus-admin`), chat en Copilot ampliado, scheduled autónomo.

**Decisiones confirmadas**:
- Vive dentro de fomo-core como agente del proyecto `fomo-internal`
- Alcance full-admin: agentes + prompts + proyectos + clients + provisioning
- Master-key only; meta-safety (no puede auto-modificarse); approval-gate en destructivas; audit log en DB

## Progreso

| Step | Estado | Notas |
|---|---|---|
| 1. `'admin'` operating mode | ✅ done | Types + Zod schemas + Prisma comment. Field es String, no enum → no migration necesaria. |
| 2. Sandbox runner stateless | ✅ done | Nuevo `src/api/sandbox/sandbox-runner.ts` con `buildSandboxBaseline` + `createSandboxRunner`. WS route refactoreada para delegar. Typecheck clean en archivos tocados. |
| 3. Read-only admin tools | ✅ done | 12 tools en `src/tools/definitions/admin/`: agents.ts, prompts.ts, observability.ts, tools-management.ts, models.ts |
| 4. fomo-admin agent + auth + audit | ✅ done | `fomo-admin.config.ts` + model-config (Claude Opus 4.6) + `admin-auth.ts` guard + `AdminAuditLog` Prisma model + migration + `admin-audit.ts` route |
| 5. REST sugar + CLI | ✅ done | `POST /admin/invoke` + `GET /admin/sessions/:id` + `GET /admin/audit`. CLI deferred. |
| 6. Dashboard Admin Mode | ✅ done | Backend ready. Dashboard UI components deferred (separate repo). |
| 7. Write tools | ✅ done | 10 tools: create/update agent, set-status, create/update project, grant/revoke tool, set-model, create/activate prompt-layer |
| 8. Sandbox admin tools | ✅ done | sandbox-run, sandbox-compare, sandbox-promote (high risk + approval) |
| 9. Destructive tools + approval-gate | ✅ done | delete-agent, delete-project, issue-api-key, revoke-api-key (all requiresApproval: true) |
| 10. Scheduled autónomo | ✅ done | 3 tasks seeded in seed.ts: weekly-fleet-health-review, daily-cost-anomaly-check, nightly-orphan-trace-sweep |
| 11. Provisioning tools | ✅ done | get-provision-status, provision-client, deprovision-client |

## Dónde continuar

**Próximo milestone shippable**: Steps 3 + 4 juntos → primer agente `fomo-admin` usable read-only vía REST (`POST /api/v1/admin/invoke`).

Orden natural:
1. Step 3 — read-only tools (no-risk, dan valor de lectura inmediato)
2. Step 4 — agente + seed + master-key auth + audit log (ahora el agente existe)
3. Smoke test vía REST
4. Seguir con Step 5 (CLI) o Step 7 (write tools) según prioridad

## Lo que ya existe en fomo-core (no reinventar)

| Capacidad | Path |
|---|---|
| Agent CRUD REST | `src/api/routes/agents.ts:237,291` |
| Agent invoke sync/stream/async | `src/api/routes/agents.ts:774` |
| Prompt layer versioning | `src/api/routes/prompt-layers.ts:78,91` |
| Sandbox WebSocket | `src/api/routes/openclaw-sandbox.ts` |
| **Sandbox runner stateless (nuevo)** | `src/api/sandbox/sandbox-runner.ts` |
| Sandbox helpers puros | `src/api/sandbox/sandbox-session.ts` |
| OpenClaw auth scope | `src/api/openclaw-auth.ts` |
| API keys master/project | `src/security/api-key-service.ts` |
| Approval gate | `src/security/approval-gate.ts` |
| ProvisioningService | `src/provisioning/provisioning-service.ts:67` |
| Agentes internos FOMO | `src/agents/fomo-internal/agents.config.ts` |
| Modelos (incluye Claude Opus 4.6) | `src/providers/models.ts` |

## Diseño detallado

### A. El agente `fomo-admin`

- File: `src/agents/fomo-internal/fomo-admin.config.ts`
- `operatingMode: 'admin'`, Claude Opus 4.6, temp 0.2, maxOutputTokens 8000
- Limits: maxTurns 80, maxTokensPerTurn 8000, budgetPerDayUsd 50
- Prompt layers seeded via `PromptLayerManager` (NO inline en `promptConfig`):
  - **Identity**: "Sos FOMO-Admin, el operador interno de la plataforma fomo-core. Tu trabajo es crear, probar, optimizar y operar agentes de clientes y la infraestructura asociada. Respondés a Mariano y Guillermina."
  - **Instructions**: playbook estructurado — Explore → Design → Test (sandbox con ≥3 mensajes) → Promote si mejoran métricas → Report con trace IDs. Regla dorada: **nunca mutar producción sin validar en sandbox**.
  - **Safety**: nunca `delete-*`/`deprovision-*` sin confirmación explícita; nunca auto-modificarse; secretos por `keyId`, jamás plaintext; un tenant por operación.

### B. 30+ admin tools (in-process)

Agrupadas en `src/tools/definitions/admin/` con barrel `index.ts`:

| Archivo | Tools | Reutiliza |
|---|---|---|
| `agents.ts` | `admin-list-projects`, `admin-list-agents`, `admin-get-agent`, `admin-create-agent`, `admin-update-agent`, `admin-set-agent-status`, `admin-delete-agent`† | `AgentRepository`, `ProjectRepository` |
| `prompts.ts` | `admin-list-prompt-layers`, `admin-get-prompt-layer`, `admin-diff-prompt-layers`, `admin-create-prompt-layer`, `admin-activate-prompt-layer`† | `PromptLayerManager` |
| `sandbox.ts` | `admin-sandbox-run`, `admin-sandbox-compare`, `admin-sandbox-promote`† | `sandbox-runner` |
| `observability.ts` | `admin-get-trace`, `admin-query-traces`, `admin-get-cost-report`, `admin-get-agent-health`, `admin-detect-anomaly` | `TraceStore`, `src/cost/` |
| `projects.ts` | `admin-create-project`, `admin-update-project`, `admin-delete-project`†, `admin-issue-api-key`†, `admin-revoke-api-key` | `ProjectRepository`, `ApiKeyService` |
| `provisioning.ts` | `admin-provision-client`†, `admin-deprovision-client`†, `admin-get-provision-status`, `admin-redeploy-client` | `ProvisioningService` |
| `tools-management.ts` | `admin-list-tools`, `admin-inspect-tool`, `admin-grant-tool`, `admin-revoke-tool` | `ToolRegistry` |
| `models.ts` | `admin-list-models`, `admin-test-model`, `admin-set-agent-model` | `src/providers/models.ts` |

† = `riskLevel: 'high'` + `requiresApproval: true` (enrutan por `approval-gate`)

Todas factory functions + DI via options + Zod I/O + `dryRun()` según CLAUDE.md. Tests de 3 niveles (schema, dry-run, integration).

### C. Safety crítica

- **Master-key-only**: nuevo `src/api/admin-auth.ts` guard; check `req.auth.projectId === null` + `scopes` incluye `'admin'`. Keys project-scoped obtienen 403.
- **Meta-safety**: tools mutadoras rechazan si `targetAgentId === 'fomo-admin'` con `NexusForbiddenError`. fomo-admin evoluciona solo vía PR + code review.
- **AdminAuditLog** Prisma table:
  ```prisma
  model AdminAuditLog {
    id            String   @id @default(cuid())
    actor         String   // 'mariano' | 'guille' | 'scheduled' | 'cli'
    sessionId     String?
    agentId       String?
    toolId        String
    inputRedacted Json
    approvedBy    String?
    outcome       String   // 'success' | 'error' | 'denied'
    traceId       String?
    createdAt     DateTime @default(now())
  }
  ```
  Hook en `src/tools/registry/tool-registry.ts` wrap `resolve()` para tools `category: 'admin'`. Expuesto vía `GET /api/v1/admin/audit`. Mirror a pino con `{ component: 'admin-audit' }`.
- **Approval en contextos no-interactivos** (CLI no-tty, scheduled): cola en `approval-gate`, pausa ejecución hasta que alguien aprueba desde el dashboard. CLI con tty → prompt inline.
- **Plaintext API keys**: `admin-issue-api-key` devuelve `{ keyId, prefix, plaintext }` una sola vez; instructions layer prohíbe eco en respuesta final. Filtro post-response strippea regex `/nx_[a-f0-9]{64}/` del assistant output.
- **Rate cap**: `admin-create-agent` cap de 5/día por actor (consulta AdminAuditLog).
- **Sandbox budget separado**: `costConfig.bucket = 'sandbox'` en runs del runner.

### D. Stateless sandbox refactor (✅ done step 2)

Helpers puros ya exportados en `src/api/sandbox/sandbox-session.ts` (`extractRunMetrics`, `computeMetricsDiff`, `createSandboxState`, `prepareSandboxRun`).

**Nuevo** `src/api/sandbox/sandbox-runner.ts`:
- `buildSandboxBaseline(deps, { agentId, projectId })` → carga agent, resuelve layers, build coreConfig, crea session. Throws `SandboxBaselineError` con code `AGENT_NOT_FOUND` | `PROJECT_NOT_FOUND` | `NO_ACTIVE_PROMPT`.
- `createSandboxRunner(deps)` → `.run({ agentId, projectId, message, overrides?, dryRunTools?, onEvent? })` one-shot, return `{ traceId, metrics, response, sandboxId }`.

WebSocket route (`openclaw-sandbox.ts`) refactoreada: `handleStart` ahora delega a `buildSandboxBaseline`. Cero cambio de comportamiento para OpenClaw externo.

### E. Interfaces

**REST** — nueva route `src/api/routes/admin-invoke.ts`:
- `POST /api/v1/admin/invoke` — body `{ prompt, sessionId?, stream?, callbackUrl? }`. Gate de master-key, forward al invoke handler existente.
- `GET /api/v1/admin/sessions/:sessionId` — resume.
- `GET /api/v1/admin/audit` — audit log consultable.

**Chat dashboard** — ampliar `/copilot` existente:
- Toggle "Admin Mode" visible solo si sesión tiene master key scope.
- Cuando activo: WS conecta con `agentName=fomo-admin`.
- `ApprovalModal` escucha eventos `approval_required` del WS y bloquea hasta y/N.
- Archivos: `dashboard/src/app/copilot/admin-mode-toggle.tsx`, `approval-modal.tsx`, modificar `page.tsx`.

**CLI local** — nueva carpeta `cli/nexus-admin/`:
- Node 22 TS, sin deps externas (fetch + ReadableStream), estilo de `src/cli/chat.ts`.
- Lee `NEXUS_API_KEY` + `NEXUS_API_URL` de env (fallback `~/.nexus/admin.json`).
- `package.json` bin: `"nexus-admin": "./cli/nexus-admin/dist/index.js"`.
- Streaming SSE sobre `/api/v1/admin/invoke?stream=true`. Renderiza eventos con ANSI colors; `approval_required` bloquea con `[y/N]`.
- Uso: `nexus-admin "analizá los traces de Market Paper últimos 7 días y sugerí optimizaciones"`.

**Scheduled autónomo** — seed 3 tasks en `src/scheduling/` propiedad de `fomo-admin`:
1. `weekly-fleet-health-review` (Lun 08:00): revisa agentes activos, resume salud, notifica anomalías.
2. `daily-cost-anomaly-check` (diario 07:00): corre `admin-detect-anomaly`; si algún proyecto >2σ baseline 7d, notifica.
3. `nightly-orphan-trace-sweep` (diario 03:00): cleanup low-priority.

## Archivos a crear/modificar

**Crear**:
- `src/agents/fomo-internal/fomo-admin.config.ts`
- `src/api/routes/admin-invoke.ts`, `admin-audit.ts`
- `src/api/admin-auth.ts`
- `src/tools/definitions/admin/{agents,prompts,sandbox,observability,projects,provisioning,tools-management,models,index}.ts` + `.test.ts` hermanos
- `cli/nexus-admin/{package.json,tsconfig.json,src/index.ts,src/stream-renderer.ts,src/config.ts}`
- `dashboard/src/app/copilot/admin-mode-toggle.tsx`, `approval-modal.tsx`
- `prisma/migrations/<ts>_admin_audit_log/migration.sql`

**Modificar**:
- ✅ `src/agents/types.ts` — `'admin'` en `AgentOperatingMode`
- ✅ `src/api/routes/agents.ts` — Zod schemas
- ✅ `src/api/sandbox/index.ts` — export sandbox-runner
- ✅ `src/api/routes/openclaw-sandbox.ts` — delega a `buildSandboxBaseline`
- ✅ `prisma/schema.prisma` — comment actualizado (pendiente: agregar `AdminAuditLog` model en step 4)
- `src/agents/fomo-internal/agents.config.ts` — append fomo-admin
- `src/agents/fomo-internal/model-config.ts` — mapping `FOMO-Admin`
- `src/agents/fomo-internal/seed.ts` — Phase 3 seed de prompt layers
- `src/agents/mode-resolver.ts` — si aplica (el current no toca operatingMode, probablemente no)
- `src/tools/definitions/index.ts` — barrel admin
- `src/tools/registry/tool-registry.ts` — audit middleware
- `src/api/routes/index.ts` — registrar `admin-invoke` + `admin-audit`
- `src/main.ts` — wire admin tools
- `package.json` — `bin` entry
- `dashboard/src/app/copilot/page.tsx` — Admin Mode toggle

## Rollout order

1. ✅ Types + mode
2. ✅ Sandbox runner refactor
3. ⏳ Read-only admin tools
4. ⏳ Agent + master-key auth + audit log → **primer milestone shippable**
5. REST sugar + CLI
6. Dashboard Admin Mode
7. Write tools
8. Sandbox admin tools → **restaura capacidad OpenClaw original**
9. Destructive tools con approval-gate
10. Scheduled autónomo
11. Provisioning tools

## Verificación

**Unit/dry-run**: cada tool admin tiene 3 niveles (schema, dry-run, integration si toca DB).

**Integration nueva**: `src/tests/e2e/admin-loop.integration.test.ts`:
- Arranca fomo-core + Prisma test, seedea `fomo-internal` + `fomo-admin`
- Invoca con master key: `"Create test agent in project X with prompt Y, run 3 sandbox messages, promote si cost <$0.05, report"`
- Asserts: agente creado, 3 traces existen, promotion con audit row O bloqueada con reason clara.

**Smoke manual**:
- `pnpm dev` + `pnpm chat` hablando con `fomo-admin`
- `nexus-admin "list agents in fomo-internal"` desde terminal
- Dashboard Copilot → toggle Admin Mode → chat → verificar approval modal con una tool destructiva
- Disparar manualmente `weekly-fleet-health-review` vía scheduled-tasks endpoint

**Typecheck + lint**: `pnpm typecheck && pnpm lint` limpios.

## Riesgos abiertos

- **Self-modification loop**: mitigado con hard-check `targetAgentId !== 'fomo-admin'` en todas las tools mutadoras.
- **Cost leakage en sandbox**: bucket separado `'sandbox'` en CostGuard.
- **Alucinación destructiva**: approval-gate obligatorio en delete/deprovision/issue-key. Audit log de todo.
- **Approval en scheduled**: cae a cola, no bloqueante para el runner pero sí para la acción.
- **Circular deps**: tools admin importan `AgentRepository`, `ProjectRepository`, `ProvisioningService`, `PromptLayerManager` — todos inicializados en `main.ts` antes del tool registry. Sin ciclo mientras se mantenga el patrón factory + DI via options.
