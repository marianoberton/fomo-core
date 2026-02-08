# 🔧 Nexus Core — Guía de Configuración e Interacción

---

## Parte 1: Cómo se configura un agente

### Flujo de vida de un agente

```
1. Crear Proyecto     → Define quién es el agente y qué puede hacer
2. Configurar Tools   → Registra las herramientas que necesita
3. Escribir Prompt    → Define personalidad e instrucciones
4. Configurar Secrets → Credenciales para APIs externas
5. Activar            → El agente queda listo para recibir requests
```

---

### 1.1 Archivo de configuración por proyecto

Cada agente se define con un archivo YAML (o JSON) que se carga al crear el proyecto. Este es el contrato completo de un agente:

```yaml
# agents/sales-agent.yaml
# ──────────────────────────────────────────────────

project:
  id: "fomo-client-cardboard-sales"
  name: "Agente de Ventas - Cartones del Sur"
  description: "Asistente de ventas mayoristas para Cartones del Sur"
  environment: "production"          # production | staging | development
  owner: "mariano@fomologic.com.ar"
  tags: ["sales", "b2b", "manufacturing"]

# ── LLM Configuration ──────────────────────────────

llm:
  primary:
    provider: "anthropic"
    model: "claude-sonnet-4-5-20250929"
    temperature: 0.3                  # bajo para consistencia en ventas
    maxOutputTokens: 4096
  
  fallback:                           # se usa si el primario falla
    provider: "openai"
    model: "gpt-4o"
    temperature: 0.3
    maxOutputTokens: 4096
  
  # Cuándo hacer failover
  failover:
    onRateLimit: true
    onServerError: true
    onTimeout: true
    timeoutMs: 30000
    maxRetries: 3

# ── Tools Permitidos ───────────────────────────────

tools:
  allowed:
    - id: "search-products"
      config:
        catalogEndpoint: "${CATALOG_API_URL}"
        maxResults: 50
    
    - id: "create-quote"
      config:
        currency: "ARS"
        taxRate: 21
        requiresApproval: false       # cotizaciones no necesitan aprobación
    
    - id: "send-email"
      config:
        fromAddress: "ventas@cartonesdelsur.com"
        requiresApproval: true        # emails SÍ necesitan aprobación humana
        allowedDomains:               # solo puede enviar a estos dominios
          - "cartonesdelsur.com"
          - "*.cartonesdelsur.com"
    
    - id: "query-crm"
      config:
        platform: "hubspot"
        readOnly: true                # solo lectura en el CRM
    
    - id: "schedule-meeting"
      config:
        calendarId: "ventas@cartonesdelsur.com"
        requiresApproval: true
        maxDaysAhead: 30
  
  # Tools explícitamente prohibidos (para documentación y auditoría)
  denied:
    - "execute-shell"
    - "modify-database"
    - "delete-records"

# ── Memoria ────────────────────────────────────────

memory:
  longTerm:
    enabled: true
    maxEntries: 1000                  # por proyecto
    retrievalTopK: 5                  # memorias por turno
    embeddingProvider: "anthropic"    # o "openai", "local"
    decayEnabled: true                # memorias poco usadas pierden relevancia
    decayHalfLifeDays: 90
  
  contextWindow:
    reserveTokens: 20000             # headroom para respuesta
    pruningStrategy: "turn-based"    # turn-based | token-based
    maxTurnsInContext: 20
    compaction:
      enabled: true
      memoryFlushBeforeCompaction: true

# ── Costos ─────────────────────────────────────────

costs:
  dailyBudgetUSD: 5.00
  monthlyBudgetUSD: 100.00
  maxTokensPerTurn: 8000
  maxTurnsPerSession: 50
  maxToolCallsPerTurn: 10
  alerts:
    thresholdPercent: 80             # avisa al 80% del budget
    webhookUrl: "${COST_ALERT_WEBHOOK}"
    emailTo: "mariano@fomologic.com.ar"

# ── Sesiones ───────────────────────────────────────

sessions:
  maxConcurrent: 10
  idleTimeoutMinutes: 30
  maxDurationMinutes: 120
  persistHistory: true               # guardar historial completo

# ── Seguridad ──────────────────────────────────────

security:
  authentication:
    type: "api-key"                   # api-key | jwt | oauth2
    keys:
      - name: "client-app"
        scopes: ["chat", "sessions:read"]
      - name: "admin"
        scopes: ["chat", "sessions:*", "config:*", "tools:test"]
  
  inputSanitization:
    maxMessageLength: 10000
    stripHtml: true
    detectPromptInjection: true      # heuristic + classifier
  
  approvalGates:
    notifyVia: "webhook"             # webhook | email | slack
    webhookUrl: "${APPROVAL_WEBHOOK}"
    timeoutMinutes: 60               # si no aprueban, cancela
    defaultOnTimeout: "deny"         # deny | approve (nunca approve en prod)

# ── Observabilidad ─────────────────────────────────

observability:
  logLevel: "info"                   # debug | info | warn | error
  tracing:
    enabled: true
    exportTo: "database"             # database | otlp | both
  metrics:
    enabled: true
    exportTo: "database"
```

