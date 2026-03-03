import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';

// ─── Approval Status ────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

// ─── Approval Timeout Config ────────────────────────────────────

/**
 * Configuration for automatic timeout handling when a human doesn't respond.
 *
 * NOTE: Timers are in-memory only. If the process restarts while an approval
 * is pending, the timeout will NOT fire — the approval will simply expire
 * (via expiresAt) on next access, but no automatic action will be taken.
 * For persistent timeout enforcement, a background job checking expiresAt
 * would be needed (not yet implemented).
 */
export interface ApprovalConfig {
  /** How long to wait for human response before auto-acting. Default: 10 minutes (600_000 ms). */
  timeoutMs?: number;
  /** Action to take when timeout fires. */
  onTimeout: 'auto-approve' | 'auto-deny' | 'escalate';
  /** Additional channel/chat to notify when onTimeout === 'escalate'. */
  escalateTo?: string;
  /** If set, send a reminder notification this many ms before timeout expires. */
  reminderMs?: number;
}

// ─── Approval Request ───────────────────────────────────────────

export interface ApprovalRequest {
  id: ApprovalId;
  projectId: ProjectId;
  sessionId: SessionId;
  toolCallId: ToolCallId;
  toolId: string;
  toolInput: Record<string, unknown>;
  riskLevel: 'high' | 'critical';
  status: ApprovalStatus;
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
}

// ─── Approval Store ─────────────────────────────────────────────

/** Storage interface for ApprovalRequests. Allows swapping in-memory vs Prisma. */
export interface ApprovalStore {
  /** Persist a new approval request. */
  create(request: ApprovalRequest): Promise<void>;
  /** Retrieve an approval request by ID. */
  get(id: ApprovalId): Promise<ApprovalRequest | undefined>;
  /** Update fields on an existing approval request. Returns the updated record, or null if not found. */
  update(id: ApprovalId, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest | null>;
  /** List pending approval requests for a project. */
  listPending(projectId: ProjectId): Promise<ApprovalRequest[]>;
  /** List all approval requests across all projects. */
  listAll(): Promise<ApprovalRequest[]>;
}

// ─── RBAC Context ───────────────────────────────────────────────

export interface RBACContext {
  projectId: ProjectId;
  allowedTools: ReadonlySet<string>;
}
