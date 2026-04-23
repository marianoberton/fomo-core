/**
 * Unit-style tests for admin-chatwoot routes. Uses mocked repositories
 * and the SecretService, so tests run without a database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { adminChatwootRoutes } from './admin-chatwoot.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';
import type { AgentConfig, AgentId } from '@/agents/types.js';
import type { ProjectId } from '@/core/types.js';
import type { Project } from '@/infrastructure/repositories/project-repository.js';

// ─── Fixtures ───────────────────────────────────────────────────

const MASTER_TOKEN = 'nx_master_token_for_tests';

function makeProject(): Project {
  return {
    id: 'proj_fomo' as ProjectId,
    name: 'Fomo',
    description: 'Fomo internal',
    environment: 'production',
    owner: 'admin',
    tags: [],
    config: {} as Project['config'],
    status: 'active',
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
  };
}

function makeAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'agt_fomo_whatsapp' as AgentId,
    projectId: 'proj_fomo' as ProjectId,
    name: 'Fomo WhatsApp',
    promptConfig: { identity: '', instructions: '', safety: '' },
    toolAllowlist: [],
    mcpServers: [],
    skillIds: [],
    channelConfig: { allowedChannels: ['whatsapp'], defaultChannel: 'whatsapp' },
    modes: [],
    type: 'conversational',
    limits: { maxTurns: 10, maxTokensPerTurn: 4000, budgetPerDayUsd: 10 },
    status: 'active',
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
    ...overrides,
  };
}

function makeIntegration(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'int_cw_1',
    projectId: 'proj_fomo' as ProjectId,
    provider: 'chatwoot',
    config: {
      baseUrl: 'https://chatwoot.fomo.tld',
      accountId: 1,
      inboxId: 2,
      agentBotId: 3,
      apiTokenSecretKey: 'CHATWOOT_API_TOKEN',
      webhookSecretKey: 'CHATWOOT_WEBHOOK_SECRET',
    },
    status: 'active',
    createdAt: new Date('2026-04-10'),
    updatedAt: new Date('2026-04-10'),
    ...overrides,
  };
}

interface Fixture {
  app: FastifyInstance;
  deps: ReturnType<typeof createMockDeps>;
}

function buildApp(): Fixture {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);

  // Master-key auth: any request with MASTER_TOKEN is treated as a master key.
  deps.apiKeyService.validateApiKey.mockImplementation((token: string) => {
    if (token === MASTER_TOKEN) {
      return Promise.resolve({ valid: true, projectId: null, scopes: ['*'] });
    }
    return Promise.resolve({ valid: false });
  });

  adminChatwootRoutes(app, deps);
  return { app, deps };
}

const masterAuth = { authorization: `Bearer ${MASTER_TOKEN}` };

// ─── Mock fetch (for Chatwoot health check) ─────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

// ─── Tests ──────────────────────────────────────────────────────

describe('adminChatwootRoutes — auth', () => {
  it('returns 401 when no Bearer token', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/attach',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when a project-scoped key is used', async () => {
    const { app, deps } = buildApp();
    deps.apiKeyService.validateApiKey.mockResolvedValueOnce({
      valid: true,
      projectId: 'proj_other' as ProjectId,
      scopes: ['*'],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/attach',
      headers: { authorization: 'Bearer some-project-scoped-key' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /admin/chatwoot/attach', () => {
  const validBody = {
    projectId: 'proj_fomo',
    agentId: 'agt_fomo_whatsapp',
    baseUrl: 'https://chatwoot.fomo.tld',
    accountId: 1,
    inboxId: 2,
    agentBotId: 3,
    apiToken: 'cw_token_abc',
    webhookSecret: 'cw_whsec_xyz',
  };

  it('attaches a fresh integration, stores secrets, and updates the agent', async () => {
    const { app, deps } = buildApp();
    const integration = makeIntegration();

    deps.projectRepository.findById.mockResolvedValue(makeProject());
    deps.agentRepository.findById.mockResolvedValue(makeAgent());
    deps.secretService.set.mockResolvedValue({
      id: 'sec1',
      projectId: 'proj_fomo',
      key: 'CHATWOOT_API_TOKEN',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    deps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue(null);
    deps.channelIntegrationRepository.create.mockResolvedValue(integration);
    deps.agentRepository.update.mockResolvedValue(makeAgent());

    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/attach',
      headers: masterAuth,
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['integrationId']).toBe('int_cw_1');
    expect(body.data['channelConfigUpdated']).toBe(true);
    expect(body.data['health']).toBe('ok');

    // Secrets were persisted under the default keys.
    expect(deps.secretService.set).toHaveBeenCalledWith(
      'proj_fomo',
      'CHATWOOT_API_TOKEN',
      'cw_token_abc',
      expect.any(String),
    );
    expect(deps.secretService.set).toHaveBeenCalledWith(
      'proj_fomo',
      'CHATWOOT_WEBHOOK_SECRET',
      'cw_whsec_xyz',
      expect.any(String),
    );

    // Integration was created, not updated.
    expect(deps.channelIntegrationRepository.create).toHaveBeenCalledOnce();
    expect(deps.channelIntegrationRepository.update).not.toHaveBeenCalled();

    // Agent's allowedChannels was extended with 'chatwoot'.
    const updateCall = deps.agentRepository.update.mock.calls[0];
    expect(updateCall?.[0]).toBe('agt_fomo_whatsapp');
    const passedConfig = updateCall?.[1] as { channelConfig: { allowedChannels: string[] } };
    expect(passedConfig.channelConfig.allowedChannels).toEqual(['whatsapp', 'chatwoot']);

    // Channel adapter cache was invalidated so new secret is picked up.
    expect(deps.channelResolver.invalidate).toHaveBeenCalledWith('proj_fomo');
  });

  it('is idempotent — second attach updates, does not duplicate or re-add channel', async () => {
    const { app, deps } = buildApp();
    const integration = makeIntegration();
    const agentWithChatwoot = makeAgent({
      channelConfig: { allowedChannels: ['whatsapp', 'chatwoot'], defaultChannel: 'whatsapp' },
    });

    deps.projectRepository.findById.mockResolvedValue(makeProject());
    deps.agentRepository.findById.mockResolvedValue(agentWithChatwoot);
    deps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue(integration);
    deps.channelIntegrationRepository.update.mockResolvedValue(integration);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/attach',
      headers: masterAuth,
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['channelConfigUpdated']).toBe(false);

    expect(deps.channelIntegrationRepository.update).toHaveBeenCalledOnce();
    expect(deps.channelIntegrationRepository.create).not.toHaveBeenCalled();
    // Agent already has 'chatwoot' — don't update.
    expect(deps.agentRepository.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the project does not exist', async () => {
    const { app, deps } = buildApp();
    deps.projectRepository.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/attach',
      headers: masterAuth,
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(deps.secretService.set).not.toHaveBeenCalled();
  });

  it('returns 404 when the agent does not exist (or is in a different project)', async () => {
    const { app, deps } = buildApp();
    deps.projectRepository.findById.mockResolvedValue(makeProject());
    deps.agentRepository.findById.mockResolvedValue(
      makeAgent({ projectId: 'proj_other' as ProjectId }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/attach',
      headers: masterAuth,
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(deps.secretService.set).not.toHaveBeenCalled();
  });

  it('returns health=unreachable when Chatwoot returns non-2xx', async () => {
    const { app, deps } = buildApp();
    deps.projectRepository.findById.mockResolvedValue(makeProject());
    deps.agentRepository.findById.mockResolvedValue(makeAgent());
    deps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue(null);
    deps.channelIntegrationRepository.create.mockResolvedValue(makeIntegration());
    deps.agentRepository.update.mockResolvedValue(makeAgent());

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }));

    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/attach',
      headers: masterAuth,
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['health']).toBe('unreachable');
  });
});

describe('GET /admin/chatwoot/health/:projectId', () => {
  it('returns integration metadata + health flags', async () => {
    const { app, deps } = buildApp();
    deps.projectRepository.findById.mockResolvedValue(makeProject());
    deps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue(makeIntegration());
    deps.secretService.exists.mockResolvedValue(true);
    deps.channelResolver.resolveAdapter.mockResolvedValue({
      channelType: 'chatwoot',
      send: vi.fn(),
      parseInbound: vi.fn(),
      isHealthy: vi.fn().mockResolvedValue(true),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/chatwoot/health/proj_fomo',
      headers: masterAuth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['integrationId']).toBe('int_cw_1');
    expect(body.data['webhookSecretConfigured']).toBe(true);
    expect(body.data['chatwootReachable']).toBe(true);
  });

  it('returns 404 when no integration exists', async () => {
    const { app, deps } = buildApp();
    deps.projectRepository.findById.mockResolvedValue(makeProject());
    deps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/chatwoot/health/proj_fomo',
      headers: masterAuth,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('NOT_ATTACHED');
  });
});

describe('POST /admin/chatwoot/detach/:projectId', () => {
  it('removes the integration and strips chatwoot from each project agent', async () => {
    const { app, deps } = buildApp();
    const integration = makeIntegration();
    const agentA = makeAgent({
      channelConfig: { allowedChannels: ['whatsapp', 'chatwoot'], defaultChannel: 'whatsapp' },
    });
    const agentB = makeAgent({
      id: 'agt_b' as AgentId,
      name: 'Agent B',
      channelConfig: { allowedChannels: ['telegram'] },
    });

    deps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue(integration);
    deps.agentRepository.list.mockResolvedValue([agentA, agentB]);
    deps.agentRepository.update.mockResolvedValue(agentA);
    deps.channelIntegrationRepository.delete.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/detach/proj_fomo',
      headers: masterAuth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['detached']).toBe(true);
    expect(body.data['agentsUpdated']).toBe(1);

    expect(deps.channelIntegrationRepository.delete).toHaveBeenCalledWith('int_cw_1');
    expect(deps.agentRepository.update).toHaveBeenCalledOnce();
    expect(deps.channelResolver.invalidate).toHaveBeenCalledWith('proj_fomo');
  });

  it('is idempotent when no integration exists', async () => {
    const { app, deps } = buildApp();
    deps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/chatwoot/detach/proj_fomo',
      headers: masterAuth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['detached']).toBe(true);
    expect(body.data['alreadyDetached']).toBe(true);
    expect(deps.channelIntegrationRepository.delete).not.toHaveBeenCalled();
  });
});