### 1.2 Secrets (separados de la config)

Los secrets NUNCA van en el archivo de configuración. Se cargan por separado:

```bash
# CLI para gestionar secrets
nexus secrets set fomo-client-cardboard-sales CATALOG_API_URL "https://api.cartonesdelsur.com/v1"
nexus secrets set fomo-client-cardboard-sales HUBSPOT_API_KEY "pat-na1-xxxxx"
nexus secrets set fomo-client-cardboard-sales COST_ALERT_WEBHOOK "https://hooks.slack.com/xxx"
nexus secrets set fomo-client-cardboard-sales APPROVAL_WEBHOOK "https://hooks.slack.com/yyy"

# Los secrets se inyectan en runtime via ${VAR_NAME} en la config
# El agente NUNCA ve el valor raw — los tools reciben el valor ya resuelto
```

### 1.3 Prompt Layers (versionado independiente por capa)

El sistema de prompts usa 3 capas independientes, cada una versionada por separado.
Esto permite cambiar las instrucciones de negocio sin tocar la identidad ni la
capa de seguridad, y hacer rollback granular.

**Capas:**
- **identity** — quién es el agente, personalidad, rol
- **instructions** — reglas de negocio, flujos de trabajo
- **safety** — límites, restricciones, qué NO hacer

```bash
# ── Crear capas iniciales ─────────────────────────────

# API: crear capa de identidad
POST /projects/fomo-client-cardboard-sales/prompt-layers
{
  "layerType": "identity",
  "content": "Sos el asistente virtual de ventas de Cartones del Sur...",
  "createdBy": "mariano@fomologic.com.ar",
  "changeReason": "Initial identity"
}

# API: crear capa de instrucciones
POST /projects/fomo-client-cardboard-sales/prompt-layers
{
  "layerType": "instructions",
  "content": "Reglas de negocio:\n- Pedido mínimo: 100 unidades\n- Descuentos...",
  "createdBy": "mariano@fomologic.com.ar",
  "changeReason": "Initial business rules"
}

# API: crear capa de seguridad
POST /projects/fomo-client-cardboard-sales/prompt-layers
{
  "layerType": "safety",
  "content": "NUNCA des precios sin consultar el catálogo...",
  "createdBy": "mariano@fomologic.com.ar",
  "changeReason": "Initial safety rules"
}

# ── Iterar una capa (sin tocar las demás) ─────────────

# Crear nueva versión de instrucciones (v2)
POST /projects/fomo-client-cardboard-sales/prompt-layers
{
  "layerType": "instructions",
  "content": "Reglas de negocio actualizadas con upselling...",
  "createdBy": "mariano@fomologic.com.ar",
  "changeReason": "Added upselling instructions"
}

# Activar la nueva versión
POST /prompt-layers/{new-layer-id}/activate

# ── Ver estado actual ─────────────────────────────────

# Ver capas activas
GET /projects/fomo-client-cardboard-sales/prompt-layers/active
# → { identity: v1, instructions: v2, safety: v1 }

# Ver historial de una capa
GET /projects/fomo-client-cardboard-sales/prompt-layers?layerType=instructions

# ── Rollback granular ────────────────────────────────

# Activar versión anterior de instrucciones (rollback a v1)
POST /prompt-layers/{old-layer-id}/activate
# → Solo instrucciones cambian. Identidad y seguridad quedan igual.
```

**Ejemplo de contenido por capa:**

