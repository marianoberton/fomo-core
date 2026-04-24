/**
 * trigger-campaign tool tests — schema validation, dry run, integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTriggerCampaignTool } from './trigger-campaign.js';
import type { TriggerCampaignToolOptions } from './trigger-campaign.js';
import type { ExecutableTool } from '@/tools/types.js';
import type { CampaignRunner } from '@/campaigns/campaign-runner.js';
import { ok, err } from '@/core/result.js';
import { NexusError } from '@/core/errors.js';
import { createTestContext } from '@/testing/fixtures/context.js';

function createMockCampaignRunner(): { [K in keyof CampaignRunner]: ReturnType<typeof vi.fn> } {
  return {
    executeCampaign: vi.fn(),
    resolveAudience: vi.fn(),
    checkAndMarkReply: vi.fn(),
  };
}

function createMockPrisma() {
  return {
    campaign: {
      findUnique: vi.fn(),
    },
    contact: {
      count: vi.fn(),
    },
  };
}

// ─── Schema Tests ───────────────────────────────────────────────

describe('trigger-campaign — schema', () => {
  let tool: ExecutableTool;

  beforeEach(() => {
    tool = createTriggerCampaignTool({
      campaignRunner: createMockCampaignRunner() as unknown as CampaignRunner,
      prisma: createMockPrisma() as unknown as TriggerCampaignToolOptions['prisma'],
    });
  });

  it('has correct metadata', () => {
    expect(tool.id).toBe('trigger-campaign');
    expect(tool.riskLevel).toBe('high');
    expect(tool.requiresApproval).toBe(false);
    expect(tool.sideEffects).toBe(true);
    expect(tool.supportsDryRun).toBe(true);
  });

  it('rejects empty input', () => {
    expect(() => tool.inputSchema.parse({})).toThrow();
  });

  it('rejects missing campaignId', () => {
    expect(() => tool.inputSchema.parse({ campaignId: '' })).toThrow();
  });

  it('accepts valid input', () => {
    const result = tool.inputSchema.safeParse({ campaignId: 'campaign-123' });
    expect(result.success).toBe(true);
  });

  it('rejects non-string campaignId', () => {
    expect(() => tool.inputSchema.parse({ campaignId: 123 })).toThrow();
  });
});

// ─── Dry Run Tests ──────────────────────────────────────────────

describe('trigger-campaign — dryRun', () => {
  let tool: ExecutableTool;
  let prisma: ReturnType<typeof createMockPrisma>;
  const ctx = createTestContext({ allowedTools: ['trigger-campaign'] });

  beforeEach(() => {
    prisma = createMockPrisma();
    tool = createTriggerCampaignTool({
      campaignRunner: createMockCampaignRunner() as unknown as CampaignRunner,
      prisma: prisma as unknown as TriggerCampaignToolOptions['prisma'],
    });
  });

  it('returns campaign preview with matching contact count', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      name: 'Test Campaign',
      status: 'active',
      channel: 'whatsapp',
      template: 'Hola {{name}}',
      audienceFilter: { tags: ['prospect'] },
    });
    prisma.contact.count.mockResolvedValue(15);

    const result = await tool.dryRun({ campaignId: 'c1' }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      const output = result.value.output as Record<string, unknown>;
      expect(output['campaignId']).toBe('c1');
      expect(output['matchingContacts']).toBe(15);
      expect(output['name']).toBe('Test Campaign');
      expect(output['preview']).toContain('DRY RUN');
    }
  });

  it('returns error when campaign not found', async () => {
    prisma.campaign.findUnique.mockResolvedValue(null);

    const result = await tool.dryRun({ campaignId: 'nonexistent' }, ctx);

    expect(result.ok).toBe(false);
  });

  it('queries contacts with audience filter', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      name: 'Test',
      status: 'active',
      channel: 'whatsapp',
      template: 'Hi',
      audienceFilter: { tags: ['vip'], role: 'customer' },
    });
    prisma.contact.count.mockResolvedValue(5);

    await tool.dryRun({ campaignId: 'c1' }, ctx);

     
    expect(prisma.contact.count).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        tags: { hasEvery: ['vip'] },
        role: 'customer',
      },
    });
  });
});

// ─── Integration Tests ──────────────────────────────────────────

describe('trigger-campaign — execute', () => {
  let tool: ExecutableTool;
  let campaignRunner: ReturnType<typeof createMockCampaignRunner>;
  const ctx = createTestContext({ allowedTools: ['trigger-campaign'] });

  beforeEach(() => {
    campaignRunner = createMockCampaignRunner();
    tool = createTriggerCampaignTool({
      campaignRunner: campaignRunner as unknown as CampaignRunner,
      prisma: createMockPrisma() as unknown as TriggerCampaignToolOptions['prisma'],
    });
  });

  it('calls campaignRunner.executeCampaign and returns result', async () => {
    campaignRunner.executeCampaign.mockResolvedValue(
      ok({
        campaignId: 'c1',
        totalContacts: 10,
        sent: 8,
        failed: 1,
        skipped: 1,
      }),
    );

    const result = await tool.execute({ campaignId: 'c1' }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      const output = result.value.output as Record<string, unknown>;
      expect(output['sent']).toBe(8);
      expect(output['failed']).toBe(1);
      expect(output['skipped']).toBe(1);
    }

     
    expect(campaignRunner.executeCampaign).toHaveBeenCalledWith('c1');
  });

  it('returns error when campaign runner fails', async () => {
    campaignRunner.executeCampaign.mockResolvedValue(
      err(
        new NexusError({
          message: 'Campaign "c1" execution failed: Campaign not found',
          code: 'CAMPAIGN_EXECUTION_ERROR',
        }),
      ),
    );

    const result = await tool.execute({ campaignId: 'c1' }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Campaign not found');
    }
  });

  it('includes duration in result metadata', async () => {
    campaignRunner.executeCampaign.mockResolvedValue(
      ok({
        campaignId: 'c1',
        totalContacts: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
      }),
    );

    const result = await tool.execute({ campaignId: 'c1' }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
