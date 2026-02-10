/**
 * Fix Demo Project configJson to match AgentConfig interface.
 *
 * The original seed.ts created a config with wrong shape:
 *   { provider: { type: "anthropic" }, tools: { allowedTools: [...] } }
 *
 * Correct shape (matching AgentConfig):
 *   { provider: { provider: "anthropic", model, ... }, allowedTools: [...] }
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Fixing Demo Project config...\n');

  // Find Demo Project
  const project = await prisma.project.findFirst({
    where: { name: 'Demo Project' },
  });

  if (!project) {
    console.log('  Demo Project not found. Skipping.');
    return;
  }

  console.log(`  Found Demo Project: ${project.id}`);

  const oldConfig = project.configJson as Record<string, unknown>;

  // Transform old shape to new shape
  const newConfig = {
    projectId: project.id,
    agentRole: 'assistant' as const,

    provider: {
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-5-20250929',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      temperature: 0.7,
      maxOutputTokens: 4096,
    },

    failover: {
      onRateLimit: true,
      onServerError: true,
      onTimeout: true,
      timeoutMs: 120000,
      maxRetries: 2,
    },

    allowedTools: ['calculator', 'date-time', 'json-transform'],

    memoryConfig: {
      longTerm: {
        enabled: false,
        maxEntries: 1000,
        retrievalTopK: 5,
        embeddingProvider: 'openai' as const,
        decayEnabled: false,
        decayHalfLifeDays: 30,
      },
      contextWindow: {
        reserveTokens: 4096,
        pruningStrategy: 'turn-based' as const,
        maxTurnsInContext: 20,
        compaction: {
          enabled: true,
          memoryFlushBeforeCompaction: false,
        },
      },
    },

    costConfig: {
      dailyBudgetUSD: 10,
      monthlyBudgetUSD: 100,
      maxTokensPerTurn: 8000,
      maxTurnsPerSession: 15,
      maxToolCallsPerTurn: 5,
      alertThresholdPercent: 80,
      hardLimitPercent: 100,
      maxRequestsPerMinute: 20,
      maxRequestsPerHour: 200,
    },

    maxTurnsPerSession: 15,
    maxConcurrentSessions: 5,
  };

  await prisma.project.update({
    where: { id: project.id },
    data: { configJson: newConfig },
  });

  console.log('  Config updated to match AgentConfig interface');
  console.log(`\n  Demo Project ready!`);
}

main()
  .catch((e: unknown) => {
    console.error('Fix failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
