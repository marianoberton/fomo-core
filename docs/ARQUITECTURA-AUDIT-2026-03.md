# Auditoría Arquitectural FOMO — Transición a OpenClaw + Modelo Mixto

**Fecha:** 2026-03-16  
**Auditor:** Subagente Arquitecto FAMA  
**Repositorios analizados:**
- fomo-core: `/home/ubuntu/.openclaw/workspace/fomo-core`
- fomo-platform: `/home/ubuntu/.openclaw/workspace/fomo-platform`
- fomo-web: No tiene código fuente relevante para esta auditoría

---

## 1. Resumen Ejecutivo

El estado actual de fomo-core (Nexus Core) tiene una arquitectura monolítica que corre todo en un solo proceso: agentes de clientes, Manager interno (FAMA-Manager), orquestación, canales y cost tracking. La transición a la arquitectura de 3 capas requiere:

1. **Extraer el Manager Agent** de fomo-core y migrarlo a contenedores OpenClaw independientes por cliente
2. **Crear endpoint HTTP `/api/v1/agents/{id}/invoke`** para que OpenClaw llame a los agentes de FOMO-Core como Skills
3. **Implementar configuración de modelo por agente** (MiniMax para Elena, Kimi para Mateo, etc.)
4. **Mantener compatibilidad** con fomo-platform (Workforce, Conversaciones, Reportes)

**Complejidad estimada:** Media-Alta (3-4 semanas con 1 developer senior)  
**Riesgo principal:** Routing de mensajes entrantes sin Manager interno — requiere decisión de arquitectura sobre si WhatsApp llega a OpenClaw o directo a fomo-core.

---

## 2. Inventario del Estado Actual

### 2.1 Estructura de fomo-core

```
src/
├── agents/                    # Multi-agent system
│   ├── agent-comms.ts         # Comunicación agent-to-agent
│   ├── agent-registry.ts      # Cache de agentes
│   ├── fomo-internal/         # ⚠️ Config de FAMA-* agents
│   │   └── agents.config.ts   # FAMA-Sales, FAMA-Manager, FAMA-Ops, FAMA-CS
│   ├── mode-resolver.ts       # Resolución de modo por canal
│   └── types.ts               # AgentConfig, AgentOperatingMode, etc.
├── api/                       # HTTP API (Fastify)
│   ├── routes/
│   │   ├── agents.ts          # CRUD agents, POST /agents/:id/message
│   │   ├── chat.ts            # POST /chat (síncrono)
│   │   ├── chat-stream.ts     # WS /chat-stream
│   │   └── ...
│   └── types.ts               # RouteDependencies
├── channels/                  # Canales (WhatsApp, Telegram, Slack)
│   ├── inbound-processor.ts   # Procesa mensajes entrantes
│   ├── agent-channel-router.ts# Enruta a qué agente atiende
│   └── adapters/              # WAHA (WhatsApp), Telegram, Slack
├── core/                      # Núcleo del agente
│   ├── agent-runner.ts        # ⚠️ Agent loop principal
│   ├── model-router.ts        # Clasificación por complejidad
│   └── types.ts               # AgentConfig, ExecutionContext, Traces
├── providers/                 # LLM Providers
│   ├── factory.ts             # createProvider() — crea instancias
│   ├── anthropic.ts           # SDK Anthropic directo
│   ├── openai.ts              # SDK OpenAI
│   ├── openrouter.ts          # OpenRouter
│   ├── google.ts              # Google Gemini
│   └── models.ts              # ⚠️ Model registry con precios
├── config/                    # Configuración
│   └── schema.ts              # Zod schemas (NO tiene provider por agente)
└── main.ts                    # ⚠️ Entry point — inicia todo
```

### 2.2 Estructura de fomo-platform

```
app/(workspace)/workspace/
├── workforce/                 # ✅ Módulo Workforce existe
│   ├── conversations/         # ✅ Conversaciones
│   ├── reports/               # ✅ Reportes
│   ├── campaigns/
│   ├── channels/
│   └── [agentId]/             # Detalle de agente
├── crm-fomo/
│   └── inbox/                 # Inbox de mensajes
├── settings/
│   └── core-projects/         # Conexión a proyectos fomo-core
└── ...

lib/
├── nexus/api.ts               # ✅ Cliente HTTP a fomo-core
└── hooks/use-workforce-project.ts
```

**Observación:** No existe un módulo "Copilot" dedicado en fomo-platform. El acceso al Manager es vía dashboard en modo `copilot` según `agents.config.ts`.

