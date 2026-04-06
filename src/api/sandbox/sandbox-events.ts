/**
 * Sandbox Events — Server-to-client event types for the optimization sandbox.
 *
 * Extends AgentStreamEvent with sandbox-specific events for config updates,
 * comparisons, and promotions.
 */
import type { AgentStreamEvent } from '@/core/stream-events.js';

// ─── Run Metrics ────────────────────────────────────────────────

/** Metrics captured from a single agent run, used for comparison. */
export interface RunMetrics {
  readonly traceId: string;
  readonly totalTokens: number;
  readonly costUSD: number;
  readonly responseLength: number;
  readonly toolCallCount: number;
  readonly durationMs: number;
  readonly response: string;
}

/** Delta between two run metrics. */
export interface MetricsDiff {
  readonly tokensDelta: number;
  readonly costDelta: number;
  readonly responseLengthDelta: number;
  readonly toolCallCountDelta: number;
  readonly durationDelta: number;
  readonly costPctChange: number;
  readonly tokensPctChange: number;
}

// ─── Sandbox-Specific Events ────────────────────────────────────

/** Sandbox initialized — includes current agent config and available tools. */
export interface SandboxReadyEvent {
  readonly type: 'sandbox_ready';
  readonly sandboxId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly promptLayers: {
    readonly identity: { content: string; version: number };
    readonly instructions: { content: string; version: number };
    readonly safety: { content: string; version: number };
  };
  readonly llmConfig: {
    readonly provider?: string;
    readonly model?: string;
    readonly temperature?: number;
  };
  readonly availableTools: string[];
  readonly testMode: boolean;
}

/** Confirms that a config override was applied in this sandbox session. */
export interface ConfigUpdatedEvent {
  readonly type: 'config_updated';
  readonly changes: Record<string, unknown>;
}

/** Confirms that a prompt override was applied in this sandbox session. */
export interface PromptUpdatedEvent {
  readonly type: 'prompt_updated';
  readonly layerType: 'identity' | 'instructions' | 'safety';
  readonly contentLength: number;
}

/** Side-by-side comparison of metrics from a replay. */
export interface ComparisonEvent {
  readonly type: 'comparison';
  readonly before: RunMetrics;
  readonly after: RunMetrics;
  readonly diff: MetricsDiff;
}

/** Confirms that sandbox changes were promoted to production. */
export interface PromotedEvent {
  readonly type: 'promoted';
  readonly what: string;
  readonly changes: {
    readonly promptLayersCreated?: string[];
    readonly agentConfigUpdated?: boolean;
    readonly toolAllowlistUpdated?: boolean;
  };
}

/** Full sandbox conversation history and config change log. */
export interface SandboxHistoryEvent {
  readonly type: 'sandbox_history';
  readonly messages: ReadonlyArray<{
    role: string;
    content: string;
    traceId?: string;
    timestamp: string;
  }>;
  readonly configChanges: ReadonlyArray<{
    changeType: string;
    details: Record<string, unknown>;
    timestamp: string;
  }>;
}

/** Sandbox was reset to production config. */
export interface SandboxResetEvent {
  readonly type: 'sandbox_reset';
}

// ─── Union ──────────────────────────────────────────────────────

/** All events the sandbox can send to the client. */
export type SandboxStreamEvent =
  | AgentStreamEvent
  | SandboxReadyEvent
  | ConfigUpdatedEvent
  | PromptUpdatedEvent
  | ComparisonEvent
  | PromotedEvent
  | SandboxHistoryEvent
  | SandboxResetEvent;