```markdown
# ── Identity Layer ────────────────────────────────────
Sos el asistente virtual de ventas de Cartones del Sur. Tu trabajo es
ayudar a los clientes mayoristas a encontrar productos, generar
cotizaciones, y agendar reuniones con el equipo comercial.

Personalidad:
- Profesional pero cercano
- Usás "vos" (español rioplatense)
- Respondés de forma concisa, no más de 3 párrafos
- Si no sabés algo, lo decís honestamente

# ── Instructions Layer ─────────────────────────────────
Reglas de negocio:
- Pedido mínimo: 100 unidades
- Descuentos por volumen: >500u = 5%, >1000u = 10%, >5000u = 15%
- Plazo de entrega estándar: 7-10 días hábiles
- Condiciones de pago: 50% adelanto, 50% contra entrega

# ── Safety Layer ──────────────────────────────────────
- No des precios sin consultar el catálogo actualizado
- No confirmes stock sin verificar con la herramienta
- No prometas plazos menores a 7 días sin aprobación
- No envíes emails sin revisión del operador
```

**En runtime**, `PromptBuilder` ensambla las 3 capas + tools + memoria en un solo
system prompt. Cada `ExecutionTrace` almacena un `PromptSnapshot` con las versiones
exactas usadas para reproducibilidad.

### 1.4 CLI completo de gestión

```bash
# ═══════════════════════════════════════════════
# PROYECTOS
# ═══════════════════════════════════════════════

nexus project create --config ./agents/sales-agent.yaml
nexus project list
nexus project status fomo-client-cardboard-sales
nexus project update fomo-client-cardboard-sales --config ./agents/sales-agent-v2.yaml
nexus project pause fomo-client-cardboard-sales      # deja de aceptar requests
nexus project resume fomo-client-cardboard-sales
nexus project delete fomo-client-cardboard-sales      # requiere confirmación

# ═══════════════════════════════════════════════
# TOOLS
# ═══════════════════════════════════════════════

nexus tool list                                       # todos los tools disponibles
nexus tool info send-email                            # detalle de un tool
nexus tool test send-email --level schema             # test de validación
nexus tool test send-email --level dry-run \
  --input '{"to":"test@test.com","subject":"Cotización"}'
nexus tool test --all --level schema                  # testear todos
nexus tool health-check --project fomo-client-cardboard-sales  # health de tools del proyecto

# ═══════════════════════════════════════════════
# PROMPT LAYERS
# ═══════════════════════════════════════════════

nexus layers list <project>                                 # todas las capas (con versiones)
nexus layers list <project> --type identity                 # solo capa de identidad
nexus layers active <project>                               # capas activas actuales
nexus layers create <project> --type instructions \
  --file ./prompts/instructions-v2.md \
  --reason "Added upselling instructions"
nexus layers activate <layer-id>                            # activar versión específica
nexus layers show <layer-id>                                # ver contenido de una versión
nexus layers diff <project> --type instructions \
  --from 1 --to 3                                           # diff entre versiones

# ═══════════════════════════════════════════════
# SCHEDULED TASKS
# ═══════════════════════════════════════════════

nexus tasks list <project>                                  # tareas del proyecto
nexus tasks list <project> --status proposed                # solo propuestas por agentes
nexus tasks create <project> \
  --name "Daily CRM Report" \
  --cron "0 9 * * 1-5" \
  --message "Generá el reporte diario de leads" \
  --budget 2.00 \
  --timeout 120000
nexus tasks show <task-id>                                  # detalle
nexus tasks approve <task-id> --by "mariano@fomologic.com.ar"
nexus tasks reject <task-id>
nexus tasks pause <task-id>
nexus tasks resume <task-id>
nexus tasks runs <task-id>                                  # historial de ejecuciones
nexus tasks runs <task-id> --limit 5                        # últimas 5

# ═══════════════════════════════════════════════
# TOOL SCAFFOLDING
# ═══════════════════════════════════════════════

# Generar boilerplate para un nuevo tool
nexus tool scaffold \
  --id "search-inventory" \
  --name "Search Inventory" \
  --description "Searches product inventory by SKU or name" \
  --category "data" \
  --risk-level "low" \
  --no-approval \
  --no-side-effects
# → Genera: src/tools/definitions/search-inventory.ts
# →         src/tools/definitions/search-inventory.test.ts
# → Agrega: export line a src/tools/definitions/index.ts

# ═══════════════════════════════════════════════
# SECRETS
# ═══════════════════════════════════════════════

nexus secrets set <project> KEY "value"
nexus secrets list <project>                          # muestra keys, nunca valores
nexus secrets delete <project> KEY

# ═══════════════════════════════════════════════
# SESIONES Y MONITOREO
# ═══════════════════════════════════════════════

nexus sessions list <project>                         # sesiones activas
nexus sessions inspect <session-id>                   # ver historial de una sesión
nexus sessions kill <session-id>                      # terminar una sesión

nexus logs <project> --tail                           # logs en tiempo real
nexus logs <project> --since "1h" --level error

nexus usage <project>                                 # consumo actual
nexus usage <project> --period monthly --format table

nexus traces <project> --last 10                      # últimas 10 ejecuciones
nexus traces inspect <trace-id>                       # detalle completo
nexus traces inspect <trace-id> --format timeline     # visualización temporal

# ═══════════════════════════════════════════════
# APROBACIONES
# ═══════════════════════════════════════════════

nexus approvals list                                  # pendientes
nexus approvals approve <approval-id>
nexus approvals deny <approval-id> --reason "No enviar a ese cliente"
```

