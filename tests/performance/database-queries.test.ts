/**
 * Performance tests for database operations.
 * Measures query latency and throughput for repository operations.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { nanoid } from 'nanoid';
import type { ProjectId } from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import { createSessionRepository } from '@/infrastructure/repositories/session-repository.js';
import { createE2EAgentConfig } from '../e2e/helpers.js';

describe('Database Query Performance', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  // ─── Project Repository ──────────────────────────────────────

  describe('Project Repository', () => {
    it('creates 100 projects in <3000ms', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const projectId = nanoid() as ProjectId;
        await repo.create({
          name: `Project ${i}`,
          owner: 'test-user',
          tags: ['performance', 'test'],
          config: createE2EAgentConfig(projectId),
        });
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(3000);
    });

    it('queries single project by ID in <50ms', async () => {
      const repo = createProjectRepository(testDb.prisma);
      const projectId = nanoid() as ProjectId;
      const created = await repo.create({
        name: 'Test Project',
        owner: 'test-user',
        config: createE2EAgentConfig(projectId),
      });

      const start = performance.now();
      const result = await repo.findById(created.id);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(result).not.toBeNull();
    });

    it('lists 100 projects in <100ms', async () => {
      const repo = createProjectRepository(testDb.prisma);

      // Seed 100 projects
      for (let i = 0; i < 100; i++) {
        const projectId = nanoid() as ProjectId;
        await repo.create({
          name: `Project ${i}`,
          owner: i % 3 === 0 ? 'alice' : 'bob',
          tags: [i % 2 === 0 ? 'production' : 'staging'],
          config: createE2EAgentConfig(projectId),
        });
      }

      const start = performance.now();
      const result = await repo.list();
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result).toHaveLength(100);
    });

    it('filters by owner on 100 projects in <100ms', async () => {
      const repo = createProjectRepository(testDb.prisma);

      for (let i = 0; i < 100; i++) {
        const projectId = nanoid() as ProjectId;
        await repo.create({
          name: `Project ${i}`,
          owner: i % 3 === 0 ? 'alice' : 'bob',
          config: createE2EAgentConfig(projectId),
        });
      }

      const start = performance.now();
      const result = await repo.list({ owner: 'alice' });
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((p) => p.owner === 'alice')).toBe(true);
    });

    it('filters by tags on 100 projects in <100ms', async () => {
      const repo = createProjectRepository(testDb.prisma);

      for (let i = 0; i < 100; i++) {
        const projectId = nanoid() as ProjectId;
        await repo.create({
          name: `Project ${i}`,
          owner: 'test',
          tags: i % 2 === 0 ? ['production'] : ['staging'],
          config: createE2EAgentConfig(projectId),
        });
      }

      const start = performance.now();
      const result = await repo.list({ tags: ['production'] });
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result.length).toBeGreaterThan(0);
    });

    it('updates project in <50ms', async () => {
      const repo = createProjectRepository(testDb.prisma);
      const projectId = nanoid() as ProjectId;
      const created = await repo.create({
        name: 'Original',
        owner: 'test',
        config: createE2EAgentConfig(projectId),
      });

      const start = performance.now();
      const result = await repo.update(created.id, { name: 'Updated' });
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(result?.name).toBe('Updated');
    });

    it('deletes project in <50ms', async () => {
      const repo = createProjectRepository(testDb.prisma);
      const projectId = nanoid() as ProjectId;

      // Direct insert to avoid FK constraints
      await testDb.prisma.project.create({
        data: {
          id: projectId,
          name: 'Deletable',
          owner: 'test',
          tags: [],
          configJson: {},
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const start = performance.now();
      const result = await repo.delete(projectId);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(result).toBe(true);
    });
  });

  // ─── Session Repository ──────────────────────────────────────

  describe('Session Repository', () => {
    let projectId: ProjectId;

    beforeEach(async () => {
      const seed = await testDb.seed();
      projectId = seed.projectId;
    });

    it('creates 100 sessions in <2000ms', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await repo.create({
          projectId,
          metadata: { index: i },
        });
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(2000);
    });

    it('queries session by ID in <50ms', async () => {
      const repo = createSessionRepository(testDb.prisma);
      const session = await repo.create({ projectId });

      const start = performance.now();
      const result = await repo.findById(session.id);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(result).not.toBeNull();
    });

    it('lists 100 sessions by project in <100ms', async () => {
      const repo = createSessionRepository(testDb.prisma);

      for (let i = 0; i < 100; i++) {
        await repo.create({ projectId });
      }

      const start = performance.now();
      const result = await repo.listByProject(projectId);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result).toHaveLength(100);
    });

    it('adds message in <50ms', async () => {
      const repo = createSessionRepository(testDb.prisma);
      const session = await repo.create({ projectId });

      const start = performance.now();
      await repo.addMessage(session.id, { role: 'user', content: 'Test' });
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    });

    it('retrieves 100 messages in <100ms', async () => {
      const repo = createSessionRepository(testDb.prisma);
      const session = await repo.create({ projectId });

      // Seed 100 messages
      for (let i = 0; i < 100; i++) {
        await repo.addMessage(session.id, {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        });
      }

      const start = performance.now();
      const messages = await repo.getMessages(session.id);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(messages).toHaveLength(100);
    });
  });

  // ─── Batch Operations ────────────────────────────────────────

  describe('Batch Operations', () => {
    it('reset() clears all tables in <1000ms', async () => {
      // Seed some data
      await testDb.seed();
      await testDb.seed();
      await testDb.seed();

      const start = performance.now();
      await testDb.reset();
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1000);

      // Verify empty
      const projects = await testDb.prisma.project.findMany();
      expect(projects).toHaveLength(0);
    });
  });
});
