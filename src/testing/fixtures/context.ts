/**
 * Factory for creating test ExecutionContext instances.
 */
import type { ExecutionContext, ProjectId, SessionId, TraceId, AgentConfig } from '@/core/types.js';

/** Create a minimal AgentConfig for tests. */
export function createTestAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    projectId: 'test-project' as ProjectId,
    agentRole: 'assistant',
    provider: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    },
    failover: {
      onRateLimit: true,
      onServerError: true,
      onTimeout: true,
      timeoutMs: 30_000,
      maxRetries: 2,
    },
    allowedTools: ['echo', 'search'],
    memoryConfig: {
      longTerm: {
        enabled: false,
        maxEntries: 100,
        retrievalTopK: 5,
        embeddingProvider: 'anthropic',
        decayEnabled: false,
        decayHalfLifeDays: 30,
      },
      contextWindow: {
        reserveTokens: 2000,
        pruningStrategy: 'turn-based',
        maxTurnsInContext: 20,
        compaction: {
          enabled: false,
          memoryFlushBeforeCompaction: false,
        },
      },
    },
    costConfig: {
      dailyBudgetUSD: 10,
      monthlyBudgetUSD: 100,
      maxTokensPerTurn: 4096,
      maxTurnsPerSession: 50,
      maxToolCallsPerTurn: 10,
      alertThresholdPercent: 80,
      hardLimitPercent: 100,
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000,
    },
    maxTurnsPerSession: 50,
    maxConcurrentSessions: 5,
    ...overrides,
  };
}

/** Create a minimal ExecutionContext for tests. */
export function createTestContext(overrides?: {
  projectId?: string;
  sessionId?: string;
  traceId?: string;
  allowedTools?: string[];
}): ExecutionContext {
  const allowedTools = overrides?.allowedTools ?? ['echo', 'search'];
  return {
    projectId: (overrides?.projectId ?? 'test-project') as ProjectId,
    sessionId: (overrides?.sessionId ?? 'test-session') as SessionId,
    traceId: (overrides?.traceId ?? 'test-trace') as TraceId,
    agentConfig: createTestAgentConfig(),
    permissions: {
      allowedTools: new Set(allowedTools),
    },
    abortSignal: AbortSignal.timeout(30_000),
  };
}