---

## Parte 2: Cómo se interactúa con el agente

### 2.1 Los 3 canales de interacción

```
┌─────────────────────────────────────────────────────────────┐
│                     Nexus Core API                          │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │  REST API   │  │  WebSocket  │  │  Webhook (salida)  │  │
│  │             │  │             │  │                    │  │
│  │ • Enviar    │  │ • Chat en   │  │ • Notificaciones │  │
│  │   mensajes  │  │   tiempo    │  │ • Approval gates │  │
│  │ • Gestión   │  │   real      │  │ • Alertas costo  │  │
│  │ • Consultas │  │ • Streaming │  │ • Tool results   │  │
│  │ • Historial │  │   de resp.  │  │   async          │  │
│  └─────────────┘  └─────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲                 ▲                    │
         │                 │                    ▼
    App cliente       Chat UI            Slack / CRM /
    (backend)        (frontend)         sistema externo
```

### 2.2 REST API

#### Crear una sesión

```bash
POST /api/v1/projects/{projectId}/sessions
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "metadata": {
    "userId": "client-123",
    "userName": "Juan Pérez",
    "channel": "web-chat",
    "language": "es"
  }
}
```

```json
// Response 201
{
  "sessionId": "sess_abc123",
  "projectId": "fomo-client-cardboard-sales",
  "status": "active",
  "createdAt": "2026-02-06T15:30:00Z",
  "expiresAt": "2026-02-06T17:30:00Z"
}
```

#### Enviar un mensaje (síncrono)

```bash
POST /api/v1/sessions/{sessionId}/messages
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "role": "user",
  "content": "Necesito cotización de 2000 cajas de cartón corrugado triple"
}
```

```json
// Response 200
{
  "messageId": "msg_xyz789",
  "role": "assistant",
  "content": "¡Hola! Busco eso en el catálogo para darte precio actualizado...",
  "toolCalls": [
    {
      "id": "tc_001",
      "tool": "search-products",
      "status": "completed",
      "input": { "query": "cartón corrugado triple", "minQuantity": 2000 },
      "output": { "products": [...] }
    }
  ],
  "usage": {
    "inputTokens": 1250,
    "outputTokens": 380,
    "estimatedCostUSD": 0.008
  },
  "traceId": "trace_def456"
}
```

#### Enviar mensaje (streaming)

```bash
POST /api/v1/sessions/{sessionId}/messages/stream
Authorization: Bearer <api-key>
Content-Type: application/json
Accept: text/event-stream

{
  "role": "user",
  "content": "Necesito cotización de 2000 cajas de cartón corrugado triple"
}
```

```
// Response - Server-Sent Events
event: message_start
data: {"messageId":"msg_xyz789"}

event: tool_start
data: {"toolCallId":"tc_001","tool":"search-products","input":{...}}

event: tool_complete
data: {"toolCallId":"tc_001","output":{...},"durationMs":450}

event: content_delta
data: {"text":"¡Hola! Encontré "}

event: content_delta
data: {"text":"3 opciones de cartón corrugado triple..."}

event: content_delta
data: {"text":"\n\n**Opción 1:** ..."}

event: message_complete
data: {"usage":{"inputTokens":1250,"outputTokens":380},"traceId":"trace_def456"}
```

#### Cuando se necesita aprobación humana

```bash
# El agente intenta enviar un email → el tool requiere aprobación
POST /api/v1/sessions/{sessionId}/messages
{
  "role": "user",
  "content": "Enviále la cotización por email a juan@empresa.com"
}
```