---

## 3. Fase 2: Diagnóstico Detallado

### 3.1 — LLM Config

**Pregunta 1: ¿Dónde se configura el modelo?**

La configuración del modelo ocurre en 3 niveles:

1. **Project-level** (`src/core/types.ts` líneas 28-38):
```typescript
export interface LLMProviderConfig {
  provider: 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter';
  model: string;
  apiKeyEnvVar?: string;  // ← referencia a env var, no la key cruda
  baseUrl?: string;
}
```

2. **Agent-level override** (`src/agents/types.ts` líneas 36-43):
```typescript
export interface AgentLLMConfig {
  provider?: 'anthropic' | 'openai' | 'google' | 'ollama';
  model?: string;
  apiKeyEnvVar?: string;
}
```

3. **Runtime** en `chat-setup.ts`: el agente hereda del project config y aplica overrides del agente.

**Pregunta 2: ¿SDK Anthropic directo o hay abstracción?**

Hay una **abstracción parcial**. El `ProviderFactory` crea instancias concretas pero los providers usan SDKs nativos.

**Pregunta 3: ¿Soporte multi-provider ya existe?**

✅ **Sí**. El factory soporta: anthropic, openai, google, ollama, openrouter. **Faltan: qwen, minimax, kimi.**

**Pregunta 4: ¿Modelo diferente por agente o global?**

⚠️ **Parcialmente implementado**. La estructura soporta `llmConfig` por agente, pero:
- El `AgentLLMConfig` NO incluye `baseUrl` (requerido para MiniMax/Qwen/Kimi)
- No hay campo `provider` explícito en el override del agente

**Pregunta 5: ¿Qué tan difícil sería Elena=MiniMax, Mateo=Kimi?**

**Complejidad: MEDIA**. Cambios necesarios:
1. Extender `AgentLLMConfig` con `baseUrl` y más providers
2. Actualizar `ProviderFactory` para soportar nuevos providers
3. Actualizar `models.ts` con precios de MiniMax, Kimi, Qwen
4. Migrar secrets de env vars a per-agent en DB

### 3.2 — Manager Agent

**Pregunta 6: ¿Existe como entidad separada o lógica inline?**

✅ **Entidad separada**. Definido en `src/agents/fomo-internal/agents.config.ts` líneas 89-172 como `famaManagerAgent` con `operatingMode: 'manager'`.

**Pregunta 7: ¿Tiene su propio loop, prompts, config?**

✅ **Sí**. Tiene prompt config propio, tool allowlist específica (incluye `delegate-to-agent`), y limits más altos (maxTurns: 50, budget: $20/día).

**Pregunta 8: ¿Cómo se diferencia de los otros agentes?**

- `operatingMode: 'manager'` vs `'customer-facing'`, `'internal'`, `'copilot'`
- Acceso a tools de monitoreo: `get-operations-summary`, `review-agent-activity`, `delegate-to-agent`
- Corre en dashboard (channel: 'dashboard')

**Pregunta 9: ¿Qué se rompe si lo movemos a OpenClaw?**

1. **Routing de mensajes entrantes**: `inbound-processor.ts` y `agent-channel-router.ts` deciden qué agente atiende. Sin Manager interno, el routing debe pasar a OpenClaw o hacerse estático.

2. **Delegate-to-agent tool**: Usa `runSubAgent` definido en `main.ts`. Si el Manager está en OpenClaw, esta tool debe llamar vía HTTP a fomo-core.

3. **Inter-agent comms**: `agentComms` es local en memoria. Mover a OpenClaw requiere cambiar a API calls.

### 3.3 — Endpoint de invocación

**Pregunta 10: ¿Existe POST /api/v1/agents/{id}/invoke o similar?**

⚠️ **NO existe** un endpoint dedicado. Lo más cercano es `POST /api/v1/chat` pero requiere `projectId` y no está diseñado para invocación externa.

**Pregunta 11: ¿Qué auth usa?**

- `NEXUS_API_KEY` global para webhooks
- API keys por proyecto en `api-key-service.ts`
- **Se necesita:** Service tokens para autenticación máquina-a-máquina entre OpenClaw y fomo-core.

**Pregunta 12: ¿Síncrono o async/streaming?**

Ambos existen: `POST /chat` (síncrono) y `WS /chat-stream` (WebSocket). Para el invoke deberíamos soportar ambos modos.

