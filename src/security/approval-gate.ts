/**
 * ApprovalGate — pauses execution of high/critical risk tools until human approval.
 * Uses an in-memory store by default; can be backed by the DB ApprovalRequest table.
 */
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import { nanoid } from 'nanoid';
import type { ApprovalConfig, ApprovalRequest, ApprovalStatus, ApprovalStore } from './types.js';

const logger = createLogger({ name: 'approval-gate' });

/** Callback notified when an approval is requested. */
export type ApprovalNotifier = (request: ApprovalRequest) => Promise<void>;

/** Callback for sending reminder notifications before timeout. */
export type ReminderNotifier = (approvalId: ApprovalId, minutesLeft: number) => Promise<void>;

export interface ApprovalGateOptions {
  /** How long approvals are valid before expiring (ms). Default: 5 minutes. */
  expirationMs?: number;
  /** Optional callback to notify humans of pending approvals. */
  notifier?: ApprovalNotifier;
  /** Optional injected store. Defaults to in-memory. */
  store?: ApprovalStore;
  /**
   * Timeout configuration for automatic resolution when no human responds.
   * Can be sourced from project.config at runtime.
   * If not set, approvals simply expire (no automatic action taken).
   */
  timeoutConfig?: ApprovalConfig;
  /**
   * Optional callback invoked when a reminder fires before timeout.
   * Use with createTelegramReminderSender or a custom implementation.
   */
  reminderNotifier?: ReminderNotifier;
  /**
   * Optional callback invoked when an approval is escalated due to timeout.
   * Receives the full ApprovalRequest for external routing.
   */
  onEscalate?: (request: ApprovalRequest) => Promise<void>;
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
   * List all approvals across all projects.
   */
  listAll(): Promise<ApprovalRequest[]>;

  /**
   * Check if a specific approval has been granted.
   * Also checks for expiration.
   */
  isApproved(approvalId: ApprovalId): Promise<boolean>;

  /**
   * Start a periodic sweeper that resolves stale pending approvals.
   *
   * This is the restart-safe complement to the in-memory timers.
   * After a process restart the timers are lost, but the sweeper will
   * pick up any pending approvals whose timeout has elapsed and execute
   * the configured timeout policy (auto-approve / auto-deny / escalate).
   */
  startSweeper(intervalMs?: number): void;

  /** Stop the periodic sweeper. */
  stopSweeper(): void;
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

    listAll(): Promise<ApprovalRequest[]> {
      return Promise.resolve([...requests.values()]);
    },
  };
}

/**
 * Create an ApprovalGate instance.
 */