```json
// Response 202 (Accepted, no completado)
{
  "messageId": "msg_abc002",
  "role": "assistant",
  "content": "Preparé el email con la cotización. Queda pendiente de aprobación para enviarlo.",
  "pendingApproval": {
    "approvalId": "apr_001",
    "tool": "send-email",
    "action": {
      "to": "juan@empresa.com",
      "subject": "Cotización #2024-089 - Cartón corrugado triple",
      "body": "Estimado Juan, adjunto la cotización solicitada..."
    },
    "status": "pending",
    "expiresAt": "2026-02-06T16:30:00Z"
  },
  "traceId": "trace_ghi789"
}
```

```bash
# El operador aprueba (via API, CLI, o webhook UI)
POST /api/v1/approvals/apr_001/approve
Authorization: Bearer <admin-api-key>

{
  "approvedBy": "mariano@fomologic.com.ar",
  "note": "OK, enviar"
}
```

```json
// Response 200
{
  "approvalId": "apr_001",
  "status": "approved",
  "toolResult": {
    "tool": "send-email",
    "success": true,
    "output": { "messageId": "email_xxx", "sentAt": "2026-02-06T15:45:00Z" }
  }
}
```

```
// El WebSocket del chat recibe automáticamente:
event: approval_resolved
data: {"approvalId":"apr_001","status":"approved"}

event: content_delta
data: {"text":"Listo, le envié la cotización a juan@empresa.com. ¿Necesitás algo más?"}
```

### 2.3 WebSocket (chat en tiempo real)

```javascript
// Cliente JavaScript/TypeScript
const ws = new WebSocket('wss://api.nexuscore.fomologic.com.ar/ws');

// Autenticar
ws.send(JSON.stringify({
  type: 'auth',
  apiKey: 'nxs_live_xxxxx',
  projectId: 'fomo-client-cardboard-sales'
}));

// Crear o reconectar sesión
ws.send(JSON.stringify({
  type: 'session.create',
  metadata: { userId: 'client-123', userName: 'Juan Pérez' }
}));

// Enviar mensaje
ws.send(JSON.stringify({
  type: 'message.send',
  sessionId: 'sess_abc123',
  content: 'Necesito cotización de 2000 cajas'
}));

// Recibir eventos
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'session.created':
      // { sessionId: 'sess_abc123' }
      break;
    
    case 'message.content_delta':
      // { text: 'fragmento de respuesta...' }
      // → Renderizar texto progresivamente
      break;
    
    case 'message.tool_start':
      // { toolCallId: 'tc_001', tool: 'search-products' }
      // → Mostrar indicador "Buscando en catálogo..."
      break;
    
    case 'message.tool_complete':
      // { toolCallId: 'tc_001', success: true, durationMs: 450 }
      // → Actualizar indicador
      break;
    
    case 'message.approval_required':
      // { approvalId: 'apr_001', tool: 'send-email', action: {...} }
      // → Mostrar UI de aprobación al operador
      break;
    
    case 'message.complete':
      // { messageId: 'msg_xyz', usage: {...}, traceId: 'trace_xxx' }
      break;
    
    case 'session.cost_alert':
      // { currentSpend: 4.50, budget: 5.00, percent: 90 }
      break;
    
    case 'error':
      // { code: 'BUDGET_EXCEEDED', message: '...' }
      break;
  }
};
```

### 2.4 Webhooks (el agente notifica al mundo)

Configurados en el YAML del proyecto. El agente dispara webhooks para eventos que requieren atención externa:

```yaml
# En la config del proyecto
webhooks:
  endpoints:
    - url: "${SLACK_WEBHOOK_URL}"
      events:
        - "approval.requested"      # tool necesita aprobación
        - "cost.alert"              # budget cercano al límite
        - "cost.exceeded"           # budget agotado
        - "session.error"           # error en una sesión
    
    - url: "${CRM_WEBHOOK_URL}"
      events:
        - "tool.completed"          # cuando un tool termina (para sync)
      filter:
        tools: ["create-quote"]     # solo para cotizaciones
    
    - url: "${MONITORING_WEBHOOK_URL}"
      events:
        - "agent.health"            # heartbeat cada 5 min
        - "trace.anomaly"           # ejecución anómala detectada
```

**Payload de webhook:**

```json
// POST a tu endpoint
{
  "event": "approval.requested",
  "timestamp": "2026-02-06T15:32:00Z",
  "projectId": "fomo-client-cardboard-sales",
  "data": {
    "approvalId": "apr_001",
    "sessionId": "sess_abc123",
    "tool": "send-email",
    "riskLevel": "high",
    "action": {
      "to": "juan@empresa.com",
      "subject": "Cotización #2024-089",
      "preview": "Estimado Juan, adjunto la cotización..."
    },
    "approveUrl": "https://api.nexuscore.../approvals/apr_001/approve",
    "denyUrl": "https://api.nexuscore.../approvals/apr_001/deny",
    "expiresAt": "2026-02-06T16:30:00Z"
  },
  "signature": "sha256=xxxx"        // para verificar autenticidad
}
```