**Pregunta 13: ¿Qué contexto necesita?**

Basado en `chat-setup.ts`: `projectId`, `agentId` (opcional), `sessionId` (opcional), `message`, `sourceChannel`, `contactRole`.

### 3.4 — Multi-tenancy

**Pregunta 14-17: ¿Aislamiento, agentes, secrets, traces per-tenant?**

✅ **Todo implementado correctamente**. Project-based isolation con `projectId` como clave en todas las tablas, secrets encriptados con project-scoped keys, y traces/costs filtrados por proyecto.

### 3.5 — fomo-platform

**Pregunta 18: ¿Cómo se comunica con fomo-core?**

✅ **REST API** via `/api/admin/nexus` proxy route (Next.js API routes). Cliente en `lib/nexus/api.ts`.

**Pregunta 19: ¿Existe módulo Copilot?**

⚠️ **No como tal**. El dashboard tiene Workforce pero no hay un "chat con el Manager" dedicado.

**Pregunta 20-21: ¿Workforce y Conversaciones?**

✅ **Ambos existen** en `workforce/` y `crm-fomo/inbox/`.

### 3.6 — Gaps y riesgos

**Pregunta 22: ¿Lógica de orquestación difícil de reemplazar?**

⚠️ **Sí**: `AgentChannelRouter` decide qué agente atiende un mensaje entrante basado en mapeo de canales a modos. Si OpenClaw es el punto de entrada, necesita replicar esta lógica.

**Pregunta 23: ¿Dependencias circulares?**

⚠️ **Sí**: En `main.ts` hay inject circular: `chatSetupDeps.agentRegistry = agentRegistry`.

**Pregunta 24: ¿Deuda técnica relevante?**

1. Environment variables para API keys (no secrets dinámicos por agente)
2. No hay soporte para baseURL en AgentLLMConfig
3. Model registry hardcodeado (requiere deploy para actualizar)

---

## 4. Fase 3: Plan de Cambios

### 4.1 — Cambios en fomo-core

#### a) Endpoint POST /api/v1/agents/{agent_id}/invoke

| Campo | Valor |
|-------|-------|
| **Archivo** | NUEVO: `src/api/routes/agent-invoke.ts` |
| **Tipo** | NUEVO |
| **Qué debe hacer** | Recibir requests de OpenClaw, validar service token, ejecutar agente, retornar respuesta o stream |
| **Auth** | Service token (header `Authorization: Bearer sk-fomo-...`) validado contra `apiKeyService` |
| **Input** | `{ message, sessionId?, sourceChannel?, contactRole?, metadata? }` |
| **Output** | `{ sessionId, traceId, response, usage, toolCalls? }` o stream SSE/WebSocket |
| **Complejidad** | MEDIA |

#### b) Configuración de modelo por agente

**Cambios específicos:**

1. `src/agents/types.ts`: Agregar `baseUrl?: string` y `apiKeySecretName?: string` a `AgentLLMConfig`

2. `src/providers/factory.ts`: Agregar caso 'openai-compatible' para MiniMax, Qwen, Kimi

3. `src/providers/models.ts`: Agregar entradas para minimax-m2.5, kimi-k2.5, qwen3.5-plus

#### c) Remoción del Manager Agent interno

**Opciones de routing sin Manager:**

| Opción | Descripción | Pros | Cons |
|--------|-------------|------|------|
| A | WhatsApp → fomo-core (agente directo) | Simple, baja latencia | Sin orquestación |
| B | WhatsApp → OpenClaw → fomo-core | Manager decide, unificado | Latencia extra |
| C | Webhook config por cliente | Flexible | Complejo de operar |

**Recomendación:** Opción B para enterprise, Opción A para pymes.

#### d) Secrets para providers

**Naming convention:**
```
AGENT_{AGENT_NAME}_{PROVIDER}_API_KEY
AGENT_{AGENT_NAME}_MODEL
AGENT_{AGENT_NAME}_BASE_URL
```

### 4.2 — Cambios en fomo-platform

#### a) Módulo Copilot (NUEVO)
- `app/(workspace)/workspace/copilot/client-page.tsx`
- `lib/openclaw-api.ts` — Cliente HTTP a OpenClaw Manager

#### b) Módulo Workforce
- Agregar `invokeAgent` method en `lib/nexus/api.ts`

#### c) Módulo Conversaciones
✅ Sin cambios mayores

### 4.3 — Nuevos archivos/repos necesarios

