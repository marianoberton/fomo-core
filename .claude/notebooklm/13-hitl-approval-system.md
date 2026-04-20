# HITL Approval System - Timeout + Telegram Notifier

## Overview

El sistema de Human-in-the-Loop (HITL) de Nexus Core controla la ejecucion de herramientas de alto riesgo. Cuando un agente quiere ejecutar un tool con `riskLevel: 'high'` o `'critical'`, el ApprovalGate pausa la ejecucion y espera aprobacion humana. Si nadie responde a tiempo, se aplica una accion automatica configurable.

## Ubicacion

```
src/security/
  approval-gate.ts       # ApprovalGate factory + in-memory store
  prisma-approval-store.ts  # Persistent store backed by Prisma
  types.ts               # ApprovalRequest, ApprovalConfig, ApprovalStatus
```

## Risk Levels de tools

| Level | Aprobacion | Ejemplo |
|-------|-----------|---------|
| `low` | Automatica, sin intervencion | calculator, date-time |
| `medium` | Automatica, loggeada | create-twenty-lead, send-email |
| `high` | Requiere aprobacion humana | http-request con URLs externas |
| `critical` | Requiere aprobacion humana + nota | operaciones destructivas |

## ApprovalGate

### Interface
```typescript
interface ApprovalGate {
  requestApproval(params): Promise<ApprovalRequest>;
  resolve(approvalId, decision, resolvedBy, note?): Promise<ApprovalRequest | null>;
  get(approvalId): Promise<ApprovalRequest | undefined>;
  listPending(projectId): Promise<ApprovalRequest[]>;
  listAll(): Promise<ApprovalRequest[]>;
  isApproved(approvalId): Promise<boolean>;
}
```

### ApprovalRequest
```typescript
interface ApprovalRequest {
  id: ApprovalId;
  projectId: ProjectId;
  sessionId: SessionId;
  toolCallId: ToolCallId;
  toolId: string;
  toolInput: Record<string, unknown>;
  riskLevel: 'high' | 'critical';
  status: ApprovalStatus;  // pending | approved | denied | expired | escalated
  resolvedBy?: string;
  resolvedAt?: Date;
  note?: string;
  expiresAt: Date;
}
```

## Timeout Configuration

Configurable por proyecto en `project.config`:

```typescript
interface ApprovalConfig {
  timeoutMs?: number;           // default 600_000 (10 min)
  timeoutAction: 'deny' | 'approve' | 'escalate';
  reminderBeforeTimeoutMs?: number;  // ej: 120_000 (2 min antes)
}
```

### Acciones de timeout

| Accion | Que pasa |
|--------|----------|
| `deny` | Se rechaza automaticamente. El agente recibe error y busca alternativa. |
| `approve` | Se aprueba automaticamente. SOLO para riesgo "high", nunca "critical". |
| `escalate` | Se marca como "escalated" y se notifica a un canal superior. |

### Flujo con timeout

1. Tool de riesgo alto/critico se invoca
2. ApprovalGate crea ApprovalRequest (status: pending)
3. Se notifica al humano (notifier callback)
4. Se programa timer de reminder (N minutos antes del timeout)
5. Se programa timer de timeout
6. Si el humano responde antes -> resolve(approved/denied)
7. Si no responde -> handleTimeout() ejecuta timeoutAction

## Telegram Reminder Notifier

### createTelegramReminderSender(botToken, chatId)
Factory que crea un `ReminderNotifier` para enviar recordatorios via Telegram.

- Recibe `approvalId` y `minutesLeft`
- Envia mensaje al chat configurado con botones inline de Aprobar/Rechazar
- Usa la Telegram Bot API directamente (fetch)

### Ejemplo de mensaje
```
⚠️ Aprobacion pendiente

Tool: http-request
Proyecto: market-paper
Quedan 2 minutos para timeout (accion: deny)

[Aprobar] [Rechazar]
```

## Integracion con el Agent Runner

1. `agent-runner.ts` revisa `tool.riskLevel` antes de ejecutar
2. Si es high/critical y `tool.requiresApproval === true`:
   a. Llama a `approvalGate.requestApproval()`
   b. Llama a `notifier()` si esta configurado
   c. Pausa la ejecucion del turno
   d. El loop de agente espera la resolucion
3. Cuando se resuelve:
   - approved -> continua con execute()
   - denied/expired/escalated -> retorna error al agente

## API Endpoints

- `GET /api/v1/approvals` - listar aprobaciones pendientes
- `POST /api/v1/approvals/:id/resolve` - aprobar o rechazar
- `GET /api/v1/approvals/:id` - detalle de una aprobacion

## Dashboard

La pagina de aprobaciones muestra:
- Lista de pendientes con countdown
- Historial de aprobaciones resueltas
- Boton rapido para aprobar/rechazar
- Vista de detalle con el input del tool
