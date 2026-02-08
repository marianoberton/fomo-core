/**
 * Scheduled Tasks — types for BullMQ-based task scheduling with agent proposals.
 *
 * Two origins:
 * - `static`: created by humans via API/config
 * - `agent_proposed`: proposed by agent tool, requires human approval to activate
 *
 * Only `active` tasks are eligible for execution.
 */
import type { ProjectId, ScheduledTaskId, ScheduledTaskRunId, TraceId } from '@/core/types.js';

// ─── Enums ──────────────────────────────────────────────────────

export type ScheduledTaskOrigin = 'static' | 'agent_proposed';

export type ScheduledTaskStatus =
  | 'proposed'
  | 'active'
  | 'paused'
  | 'rejected'
  | 'completed'
  | 'expired';

export type ScheduledTaskRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'budget_exceeded';

// ─── Task Payload ───────────────────────────────────────────────

/** The message/instruction the agent will receive when the task executes. */
export interface TaskPayload {
  /** The user message to send to the agent. */
  message: string;
  /** Optional metadata passed to the agent context. */
  metadata?: Record<string, unknown>;
}

// ─── Scheduled Task ─────────────────────────────────────────────

export interface ScheduledTask {
  id: ScheduledTaskId;
  projectId: ProjectId;
  name: string;
  description?: string;
  cronExpression: string;
  taskPayload: TaskPayload;
  origin: ScheduledTaskOrigin;
  status: ScheduledTaskStatus;
  proposedBy?: string;
  approvedBy?: string;
  maxRetries: number;
  timeoutMs: number;
  budgetPerRunUSD: number;
  maxDurationMinutes: number;
  maxTurns: number;
  maxRuns?: number;
  runCount: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Scheduled Task Run ─────────────────────────────────────────

export interface ScheduledTaskRun {
  id: ScheduledTaskRunId;
  taskId: ScheduledTaskId;
  status: ScheduledTaskRunStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  traceId?: TraceId;
  result?: Record<string, unknown>;
  errorMessage?: string;
  retryCount: number;
  createdAt: Date;
}

// ─── Create Inputs ──────────────────────────────────────────────

export interface ScheduledTaskCreateInput {
  projectId: ProjectId;
  name: string;
  description?: string;
  cronExpression: string;
  taskPayload: TaskPayload;
  origin: ScheduledTaskOrigin;
  /** For agent-proposed tasks, the agent/session that proposed it. */
  proposedBy?: string;
  maxRetries?: number;
  timeoutMs?: number;
  budgetPerRunUSD?: number;
  maxDurationMinutes?: number;
  maxTurns?: number;
  maxRuns?: number;
  expiresAt?: Date;
}

export interface ScheduledTaskRunCreateInput {
  taskId: ScheduledTaskId;
  traceId?: TraceId;
}