1. **Repo `fomo-openclaw-manager`** con:
   - `template/SOUL.md` — System prompt base
   - `template/AGENTS.md` — Skills disponibles
   - `template/HEARTBEAT.md` — Tareas programadas
   - `template/docker-compose.yml`
   - `template/skills/invoke-fomo-agent/`

2. **Script `scripts/provision-client.sh`** — Automatiza creación de proyecto, generación de tokens, y deploy

---

## 5. Fase 4: Priorización

| # | Cambio | Repo | Complejidad | Días estimados | Bloquea a |
|---|--------|------|-------------|----------------|-----------|
| 1 | Extender AgentLLMConfig | fomo-core | BAJA | 0.5 | 2, 3, 4 |
| 2 | Agregar providers MiniMax, Kimi, Qwen | fomo-core | BAJA | 0.5 | 5 |
| 3 | Agregar modelos a models.ts | fomo-core | BAJA | 0.5 | — |
| 4 | Crear endpoint POST /agents/:id/invoke | fomo-core | MEDIA | 2 | 6, 7 |
| 5 | Migrar secrets de env vars a DB | fomo-core | MEDIA | 2 | — |
| 6 | Crear template OpenClaw Manager | fomo-openclaw | MEDIA | 3 | 7 |
| 7 | Crear skill invoke-fomo-agent | fomo-openclaw | BAJA | 1 | 8 |
| 8 | Script de provisioning | fomo-openclaw | BAJA | 1 | 9 |
| 9 | Crear módulo Copilot | fomo-platform | MEDIA | 2 | 10 |
| 10 | Migrar FAMA-Manager a OpenClaw | fomo-openclaw | ALTA | 3 | 11 |
| 11 | Definir routing de mensajes entrantes | fomo-core | ALTA | 2 | 12 |
| 12 | Implementar routing elegido | fomo-core | MEDIA | 2 | — |
| 13 | Testing E2E y rollback plan | Todos | MEDIA | 2 | Deploy |

**Total estimado:** 22 días-hombre (~1 mes con 1 dev, 2-3 semanas con 2 devs)

---

## 6. Riesgos y Advertencias

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Latencia OpenClaw → fomo-core → provider | MEDIA | ALTO | Cache, HTTP keep-alive |
| Fallback si OpenClaw cae | BAJA | CRÍTICO | Health checks, rollback |
| Incompatibilidad API providers chinos | MEDIA | ALTO | Validar antes de deploy |
| Costo de infra extra | ALTA | MEDIO | Auto-sleep, pooling |

### Deuda técnica expuesta
- Coupling fuerte entre channel routing y Manager
- Tool execution acoplado al proceso principal
- Secrets en environment variables

---

## 7. Preguntas para Mariano

1. **Routing de mensajes entrantes**: ¿WhatsApp/Telegram llega a OpenClaw primero o directo a fomo-core?

2. **Prioridad del Copilot**: ¿Es crítico para MVP o puede venir después?

3. **Cantidad de clientes iniciales**: ¿Cuántos se migrarán en la primera ola?

4. **Secrets de providers**: ¿Tenés API keys de MiniMax, Kimi, Qwen?

5. **Presupuesto de infra**: ¿Presupuesto mensual aceptable para N contenedores?

6. **Rollback**: ¿Rollback por cliente individual o solo global?

7. **FAMA-Ops**: ¿Migra a OpenClaw o se queda en fomo-core?

---

## Anexos

### A. Referencias de código clave

| Concepto | Archivo |
|----------|---------|
| Agent config | `src/agents/types.ts` líneas 36-43 |
| Provider factory | `src/providers/factory.ts` líneas 48-90 |
| Manager agent | `src/agents/fomo-internal/agents.config.ts` líneas 89-172 |
| Chat endpoint | `src/api/routes/chat.ts` |
| Agent runner | `src/core/agent-runner.ts` |
| fomo-platform API | `lib/nexus/api.ts` |

### B. Modelos por agente (target)

| Agente | Modelo | Provider |
|--------|--------|----------|
| Manager (OpenClaw) | qwen3.5-plus | Qwen |
| Elena | minimax-m2.5 | MiniMax |
| Nadia | qwen3.5-plus | Qwen |
| Mateo | kimi-k2.5 | Moonshot |
| Franco/Marcos | qwen3.5-flash | Qwen |
| Fallback | claude-sonnet-4-6 | Anthropic |

---

*Documento generado automáticamente por auditoría arquitectural FAMA — 2026-03-16*