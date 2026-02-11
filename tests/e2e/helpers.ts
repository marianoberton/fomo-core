/**
 * E2E test helpers.
 * Provides valid AgentConfig factories and seeding utilities.
 */
import { nanoid } from 'nanoid';
import type { ProjectId, AgentConfig } from '@/core/types.js';
import type { TestDatabase } from '@/testing/helpers/test-database.js';

/**
 * Create a valid AgentConfig for E2E tests.
 * Uses the correct shape matching the actual AgentConfig interface.
 */
export function createE2EAgentConfig(
  projectId: ProjectId,
  overrides?: Partial<AgentConfig>,
): AgentConfig {
  return {
    projectId,
    agentRole: 'assistant',
    provider: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyEnvVar: 'OPENAI_API_KEY',
    },
    failover: {
      onRateLimit: false,
      onServerError: false,
      onTimeout: false,
      timeoutMs: 30_000,
      maxRetries: 0,
    },
    allowedTools: ['calculator', 'date-time', 'json-transform'],
    memoryConfig: {
      longTerm: {
        enabled: false,
        maxEntries: 100,
        retrievalTopK: 5,
        embeddingProvider: 'openai',
        decayEnabled: false,
        decayHalfLifeDays: 7,
      },
      contextWindow: {
        reserveTokens: 1000,
        pruningStrategy: 'turn-based',
        maxTurnsInContext: 20,
        compaction: {
          enabled: false,
          memoryFlushBeforeCompaction: false,
        },
      },
    },
    costConfig: {
      dailyBudgetUSD: 100,
      monthlyBudgetUSD: 1000,
      maxTokensPerTurn: 4096,
      maxTurnsPerSession: 10,
      maxToolCallsPerTurn: 5,
      alertThresholdPercent: 80,
      hardLimitPercent: 100,
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000,
    },
    maxTurnsPerSession: 10,
    maxConcurrentSessions: 5,
    ...overrides,
  };
}

/**
 * Seed a project with valid E2E config and prompt layers.
 * Uses the correct AgentConfig shape required by prepareChatRun.
 */
export async function seedE2EProject(
  testDb: TestDatabase,
  overrides?: Partial<AgentConfig>,
): Promise<{ projectId: ProjectId }> {
  const projectId = nanoid() as ProjectId;
  const config = createE2EAgentConfig(projectId, overrides);
  return testDb.seed({ projectId, config });
}
