import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import { createWebhookRepository } from './webhook-repository.js';

const PROJECT_ID = 'proj_test' as ProjectId;

function makeWebhookRecord(overrides?: Record<string, unknown>) {
  return {
    id: 'webhook_abc',
    projectId: PROJECT_ID,
    agentId: 'agent_123',
    name: 'New Lead Webhook',
    description: 'Triggered when a new lead is created',
    triggerPrompt: 'New lead received: {{name}} ({{email}})',
    secretEnvVar: 'WEBHOOK_SECRET',
    allowedIps: ['192.168.1.1', '10.0.0.1'],
    status: 'active',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    webhook: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('WebhookRepository', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a webhook with all fields', async () => {
      vi.mocked(mockPrisma.webhook.create).mockResolvedValue(makeWebhookRecord() as never);

      const repo = createWebhookRepository(mockPrisma);
      const webhook = await repo.create({
        projectId: PROJECT_ID,
        name: 'New Lead Webhook',
        triggerPrompt: 'New lead: {{name}}',
        secretEnvVar: 'WEBHOOK_SECRET',
      });

      expect(webhook.id).toBe('webhook_abc');
      expect(webhook.name).toBe('New Lead Webhook');
      expect(webhook.status).toBe('active');
      expect(mockPrisma.webhook.create).toHaveBeenCalledOnce();
    });

    it('creates a webhook with minimal fields', async () => {
      vi.mocked(mockPrisma.webhook.create).mockResolvedValue(
        makeWebhookRecord({ secretEnvVar: null, allowedIps: [] }) as never
      );

      const repo = createWebhookRepository(mockPrisma);
      const webhook = await repo.create({
        projectId: PROJECT_ID,
        name: 'Simple Webhook',
        triggerPrompt: 'Event received',
      });

      expect(webhook.secretEnvVar).toBeUndefined();
      expect(webhook.allowedIps).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns webhook when found', async () => {
      vi.mocked(mockPrisma.webhook.findUnique).mockResolvedValue(makeWebhookRecord() as never);

      const repo = createWebhookRepository(mockPrisma);
      const webhook = await repo.findById('webhook_abc');

      expect(webhook?.id).toBe('webhook_abc');
      expect(webhook?.name).toBe('New Lead Webhook');
    });

    it('returns null when not found', async () => {
      vi.mocked(mockPrisma.webhook.findUnique).mockResolvedValue(null as never);

      const repo = createWebhookRepository(mockPrisma);
      const webhook = await repo.findById('nonexistent');

      expect(webhook).toBeNull();
    });
  });

  describe('update', () => {
    it('updates webhook fields', async () => {
      vi.mocked(mockPrisma.webhook.update).mockResolvedValue(
        makeWebhookRecord({ status: 'paused' }) as never
      );

      const repo = createWebhookRepository(mockPrisma);
      const webhook = await repo.update('webhook_abc', { status: 'paused' });

      expect(webhook.status).toBe('paused');
      expect(mockPrisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'webhook_abc' },
        data: { status: 'paused' },
      });
    });
  });

  describe('delete', () => {
    it('deletes a webhook', async () => {
      vi.mocked(mockPrisma.webhook.delete).mockResolvedValue(makeWebhookRecord() as never);

      const repo = createWebhookRepository(mockPrisma);
      await repo.delete('webhook_abc');

      expect(mockPrisma.webhook.delete).toHaveBeenCalledWith({
        where: { id: 'webhook_abc' },
      });
    });
  });

  describe('list', () => {
    it('lists all webhooks by project', async () => {
      vi.mocked(mockPrisma.webhook.findMany).mockResolvedValue([
        makeWebhookRecord(),
        makeWebhookRecord({ id: 'webhook_def', name: 'Another Webhook' }),
      ] as never);

      const repo = createWebhookRepository(mockPrisma);
      const webhooks = await repo.list(PROJECT_ID);

      expect(webhooks).toHaveLength(2);
      expect(webhooks[0].name).toBe('New Lead Webhook');
    });
  });

  describe('listActive', () => {
    it('lists only active webhooks', async () => {
      vi.mocked(mockPrisma.webhook.findMany).mockResolvedValue([
        makeWebhookRecord(),
      ] as never);

      const repo = createWebhookRepository(mockPrisma);
      await repo.listActive(PROJECT_ID);

      expect(mockPrisma.webhook.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
