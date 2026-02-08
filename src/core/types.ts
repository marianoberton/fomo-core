// ─── Branded ID Types ────────────────────────────────────────────
// Branded types prevent accidentally passing a SessionId where a ProjectId is expected.

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type TraceId = Brand<string, 'TraceId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type PromptLayerId = Brand<string, 'PromptLayerId'>;
export type UsageRecordId = Brand<string, 'UsageRecordId'>;
export type ScheduledTaskId = Brand<string, 'ScheduledTaskId'>;
export type ScheduledTaskRunId = Brand<string, 'ScheduledTaskRunId'>;

// ─── LLM Provider Config ────────────────────────────────────────

export interface LLMProviderConfig {
  /** Provider identifier. */
  provider: 'anthropic' | 'openai' | 'google' | 'ollama';
  /** Model identifier (e.g. 'claude-sonnet-4-5-20250929', 'gpt-4o'). */
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** References an env var name, never the raw key. */
  apiKeyEnvVar?: string;
  /** Custom base URL for self-hosted providers (e.g. Ollama). */
  baseUrl?: string;
}

// ─── Failover Config ────────────────────────────────────────────

export interface FailoverConfig {
  onRateLimit: boolean;
  onServerError: boolean;
  onTimeout: boolean;
  timeoutMs: number;
  maxRetries: number;
}

// ─── Memory Config ──────────────────────────────────────────────

export interface MemoryConfig {
  longTerm: {
    enabled: boolean;
    maxEntries: number;
    retrievalTopK: number;
    embeddingProvider: string;
    decayEnabled: boolean;
    decayHalfLifeDays: number;
  };
  contextWindow: {
    reserveTokens: number;
    pruningStrategy: 'turn-based' | 'token-based';
    maxTurnsInContext: number;
    compaction: {
      enabled: boolean;
      memoryFlushBeforeCompaction: boolean;
    };
  };
}

// ─── Cost Config ────────────────────────────────────────────────

export interface CostConfig {
  dailyBudgetUSD: number;
  monthlyBudgetUSD: number;
  maxTokensPerTurn: number;
  maxTurnsPerSession: number;
  maxToolCallsPerTurn: number;
  alertThresholdPercent: number;
  hardLimitPercent: number;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
}

// ─── Agent Config ───────────────────────────────────────────────

export interface AgentConfig {
  projectId: ProjectId;
  agentRole: string;

  /** Primary LLM provider. */
  provider: LLMProviderConfig;
  /** Failover LLM provider (optional). */
  fallbackProvider?: LLMProviderConfig;
  failover: FailoverConfig;

  /** Whitelist of tool IDs this agent can use. */
  allowedTools: string[];

  memoryConfig: MemoryConfig;
  costConfig: CostConfig;

  maxTurnsPerSession: number;
  maxConcurrentSessions: number;
}

// ─── Execution Context ──────────────────────────────────────────

export interface ExecutionContext {
  projectId: ProjectId;
  sessionId: SessionId;
  traceId: TraceId;
  agentConfig: AgentConfig;
  permissions: {
    allowedTools: ReadonlySet<string>;
  };
  abortSignal: AbortSignal;
}

// ─── Trace Events ───────────────────────────────────────────────

export type TraceEventType =
  | 'llm_request'
  | 'llm_response'
  | 'tool_call'
  | 'tool_result'
  | 'tool_blocked'
  | 'tool_hallucination'
  | 'approval_requested'
  | 'approval_resolved'
  | 'memory_retrieval'
  | 'memory_store'
  | 'compaction'
  | 'error'
  | 'cost_check'
  | 'cost_alert'
  | 'failover';

export interface TraceEvent {
  id: string;
  traceId: TraceId;
  type: TraceEventType;
  timestamp: Date;
  durationMs?: number;
  data: Record<string, unknown>;
  parentEventId?: string;
}

export type ExecutionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'budget_exceeded'
  | 'max_turns'
  | 'human_approval_pending'
  | 'aborted';

// ─── Prompt Snapshot ───────────────────────────────────────────

/**
 * Records which combination of prompt layers was used in an execution.
 * Stored as JSON in ExecutionTrace for audit & performance correlation.
 */
export interface PromptSnapshot {
  identityLayerId: PromptLayerId;
  identityVersion: number;
  instructionsLayerId: PromptLayerId;
  instructionsVersion: number;
  safetyLayerId: PromptLayerId;
  safetyVersion: number;
  /** SHA-256 hash of the generated tool docs section. */
  toolDocsHash: string;
  /** SHA-256 hash of the runtime context section. */
  runtimeContextHash: string;
}

// ─── Execution Trace ───────────────────────────────────────────

export interface ExecutionTrace {
  id: TraceId;
  projectId: ProjectId;
  sessionId: SessionId;
  /** Snapshot of the prompt layer versions used in this execution. */
  promptSnapshot: PromptSnapshot;
  events: TraceEvent[];
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUSD: number;
  turnCount: number;
  status: ExecutionStatus;
  createdAt: Date;
  completedAt?: Date;
}
