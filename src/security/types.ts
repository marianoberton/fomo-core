import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';

// ─── Approval Status ────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

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