---

## Parte 3: Escenarios de integración típicos

### Escenario A: Chat widget en sitio web del cliente

```
┌──────────────┐     WebSocket      ┌──────────────┐
│  Widget chat │ ◄────────────────► │  Nexus Core  │
│  (React)     │     streaming      │              │
│  sitio web   │                    │  Proyecto:   │
│  del cliente │                    │  sales-agent │
└──────────────┘                    └──────────────┘
```

El cliente embebe un widget de chat en su sitio web. El widget se conecta via WebSocket y muestra las respuestas en streaming. Las aprobaciones se manejan en un dashboard separado para el operador.

### Escenario B: Agente que corre en background (scheduled tasks)

Las tareas programadas se crean via API y se ejecutan con BullMQ + Redis:

```bash
# Crear tarea recurrente via API
POST /projects/fomo-client-cardboard-sales/scheduled-tasks
{
  "name": "Daily CRM Report",
  "cronExpression": "0 9 * * 1-5",
  "taskPayload": {
    "message": "Revisá los leads de HubSpot que no fueron contactados en los últimos 7 días y preparame un resumen con las acciones sugeridas."
  },
  "maxDurationMinutes": 10,
  "budgetPerRunUSD": 2.00,
  "timeoutMs": 300000
}

# O el agente puede proponerlas durante una conversación:
# Agent usa el tool "propose-scheduled-task" →
#   → task se crea con status "proposed"
#   → requiere aprobación humana via POST /scheduled-tasks/:id/approve

# Crear otra tarea
POST /projects/fomo-client-cardboard-sales/scheduled-tasks
{
  "name": "Weekly Sales Report",
  "cronExpression": "0 18 * * 5",
  "taskPayload": {
    "message": "Generá el reporte semanal de cotizaciones enviadas, aceptadas y pendientes."
  },
  "maxDurationMinutes": 15,
  "budgetPerRunUSD": 3.00
}
```

El `TaskRunner` (BullMQ) se activa automáticamente si `REDIS_URL` está configurada.
Cada ejecución crea un `ScheduledTaskRun` con tracing completo.

### Escenario C: Agente como servicio dentro de un workflow

```bash
# Desde n8n, Make, o cualquier orquestador
POST /api/v1/projects/fomo-client-cardboard-sales/run
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "message": "Analiza este pedido y genera una cotización automática",
  "attachments": [
    {
      "type": "json",
      "name": "pedido.json",
      "content": {
        "cliente": "Distribuidora Norte",
        "items": [
          { "producto": "Caja corrugado simple", "cantidad": 500 },
          { "producto": "Caja corrugado triple", "cantidad": 200 }
        ]
      }
    }
  ],
  "options": {
    "synchronous": true,               # esperar respuesta completa
    "maxTurns": 10,
    "timeout": 60000
  }
}
```

```json
// Response 200
{
  "sessionId": "sess_oneshot_001",
  "result": {
    "content": "Cotización generada para Distribuidora Norte...",
    "toolResults": [
      {
        "tool": "search-products",
        "output": { "products": [...] }
      },
      {
        "tool": "create-quote",
        "output": {
          "quoteId": "QT-2026-089",
          "total": 485000,
          "currency": "ARS",
          "discount": "5%",
          "validUntil": "2026-02-20"
        }
      }
    ]
  },
  "usage": {
    "turns": 3,
    "totalTokens": 4200,
    "estimatedCostUSD": 0.021
  },
  "traceId": "trace_oneshot_001"
}
```

### Escenario D: Dashboard de operador

