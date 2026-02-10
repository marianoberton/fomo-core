/**
 * Database fixtures for integration tests.
 * Provides helpers to create persisted test data.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId, TraceId, AgentConfig, Message } from '@/core/types.js';

/**
 * Create a test project in the database.
 * Returns the created project with all fields.
 *
 * @param prisma - Prisma client.
 * @param overrides - Optional field overrides.
 * @returns Created project.
 */
export async function createTestProject(
  prisma: PrismaClient,
  overrides?: Partial<{
    id: ProjectId;
    name: string;
    owner: string;
    config: AgentConfig;
    tags: string[];
    status: 'active' | 'archived';
  }>,
) {
  const projectId = (overrides?.id || nanoid()) as ProjectId;
  const config = overrides?.config || defaultAgentConfig(projectId);

  const project = await prisma.project.create({
    data: {
      id: projectId,
      name: overrides?.name || 'Test Project',
      owner: overrides?.owner || 'test-user',
      tags: overrides?.tags || ['test'],
      configJson: config as Prisma.InputJsonValue,
      status: overrides?.status || 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return project;
}

/**
 * Create a test session in the database.
 * Optionally creates messages.
 *
 * @param prisma - Prisma client.
 * @param projectId - Project ID.
 * @param overrides - Optional field overrides.
 * @returns Created session.
 */
export async function createTestSession(
  prisma: PrismaClient,
  projectId: ProjectId,
  overrides?: Partial<{
    id: SessionId;
    messages: Message[];
    metadata: Record<string, unknown>;
  }>,
) {
  const sessionId = (overrides?.id || nanoid()) as SessionId;

  const session = await prisma.session.create({
    data: {
      id: sessionId,
      projectId,
      messagesJson: (overrides?.messages || []) as Prisma.InputJsonValue,
      metadata: (overrides?.metadata || {}) as Prisma.InputJsonValue,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return session;
}

/**
 * Create test memory entries in the database.
 * Generates random embeddings for pgvector.
 *
 * @param prisma - Prisma client.
 * @param sessionId - Session ID.
 * @param count - Number of entries to create.
 * @returns Created memory entry IDs.
 */
export async function createTestMemoryEntries(
  prisma: PrismaClient,
  sessionId: SessionId,
  count: number = 3,
): Promise<string[]> {
  const projectId = await prisma.session
    .findUnique({
      where: { id: sessionId },
      select: { projectId: true },
    })
    .then((s) => s?.projectId);

  if (!projectId) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const id = nanoid();
    const embedding = generateRandomEmbedding();

    await prisma.$executeRaw`
      INSERT INTO memory_entries (id, project_id, session_id, content, embedding, created_at)
      VALUES (
        ${id},
        ${projectId},
        ${sessionId},
        ${`Test memory entry ${i + 1}`},
        ${vectorLiteral(embedding)}::vector(1536),
        NOW()
      )
    `;

    ids.push(id);
  }

  return ids;
}

/**
 * Create a test execution trace in the database.
 *
 * @param prisma - Prisma client.
 * @param projectId - Project ID.
 * @param sessionId - Session ID.
 * @param overrides - Optional field overrides.
 * @returns Created trace.
 */
export async function createTestTrace(
  prisma: PrismaClient,
  projectId: ProjectId,
  sessionId: SessionId,
  overrides?: Partial<{
    id: TraceId;
    status: 'running' | 'completed' | 'failed';
    events: unknown[];
  }>,
) {
  const traceId = (overrides?.id || nanoid()) as TraceId;

  const trace = await prisma.executionTrace.create({
    data: {
      id: traceId,
      projectId,
      sessionId,
      events: (overrides?.events || []) as Prisma.InputJsonValue,
      startedAt: new Date(),
      status: overrides?.status || 'completed',
      completedAt: overrides?.status === 'completed' ? new Date() : null,
    },
  });

  return trace;
}

/**
 * Default agent config for tests.
 * Minimal valid configuration.
 *
 * @param projectId - Project ID.
 * @returns Default agent config.
 */
function defaultAgentConfig(projectId: ProjectId): AgentConfig {
  return {
    projectId,
    provider: {
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5',
    },
    maxTurnsPerSession: 10,
    allowedTools: ['calculator', 'date-time', 'json-transform'],
    memoryConfig: {
      contextWindow: 200_000,
      pruneStrategy: 'turn-based',
      pruneThreshold: 50,
      enableCompaction: false,
      enableLongTerm: false,
      categories: [],
    },
    costConfig: {
      dailyBudgetUSD: 100,
      monthlyBudgetUSD: 1000,
      alertThresholdPercent: 80,
    },
    securityConfig: {
      enableApprovalGate: false,
      enableInputSanitization: true,
      highRiskToolsRequireApproval: [],
    },
    failoverProvider: undefined,
  };
}

/**
 * Helper to create vector literal for pgvector.
 *
 * @param values - Embedding values.
 * @returns Vector literal string.
 */
function vectorLiteral(values: number[]): string {
  return `'[${values.join(',')}]'`;
}

/**
 * Helper to generate random embedding for testing.
 *
 * @returns Random 1536-dimensional embedding.
 */
function generateRandomEmbedding(): number[] {
  return Array.from({ length: 1536 }, () => Math.random());
}