export function createApprovalGate(options?: ApprovalGateOptions): ApprovalGate {
  const expirationMs = options?.expirationMs ?? 5 * 60 * 1000;
  const store = options?.store ?? createInMemoryApprovalStore();
  const timeoutConfig = options?.timeoutConfig;
  const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

  // ─── Timer tracking (in-memory only — not persisted across restarts) ──
  // The startSweeper() method acts as a restart-safe complement: it scans
  // the store periodically and resolves any stale pending approvals whose
  // timeout has elapsed, covering the gap left by lost in-memory timers.
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
  let sweeperTimer: ReturnType<typeof setInterval> | null = null;

  function cancelTimers(approvalId: ApprovalId): void {
    const timers = pendingTimers.get(approvalId);
    if (timers) {
      for (const t of timers) clearTimeout(t);
      pendingTimers.delete(approvalId);
    }
  }

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

  async function handleTimeout(approvalId: ApprovalId): Promise<void> {
    if (!timeoutConfig) return;

    const current = await store.get(approvalId);
    if (current?.status !== 'pending') {
      // Already resolved — nothing to do
      return;
    }

    cancelTimers(approvalId);

    const { onTimeout, escalateTo } = timeoutConfig;

    if (onTimeout === 'auto-approve') {
      const resolved: ApprovalRequest = {
        ...current,
        status: 'approved',
        resolvedAt: new Date(),
        resolvedBy: 'system:timeout',
        resolutionNote: 'Auto-approved by timeout policy',
      };
      await store.update(approvalId, resolved);
      logger.warn('Approval AUTO-APPROVED by timeout policy', {
        component: 'approval-gate',
        approvalId,
        toolId: current.toolId,
        projectId: current.projectId,
        timeoutMs: timeoutConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } else if (onTimeout === 'auto-deny') {
      const resolved: ApprovalRequest = {
        ...current,
        status: 'denied',
        resolvedAt: new Date(),
        resolvedBy: 'system:timeout',
        resolutionNote: 'Auto-denied by timeout policy',
      };
      await store.update(approvalId, resolved);
      logger.warn('Approval AUTO-DENIED by timeout policy', {
        component: 'approval-gate',
        approvalId,
        toolId: current.toolId,
        projectId: current.projectId,
        timeoutMs: timeoutConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } else {
      const resolved: ApprovalRequest = {
        ...current,
        status: 'denied',
        resolvedAt: new Date(),
        resolvedBy: 'system:timeout',
        resolutionNote: `Escalated due to timeout${escalateTo ? ` → ${escalateTo}` : ''}`,
      };
      await store.update(approvalId, resolved);
      logger.warn('Approval ESCALATED due to timeout', {
        component: 'approval-gate',
        approvalId,
        toolId: current.toolId,
        projectId: current.projectId,
        escalateTo,
        timeoutMs: timeoutConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      // Emit escalation event via optional callback
      if (options.onEscalate) {
        await options.onEscalate(resolved).catch((err: unknown) => {
          logger.error('onEscalate callback failed', {
            component: 'approval-gate',
            approvalId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  }

  function scheduleTimers(request: ApprovalRequest): void {
    if (!timeoutConfig) return;

    const timeoutMs = timeoutConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Reminder timer
    if (timeoutConfig.reminderMs !== undefined && timeoutConfig.reminderMs < timeoutMs) {
      const reminderDelay = timeoutMs - timeoutConfig.reminderMs;
      const minutesLeft = Math.round(timeoutConfig.reminderMs / 60_000);
      const reminderTimer = setTimeout(() => {
        if (options.reminderNotifier) {
          options.reminderNotifier(request.id, minutesLeft).catch((err: unknown) => {
            logger.error('reminderNotifier failed', {
              component: 'approval-gate',
              approvalId: request.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }, reminderDelay);
      timers.push(reminderTimer);
    }

    // Timeout timer
    const timeoutTimer = setTimeout(() => {
      handleTimeout(request.id).catch((err: unknown) => {
        logger.error('handleTimeout failed', {
          component: 'approval-gate',
          approvalId: request.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, timeoutMs);
    timers.push(timeoutTimer);

    pendingTimers.set(request.id, timers);
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

      // Start timeout/reminder timers after notifier fires
      scheduleTimers(request);

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

      // Cancel pending timers before resolving
      cancelTimers(approvalId);

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

    async listAll(): Promise<ApprovalRequest[]> {
      const all = await store.listAll();
      return all.map(checkExpiration);
    },

    async isApproved(approvalId: ApprovalId): Promise<boolean> {
      const checked = await getAndCheckExpiration(approvalId);
      if (!checked) return false;
      return checked.status === 'approved';
    },

    // ─── Periodic Sweeper ─────────────────────────────────────────
    // Scans the store for pending approvals whose timeout has elapsed
    // and executes the timeout policy.  This ensures that approvals
    // are resolved even if the process was restarted (in-memory timers lost).

    startSweeper(intervalMs = 60_000): void {
      if (sweeperTimer) return; // already running

      const sweep = async (): Promise<void> => {
        if (!timeoutConfig) return; // nothing to enforce

        try {
          const all = await store.listAll();
          const now = new Date();
          const timeoutMs = timeoutConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

          for (const request of all) {
            if (request.status !== 'pending') continue;

            const elapsed = now.getTime() - request.requestedAt.getTime();
            if (elapsed < timeoutMs) continue;

            // Skip if an in-memory timer is still active for this approval
            if (pendingTimers.has(request.id)) continue;

            logger.info('Sweeper resolving stale approval', {
              component: 'approval-gate',
              approvalId: request.id,
              toolId: request.toolId,
              elapsedMs: elapsed,
            });

            await handleTimeout(request.id);
          }
        } catch (error) {
          logger.error('Approval sweeper failed', {
            component: 'approval-gate',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      sweeperTimer = setInterval(() => {
        void sweep();
      }, intervalMs);

      // Don't prevent Node from exiting
      if (typeof sweeperTimer === 'object' && 'unref' in sweeperTimer) {
        sweeperTimer.unref();
      }

      logger.info('Approval sweeper started', {
        component: 'approval-gate',
        intervalMs,
      });
    },

    stopSweeper(): void {
      if (sweeperTimer) {
        clearInterval(sweeperTimer);
        sweeperTimer = null;
        logger.info('Approval sweeper stopped', { component: 'approval-gate' });
      }
    },
  };
}