```
┌──────────────────────────────────────────────────────┐
│  Nexus Core — Dashboard Operador                     │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Proyectos activos                    [3/5]      │ │
│  │                                                 │ │
│  │ 🟢 sales-agent     │ 4 sesiones │ $3.20/día  │ │
│  │ 🟢 support-agent   │ 12 sesiones│ $8.40/día  │ │
│  │ 🟡 finance-agent   │ 1 sesión   │ $0.90/día  │ │
│  │ ⚪ sysadmin-agent  │ pausado    │ —          │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Aprobaciones pendientes              [2]        │ │
│  │                                                 │ │
│  │ 📧 send-email → juan@empresa.com               │ │
│  │    Cotización #2024-089                         │ │
│  │    [Ver detalle] [✅ Aprobar] [❌ Rechazar]     │ │
│  │                                                 │ │
│  │ 📅 schedule-meeting → María López               │ │
│  │    Reunión comercial 12/02 10:00               │ │
│  │    [Ver detalle] [✅ Aprobar] [❌ Rechazar]     │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Últimas ejecuciones                             │ │
│  │                                                 │ │
│  │ trace_def456 │ sales │ 3 turns │ $0.02 │ ✅   │ │
│  │ trace_ghi789 │ sales │ 5 turns │ $0.03 │ ⏳   │ │
│  │ trace_jkl012 │ suprt │ 8 turns │ $0.05 │ ✅   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## Parte 4: Ejemplo completo end-to-end

### Setup inicial de un agente nuevo (5 minutos)

```bash
# 1. Clonar template
nexus project init my-new-agent --template sales
# → Crea: agents/my-new-agent.yaml, prompts/my-new-agent.md

# 2. Editar config (abrir en editor)
code agents/my-new-agent.yaml

# 3. Escribir/adaptar el prompt
code prompts/my-new-agent.md

# 4. Configurar secrets
nexus secrets set my-new-agent CATALOG_API_URL "https://..."
nexus secrets set my-new-agent HUBSPOT_API_KEY "pat-xxx"

# 5. Crear proyecto
nexus project create --config ./agents/my-new-agent.yaml

# 6. Crear prompt (primera versión)
nexus prompt create my-new-agent --file ./prompts/my-new-agent.md --reason "v1"

# 7. Testear tools
nexus tool test --project my-new-agent --all --level dry-run

# 8. Test interactivo
nexus chat my-new-agent
# → Abre una sesión de chat interactiva en la terminal
# → Podés hablar con el agente y ver tools, costos, etc.

# 9. Si todo bien, cambiar a production
nexus project update my-new-agent --set environment=production
```

### Conversación de ejemplo (lo que ve el usuario vs lo que pasa detrás)

```
USUARIO: Hola, necesito 2000 cajas de corrugado triple

  ┌──── INTERNAMENTE ────────────────────────────────────────┐
  │ 1. ContextWindowManager: 2100 tokens usados de 200K     │
  │ 2. MemoryRetriever: busca memorias → 0 (primera vez)    │
  │ 3. PromptBuilder: arma 3 capas + 5 tools + 0 memorias   │
  │ 4. CostGuard: $0.00 / $5.00 diario → OK                │
  │ 5. LLMProvider (anthropic): envía request                │
  │ 6. LLM responde: tool_use → search-products             │
  │ 7. ToolExecutor: ¿search-products en whitelist? → SÍ    │
  │ 8. Zod valida input → OK                                │
  │ 9. Tool ejecuta → retorna 3 productos                   │
  │ 10. Resultado → de vuelta al LLM                        │
  │ 11. LLM genera respuesta final con los productos        │
  │ 12. CostGuard registra: 1850 tokens, $0.008             │
  │ 13. ExecutionTrace: 1 tool call, 2 turns, 1.2s          │
  └──────────────────────────────────────────────────────────┘

AGENTE: ¡Hola! Encontré 3 opciones de corrugado triple en el catálogo:

  1. **CT-300** - Corrugado triple estándar
     $245/unidad → Total: $490.000 + IVA
  
  2. **CT-300R** - Corrugado triple reforzado
     $310/unidad → Total: $620.000 + IVA
  
  3. **CT-300P** - Corrugado triple premium (resistente a humedad)
     $380/unidad → Total: $760.000 + IVA

  Por 2000 unidades aplicamos 10% de descuento.
  ¿Querés que prepare una cotización formal con alguna de estas opciones?

