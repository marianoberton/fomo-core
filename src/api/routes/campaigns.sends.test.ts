/**
 * GET /projects/:projectId/campaigns/:id/sends — listing and filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { campaignRoutes } from './campaigns.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface MockPrisma {
  campaign: { findUnique: ReturnType<typeof vi.fn> };
  campaignSend: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
}

function makeSend(overrides: Record<string, unknown> = {}) {
  return {
    id: 'send-1',
    campaignId: 'camp-1',
    agentId: 'agent-1',
    contactId: 'contact-1',
    status: 'sent',
    variantId: null,
    error: null,
    sentAt: new Date('2026-04-24T10:00:00Z'),
    deliveredAt: null,
    unsubscribedAt: null,
    createdAt: new Date('2026-04-24T09:00:00Z'),
    ...overrides,
  };
}

function createApp(): { app: FastifyInstance; prisma: MockPrisma } {
  const prisma: MockPrisma = {
    campaign: { findUnique: vi.fn() },
    campaignSend: { findMany: vi.fn(), count: vi.fn() },
  };
  const deps = {
    ...createMockDeps(),
    prisma: prisma as unknown as ReturnType<typeof createMockDeps>['prisma'],
  };
  const app = Fastify();
  registerErrorHandler(app);
  campaignRoutes(app, deps);
  return { app, prisma };
}

describe('GET /projects/:projectId/campaigns/:id/sends', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns sends for an existing campaign', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-1' });
    prisma.campaignSend.findMany.mockResolvedValue([makeSend()]);
    prisma.campaignSend.count.mockResolvedValue(1);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { items: unknown[]; total: number; limit: number; offset: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.total).toBe(1);
    expect(body.data.limit).toBe(20);
    expect(body.data.offset).toBe(0);
  });

  it('returns empty array when campaign has no sends', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-1' });
    prisma.campaignSend.findMany.mockResolvedValue([]);
    prisma.campaignSend.count.mockResolvedValue(0);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { items: unknown[]; total: number } };
    expect(body.data.items).toHaveLength(0);
    expect(body.data.total).toBe(0);
  });

  it('filters sends by status', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-1' });
    prisma.campaignSend.findMany.mockResolvedValue([makeSend({ status: 'delivered' })]);
    prisma.campaignSend.count.mockResolvedValue(1);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends?status=delivered',
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.campaignSend.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'delivered' }),
      }),
    );
  });

  it('rejects an invalid status value', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-1' });

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends?status=unknown',
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.campaignSend.findMany).not.toHaveBeenCalled();
  });

  it('respects limit and offset for pagination', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-1' });
    const sends = Array.from({ length: 5 }, (_, i) => makeSend({ id: `send-${i}` }));
    prisma.campaignSend.findMany.mockResolvedValue(sends);
    prisma.campaignSend.count.mockResolvedValue(50);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends?limit=5&offset=10',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { items: unknown[]; total: number; limit: number; offset: number };
    };
    expect(body.data.items).toHaveLength(5);
    expect(body.data.total).toBe(50);
    expect(body.data.limit).toBe(5);
    expect(body.data.offset).toBe(10);
    expect(prisma.campaignSend.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    );
  });

  it('returns 404 when campaign does not exist', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/nonexistent/sends',
    });

    expect(response.statusCode).toBe(404);
    expect(prisma.campaignSend.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when campaign belongs to a different project', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-other' });

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends',
    });

    expect(response.statusCode).toBe(404);
    expect(prisma.campaignSend.findMany).not.toHaveBeenCalled();
  });

  it('orders sends by createdAt descending', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-1' });
    prisma.campaignSend.findMany.mockResolvedValue([]);
    prisma.campaignSend.count.mockResolvedValue(0);

    await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends',
    });

    expect(prisma.campaignSend.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('total reflects full count regardless of limit/offset', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', projectId: 'proj-1' });
    prisma.campaignSend.findMany.mockResolvedValue([makeSend()]);
    prisma.campaignSend.count.mockResolvedValue(42);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/campaigns/camp-1/sends?limit=1&offset=0',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { total: number } };
    expect(body.data.total).toBe(42);
  });
});
