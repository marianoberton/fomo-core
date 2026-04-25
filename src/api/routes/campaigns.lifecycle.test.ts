/**
 * Campaign lifecycle endpoint tests — pause/resume/cancel + send marks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { campaignRoutes } from './campaigns.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface MockPrisma {
  campaign: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  campaignSend: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contact: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

function createApp(): { app: FastifyInstance; prisma: MockPrisma } {
  const prisma: MockPrisma = {
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    campaignSend: { findUnique: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  const deps = {
    ...createMockDeps(),
    prisma: prisma as unknown as ReturnType<typeof createMockDeps>['prisma'],
  };
  const app = Fastify();
  app.addHook('onRequest', async (request) => { request.apiKeyProjectId = null; });
  registerErrorHandler(app);
  campaignRoutes(app, deps);
  return { app, prisma };
}

// ─── pause ──────────────────────────────────────────────────────

describe('POST /projects/:projectId/campaigns/:id/pause', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('pauses an active campaign', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1',
      projectId: 'proj-1',
      agentId: 'agent-1',
      status: 'active',
    });
    prisma.campaign.update.mockResolvedValue({
      id: 'camp-1',
      status: 'paused',
      pausedAt: new Date('2026-04-24T10:00:00Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/pause',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { status: string; pausedAt: string };
    };
    expect(body.data.status).toBe('paused');
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'paused' }),
      }),
    );
  });

  it('rejects pause when campaign is not active', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', status: 'draft',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/pause',
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('returns 404 when campaign not in project', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-other', status: 'active',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/pause',
    });

    expect(response.statusCode).toBe(404);
  });
});

// ─── resume ─────────────────────────────────────────────────────

describe('POST /projects/:projectId/campaigns/:id/resume', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resumes a paused campaign', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', agentId: 'agent-1', status: 'paused',
    });
    prisma.campaign.update.mockResolvedValue({
      id: 'camp-1', status: 'active', resumedAt: new Date(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/resume',
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'active', pausedAt: null }),
      }),
    );
  });

  it('rejects resume when campaign is not paused', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', status: 'active',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/resume',
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });
});

// ─── cancel ─────────────────────────────────────────────────────

describe('POST /projects/:projectId/campaigns/:id/cancel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('cancels an active campaign', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', agentId: 'agent-1', status: 'active',
    });
    prisma.campaign.update.mockResolvedValue({
      id: 'camp-1', status: 'cancelled', cancelledAt: new Date(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/cancel',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { status: string; cancelledAt: string };
    };
    expect(body.data.status).toBe('cancelled');
  });

  it('cancels a paused campaign', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', status: 'paused',
    });
    prisma.campaign.update.mockResolvedValue({
      id: 'camp-1', status: 'cancelled', cancelledAt: new Date(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/cancel',
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects cancel when already completed', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', status: 'completed',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/cancel',
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('rejects cancel when already cancelled', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', status: 'cancelled',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/cancel',
    });

    expect(response.statusCode).toBe(409);
  });
});

// ─── mark-delivered ─────────────────────────────────────────────

describe('POST /projects/:projectId/campaigns/:id/sends/:sendId/mark-delivered', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks a sent send as delivered', async () => {
    const { app, prisma } = createApp();
    prisma.campaignSend.findUnique.mockResolvedValue({
      id: 'send-1',
      campaignId: 'camp-1',
      contactId: 'c-1',
      status: 'sent',
      campaign: { id: 'camp-1', projectId: 'proj-1' },
    });
    prisma.campaignSend.update.mockResolvedValue({
      id: 'send-1', status: 'delivered', deliveredAt: new Date(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/sends/send-1/mark-delivered',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { sendId: string; status: string };
    };
    expect(body.data.status).toBe('delivered');
  });

  it('rejects when send status is not sent', async () => {
    const { app, prisma } = createApp();
    prisma.campaignSend.findUnique.mockResolvedValue({
      id: 'send-1',
      campaignId: 'camp-1',
      contactId: 'c-1',
      status: 'failed',
      campaign: { id: 'camp-1', projectId: 'proj-1' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/sends/send-1/mark-delivered',
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(prisma.campaignSend.update).not.toHaveBeenCalled();
  });

  it('returns 404 when send belongs to a different campaign', async () => {
    const { app, prisma } = createApp();
    prisma.campaignSend.findUnique.mockResolvedValue({
      id: 'send-1',
      campaignId: 'other-camp',
      status: 'sent',
      campaign: { id: 'other-camp', projectId: 'proj-1' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/sends/send-1/mark-delivered',
    });

    expect(response.statusCode).toBe(404);
  });
});

// ─── mark-unsubscribed ──────────────────────────────────────────

describe('POST /projects/:projectId/campaigns/:id/sends/:sendId/mark-unsubscribed', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks send as unsubscribed and adds opted_out tag to the contact', async () => {
    const { app, prisma } = createApp();
    prisma.campaignSend.findUnique.mockResolvedValue({
      id: 'send-1',
      campaignId: 'camp-1',
      contactId: 'c-1',
      status: 'sent',
      campaign: { id: 'camp-1', projectId: 'proj-1' },
    });
    prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => unknown) => {
      const tx: MockPrisma = {
        campaign: prisma.campaign,
        campaignSend: {
          findUnique: vi.fn(),
          update: vi.fn().mockResolvedValue({
            id: 'send-1', status: 'unsubscribed', unsubscribedAt: new Date(),
          }),
        },
        contact: {
          findUnique: vi.fn().mockResolvedValue({ id: 'c-1', tags: ['vip'] }),
          update: vi.fn().mockResolvedValue({ id: 'c-1', tags: ['vip', 'opted_out'] }),
        },
        $transaction: prisma.$transaction,
      };
      return fn(tx);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/sends/send-1/mark-unsubscribed',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { sendId: string; status: string; contactUpdated: boolean };
    };
    expect(body.data.status).toBe('unsubscribed');
    expect(body.data.contactUpdated).toBe(true);
  });

  it('does not re-tag when contact already has opted_out', async () => {
    const { app, prisma } = createApp();
    prisma.campaignSend.findUnique.mockResolvedValue({
      id: 'send-1',
      campaignId: 'camp-1',
      contactId: 'c-1',
      status: 'sent',
      campaign: { id: 'camp-1', projectId: 'proj-1' },
    });
    const contactUpdateSpy = vi.fn();
    prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => unknown) => {
      const tx: MockPrisma = {
        campaign: prisma.campaign,
        campaignSend: {
          findUnique: vi.fn(),
          update: vi.fn().mockResolvedValue({
            id: 'send-1', status: 'unsubscribed', unsubscribedAt: new Date(),
          }),
        },
        contact: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'c-1', tags: ['vip', 'opted_out'],
          }),
          update: contactUpdateSpy,
        },
        $transaction: prisma.$transaction,
      };
      return fn(tx);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/sends/send-1/mark-unsubscribed',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { contactUpdated: boolean };
    };
    expect(body.data.contactUpdated).toBe(false);
    expect(contactUpdateSpy).not.toHaveBeenCalled();
  });

  it('accepts unsubscribe from any send status (including failed)', async () => {
    const { app, prisma } = createApp();
    prisma.campaignSend.findUnique.mockResolvedValue({
      id: 'send-1',
      campaignId: 'camp-1',
      contactId: 'c-1',
      status: 'failed',
      campaign: { id: 'camp-1', projectId: 'proj-1' },
    });
    prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => unknown) => {
      const tx: MockPrisma = {
        campaign: prisma.campaign,
        campaignSend: {
          findUnique: vi.fn(),
          update: vi.fn().mockResolvedValue({
            id: 'send-1', status: 'unsubscribed', unsubscribedAt: new Date(),
          }),
        },
        contact: {
          findUnique: vi.fn().mockResolvedValue({ id: 'c-1', tags: [] }),
          update: vi.fn().mockResolvedValue({ id: 'c-1', tags: ['opted_out'] }),
        },
        $transaction: prisma.$transaction,
      };
      return fn(tx);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/campaigns/camp-1/sends/send-1/mark-unsubscribed',
    });

    expect(response.statusCode).toBe(200);
  });
});

// ─── PATCH lockout ──────────────────────────────────────────────

describe('PATCH /projects/:projectId/campaigns/:id — cancelled lockout', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects PATCH with status=cancelled', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1', projectId: 'proj-1', status: 'active',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/projects/proj-1/campaigns/camp-1',
      payload: { status: 'cancelled' },
    });

    expect(response.statusCode).toBe(400);
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });
});
