/**
 * ApprovalGate — pauses execution of high/critical risk tools until human approval.
 * Uses an in-memory store by default; can be backed by the DB ApprovalRequest table.
 */
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import { nanoid } from 'nanoid';
import type { ApprovalRequest, ApprovalStatus, ApprovalStore } from './types.js';

const logger = createLogger({ name: 'approval-gate' });

/** Callback notified when an approval is requested. */
export type ApprovalNotifier = (request: ApprovalRequest) => Promise<void>;

export interface ApprovalGateOptions {
  /** How long approvals are valid before expiring (ms). Default: 5 minutes. */
  expirationMs?: number;
  /** Optional callback to notify humans of pending approvals. */
  notifier?: ApprovalNotifier;
  /** Optional injected store. Defaults to in-memory. */
  store?: ApprovalStore;
}

export interface ApprovalGate {
  /**
   * Request approval for a tool execution.
   * Returns the ApprovalRequest record (initially 'pending').
   */
  requestApproval(params: {
    projectId: ProjectId;
    sessionId: SessionId;
    toolCallId: ToolCallId;
    toolId: string;
    toolInput: Record<string, unknown>;
    riskLevel: 'high' | 'critical';
  }): Promise<ApprovalRequest>;

  /**
   * Resolve an approval (approve or deny).
   */
  resolve(
    approvalId: ApprovalId,
    decision: 'approved' | 'denied',
    resolvedBy: string,
    note?: string,
  ): Promise<ApprovalRequest | null>;

  /**
   * Get an approval request by ID.
   */
  get(approvalId: ApprovalId): Promise<ApprovalRequest | undefined>;

  /**
   * List pending approvals for a project.
   */
  listPending(projectId: ProjectId): Promise<ApprovalRequest[]>;

  /**
   * Check if a specific approval has been granted.
   * Also checks for expiration.
   */
  isApproved(approvalId: ApprovalId): Promise<boolean>;
}

/**
 * Create an in-memory ApprovalStore for testing and development.
 */
export function createInMemoryApprovalStore(): ApprovalStore {
  const requests = new Map<string, ApprovalRequest>();

  return {
    create(request: ApprovalRequest): Promise<void> {
      requests.set(request.id, request);
      return Promise.resolve();
    },

    get(id: ApprovalId): Promise<ApprovalRequest | undefined> {
      return Promise.resolve(requests.get(id));
    },

    update(_id: ApprovalId, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest | null> {
      const idToUpdate = updates.id ?? _id;
      const existing = requests.get(idToUpdate);
      if (!existing) return Promise.resolve(null);
      const updated: ApprovalRequest = { ...existing, ...updates };
      requests.set(idToUpdate, updated);
      return Promise.resolve(updated);
    },

    listPending(projectId: ProjectId): Promise<ApprovalRequest[]> {
      return Promise.resolve(
        [...requests.values()].filter(
          (r) => r.projectId === projectId && r.status === 'pending',
        ),
      );
    },
  };
}

/**
 * Create an ApprovalGate instance.
 */
export function createApprovalGate(options?: ApprovalGateOptions): ApprovalGate {
  const expirationMs = options?.expirationMs ?? 5 * 60 * 1000;
  const store = options?.store ?? createInMemoryApprovalStore();

  function checkExpiration(request: ApprovalRequest): ApprovalRequest {
    if (request.status === 'pending' && new Date() >= request.expiresAt) {
      return { ...request, status: 'expired' };
    }
    return request;
  }

  async function getAndCheckExpiration(approvalId: ApprovalId): Promise<ApprovalRequest | undefined> {
    const request = await store.get(approvalId);
    if (!request) return undefined;
    const checked = checkExpiration(request);
    // Persist expiration if status changed
    if (checked.status !== request.status) {
      await store.update(approvalId, checked);
    }
    return checked;
  }

  return {
    async requestApproval(params): Promise<ApprovalRequest> {
      const id = `appr_${nanoid()}` as ApprovalId;
      const now = new Date();

      const request: ApprovalRequest = {
        id,
        projectId: params.projectId,
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
        toolId: params.toolId,
        toolInput: params.toolInput,
        riskLevel: params.riskLevel,
        status: 'pending',
        requestedAt: now,
        expiresAt: new Date(now.getTime() + expirationMs),
      };

      await store.create(request);

      logger.info('Approval requested', {
        component: 'approval-gate',
        approvalId: id,
        toolId: params.toolId,
        riskLevel: params.riskLevel,
        projectId: params.projectId,
      });

      if (options?.notifier) {
        await options.notifier(request);
      }

      return request;
    },

    async resolve(
      approvalId: ApprovalId,
      decision: 'approved' | 'denied',
      resolvedBy: string,
      note?: string,
    ): Promise<ApprovalRequest | null> {
      const checked = await getAndCheckExpiration(approvalId);
      if (!checked) return null;

      if (checked.status !== 'pending') {
        logger.warn('Attempted to resolve non-pending approval', {
          component: 'approval-gate',
          approvalId,
          currentStatus: checked.status,
        });
        return checked;
      }

      const resolved: ApprovalRequest = {
        ...checked,
        status: decision as ApprovalStatus,
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNote: note,
      };

      const result = await store.update(approvalId, resolved);

      logger.info('Approval resolved', {
        component: 'approval-gate',
        approvalId,
        decision,
        resolvedBy,
        toolId: resolved.toolId,
      });

      return result;
    },

    async get(approvalId: ApprovalId): Promise<ApprovalRequest | undefined> {
      return getAndCheckExpiration(approvalId);
    },

    async listPending(projectId: ProjectId): Promise<ApprovalRequest[]> {
      const pending = await store.listPending(projectId);
      return pending.map(checkExpiration).filter((r) => r.status === 'pending');
    },

    async isApproved(approvalId: ApprovalId): Promise<boolean> {
      const checked = await getAndCheckExpiration(approvalId);
      if (!checked) return false;
      return checked.status === 'approved';
    },
  };
}
