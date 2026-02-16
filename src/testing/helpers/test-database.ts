/**
 * Test database helper for integration tests.
 * Provides database isolation and reset capabilities.
 */
import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, AgentConfig } from '@/core/types.js';
import type { Prisma } from '@prisma/client';
import { createTestAgentConfig } from '@/testing/fixtures/context.js';

/** Test database instance with helpers for isolation and seeding. */
export interface TestDatabase {
  /** Prisma client connected to test database. */
  prisma: PrismaClient;
  /** Reset database by deleting all rows (fast isolation). */
  reset: () => Promise<void>;
  /** Seed minimal test data (project + prompt layers). */
  seed: (data?: SeedData) => Promise<SeedResult>;
  /** Disconnect from database. */
  disconnect: () => Promise<void>;
}

/** Optional data for seeding. */
export interface SeedData {
  /** Custom project ID. */
  projectId?: ProjectId;
  /** Custom agent config. */
  config?: AgentConfig;
}

/** Result of seeding operation. */
export interface SeedResult {
  /** ID of the created project. */
  projectId: ProjectId;
}

/**
 * Create a test database instance.
 * Connects to test database and provides helpers for isolation.
 *
 * @returns Test database instance.
 */
export function createTestDatabase(): Promise<TestDatabase> {
  const testDbUrl =
    process.env['TEST_DATABASE_URL'] ??
    'postgresql://nexus:nexus@localhost:5433/nexus_core_test?schema=public';

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: testDbUrl,
      },
    },
    // Suppress logs in tests
    log: [],
  });

  return Promise.resolve<TestDatabase>({
    prisma,

    /**
     * Reset database by deleting all rows.
     * Faster than running migrations between tests.
     */
    reset: async () => {
      // TRUNCATE CASCADE avoids FK ordering issues when tests run in parallel
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE
          messages,
          approval_requests,
          execution_traces,
          sessions,
          memory_entries,
          usage_records,
          scheduled_task_runs,
          scheduled_tasks,
          prompt_layers,
          webhooks,
          files,
          contacts,
          agents,
          channel_integrations,
          projects
        CASCADE`,
      );
    },

    /**
     * Seed minimal test data.
     * Creates a project with active prompt layers.
     *
     * @param data - Optional seed data.
     * @returns Seed result with project ID.
     */
    seed: async (data?: SeedData) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- branded type
      const projectId = data?.projectId ?? nanoid() as ProjectId;
      const config = data?.config ?? createTestAgentConfig({ projectId });

      // Create project
      await prisma.project.create({
        data: {
          id: projectId,
          name: 'Test Project',
          owner: 'test-user',
          tags: ['test'],
          configJson: config as unknown as Prisma.InputJsonValue,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create 3 active prompt layers (identity, instructions, safety)
      await prisma.promptLayer.createMany({
        data: [
          {
            id: nanoid(),
            projectId,
            layerType: 'identity',
            version: 1,
            content: 'You are a helpful test assistant.',
            isActive: true,
            createdBy: 'test-user',
            changeReason: 'Test seed',
            createdAt: new Date(),
          },
          {
            id: nanoid(),
            projectId,
            layerType: 'instructions',
            version: 1,
            content: 'Follow instructions carefully.',
            isActive: true,
            createdBy: 'test-user',
            changeReason: 'Test seed',
            createdAt: new Date(),
          },
          {
            id: nanoid(),
            projectId,
            layerType: 'safety',
            version: 1,
            content: 'Do not perform harmful actions.',
            isActive: true,
            createdBy: 'test-user',
            changeReason: 'Test seed',
            createdAt: new Date(),
          },
        ],
      });

      return { projectId };
    },

    /**
     * Disconnect from database.
     * Call in afterAll hook.
     */
    disconnect: async () => {
      await prisma.$disconnect();
    },
  });
}

/**
 * Helper to create vector literal for pgvector.
 * Converts number array to PostgreSQL vector literal format.
 *
 * @param values - Embedding values.
 * @returns Vector literal string.
 */
export function vectorLiteral(values: number[]): string {
  return `'[${values.join(',')}]'`;
}

/**
 * Helper to generate random embedding for testing.
 * Creates a 1536-dimensional random vector.
 *
 * @returns Random embedding array.
 */
export function generateRandomEmbedding(): number[] {
  return Array.from({ length: 1536 }, () => Math.random());
}
