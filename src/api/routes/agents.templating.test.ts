/**
 * Unit tests for agent templating endpoints (export-as-template + clone).
 *
 * Both endpoints live in `agents.ts`. Repos are mocked; the AgentTemplateRepository
 * is mocked at the Prisma level (the route instantiates the repo via factory, so
 * we provide a `prisma.agentTemplate` shape that mimics the queries the repo issues).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { agentRoutes } from './agents.js';
import { registerErrorHandler } from '../error-handler.js';
import {
  createMockDeps,
  createSampleProject,
  createSamplePromptLayer,
} from '@/testing/fixtures/routes.js';
import type { AgentConfig, AgentId } from '@/agents/types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Helpers ────────────────────────────────────────────────────

interface SuccessBody<T = unknown> {
  success: boolean;
  data: T;
}

interface ErrorBody {
  success: boolean;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

interface MockAgentTemplatePrisma {
  agentTemplate: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  agent: {
    findUnique: ReturnType<typeof vi.fn>;
  };
}

function buildAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-source' as AgentId,
    projectId: 'proj-1' as ProjectId,
    name: 'Soporte Clínica',
    description: 'Atiende a pacientes',
    promptConfig: {
      identity: 'Eres un agente de soporte.',
      instructions: 'Resolvé dudas y agendá turnos.',
      safety: 'No compartas datos personales.',
    },
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.4,
    },
    toolAllowlist: ['calculator', 'date-time'],
    mcpServers: [],
    channelConfig: { allowedChannels: ['whatsapp'] },
    modes: [],
    type: 'conversational',
    skillIds: [],
    limits: { maxTurns: 12, maxTokensPerTurn: 3000, budgetPerDayUsd: 7.5 },
    status: 'active',
    managerAgentId: null,
    metadata: { archetype: 'customer-support' },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function createApp(opts: { masterKey?: boolean } = {}): {
  app: FastifyInstance;
  deps: ReturnType<typeof createMockDeps>;
  prisma: MockAgentTemplatePrisma;
} {
  const masterKey = opts.masterKey ?? true;

  const prismaMock: MockAgentTemplatePrisma = {
    agentTemplate: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    agent: {
      // requireProjectAccess hits this for project-scoped keys; harmless for master keys
      findUnique: vi.fn().mockResolvedValue({ projectId: 'proj-1' }),
    },
  };

  const deps = {
    ...createMockDeps(),
    prisma: prismaMock as unknown as ReturnType<typeof createMockDeps>['prisma'],
  };

  const app = Fastify();
  // Inject the API-key projectId so the export-as-template handler can see it.
  app.addHook('onRequest', (request, _reply, done) => {
    request.apiKeyProjectId = masterKey ? null : 'proj-1';
    done();
  });
  registerErrorHandler(app);
  agentRoutes(app, deps);

  return { app, deps, prisma: prismaMock };
}

// ─── Schema sanity checks ───────────────────────────────────────

describe('export-as-template — schema validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an explicit slug that is not kebab-case', async () => {
    const { app } = createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: { slug: 'Has Spaces!!' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects oversized tags array', async () => {
    const { app } = createApp();
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: { tags },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── export-as-template ────────────────────────────────────────

describe('POST /projects/:projectId/agents/:agentId/export-as-template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports an agent as a non-official template (master key)', async () => {
    const { app, deps, prisma } = createApp({ masterKey: true });
    const agent = buildAgent();

    deps.projectRepository.findById.mockResolvedValue(createSampleProject());
    deps.agentRepository.findById.mockResolvedValue(agent);
    deps.promptLayerRepository.getActiveLayer.mockImplementation(
      (...args: unknown[]) => {
        const layerType = args[1] as 'identity' | 'instructions' | 'safety';
        return Promise.resolve(
          createSamplePromptLayer({
            layerType,
            content: `[active-${layerType}]`,
          }),
        );
      },
    );
    prisma.agentTemplate.findUnique.mockResolvedValue(null);
    prisma.agentTemplate.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'tmpl-1',
        slug: args.data['slug'],
        name: args.data['name'],
        description: args.data['description'],
        type: args.data['type'],
        icon: null,
        tags: args.data['tags'] ?? [],
        isOfficial: args.data['isOfficial'] ?? false,
        promptConfig: args.data['promptConfig'],
        suggestedTools: args.data['suggestedTools'] ?? [],
        suggestedLlm: args.data['suggestedLlm'] ?? null,
        suggestedModes: args.data['suggestedModes'] ?? null,
        suggestedChannels: args.data['suggestedChannels'] ?? [],
        suggestedMcps: args.data['suggestedMcps'] ?? null,
        suggestedSkillSlugs: args.data['suggestedSkillSlugs'] ?? [],
        metadata: args.data['metadata'] ?? null,
        maxTurns: args.data['maxTurns'] ?? 10,
        maxTokensPerTurn: args.data['maxTokensPerTurn'] ?? 4000,
        budgetPerDayUsd: args.data['budgetPerDayUsd'] ?? 10,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: { tags: ['support', 'clinic'] },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as SuccessBody<{
      slug: string;
      isOfficial: boolean;
      type: string;
      suggestedTools: string[];
      promptConfig: { identity: string };
      metadata: Record<string, unknown>;
    }>;
    expect(body.data.slug).toBe('soporte-clinica');
    expect(body.data.isOfficial).toBe(false); // body.isOfficial defaulted to undefined
    expect(body.data.type).toBe('conversational');
    expect(body.data.suggestedTools).toEqual(['calculator', 'date-time']);
    // Prompt content from project's active layers, not the agent snapshot
    expect(body.data.promptConfig.identity).toBe('[active-identity]');
    expect(body.data.metadata['archetype']).toBe('customer-support');
  });

  it('honors isOfficial=true only for master keys', async () => {
    const { app, deps, prisma } = createApp({ masterKey: false });
    deps.projectRepository.findById.mockResolvedValue(createSampleProject());
    deps.agentRepository.findById.mockResolvedValue(buildAgent());
    deps.promptLayerRepository.getActiveLayer.mockResolvedValue(null);
    prisma.agentTemplate.findUnique.mockResolvedValue(null);
    prisma.agentTemplate.create.mockImplementation(
      (args: { data: { isOfficial: boolean; slug: string } }) =>
        Promise.resolve({
          id: 'tmpl-1',
          slug: args.data.slug,
          name: 'X',
          description: 'X',
          type: 'conversational',
          icon: null,
          tags: [],
          isOfficial: args.data.isOfficial,
          promptConfig: { identity: '', instructions: '', safety: '' },
          suggestedTools: [],
          suggestedLlm: null,
          suggestedModes: null,
          suggestedChannels: [],
          suggestedMcps: null,
          suggestedSkillSlugs: [],
          metadata: null,
          maxTurns: 10,
          maxTokensPerTurn: 4000,
          budgetPerDayUsd: 10,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: { isOfficial: true, slug: 'forced-slug' },
    });

    expect(res.statusCode).toBe(201);
    const callArg = prisma.agentTemplate.create.mock.calls[0]?.[0] as {
      data: { isOfficial: boolean };
    };
    expect(callArg.data.isOfficial).toBe(false); // forced down by non-master key
  });

  it('returns 409 when the slug is already taken', async () => {
    const { app, deps, prisma } = createApp();
    deps.projectRepository.findById.mockResolvedValue(createSampleProject());
    deps.agentRepository.findById.mockResolvedValue(buildAgent());
    prisma.agentTemplate.findUnique.mockResolvedValue({ id: 'tmpl-existing' });

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: { slug: 'taken' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as ErrorBody;
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.['slug']).toBe('taken');
    expect(prisma.agentTemplate.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the project does not exist', async () => {
    const { app, deps } = createApp();
    deps.projectRepository.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when agent is not in the requested project', async () => {
    const { app, deps } = createApp();
    deps.projectRepository.findById.mockResolvedValue(createSampleProject());
    deps.agentRepository.findById.mockResolvedValue(
      buildAgent({ projectId: 'other-project' as ProjectId }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when name yields an empty slug', async () => {
    const { app, deps } = createApp();
    deps.projectRepository.findById.mockResolvedValue(createSampleProject());
    deps.agentRepository.findById.mockResolvedValue(buildAgent({ name: '!!!' }));

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/export-as-template',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── clone-agent ───────────────────────────────────────────────

describe('POST /projects/:projectId/agents/:agentId/clone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clones an agent in the same project (happy path)', async () => {
    const { app, deps } = createApp();
    const source = buildAgent();
    deps.agentRepository.findById.mockResolvedValue(source);
    deps.agentRepository.findByName.mockResolvedValue(null);
    deps.promptLayerRepository.getActiveLayer.mockResolvedValue(null);
    deps.promptLayerRepository.create.mockImplementation(
      (input: { layerType: string }) =>
        Promise.resolve(
          createSamplePromptLayer({
            layerType: input.layerType as 'identity' | 'instructions' | 'safety',
          }),
        ),
    );
    deps.agentRepository.create.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...source,
        id: 'agent-clone' as AgentId,
        name: input['name'] as string,
        metadata: input['metadata'] as Record<string, unknown>,
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/clone',
      payload: { name: 'Soporte Clínica (copy)' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as SuccessBody<{
      id: string;
      name: string;
      metadata: Record<string, unknown>;
    }>;
    expect(body.data.id).toBe('agent-clone');
    expect(body.data.name).toBe('Soporte Clínica (copy)');
    expect((body.data.metadata['clonedFrom'] as { id: string }).id).toBe('agent-source');

    // Both seeding calls fired (3 layers were missing → all created)
    expect(deps.promptLayerRepository.create).toHaveBeenCalledTimes(3);
  });

  it('skips layer seeding when includePromptLayers=false', async () => {
    const { app, deps } = createApp();
    const source = buildAgent();
    deps.agentRepository.findById.mockResolvedValue(source);
    deps.agentRepository.findByName.mockResolvedValue(null);
    deps.agentRepository.create.mockResolvedValue({ ...source, id: 'agent-clone' as AgentId });

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/clone',
      payload: { name: 'Clon Sin Layers', includePromptLayers: false },
    });

    expect(res.statusCode).toBe(201);
    expect(deps.promptLayerRepository.create).not.toHaveBeenCalled();
    expect(deps.promptLayerRepository.getActiveLayer).not.toHaveBeenCalled();
  });

  it('strips template provenance from the cloned metadata', async () => {
    const { app, deps } = createApp();
    const source = buildAgent({
      metadata: {
        archetype: 'customer-support',
        createdFromTemplate: 'customer-support',
        templateVersion: 1,
      },
    });
    deps.agentRepository.findById.mockResolvedValue(source);
    deps.agentRepository.findByName.mockResolvedValue(null);
    deps.promptLayerRepository.getActiveLayer.mockResolvedValue(
      createSamplePromptLayer({ layerType: 'identity' }),
    );
    deps.agentRepository.create.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...source, id: 'agent-clone' as AgentId, metadata: input['metadata'] }),
    );

    await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/clone',
      payload: { name: 'Clon' },
    });

    const callArg = deps.agentRepository.create.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect(callArg.metadata['archetype']).toBe('customer-support');
    expect(callArg.metadata['createdFromTemplate']).toBeUndefined();
    expect(callArg.metadata['templateVersion']).toBeUndefined();
    expect((callArg.metadata['clonedFrom'] as { name: string }).name).toBe('Soporte Clínica');
  });

  it('returns 409 with a suggested name on collision', async () => {
    const { app, deps } = createApp();
    deps.agentRepository.findById.mockResolvedValue(buildAgent());
    deps.agentRepository.findByName.mockResolvedValue(buildAgent({ name: 'Colisión' }));

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/clone',
      payload: { name: 'Colisión' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as ErrorBody;
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.['suggestedName']).toBe('Colisión (copy)');
  });

  it('returns 404 when source agent is in another project', async () => {
    const { app, deps } = createApp();
    deps.agentRepository.findById.mockResolvedValue(
      buildAgent({ projectId: 'other-project' as ProjectId }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/clone',
      payload: { name: 'Clon' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects empty name (schema)', async () => {
    const { app } = createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/agents/agent-source/clone',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
