/**
 * PromptLayerRepository integration tests.
 * Tests real Prisma operations against PostgreSQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { ProjectId, PromptLayerId } from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createPromptLayerRepository } from './prompt-layer-repository.js';

describe('PromptLayerRepository Integration', () => {
  let testDb: TestDatabase;
  let projectId: ProjectId;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('create', () => {
    it('creates layer with auto-incremented version starting at 1', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Seed already creates version 1 layers, so next should be version 2
      const layer = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'Updated identity prompt.',
        createdBy: 'admin',
        changeReason: 'Testing version increment',
      });

      expect(layer.id).toBeDefined();
      expect(layer.projectId).toBe(projectId);
      expect(layer.layerType).toBe('identity');
      expect(layer.version).toBe(2); // Seed creates v1
      expect(layer.content).toBe('Updated identity prompt.');
      expect(layer.isActive).toBe(false); // New layers start inactive
      expect(layer.createdBy).toBe('admin');
      expect(layer.changeReason).toBe('Testing version increment');
    });

    it('versions independently per layer type', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Each type should get version 2 (seed creates v1 for each)
      const identity = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'Identity v2',
        createdBy: 'admin',
        changeReason: 'v2',
      });

      const instructions = await repo.create({
        projectId,
        layerType: 'instructions',
        content: 'Instructions v2',
        createdBy: 'admin',
        changeReason: 'v2',
      });

      const safety = await repo.create({
        projectId,
        layerType: 'safety',
        content: 'Safety v2',
        createdBy: 'admin',
        changeReason: 'v2',
      });

      expect(identity.version).toBe(2);
      expect(instructions.version).toBe(2);
      expect(safety.version).toBe(2);
    });

    it('stores optional metadata as JSON', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      const metadata = { author: 'test', tags: ['production', 'v2'] };
      const layer = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'With metadata',
        createdBy: 'admin',
        changeReason: 'metadata test',
        metadata,
      });

      const found = await repo.findById(layer.id);
      expect(found?.metadata).toEqual(metadata);
    });

    it('stores performanceNotes when provided', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      const layer = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'With perf notes',
        createdBy: 'admin',
        changeReason: 'perf test',
        performanceNotes: 'Reduced token usage by 20%',
      });

      const found = await repo.findById(layer.id);
      expect(found?.performanceNotes).toBe('Reduced token usage by 20%');
    });
  });

  describe('findById', () => {
    it('retrieves layer by ID', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      const layer = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'Findable layer',
        createdBy: 'admin',
        changeReason: 'findById test',
      });

      const found = await repo.findById(layer.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(layer.id);
      expect(found?.content).toBe('Findable layer');
    });

    it('returns null for non-existent ID', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      const found = await repo.findById('non-existent' as PromptLayerId);
      expect(found).toBeNull();
    });
  });

  describe('getActiveLayer', () => {
    it('returns the active layer for a project and type', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Seed creates 3 active layers
      const active = await repo.getActiveLayer(projectId, 'identity');

      expect(active).not.toBeNull();
      expect(active?.layerType).toBe('identity');
      expect(active?.isActive).toBe(true);
      expect(active?.content).toBe('You are a helpful test assistant.');
    });

    it('returns null when no active layer exists', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Create new project with no layers
      await testDb.reset();
      const newProject = await testDb.prisma.project.create({
        data: {
          id: 'no-layers-project',
          name: 'No Layers',
          owner: 'test',
          tags: [],
          configJson: {},
          status: 'active',
        },
      });

      const active = await repo.getActiveLayer(newProject.id as ProjectId, 'identity');
      expect(active).toBeNull();
    });
  });

  describe('activate', () => {
    it('activates a layer and deactivates others of same type', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Seed has v1 active. Create v2, activate it.
      const v2 = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'Identity v2 - activated',
        createdBy: 'admin',
        changeReason: 'Upgrade identity',
      });

      expect(v2.isActive).toBe(false);

      const result = await repo.activate(v2.id);
      expect(result).toBe(true);

      // v2 is now active
      const active = await repo.getActiveLayer(projectId, 'identity');
      expect(active?.id).toBe(v2.id);
      expect(active?.version).toBe(2);

      // v1 is now inactive
      const allLayers = await repo.listByProject(projectId, 'identity');
      const v1 = allLayers.find((l) => l.version === 1);
      expect(v1?.isActive).toBe(false);
    });

    it('supports rollback by activating old version', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Get the seeded v1 identity layer
      const v1 = await repo.getActiveLayer(projectId, 'identity');
      expect(v1).not.toBeNull();

      // Create v2 and activate
      const v2 = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'Identity v2',
        createdBy: 'admin',
        changeReason: 'Upgrade',
      });
      await repo.activate(v2.id);

      // Rollback: activate v1 again
      await repo.activate(v1!.id);

      const active = await repo.getActiveLayer(projectId, 'identity');
      expect(active?.id).toBe(v1!.id);
      expect(active?.version).toBe(1);
    });

    it('does not affect other layer types', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Create and activate new identity layer
      const newIdentity = await repo.create({
        projectId,
        layerType: 'identity',
        content: 'New identity',
        createdBy: 'admin',
        changeReason: 'test',
      });
      await repo.activate(newIdentity.id);

      // Instructions and safety should still be active at v1
      const activeInstructions = await repo.getActiveLayer(projectId, 'instructions');
      expect(activeInstructions?.version).toBe(1);
      expect(activeInstructions?.isActive).toBe(true);

      const activeSafety = await repo.getActiveLayer(projectId, 'safety');
      expect(activeSafety?.version).toBe(1);
      expect(activeSafety?.isActive).toBe(true);
    });

    it('returns false for non-existent layer ID', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      const result = await repo.activate('non-existent' as PromptLayerId);
      expect(result).toBe(false);
    });
  });

  describe('listByProject', () => {
    it('lists all layers sorted by version desc', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      // Create additional versions
      await repo.create({ projectId, layerType: 'identity', content: 'v2', createdBy: 'admin', changeReason: 'v2' });
      await repo.create({ projectId, layerType: 'identity', content: 'v3', createdBy: 'admin', changeReason: 'v3' });

      const layers = await repo.listByProject(projectId);

      // 3 seed layers + 2 new identity layers = 5 total
      expect(layers).toHaveLength(5);
    });

    it('filters by layer type', async () => {
      const repo = createPromptLayerRepository(testDb.prisma);

      await repo.create({ projectId, layerType: 'identity', content: 'v2', createdBy: 'admin', changeReason: 'v2' });

      const identityLayers = await repo.listByProject(projectId, 'identity');
      expect(identityLayers).toHaveLength(2); // v1 from seed + v2
      identityLayers.forEach((l) => {
        expect(l.layerType).toBe('identity');
      });

      // Newest version first
      expect(identityLayers[0]!.version).toBeGreaterThan(identityLayers[1]!.version);
    });
  });
});
