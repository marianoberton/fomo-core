/**
 * Shared types for approval notifiers.
 *
 * Two notifier transports (Telegram + in-app) consume the same enriched
 * context so operators see the same information on phone and dashboard.
 */
import type { ApprovalRequest } from '@/security/types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Enriched Context ──────────────────────────────────────────

/**
 * Approval + human-readable context assembled from repositories.
 *
 * Built once per approval and reused by every notifier so we hit the
 * DB a single time per approval regardless of how many transports fire.
 */
export interface ApprovalNotificationContext {
  approvalId: string;
  projectId: ProjectId;
  projectName: string;
  agentId: string | null;
  agentName: string;
  /** Lead display name (contact.name or fallback). */
  leadName: string;
  /** Lead phone or email, whichever is available. */
  leadContact: string | null;
  contactId: string | null;
  sessionId: string;
  /** Human-readable summary of what the agent wants to do. */
  actionSummary: string;
  /** Raw tool id — useful for dashboard filters. */
  toolId: string;
  /** Raw tool input — full payload, for dashboard detail view only. */
  toolInput: Record<string, unknown>;
  /** i18n'd risk label for notifications ("Alto" / "Crítico"). */
  riskLabel: string;
  riskLevel: 'high' | 'critical';
  requestedAt: Date;
}

/** Minimal payload persisted on in_app_notifications.payload. */
export interface InAppApprovalPayload {
  approvalId: string;
  agentName: string;
  leadName: string;
  leadContact: string | null;
  actionSummary: string;
  riskLevel: 'high' | 'critical';
  toolId: string;
}

/**
 * A notifier consumes an enriched context (not the raw ApprovalRequest) so
 * each transport renders consistent information.
 *
 * Notifiers must NEVER throw — they wrap their own errors internally. The
 * composite notifier runs them in parallel and ignores individual failures.
 */
export type ApprovalContextNotifier = (
  context: ApprovalNotificationContext,
  raw: ApprovalRequest,
) => Promise<void>;