USUARIO: Dale, la opción 2. Y enviásela a juan@distribuidoranorte.com

  ┌──── INTERNAMENTE ────────────────────────────────────────┐
  │ 1. LLM responde: 2 tool_use en cadena                   │
  │    → create-quote (no requiere aprobación)               │
  │    → send-email (REQUIERE aprobación)                    │
  │ 2. ToolExecutor: create-quote → whitelist OK → ejecuta   │
  │ 3. Cotización generada: QT-2026-089                      │
  │ 4. ToolExecutor: send-email → whitelist OK               │
  │    → riskLevel: high + requiresApproval: true            │
  │    → PAUSA: crea approval_request apr_001                │
  │    → Webhook a Slack: "Aprobar envío de cotización?"     │
  │ 5. Retorna al usuario con estado pendiente               │
  │ 6. MemoryManager: guarda memoria →                       │
  │    {category: "fact", content: "Juan de Distribuidora    │
  │     Norte pidió CT-300R x2000", importance: 0.8}         │
  └──────────────────────────────────────────────────────────┘

AGENTE: Generé la cotización **QT-2026-089** por $558.000 + IVA
  (2000 x CT-300R a $310 con 10% descuento).

  El email a juan@distribuidoranorte.com está pendiente de
  aprobación. Te aviso cuando se envíe.

  ┌──── SLACK (canal del operador) ──────────────────────────┐
  │ 🔔 Nexus Core — Aprobación requerida                    │
  │                                                          │
  │ Proyecto: sales-agent                                    │
  │ Tool: send-email                                         │
  │ Para: juan@distribuidoranorte.com                        │
  │ Asunto: Cotización QT-2026-089                           │
  │                                                          │
  │ [Ver contenido] [✅ Aprobar] [❌ Rechazar]               │
  └──────────────────────────────────────────────────────────┘

  // Operador aprueba en Slack...

AGENTE: ✅ Listo, le envié la cotización a Juan. ¿Necesitás algo más?
```

---

## Parte 5: Resumen de endpoints API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| **Proyectos** | | |
| `POST` | `/api/v1/projects` | Crear proyecto |
| `GET` | `/api/v1/projects` | Listar proyectos |
| `GET` | `/api/v1/projects/:id` | Detalle proyecto |
| `PATCH` | `/api/v1/projects/:id` | Actualizar config |
| **Sesiones** | | |
| `POST` | `/api/v1/projects/:id/sessions` | Crear sesión |
| `GET` | `/api/v1/projects/:id/sessions` | Listar sesiones |
| `POST` | `/api/v1/projects/:id/run` | Ejecución one-shot (sync) |
| `POST` | `/api/v1/sessions/:id/messages` | Enviar mensaje (sync) |
| `POST` | `/api/v1/sessions/:id/messages/stream` | Enviar mensaje (SSE streaming) |
| `GET` | `/api/v1/sessions/:id/messages` | Historial de sesión |
| `DELETE` | `/api/v1/sessions/:id` | Terminar sesión |
| **Prompt Layers** | | |
| `GET` | `/api/v1/projects/:id/prompt-layers` | Listar capas (filter: `?layerType=`) |
| `GET` | `/api/v1/projects/:id/prompt-layers/active` | Capas activas (identity, instructions, safety) |
| `GET` | `/api/v1/prompt-layers/:id` | Detalle de una capa |
| `POST` | `/api/v1/projects/:id/prompt-layers` | Crear nueva versión de capa |
| `POST` | `/api/v1/prompt-layers/:id/activate` | Activar versión específica |
| **Scheduled Tasks** | | |
| `GET` | `/api/v1/projects/:id/scheduled-tasks` | Listar tareas (filter: `?status=`) |
| `GET` | `/api/v1/scheduled-tasks/:id` | Detalle de tarea |
| `POST` | `/api/v1/projects/:id/scheduled-tasks` | Crear tarea programada |
| `POST` | `/api/v1/scheduled-tasks/:id/approve` | Aprobar tarea propuesta |
| `POST` | `/api/v1/scheduled-tasks/:id/reject` | Rechazar tarea propuesta |
| `POST` | `/api/v1/scheduled-tasks/:id/pause` | Pausar tarea activa |
| `POST` | `/api/v1/scheduled-tasks/:id/resume` | Reanudar tarea pausada |
| `GET` | `/api/v1/scheduled-tasks/:id/runs` | Historial de ejecuciones |
| **Aprobaciones** | | |
| `GET` | `/api/v1/approvals` | Aprobaciones pendientes |
| `POST` | `/api/v1/approvals/:id/approve` | Aprobar acción |
| `POST` | `/api/v1/approvals/:id/deny` | Rechazar acción |
| **Observabilidad** | | |
| `GET` | `/api/v1/projects/:id/usage` | Consumo y costos |
| `GET` | `/api/v1/projects/:id/traces` | Execution traces |
| `GET` | `/api/v1/traces/:id` | Detalle de trace |
| **WebSocket** | | |
| `WS` | `/ws` | WebSocket para chat en tiempo real |