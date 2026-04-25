/**
 * Campaign dry-run endpoint tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { campaignRoutes } from './campaigns.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface MockPrismaCampaign {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  contact: {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
}

function createApp(): { app: FastifyInstance; prisma: MockPrismaCampaign } {
  const prisma: MockPrismaCampaign = {
    campaign: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const deps = { ...createMockDeps(), prisma: prisma as unknown as ReturnType<typeof createMockDeps>['prisma'] };
  const app = Fastify();
  app.addHook('onRequest', async (request) => { request.apiKeyProjectId = null; });
  registerErrorHandler(app);
  campaignRoutes(app, deps);
  return { app, prisma };
}

describe('POST /projects/:projectId/campaigns/:id/dry-run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders previews with interpolated template and estimates cost', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      template: 'Hola {{name}}',
      channel: 'whatsapp',
      audienceFilter: { tags: ['vip'] },
    });
    // Parallel counts + findMany: order of resolution: count, count, count, findMany
    prisma.contact.count
      .mockResolvedValueOnce(5) // total
      .mockResolvedValueOnce(4) // withPhone
      .mockResolvedValueOnce(2); // withEmail
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c-1', name: 'Juan', displayName: null, phone: '+54911', email: null },
      { id: 'c-2', name: 'Ana', displayName: null, phone: null, email: 'ana@test.com' },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/projects/p1/campaigns/c1/dry-run',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        campaignId: string;
        totalAudience: number;
        estimatedTotalCostUsd: number;
        coverage: { withPhone: number; withEmail: number };
        previews: { contactId: string; rendered: string }[];
      };
    }>();
    expect(body.data.totalAudience).toBe(5);
    expect(body.data.coverage.withPhone).toBe(4);
    expect(body.data.coverage.withEmail).toBe(2);
    expect(body.data.estimatedTotalCostUsd).toBeGreaterThan(0);
    expect(body.data.previews[0]?.rendered).toBe('Hola Juan');
    expect(body.data.previews[1]?.rendered).toBe('Hola Ana');
  });

  it('returns 404 when campaign project mismatches', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'other',
      template: 'x',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/projects/p1/campaigns/c1/dry-run',
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns empty previews when audience is empty', async () => {
    const { app, prisma } = createApp();
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'p1',
      template: 'Hola',
      channel: 'whatsapp',
      audienceFilter: { tags: ['vip'] },
    });
    prisma.contact.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.contact.findMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'POST',
      url: '/projects/p1/campaigns/c1/dry-run',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { totalAudience: number; previews: unknown[] } }>();
    expect(body.data.totalAudience).toBe(0);
    expect(body.data.previews).toEqual([]);
  });
});
