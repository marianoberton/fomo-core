/**
 * ProjectRepository integration tests.
 * Tests real Prisma operations against PostgreSQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { nanoid } from 'nanoid';
import type { ProjectId } from '@/core/types.js';
import type { Prisma } from '@prisma/client';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createProjectRepository } from './project-repository.js';

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
        config: {
          projectId,
          provider: {
            provider: 'anthropic',
            apiKey: 'test-key',
            model: 'claude-sonnet-4-5',
          },
          maxTurnsPerSession: 10,
          allowedTools: ['calculator'],
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
        },
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
      const complexConfig = {
        projectId,
        provider: {
          provider: 'anthropic' as const,
          apiKey: 'test-key',
          model: 'claude-sonnet-4-5',
        },
        maxTurnsPerSession: 20,
        allowedTools: ['calculator', 'date-time', 'json-transform'],
        memoryConfig: {
          contextWindow: 1_000_000,
          pruneStrategy: 'token-based' as const,
          pruneThreshold: 100_000,
          enableCompaction: true,
          enableLongTerm: true,
          categories: ['general', 'technical'],
        },
        costConfig: {
          dailyBudgetUSD: 50,
          monthlyBudgetUSD: 500,
          alertThresholdPercent: 90,
        },
        securityConfig: {
          enableApprovalGate: true,
          enableInputSanitization: true,
          highRiskToolsRequireApproval: ['http-request'],
        },
        failoverProvider: {
          provider: 'openai' as const,
          apiKey: 'fallback-key',
          model: 'gpt-4o',
        },
      };

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

      const projectId = nanoid() as ProjectId;
      const project1 = await repo.create({
        name: 'Project 1',
        owner: 'user1',
        config: {
          projectId,
          provider: { provider: 'anthropic', apiKey: 'key', model: 'claude-sonnet-4-5' },
          maxTurnsPerSession: 10,
          allowedTools: [],
          memoryConfig: {
            contextWindow: 200_000,
            pruneStrategy: 'turn-based',
            pruneThreshold: 50,
            enableCompaction: false,
            enableLongTerm: false,
            categories: [],
          },
          costConfig: { dailyBudgetUSD: 100, monthlyBudgetUSD: 1000, alertThresholdPercent: 80 },
          securityConfig: {
            enableApprovalGate: false,
            enableInputSanitization: true,
            highRiskToolsRequireApproval: [],
          },
          failoverProvider: undefined,
        },
      });

      const projectId2 = nanoid() as ProjectId;
      const project2 = await repo.create({
        name: 'Project 2',
        owner: 'user2',
        config: {
          projectId: projectId2,
          provider: { provider: 'openai', apiKey: 'key', model: 'gpt-4o' },
          maxTurnsPerSession: 10,
          allowedTools: [],
          memoryConfig: {
            contextWindow: 128_000,
            pruneStrategy: 'turn-based',
            pruneThreshold: 50,
            enableCompaction: false,
            enableLongTerm: false,
            categories: [],
          },
          costConfig: { dailyBudgetUSD: 100, monthlyBudgetUSD: 1000, alertThresholdPercent: 80 },
          securityConfig: {
            enableApprovalGate: false,
            enableInputSanitization: true,
            highRiskToolsRequireApproval: [],
          },
          failoverProvider: undefined,
        },
      });

      expect(project1.id).not.toBe(project2.id);
      expect(project1.createdAt).toBeInstanceOf(Date);
      expect(project2.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('findById', () => {
    it('retrieves project by ID', async () => {
      const repo = createProjectRepository(testDb.prisma);

      // Create project
      const seed = await testDb.seed();
      const projectId = seed.projectId;

      // Retrieve project
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

  describe('findAll', () => {
    it('returns empty array when no projects exist', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const projects = await repo.findAll();

      expect(projects).toEqual([]);
    });

    it('returns all projects', async () => {
      const repo = createProjectRepository(testDb.prisma);

      // Create multiple projects
      await testDb.seed();
      await testDb.seed();
      await testDb.seed();

      const projects = await repo.findAll();

      expect(projects).toHaveLength(3);
      projects.forEach((project) => {
        expect(project.id).toBeDefined();
        expect(project.config).toBeDefined();
      });
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

      // Update config
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

  describe('findByTags', () => {
    it('queries by tags using hasSome operator', async () => {
      const repo = createProjectRepository(testDb.prisma);

      // Create projects with different tags
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

      // Query by tags
      const productionProjects = await repo.findByTags(['production']);
      expect(productionProjects).toHaveLength(2);

      const apiProjects = await repo.findByTags(['api']);
      expect(apiProjects).toHaveLength(2);

      const productionApi = await repo.findByTags(['production', 'api']);
      expect(productionApi).toHaveLength(1);
      expect(productionApi[0]?.name).toBe('Project A');
    });
  });

  describe('delete', () => {
    it('deletes project from database', async () => {
      const repo = createProjectRepository(testDb.prisma);

      const seed = await testDb.seed();
      const projectId = seed.projectId;

      // Verify exists
      const before = await repo.findById(projectId);
      expect(before).not.toBeNull();

      // Delete
      await repo.delete(projectId);

      // Verify deleted
      const after = await repo.findById(projectId);
      expect(after).toBeNull();
    });

    it('handles deleting non-existent project gracefully', async () => {
      const repo = createProjectRepository(testDb.prisma);

      // Should not throw
      await expect(repo.delete('non-existent' as ProjectId)).resolves.not.toThrow();
    });
  });
});
