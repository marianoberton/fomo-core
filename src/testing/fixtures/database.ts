/**
 * Database fixtures for integration tests.
 * Provides helpers to create persisted test data.
 */
import type { PrismaClient, Prisma, Project, Session, ExecutionTrace } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId, TraceId, AgentConfig } from '@/core/types.js';
import { createTestAgentConfig } from './context.js';

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
): Promise<Project> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- branded type
  const projectId = overrides?.id ?? nanoid() as ProjectId;
  const config = overrides?.config ?? createTestAgentConfig({ projectId });

  const project = await prisma.project.create({
    data: {
      id: projectId,
      name: overrides?.name ?? 'Test Project',
      owner: overrides?.owner ?? 'test-user',
      tags: overrides?.tags ?? ['test'],
      configJson: config as unknown as Prisma.InputJsonValue,
      status: overrides?.status ?? 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return project;
}

/**
 * Create a test session in the database.
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
    metadata: Record<string, unknown>;
  }>,
): Promise<Session> {
  const sessionId = (overrides?.id ?? nanoid());

  const session = await prisma.session.create({
    data: {
      id: sessionId,
      projectId,
      metadata: (overrides?.metadata ?? {}) as Prisma.InputJsonValue,
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
  count = 3,
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
): Promise<ExecutionTrace> {
  const traceId = (overrides?.id ?? nanoid());

  const trace = await prisma.executionTrace.create({
    data: {
      id: traceId,
      projectId,
      sessionId,
      promptSnapshot: {} as Prisma.InputJsonValue,
      events: (overrides?.events ?? []) as Prisma.InputJsonValue,
      totalDurationMs: 0,
      totalTokensUsed: 0,
      totalCostUsd: 0,
      turnCount: 0,
      status: overrides?.status ?? 'completed',
      createdAt: new Date(),
      completedAt: overrides?.status === 'completed' ? new Date() : null,
    },
  });

  return trace;
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
