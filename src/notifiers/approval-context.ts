/**
 * Build an enriched notification context from a raw ApprovalRequest.
 *
 * Runs a single Prisma query joining session → project + agent + contact
 * so every notifier transport can render the same information without
 * triggering its own round of lookups.
 */
import type { PrismaClient } from '@prisma/client';
import type { ApprovalRequest } from '@/security/types.js';
import type { ProjectId } from '@/core/types.js';
import type { ApprovalNotificationContext } from './types.js';

// ─── Risk Label ────────────────────────────────────────────────

const RISK_LABELS: Record<'high' | 'critical', string> = {
  high: 'Alto',
  critical: 'Crítico',
};

// ─── Action Summary ────────────────────────────────────────────

/**
 * Human-readable description of what the agent wants to do.
 *
 * Falls back to the raw tool id when no friendly mapping exists — the
 * dashboard detail view always shows the full tool input so the operator
 * can still decide with full information.
 */
const ACTION_SUMMARIES: Record<string, string> = {
  'send-channel-message': 'Enviar mensaje al cliente',
  'send-email': 'Enviar email',
  'send-notification': 'Enviar notificación',
  'trigger-campaign': 'Disparar campaña',
  'waha-send-message': 'Enviar WhatsApp',
  'notify-owner': 'Notificar al dueño',
  'notify-slack': 'Notificar a Slack',
  'twenty-update': 'Actualizar registro en CRM',
  'twenty-upsert': 'Crear/actualizar registro en CRM',
  'mp-create-payment-link': 'Generar link de pago',
  'odoo-register-payment': 'Registrar pago en Odoo',
  'escalate-to-human': 'Escalar a humano',
};

function summarizeAction(toolId: string): string {
  return ACTION_SUMMARIES[toolId] ?? toolId;
}

// ─── Context Builder ───────────────────────────────────────────

/**
 * Build an enriched context for an approval request.
 *
 * Always succeeds — falls back to sensible placeholders when related
 * rows (contact, agent) are missing so notifications still fire even
 * for sessions without a contact attached.
 */
export async function buildApprovalContext(
  prisma: PrismaClient,
  request: ApprovalRequest,
): Promise<ApprovalNotificationContext> {
  const session = await prisma.session.findUnique({
    where: { id: request.sessionId },
    include: {
      contact: true,
      agent: { select: { id: true, name: true } },
      project: { select: { name: true } },
    },
  });

  const agentName = session?.agent?.name ?? 'Agente';
  const agentId = session?.agent?.id ?? null;
  const projectName = session?.project.name ?? 'Proyecto';
  const contact = session?.contact ?? null;

  const leadName = contact?.displayName ?? contact?.name ?? 'Lead sin nombre';
  const leadContact = contact?.phone ?? contact?.email ?? null;

  return {
    approvalId: request.id,
    projectId: request.projectId as ProjectId,
    projectName,
    agentId,
    agentName,
    leadName,
    leadContact,
    contactId: contact?.id ?? null,
    sessionId: request.sessionId,
    actionSummary: summarizeAction(request.toolId),
    toolId: request.toolId,
    toolInput: request.toolInput,
    riskLabel: RISK_LABELS[request.riskLevel],
    riskLevel: request.riskLevel,
    requestedAt: request.requestedAt,
  };
}
