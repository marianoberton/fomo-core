/**
 * Tests for the MCP Server repository.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMCPServerRepository } from './mcp-server-repository.js';
import type { MCPServerRepository } from './mcp-server-repository.js';
import type { ProjectId } from '@/core/types.js';

// ─── Mock Prisma Models ─────────────────────────────────────────

function createMockPrisma() {
  return {
    mCPServerTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    mCPServerInstance: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

// ─── Test Data ──────────────────────────────────────────────────

const templateRecord = {
  id: 'tmpl-1',
  name: 'odoo-erp',
  displayName: 'Odoo ERP',
  description: 'Odoo connector',
  category: 'erp',
  transport: 'sse',
  command: null,
  args: [],
  defaultEnv: null,
  url: 'http://localhost:8069/mcp',
  toolPrefix: 'odoo',
  requiredSecrets: ['ODOO_URL', 'ODOO_API_KEY'],
  isOfficial: true,
  createdAt: new Date('2026-02-20T00:00:00Z'),
  updatedAt: new Date('2026-02-20T00:00:00Z'),
};

const instanceRecord = {
  id: 'inst-1',
  projectId: 'proj-1',
  templateId: 'tmpl-1',
  name: 'my-odoo',
  displayName: 'My Odoo',
  description: 'Production Odoo',
  transport: 'sse',
  command: null,
  args: [],
  envSecretKeys: { ODOO_URL: 'url-secret' },
  url: 'http://odoo.prod.com/mcp',
  toolPrefix: 'odoo',
  status: 'active',
  createdAt: new Date('2026-02-20T00:00:00Z'),
  updatedAt: new Date('2026-02-20T00:00:00Z'),
};

// ─── Tests ──────────────────────────────────────────────────────

describe('mcp-server-repository', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let repo: MCPServerRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    // Cast mock as PrismaClient — the repo internally casts to access new models
    repo = createMCPServerRepository(mockPrisma as never);
  });

  // ─── Templates ──────────────────────────────────────────────

  describe('listTemplates', () => {
    it('returns all templates', async () => {
      mockPrisma.mCPServerTemplate.findMany.mockResolvedValue([templateRecord]);

      const result = await repo.listTemplates();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('odoo-erp');
      expect(result[0]?.command).toBeUndefined();
      expect(result[0]?.isOfficial).toBe(true);
    });

    it('filters by category', async () => {
      mockPrisma.mCPServerTemplate.findMany.mockResolvedValue([]);

      await repo.listTemplates('erp');

      expect(mockPrisma.mCPServerTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: 'erp' },
        }),
      );
    });

    it('returns empty without filter', async () => {
      mockPrisma.mCPServerTemplate.findMany.mockResolvedValue([]);

      const result = await repo.listTemplates();

      expect(result).toEqual([]);
      expect(mockPrisma.mCPServerTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });
  });

  describe('findTemplateById', () => {
    it('returns template when found', async () => {
      mockPrisma.mCPServerTemplate.findUnique.mockResolvedValue(templateRecord);

      const result = await repo.findTemplateById('tmpl-1');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('odoo-erp');
    });

    it('returns null when not found', async () => {
      mockPrisma.mCPServerTemplate.findUnique.mockResolvedValue(null);

      const result = await repo.findTemplateById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findTemplateByName', () => {
    it('returns template when found by name', async () => {
      mockPrisma.mCPServerTemplate.findUnique.mockResolvedValue(templateRecord);

      const result = await repo.findTemplateByName('odoo-erp');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('tmpl-1');
    });
  });

  describe('createTemplate', () => {
    it('creates template with required fields', async () => {
      mockPrisma.mCPServerTemplate.create.mockResolvedValue(templateRecord);

      const result = await repo.createTemplate({
        name: 'odoo-erp',
        displayName: 'Odoo ERP',
        description: 'Odoo connector',
        category: 'erp',
        transport: 'sse',
      });

      expect(result.name).toBe('odoo-erp');
      expect(mockPrisma.mCPServerTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'odoo-erp',
            transport: 'sse',
          }),
        }),
      );
    });
  });

  // ─── Instances ──────────────────────────────────────────────

  describe('listInstances', () => {
    it('returns instances for project', async () => {
      mockPrisma.mCPServerInstance.findMany.mockResolvedValue([instanceRecord]);

      const result = await repo.listInstances('proj-1' as ProjectId);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('my-odoo');
      expect(result[0]?.projectId).toBe('proj-1');
    });

    it('filters by status', async () => {
      mockPrisma.mCPServerInstance.findMany.mockResolvedValue([]);

      await repo.listInstances('proj-1' as ProjectId, 'active');

      expect(mockPrisma.mCPServerInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'proj-1', status: 'active' },
        }),
      );
    });
  });

  describe('findInstanceById', () => {
    it('returns instance when found', async () => {
      mockPrisma.mCPServerInstance.findUnique.mockResolvedValue(instanceRecord);

      const result = await repo.findInstanceById('inst-1');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-odoo');
      expect(result?.envSecretKeys).toEqual({ ODOO_URL: 'url-secret' });
    });

    it('returns null when not found', async () => {
      mockPrisma.mCPServerInstance.findUnique.mockResolvedValue(null);

      const result = await repo.findInstanceById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createInstance', () => {
    it('creates instance with all fields', async () => {
      mockPrisma.mCPServerInstance.create.mockResolvedValue(instanceRecord);

      const result = await repo.createInstance({
        projectId: 'proj-1' as ProjectId,
        templateId: 'tmpl-1',
        name: 'my-odoo',
        transport: 'sse',
        url: 'http://odoo.prod.com/mcp',
        envSecretKeys: { ODOO_URL: 'url-secret' },
      });

      expect(result.name).toBe('my-odoo');
      expect(result.status).toBe('active');
      expect(mockPrisma.mCPServerInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'proj-1',
            templateId: 'tmpl-1',
            name: 'my-odoo',
            status: 'active',
          }),
        }),
      );
    });
  });

  describe('updateInstance', () => {
    it('updates specified fields only', async () => {
      const updatedRecord = { ...instanceRecord, displayName: 'Updated' };
      mockPrisma.mCPServerInstance.update.mockResolvedValue(updatedRecord);

      const result = await repo.updateInstance('inst-1', { displayName: 'Updated' });

      expect(result.displayName).toBe('Updated');
      expect(mockPrisma.mCPServerInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inst-1' },
          data: { displayName: 'Updated' },
        }),
      );
    });

    it('updates status', async () => {
      const pausedRecord = { ...instanceRecord, status: 'paused' };
      mockPrisma.mCPServerInstance.update.mockResolvedValue(pausedRecord);

      const result = await repo.updateInstance('inst-1', { status: 'paused' });

      expect(result.status).toBe('paused');
    });
  });

  describe('deleteInstance', () => {
    it('deletes instance by id', async () => {
      mockPrisma.mCPServerInstance.delete.mockResolvedValue(instanceRecord);

      await repo.deleteInstance('inst-1');

      expect(mockPrisma.mCPServerInstance.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inst-1' },
        }),
      );
    });
  });

  // ─── Mapper edge cases ────────────────────────────────────

  describe('mapper edge cases', () => {
    it('maps null template fields to undefined', async () => {
      mockPrisma.mCPServerTemplate.findUnique.mockResolvedValue({
        ...templateRecord,
        command: null,
        defaultEnv: null,
        url: null,
        toolPrefix: null,
      });

      const result = await repo.findTemplateById('tmpl-1');

      expect(result?.command).toBeUndefined();
      expect(result?.defaultEnv).toBeUndefined();
      expect(result?.url).toBeUndefined();
      expect(result?.toolPrefix).toBeUndefined();
    });

    it('maps null instance fields to undefined', async () => {
      mockPrisma.mCPServerInstance.findUnique.mockResolvedValue({
        ...instanceRecord,
        templateId: null,
        displayName: null,
        description: null,
        command: null,
        envSecretKeys: null,
        url: null,
        toolPrefix: null,
      });

      const result = await repo.findInstanceById('inst-1');

      expect(result?.templateId).toBeUndefined();
      expect(result?.displayName).toBeUndefined();
      expect(result?.description).toBeUndefined();
      expect(result?.command).toBeUndefined();
      expect(result?.envSecretKeys).toBeUndefined();
      expect(result?.url).toBeUndefined();
      expect(result?.toolPrefix).toBeUndefined();
    });
  });
});
