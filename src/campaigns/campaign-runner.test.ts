/**
 * Campaign runner tests — audience filtering, template interpolation, send tracking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCampaignRunner, interpolateTemplate } from './campaign-runner.js';
import type { CampaignRunner, CampaignRunnerDeps } from './campaign-runner.js';
import { createLogger } from '@/observability/logger.js';

// ─── Mocks ──────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
    },
    campaignSend: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

function createMockProactiveMessenger() {
  return {
    send: vi.fn(),
    schedule: vi.fn(),
    cancel: vi.fn(),
  };
}

// ─── interpolateTemplate ────────────────────────────────────────

describe('interpolateTemplate', () => {
  it('replaces {{name}} with contact name', () => {
    const result = interpolateTemplate('Hola {{name}}, bienvenido', { name: 'Juan' });
    expect(result).toBe('Hola Juan, bienvenido');
  });

  it('replaces {{displayName}} with display name when present', () => {
    const result = interpolateTemplate('Hola {{displayName}}', {
      name: 'Juan',
      displayName: 'Juanito',
    });
    expect(result).toBe('Hola Juanito');
  });

  it('falls back to name when displayName is missing', () => {
    const result = interpolateTemplate('Hola {{displayName}}', { name: 'Juan' });
    expect(result).toBe('Hola Juan');
  });

  it('replaces multiple placeholders', () => {
    const result = interpolateTemplate(
      '{{name}} ({{email}}) - {{phone}}',
      { name: 'Ana', email: 'ana@test.com', phone: '+5491155550000' },
    );
    expect(result).toBe('Ana (ana@test.com) - +5491155550000');
  });

  it('leaves unknown placeholders untouched', () => {
    const result = interpolateTemplate('Hola {{unknown}}', { name: 'Juan' });
    expect(result).toBe('Hola {{unknown}}');
  });

  it('replaces missing optional fields with empty string', () => {
    const result = interpolateTemplate('Tel: {{phone}}', { name: 'Juan' });
    expect(result).toBe('Tel: ');
  });
});

// ─── executeCampaign ────────────────────────────────────────────

describe('createCampaignRunner', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let messenger: ReturnType<typeof createMockProactiveMessenger>;
  let runner: CampaignRunner;

  beforeEach(() => {
    prisma = createMockPrisma();
    messenger = createMockProactiveMessenger();

    runner = createCampaignRunner({
      prisma: prisma as unknown as CampaignRunnerDeps['prisma'],
      proactiveMessenger: messenger,
      logger: createLogger({ name: 'test' }),
    });
  });

  it('returns error when campaign not found', async () => {
    prisma.campaign.findUnique.mockResolvedValue(null);

    const result = await runner.executeCampaign('nonexistent');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not found');
    }
  });

  it('returns error when campaign is not active', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'draft',
      channel: 'whatsapp',
      template: 'test',
      audienceFilter: {},
    });

    const result = await runner.executeCampaign('c1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('draft');
    }
  });

  it('filters contacts by tags', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'active',
      channel: 'whatsapp',
      template: 'Hola {{name}}',
      audienceFilter: { tags: ['prospect'] },
    });
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.campaign.update.mockResolvedValue({});

    await runner.executeCampaign('c1');

     
    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        tags: { hasEvery: ['prospect'] },
      },
    });
  });

  it('filters contacts by role', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'active',
      channel: 'whatsapp',
      template: 'Hola {{name}}',
      audienceFilter: { role: 'customer' },
    });
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.campaign.update.mockResolvedValue({});

    await runner.executeCampaign('c1');

     
    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        role: 'customer',
      },
    });
  });

  it('skips contacts without identifier for channel', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'active',
      channel: 'whatsapp',
      template: 'Hola {{name}}',
      audienceFilter: {},
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'ct1', name: 'NoPhone', phone: null, telegramId: null, slackId: null },
    ]);
    prisma.campaign.update.mockResolvedValue({});

    const result = await runner.executeCampaign('c1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(1);
      expect(result.value.sent).toBe(0);
    }
  });

  it('sends messages and tracks results', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'active',
      channel: 'whatsapp',
      template: 'Hola {{name}}',
      audienceFilter: {},
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'ct1', name: 'Juan', phone: '+5491155550001', telegramId: null, slackId: null },
      { id: 'ct2', name: 'Ana', phone: '+5491155550002', telegramId: null, slackId: null },
    ]);
    prisma.campaignSend.create.mockResolvedValue({ id: 'send1' });
    messenger.send
      .mockResolvedValueOnce({ success: true, channelMessageId: 'msg1' })
      .mockResolvedValueOnce({ success: false, error: 'Rate limited' });
    prisma.campaignSend.update.mockResolvedValue({});
    prisma.campaign.update.mockResolvedValue({});

    const result = await runner.executeCampaign('c1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalContacts).toBe(2);
      expect(result.value.sent).toBe(1);
      expect(result.value.failed).toBe(1);
      expect(result.value.skipped).toBe(0);
    }

    // Verify message interpolation
     
    expect(messenger.send).toHaveBeenCalledTimes(2);
    const firstCall = messenger.send.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    expect(firstCall?.at(0)).toMatchObject({
      content: 'Hola Juan',
      recipientIdentifier: '+5491155550001',
    });
  });

  it('marks campaign as completed after execution', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'active',
      channel: 'telegram',
      template: 'Hi',
      audienceFilter: {},
    });
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.campaign.update.mockResolvedValue({});

    await runner.executeCampaign('c1');

     
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ status: 'completed' }),
    });
  });

  it('handles send exceptions gracefully', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'active',
      channel: 'whatsapp',
      template: 'Hi {{name}}',
      audienceFilter: {},
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'ct1', name: 'Juan', phone: '+5491155550001', telegramId: null, slackId: null },
    ]);
    prisma.campaignSend.create.mockResolvedValue({ id: 'send1' });
    messenger.send.mockRejectedValue(new Error('Network error'));
    prisma.campaignSend.update.mockResolvedValue({});
    prisma.campaign.update.mockResolvedValue({});

    const result = await runner.executeCampaign('c1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.failed).toBe(1);
    }

    // Verify send row marked as failed
     
    expect(prisma.campaignSend.update).toHaveBeenCalledWith({
      where: { id: 'send1' },
      data: { status: 'failed', error: 'Network error' },
    });
  });

  it('resolves telegram recipient from telegramId', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      status: 'active',
      channel: 'telegram',
      template: 'Hi',
      audienceFilter: {},
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'ct1', name: 'Juan', phone: null, telegramId: '123456', slackId: null },
    ]);
    prisma.campaignSend.create.mockResolvedValue({ id: 'send1' });
    messenger.send.mockResolvedValue({ success: true });
    prisma.campaignSend.update.mockResolvedValue({});
    prisma.campaign.update.mockResolvedValue({});

    await runner.executeCampaign('c1');

    const firstCall = messenger.send.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    expect(firstCall?.at(0)).toMatchObject({
      channel: 'telegram',
      recipientIdentifier: '123456',
    });
  });
});
