/**
 * OpenClaw Task Registry — In-memory tracking of agent task lifecycle.
 *
 * Tracks running, completed, failed, and cancelled tasks dispatched by
 * OpenClaw Manager. Provides abort support, event buffering, and status
 * queries for the orchestration API.
 *
 * Process-local (Map-backed). Can be swapped for Redis if scaling is needed.
 */
import type { AgentStreamEvent } from '@/core/stream-events.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'openclaw-task-registry' });

// ─── Types ──────────────────────────────────────────────────────

/** Status of a tracked task. */
export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** A tracked task entry. */
export interface TaskEntry {
  readonly taskId: string;
  readonly agentId: string;
  readonly projectId: string;
  status: TaskStatus;
  readonly callbackUrl?: string;
  readonly createdAt: Date;
  completedAt?: Date;
  result?: TaskResult;
  error?: string;
  readonly abortController: AbortController;
  /** Buffered stream events for mid-execution observation. */
  events: AgentStreamEvent[];
}

/** Result payload for a completed task. */
export interface TaskResult {
  readonly response: string;
  readonly traceId: string;
  readonly sessionId: string;
  readonly toolCalls?: ReadonlyArray<{
    toolId: string;
    input: Record<string, unknown>;
    result: unknown;
  }>;
  readonly usage: {
    readonly totalTokens: number;
    readonly costUSD: number;
  };
  readonly timestamp: string;
}

/** Public interface for the task registry. */
export interface TaskRegistry {
  /** Create a new running task entry. Returns the AbortController for the caller. */
  create(taskId: string, agentId: string, projectId: string, callbackUrl?: string): AbortController;
  /** Get a task entry by ID. */
  get(taskId: string): TaskEntry | undefined;
  /** Add a stream event to a running task's buffer. */
  addEvent(taskId: string, event: AgentStreamEvent): void;
  /** Mark a task as completed with its result. */
  complete(taskId: string, result: TaskResult): void;
  /** Mark a task as failed with an error message. */
  fail(taskId: string, error: string): void;
  /** Cancel a running task (aborts its execution). Returns true if cancelled. */
  cancel(taskId: string): boolean;
  /** List tasks filtered by status, agentId, and/or projectId. */
  list(filter?: { status?: TaskStatus; agentId?: string; projectId?: string }): TaskEntry[];
  /** Count active (running) tasks for a given agent. */
  countActive(agentId: string): number;
  /** Prune completed/failed/cancelled tasks older than maxAgeMs. Returns count pruned. */
  prune(maxAgeMs: number): number;
}

// ─── Factory ────────────────────────────────────────────────────

/** Maximum buffered events per task to prevent unbounded memory growth. */
const MAX_EVENTS_PER_TASK = 500;

/** Default prune interval: 10 minutes. */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/** Default max age for completed tasks: 1 hour. */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Create an in-memory task registry with automatic pruning.
 *
 * @param options - Optional configuration.
 * @returns A TaskRegistry instance.
 */
export function createTaskRegistry(options?: {
  pruneIntervalMs?: number;
  maxAgeMs?: number;
}): TaskRegistry & { shutdown: () => void } {
  const tasks = new Map<string, TaskEntry>();
  const maxAge = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  // Auto-prune timer
  const pruneTimer = setInterval(() => {
    const count = pruneEntries(maxAge);
    if (count > 0) {
      logger.debug('Pruned stale task entries', { component: 'openclaw-task-registry', count });
    }
  }, options?.pruneIntervalMs ?? PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  function pruneEntries(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    for (const [id, entry] of tasks) {
      if (entry.status !== 'running' && entry.completedAt && entry.completedAt.getTime() < cutoff) {
        tasks.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  return {
    create(taskId: string, agentId: string, projectId: string, callbackUrl?: string): AbortController {
      const abortController = new AbortController();
      const entry: TaskEntry = {
        taskId,
        agentId,
        projectId,
        status: 'running',
        callbackUrl,
        createdAt: new Date(),
        abortController,
        events: [],
      };
      tasks.set(taskId, entry);
      logger.info('Task created', { component: 'openclaw-task-registry', taskId, agentId });
      return abortController;
    },

    get(taskId: string): TaskEntry | undefined {
      return tasks.get(taskId);
    },

    addEvent(taskId: string, event: AgentStreamEvent): void {
      const entry = tasks.get(taskId);
      if (entry && entry.status === 'running' && entry.events.length < MAX_EVENTS_PER_TASK) {
        entry.events.push(event);
      }
    },

    complete(taskId: string, result: TaskResult): void {
      const entry = tasks.get(taskId);
      if (entry && entry.status === 'running') {
        entry.status = 'completed';
        entry.completedAt = new Date();
        entry.result = result;
        logger.info('Task completed', { component: 'openclaw-task-registry', taskId });
      }
    },

    fail(taskId: string, error: string): void {
      const entry = tasks.get(taskId);
      if (entry && entry.status === 'running') {
        entry.status = 'failed';
        entry.completedAt = new Date();
        entry.error = error;
        logger.warn('Task failed', { component: 'openclaw-task-registry', taskId, error });
      }
    },

    cancel(taskId: string): boolean {
      const entry = tasks.get(taskId);
      if (!entry || entry.status !== 'running') {
        return false;
      }
      entry.abortController.abort();
      entry.status = 'cancelled';
      entry.completedAt = new Date();
      logger.info('Task cancelled', { component: 'openclaw-task-registry', taskId });
      return true;
    },

    list(filter?: { status?: TaskStatus; agentId?: string; projectId?: string }): TaskEntry[] {
      const entries = [...tasks.values()];
      if (!filter) return entries;
      return entries.filter((e) => {
        if (filter.status && e.status !== filter.status) return false;
        if (filter.agentId && e.agentId !== filter.agentId) return false;
        if (filter.projectId && e.projectId !== filter.projectId) return false;
        return true;
      });
    },

    countActive(agentId: string): number {
      let count = 0;
      for (const entry of tasks.values()) {
        if (entry.agentId === agentId && entry.status === 'running') {
          count++;
        }
      }
      return count;
    },

    prune(maxAgeMs: number): number {
      return pruneEntries(maxAgeMs);
    },

    shutdown(): void {
      clearInterval(pruneTimer);
    },
  };
}
