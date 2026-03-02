/**
 * Tests for SkillService — composition logic, template creation, parameter resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSkillService } from './skill-service.js';
import type { SkillService } from './skill-service.js';
import type { SkillRepository, SkillTemplate, SkillInstance } from './types.js';

// ─── Mock Repository ────────────────────────────────────────────

function createMockRepository(): { [K in keyof SkillRepository]: ReturnType<typeof vi.fn> } {
  return {
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    listInstances: vi.fn(),
    getInstance: vi.fn(),
    getInstancesByIds: vi.fn(),
    createInstance: vi.fn(),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
  };
}

// ─── Fixtures ───────────────────────────────────────────────────

const TEMPLATE_LEAD_SCORING: SkillTemplate = {
  id: 'tpl-lead',
  name: 'lead-scoring',
  displayName: 'Lead Scoring',
  description: 'Evaluate buying intent',
  category: 'sales',
  instructionsFragment: 'Score leads using {{threshold}} as the minimum score.',
  requiredTools: ['vehicle-lead-score', 'catalog-search'],
  requiredMcpServers: [],
  parametersSchema: {
    properties: { threshold: { type: 'number', default: 70 } },
  },
  tags: ['sales', 'automotive'],
  icon: 'Target',
  isOfficial: true,
  version: 1,
  status: 'published',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const INSTANCE_A: SkillInstance = {
  id: 'inst-a',
  projectId: 'proj-1',
  templateId: 'tpl-lead',
  name: 'lead-scoring',
  displayName: 'Lead Scoring',
  description: null,
  instructionsFragment: 'Score leads using 80 as the minimum score.',
  requiredTools: ['vehicle-lead-score', 'catalog-search'],
  requiredMcpServers: [],
  parameters: { threshold: 80 },
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const INSTANCE_B: SkillInstance = {
  id: 'inst-b',
  projectId: 'proj-1',
  templateId: null,
  name: 'email-comms',
  displayName: 'Email Communication',
  description: 'Send emails',
  instructionsFragment: 'Draft professional emails.',
  requiredTools: ['send-email', 'date-time'],
  requiredMcpServers: ['google-calendar'],
  parameters: null,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const INSTANCE_DISABLED: SkillInstance = {
  id: 'inst-disabled',
  projectId: 'proj-1',
  templateId: null,
  name: 'disabled-skill',
  displayName: 'Disabled',
  description: null,
  instructionsFragment: 'Should not appear.',
  requiredTools: ['http-request'],
  requiredMcpServers: [],
  parameters: null,
  status: 'disabled',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ──────────────────────────────────────────────────────

describe('SkillService', () => {
  let repo: ReturnType<typeof createMockRepository>;
  let service: SkillService;

  beforeEach(() => {
    repo = createMockRepository();
    service = createSkillService({ repository: repo });
  });

  // ─── Template Browsing ──────────────────────────────────────

  describe('listTemplates', () => {
    it('delegates to repository', async () => {
      repo.listTemplates.mockResolvedValue([TEMPLATE_LEAD_SCORING]);
      const result = await service.listTemplates('sales');
      expect(repo.listTemplates).toHaveBeenCalledWith('sales');
      expect(result).toHaveLength(1);
    });
  });

  describe('getTemplate', () => {
    it('returns template by ID', async () => {
      repo.getTemplate.mockResolvedValue(TEMPLATE_LEAD_SCORING);
      const result = await service.getTemplate('tpl-lead');
      expect(result).toEqual(TEMPLATE_LEAD_SCORING);
    });

    it('returns null for missing template', async () => {
      repo.getTemplate.mockResolvedValue(null);
      const result = await service.getTemplate('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── Instance CRUD ──────────────────────────────────────────

  describe('createInstance', () => {
    it('creates an instance and delegates to repository', async () => {
      repo.createInstance.mockResolvedValue(INSTANCE_A);
      const result = await service.createInstance({
        projectId: 'proj-1',
        templateId: 'tpl-lead',
        name: 'lead-scoring',
        displayName: 'Lead Scoring',
        instructionsFragment: 'Score leads.',
      });
      expect(repo.createInstance).toHaveBeenCalled();
      expect(result.id).toBe('inst-a');
    });
  });

  describe('createFromTemplate', () => {
    it('creates instance from template with defaults', async () => {
      repo.getTemplate.mockResolvedValue(TEMPLATE_LEAD_SCORING);
      repo.createInstance.mockImplementation(async (input) => ({
        ...INSTANCE_A,
        instructionsFragment: input.instructionsFragment,
      }));

      const result = await service.createFromTemplate('proj-1', 'tpl-lead');

      expect(repo.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          templateId: 'tpl-lead',
          name: 'lead-scoring',
          requiredTools: ['vehicle-lead-score', 'catalog-search'],
        }),
      );
      // Without parameters, placeholders remain
      expect(result.instructionsFragment).toContain('{{threshold}}');
    });

    it('resolves parameters into instructions', async () => {
      repo.getTemplate.mockResolvedValue(TEMPLATE_LEAD_SCORING);
      repo.createInstance.mockImplementation(async (input) => ({
        ...INSTANCE_A,
        instructionsFragment: input.instructionsFragment,
      }));

      const result = await service.createFromTemplate('proj-1', 'tpl-lead', {
        parameters: { threshold: 80 },
      });

      expect(result.instructionsFragment).toBe(
        'Score leads using 80 as the minimum score.',
      );
    });

    it('allows name override', async () => {
      repo.getTemplate.mockResolvedValue(TEMPLATE_LEAD_SCORING);
      repo.createInstance.mockImplementation(async (input) => ({
        ...INSTANCE_A,
        name: input.name,
      }));

      const result = await service.createFromTemplate('proj-1', 'tpl-lead', {
        name: 'custom-lead-scoring',
      });

      expect(result.name).toBe('custom-lead-scoring');
    });

    it('throws if template not found', async () => {
      repo.getTemplate.mockResolvedValue(null);
      await expect(
        service.createFromTemplate('proj-1', 'nonexistent'),
      ).rejects.toThrow('Skill template not found: nonexistent');
    });
  });

  // ─── Composition ────────────────────────────────────────────

  describe('composeForAgent', () => {
    it('returns empty composition for no skills', async () => {
      const result = await service.composeForAgent([]);
      expect(result).toEqual({
        mergedInstructions: '',
        mergedTools: [],
        mergedMcpServers: [],
      });
      expect(repo.getInstancesByIds).not.toHaveBeenCalled();
    });

    it('composes single skill', async () => {
      repo.getInstancesByIds.mockResolvedValue([INSTANCE_A]);

      const result = await service.composeForAgent(['inst-a']);

      expect(result.mergedInstructions).toContain('## Lead Scoring');
      expect(result.mergedInstructions).toContain('Score leads using 80');
      expect(result.mergedTools).toEqual(['vehicle-lead-score', 'catalog-search']);
      expect(result.mergedMcpServers).toEqual([]);
    });

    it('composes multiple skills with deduplication', async () => {
      const instanceWithOverlap: SkillInstance = {
        ...INSTANCE_B,
        requiredTools: ['send-email', 'date-time', 'catalog-search'], // overlaps with INSTANCE_A
      };

      repo.getInstancesByIds.mockResolvedValue([INSTANCE_A, instanceWithOverlap]);

      const result = await service.composeForAgent(['inst-a', 'inst-b']);

      // Instructions are concatenated with separator
      expect(result.mergedInstructions).toContain('## Lead Scoring');
      expect(result.mergedInstructions).toContain('---');
      expect(result.mergedInstructions).toContain('## Email Communication');

      // Tools are deduplicated
      expect(result.mergedTools).toContain('vehicle-lead-score');
      expect(result.mergedTools).toContain('catalog-search');
      expect(result.mergedTools).toContain('send-email');
      expect(result.mergedTools).toContain('date-time');
      // catalog-search appears in both but should only be listed once
      expect(result.mergedTools.filter((t) => t === 'catalog-search')).toHaveLength(1);

      // MCP servers merged
      expect(result.mergedMcpServers).toEqual(['google-calendar']);
    });

    it('preserves skillIds order', async () => {
      repo.getInstancesByIds.mockResolvedValue([INSTANCE_B, INSTANCE_A]); // DB returns in different order

      const result = await service.composeForAgent(['inst-a', 'inst-b']); // specified order

      // Instructions should follow skillIds order, not DB return order
      const aIndex = result.mergedInstructions.indexOf('Lead Scoring');
      const bIndex = result.mergedInstructions.indexOf('Email Communication');
      expect(aIndex).toBeLessThan(bIndex);
    });

    it('filters out disabled skills', async () => {
      repo.getInstancesByIds.mockResolvedValue([INSTANCE_A, INSTANCE_DISABLED]);

      const result = await service.composeForAgent(['inst-a', 'inst-disabled']);

      expect(result.mergedInstructions).toContain('Lead Scoring');
      expect(result.mergedInstructions).not.toContain('Should not appear');
      expect(result.mergedTools).not.toContain('http-request');
    });

    it('returns empty if all skills are disabled', async () => {
      repo.getInstancesByIds.mockResolvedValue([INSTANCE_DISABLED]);

      const result = await service.composeForAgent(['inst-disabled']);

      expect(result.mergedInstructions).toBe('');
      expect(result.mergedTools).toEqual([]);
      expect(result.mergedMcpServers).toEqual([]);
    });
  });
});
