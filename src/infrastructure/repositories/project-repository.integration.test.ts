/**
 * ProjectRepository integration tests.
 * Tests real Prisma operations against PostgreSQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { nanoid } from 'nanoid';
import type { ProjectId, AgentConfig } from '@/core/types.js';
import type { Prisma } from '@prisma/client';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestAgentConfig } from '@/testing/fixtures/context.js';
import { createProjectRepository } from './project-repository.js';

/** Create a valid AgentConfig with a given projectId. */
function makeConfig(projectId: ProjectId, overrides?: Partial<AgentConfig>): AgentConfig {
  return createTestAgentConfig({ projectId, ...overrides });
}

describe('ProjectRepository Integration', () => {
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

  describe('create', () => {
    it('creates project and persists to PostgreSQL', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const projectId = nanoid() as ProjectId;
      const project = await repo.create({
        name: 'Integration Test Project',
        owner: 'test-admin',
        config: makeConfig(projectId),
      });

      // Verify in DB
      const found = await testDb.prisma.project.findUnique({
        where: { id: project.id },
      });

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Integration Test Project');
      expect(found?.owner).toBe('test-admin');
      expect(found?.configJson).toMatchObject({ projectId });
    });

    it('handles JSON column with complex AgentConfig', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const projectId = nanoid() as ProjectId;
      const complexConfig = makeConfig(projectId, {
        allowedTools: ['calculator', 'date-time', 'json-transform'],
        maxTurnsPerSession: 20,
        maxConcurrentSessions: 10,
        fallbackProvider: {
          provider: 'openai',
          model: 'gpt-4o',
          apiKeyEnvVar: 'OPENAI_API_KEY',
        },
      });

      const project = await repo.create({
        name: 'Complex Config',
        owner: 'admin',
        config: complexConfig,
      });

      const retrieved = await repo.findById(project.id);
      expect(retrieved?.config).toEqual(complexConfig);
    });

    it('assigns unique IDs and timestamps', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const project1 = await repo.create({
        name: 'Project 1',
        owner: 'user1',
        config: makeConfig(nanoid() as ProjectId),
      });

      const project2 = await repo.create({
        name: 'Project 2',
        owner: 'user2',
        config: makeConfig(nanoid() as ProjectId, {
          provider: { provider: 'openai', model: 'gpt-4o', apiKeyEnvVar: 'OPENAI_API_KEY' },
        }),
      });

      expect(project1.id).not.toBe(project2.id);
      expect(project1.createdAt).toBeInstanceOf(Date);
      expect(project2.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('findById', () => {
    it('retrieves project by ID', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const seed = await testDb.seed();
      const projectId = seed.projectId;

      const found = await repo.findById(projectId);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(projectId);
      expect(found?.config.projectId).toBe(projectId);
    });

    it('returns null for non-existent ID', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const found = await repo.findById('non-existent-id' as ProjectId);

      expect(found).toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array when no projects exist', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const projects = await repo.list();

      expect(projects).toEqual([]);
    });

    it('returns all projects when no filters provided', async () => {
      const repo = createProjectRepository(testDb.prisma);

      await testDb.seed();
      await testDb.seed();
      await testDb.seed();

      const projects = await repo.list();

      expect(projects).toHaveLength(3);
      projects.forEach((project) => {
        expect(project.id).toBeDefined();
        expect(project.config).toBeDefined();
      });
    });

    it('filters by owner', async () => {
      const repo = createProjectRepository(testDb.prisma);

      await repo.create({
        name: 'Owned by Alice',
        owner: 'alice',
        config: makeConfig(nanoid() as ProjectId),
      });

      await repo.create({
        name: 'Owned by Bob',
        owner: 'bob',
        config: makeConfig(nanoid() as ProjectId),
      });

      const aliceProjects = await repo.list({ owner: 'alice' });
      expect(aliceProjects).toHaveLength(1);
      expect(aliceProjects[0]?.name).toBe('Owned by Alice');
    });

    it('returns projects ordered by createdAt desc', async () => {
      const repo = createProjectRepository(testDb.prisma);

      await testDb.seed();
      await testDb.seed();

      const projects = await repo.list();
      expect(projects).toHaveLength(2);
      expect(projects[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(projects[1]!.createdAt.getTime());
    });
  });

  describe('update', () => {
    it('updates JSON config without data loss', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const seed = await testDb.seed();
      const projectId = seed.projectId;

      const project = await repo.findById(projectId);
      expect(project).not.toBeNull();

      const originalProvider = project!.config.provider;

      const updated = await repo.update(projectId, {
        config: { ...project!.config, maxTurnsPerSession: 99 },
      });

      expect(updated?.config.maxTurnsPerSession).toBe(99);
      expect(updated?.config.provider).toEqual(originalProvider);
    });

    it('updates name and tags', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const seed = await testDb.seed();
      const projectId = seed.projectId;

      const updated = await repo.update(projectId, {
        name: 'Updated Name',
        tags: ['production', 'critical'],
      });

      expect(updated?.name).toBe('Updated Name');
      expect(updated?.tags).toEqual(['production', 'critical']);
    });

    it('returns null when updating non-existent project', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const updated = await repo.update('non-existent' as ProjectId, {
        name: 'New Name',
      });

      expect(updated).toBeNull();
    });
  });

  describe('list with tag filters', () => {
    it('queries by tags using hasSome operator', async () => {
      const repo = createProjectRepository(testDb.prisma);

      await testDb.prisma.project.create({
        data: {
          id: nanoid(),
          name: 'Project A',
          owner: 'user1',
          tags: ['production', 'api'],
          configJson: {} as Prisma.InputJsonValue,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await testDb.prisma.project.create({
        data: {
          id: nanoid(),
          name: 'Project B',
          owner: 'user2',
          tags: ['development', 'api'],
          configJson: {} as Prisma.InputJsonValue,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await testDb.prisma.project.create({
        data: {
          id: nanoid(),
          name: 'Project C',
          owner: 'user3',
          tags: ['production', 'web'],
          configJson: {} as Prisma.InputJsonValue,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const productionProjects = await repo.list({ tags: ['production'] });
      expect(productionProjects).toHaveLength(2);

      const apiProjects = await repo.list({ tags: ['api'] });
      expect(apiProjects).toHaveLength(2);

      const anyProductionOrApi = await repo.list({ tags: ['production', 'api'] });
      expect(anyProductionOrApi).toHaveLength(3);
    });
  });

  describe('delete', () => {
    it('deletes project from database', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const project = await repo.create({
        name: 'To Delete',
        owner: 'test-user',
        config: makeConfig(nanoid() as ProjectId),
      });

      const before = await repo.findById(project.id);
      expect(before).not.toBeNull();

      const result = await repo.delete(project.id);
      expect(result).toBe(true);

      const after = await repo.findById(project.id);
      expect(after).toBeNull();
    });

    it('returns false when project has child rows (FK constraint)', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const seed = await testDb.seed();

      const result = await repo.delete(seed.projectId);
      expect(result).toBe(false);

      const after = await repo.findById(seed.projectId);
      expect(after).not.toBeNull();
    });

    it('handles deleting non-existent project gracefully', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const result = await repo.delete('non-existent' as ProjectId);
      expect(result).toBe(false);
    });
  });
});
