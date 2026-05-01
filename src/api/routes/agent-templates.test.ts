/**
 * Unit tests for AgentTemplate PUT + DELETE — schema validation + happy path
 * with mocked Prisma. The routes instantiate the repository inline so we mock
 * the underlying `prisma.agentTemplate.*` calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { agentTemplateRoutes } from './agent-templates.js';
import { registerErrorHandler } from '../error-handler.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

interface MockTemplatePrisma {
  agentTemplate: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  promptPattern: { findMany: ReturnType<typeof vi.fn> };
  promptPatternVersion: { findFirst: ReturnType<typeof vi.fn> };
}

function fakeTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tmpl-1',
    slug: 'customer-support',
    name: 'Customer Support',
    description: 'Atiende clientes',
    type: 'conversational',
    icon: null,
    tags: ['support'],
    isOfficial: true,
    promptConfig: { identity: 'i', instructions: 'in', safety: 's' },
    suggestedTools: ['calculator'],
    suggestedLlm: null,
    suggestedModes: null,
    suggestedChannels: ['whatsapp'],
    suggestedMcps: null,
    suggestedSkillSlugs: [],
    metadata: null,
    maxTurns: 10,
    maxTokensPerTurn: 4000,
    budgetPerDayUsd: 10,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createApp(opts: { masterKey?: boolean } = {}): {
  app: FastifyInstance;
  prisma: MockTemplatePrisma;
} {
  const masterKey = opts.masterKey ?? true;
  const prisma: MockTemplatePrisma = {
    agentTemplate: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    promptPattern: { findMany: vi.fn().mockResolvedValue([]) },
    promptPatternVersion: { findFirst: vi.fn().mockResolvedValue(null) },
  };

  const deps = {
    ...createMockDeps(),
    prisma: prisma as unknown as ReturnType<typeof createMockDeps>['prisma'],
  };

  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    request.apiKeyProjectId = masterKey ? null : 'proj-1';
    done();
  });
  registerErrorHandler(app);
  agentTemplateRoutes(app, deps);

  return { app, prisma };
}

// ─── PUT ───────────────────────────────────────────────────────

describe('PUT /agent-templates/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unknown body keys (strict schema, prevents slug/type mutation)', async () => {
    const { app } = createApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/agent-templates/customer-support',
      payload: { slug: 'new-slug' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an attempt to change type', async () => {
    const { app } = createApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/agent-templates/customer-support',
      payload: { type: 'process' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when slug does not exist', async () => {
    const { app, prisma } = createApp();
    prisma.agentTemplate.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: '/agent-templates/missing',
      payload: { description: 'updated' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('updates mutable fields with master key', async () => {
    const { app, prisma } = createApp({ masterKey: true });
    prisma.agentTemplate.findUnique.mockResolvedValue(fakeTemplate());
    prisma.agentTemplate.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve(fakeTemplate({ ...args.data })),
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/agent-templates/customer-support',
      payload: {
        description: 'New description',
        tags: ['support', 'priority'],
        suggestedTools: ['calculator', 'date-time'],
        maxTurns: 15,
      },
    });

    expect(res.statusCode).toBe(200);
    const callArg = prisma.agentTemplate.update.mock.calls[0]?.[0] as {
      where: { slug: string };
      data: Record<string, unknown>;
    };
    expect(callArg.where.slug).toBe('customer-support');
    expect(callArg.data['description']).toBe('New description');
    expect(callArg.data['tags']).toEqual(['support', 'priority']);
    expect(callArg.data['maxTurns']).toBe(15);
  });

  it('blocks non-master keys from flipping isOfficial', async () => {
    const { app, prisma } = createApp({ masterKey: false });
    prisma.agentTemplate.findUnique.mockResolvedValue(fakeTemplate());

    const res = await app.inject({
      method: 'PUT',
      url: '/agent-templates/customer-support',
      payload: { isOfficial: true },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as ErrorBody;
    expect(body.error.code).toBe('FORBIDDEN');
    expect(prisma.agentTemplate.update).not.toHaveBeenCalled();
  });
});

// ─── DELETE ────────────────────────────────────────────────────

describe('DELETE /agent-templates/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when slug does not exist', async () => {
    const { app, prisma } = createApp();
    prisma.agentTemplate.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: '/agent-templates/missing',
    });
    expect(res.statusCode).toBe(404);
  });

  it('blocks non-master keys from deleting an official template', async () => {
    const { app, prisma } = createApp({ masterKey: false });
    prisma.agentTemplate.findUnique.mockResolvedValue(fakeTemplate({ isOfficial: true }));

    const res = await app.inject({
      method: 'DELETE',
      url: '/agent-templates/customer-support',
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.agentTemplate.delete).not.toHaveBeenCalled();
  });

  it('deletes a non-official template (non-master allowed)', async () => {
    const { app, prisma } = createApp({ masterKey: false });
    prisma.agentTemplate.findUnique.mockResolvedValue(
      fakeTemplate({ slug: 'custom-tmpl', isOfficial: false }),
    );
    prisma.agentTemplate.delete.mockResolvedValue(fakeTemplate({ slug: 'custom-tmpl' }));

    const res = await app.inject({
      method: 'DELETE',
      url: '/agent-templates/custom-tmpl',
    });
    expect(res.statusCode).toBe(204);
    expect(prisma.agentTemplate.delete).toHaveBeenCalledWith({
      where: { slug: 'custom-tmpl' },
    });
  });

  it('deletes an official template under master key', async () => {
    const { app, prisma } = createApp({ masterKey: true });
    prisma.agentTemplate.findUnique.mockResolvedValue(fakeTemplate({ isOfficial: true }));
    prisma.agentTemplate.delete.mockResolvedValue(fakeTemplate());

    const res = await app.inject({
      method: 'DELETE',
      url: '/agent-templates/customer-support',
    });
    expect(res.statusCode).toBe(204);
    expect(prisma.agentTemplate.delete).toHaveBeenCalled();
  });
});
