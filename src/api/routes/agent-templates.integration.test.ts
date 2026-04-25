/**
 * AgentTemplate integration tests — catalog read + agent materialization.
 *
 * Covers:
 *  - GET /agent-templates → list with filters
 *  - GET /agent-templates/:slug → get by slug, 404 on missing
 *  - POST /projects/:id/agents/from-template → creates agent with template defaults
 *  - Overrides applied on top of template defaults
 *  - Warnings emitted when suggested channels lack credentials
 *
 * NOTE: AgentTemplate is a global catalog table not cleared by reset().
 * We seed a minimal test template in beforeAll and remove it in afterAll.
 *
 * CONSTRAINT: The test server only registers tools: calculator, date-time,
 * json-transform. Templates must use only those tools in suggestedTools to
 * avoid "Tool X is not registered" validation errors.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import type { ProjectId } from '@/core/types.js';

// ─── Constants ───────────────────────────────────────────────────

const API_KEY = 'at-integration-test-key';
const AUTH = { authorization: `Bearer ${API_KEY}` } as const;

// Stable slug for the test template — deterministic across runs
const TEST_TEMPLATE_SLUG = '__test-outbound-integration__';

// ─── Suite ───────────────────────────────────────────────────────

describe('AgentTemplate integration', () => {
  let testDb: TestDatabase;
  let server: FastifyInstance;
  let projectId: ProjectId;
  let templateId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server = await createTestServer({ prisma: testDb.prisma, apiKey: API_KEY });

    // Seed a minimal test template (global catalog — not tied to project).
    // upsert so re-runs don't fail on unique constraint.
    const tmpl = await testDb.prisma.agentTemplate.upsert({
      where: { slug: TEST_TEMPLATE_SLUG },
      update: {},
      create: {
        slug: TEST_TEMPLATE_SLUG,
        name: 'Test Outbound (integration)',
        description: 'Test template for integration tests only',
        type: 'process',
        icon: null,
        tags: ['test', 'outbound'],
        isOfficial: false,
        promptConfig: {
          identity: 'You are a test outbound agent.',
          instructions: 'Send messages to contacts.',
          safety: 'Do not share personal data.',
        } as unknown as Prisma.InputJsonValue,
        // Only use tools registered in the test server
        suggestedTools: ['calculator', 'date-time'],
        suggestedLlm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.5,
        } as unknown as Prisma.InputJsonValue,
        suggestedModes: [] as unknown as Prisma.InputJsonValue,
        suggestedChannels: ['whatsapp'],
        suggestedMcps: [] as unknown as Prisma.InputJsonValue,
        suggestedSkillSlugs: [],
        metadata: { archetype: 'test' } as unknown as Prisma.InputJsonValue,
        maxTurns: 8,
        maxTokensPerTurn: 3000,
        budgetPerDayUsd: 10.0,
        version: 1,
      },
    });
    templateId = tmpl.id;
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;
  });

  afterAll(async () => {
    // Clean up test template (don't pollute the shared test DB)
    await testDb.prisma.agentTemplate.deleteMany({
      where: { slug: TEST_TEMPLATE_SLUG },
    });
    await server.close();
    await testDb.disconnect();
  });

  // ─── Test 1: List and get templates ───────────────────────────

  describe('GET /agent-templates', () => {
    it('lists the seeded test template', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/agent-templates',
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        data: { items: Array<{ slug: string; type: string }>; total: number };
      };
      expect(body.data.total).toBeGreaterThanOrEqual(1);
      const testTmpl = body.data.items.find((t) => t.slug === TEST_TEMPLATE_SLUG);
      expect(testTmpl).toBeDefined();
      expect(testTmpl?.type).toBe('process');
    });

    it('filters by type', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/agent-templates?type=process',
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        data: { items: Array<{ type: string }> };
      };
      expect(body.data.items.every((t) => t.type === 'process')).toBe(true);
    });

    it('filters by tag', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/agent-templates?tag=outbound',
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        data: { items: Array<{ slug: string; tags: string[] }> };
      };
      const testTmpl = body.data.items.find((t) => t.slug === TEST_TEMPLATE_SLUG);
      expect(testTmpl).toBeDefined();
      expect(testTmpl?.tags).toContain('outbound');
    });

    it('filters by full-text search on name/description', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/agent-templates?q=integration',
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        data: { items: Array<{ slug: string }> };
      };
      const found = body.data.items.find((t) => t.slug === TEST_TEMPLATE_SLUG);
      expect(found).toBeDefined();
    });

    it('GET /agent-templates/:slug returns the template', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/agent-templates/${TEST_TEMPLATE_SLUG}`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        data: {
          id: string;
          slug: string;
          name: string;
          suggestedTools: string[];
          promptConfig: { identity: string };
        };
      };
      expect(body.data.slug).toBe(TEST_TEMPLATE_SLUG);
      expect(body.data.id).toBe(templateId);
      expect(body.data.suggestedTools).toContain('calculator');
      expect(body.data.promptConfig.identity).toBe('You are a test outbound agent.');
    });

    it('GET /agent-templates/:slug returns 404 for unknown slug', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/agent-templates/non-existent-slug-xyz',
        headers: AUTH,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Test 2: Create agent from template ───────────────────────

  describe('POST /projects/:projectId/agents/from-template', () => {
    it('creates an agent with type, tools, and promptConfig from the template', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: {
          templateSlug: TEST_TEMPLATE_SLUG,
          name: 'Test Reactivadora',
        },
      });
      expect(res.statusCode).toBe(201);

      const body = JSON.parse(res.body) as {
        data: {
          agent: {
            id: string;
            name: string;
            type: string;
            toolAllowlist: string[];
            status: string;
            metadata: { createdFromTemplate: string; templateVersion: number };
          };
          warnings: string[];
        };
      };

      expect(body.data.agent.name).toBe('Test Reactivadora');
      expect(body.data.agent.type).toBe('process');
      expect(body.data.agent.toolAllowlist).toContain('calculator');
      expect(body.data.agent.toolAllowlist).toContain('date-time');
      expect(body.data.agent.status).toBe('active');
      // warnings is present (even if empty for the channel warning)
      expect(Array.isArray(body.data.warnings)).toBe(true);
      // whatsapp channel likely not configured → warning expected
      expect(body.data.warnings.some((w) => w.includes('channel'))).toBe(true);
      // metadata tracks template provenance
      expect(body.data.agent.metadata.createdFromTemplate).toBe(TEST_TEMPLATE_SLUG);
      expect(body.data.agent.metadata.templateVersion).toBe(1);
    });

    it('agent is persisted in the DB and discoverable via GET /agents', async () => {
      await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: { templateSlug: TEST_TEMPLATE_SLUG, name: 'Persisted Agent' },
      });

      const listRes = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/agents`,
        headers: AUTH,
      });
      expect(listRes.statusCode).toBe(200);
      const list = JSON.parse(listRes.body) as {
        data: { items?: Array<{ name: string }> } | Array<{ name: string }>;
      };
      // Handle both array and paginated response shapes
      const items = Array.isArray(list.data)
        ? list.data
        : (list.data as { items: Array<{ name: string }> }).items ?? [];
      const found = items.find((a) => a.name === 'Persisted Agent');
      expect(found).toBeDefined();
    });

    it('returns 409 when an agent with the same name already exists', async () => {
      // First creation
      await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: { templateSlug: TEST_TEMPLATE_SLUG, name: 'Duplicate Name' },
      });

      // Second creation with same name
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: { templateSlug: TEST_TEMPLATE_SLUG, name: 'Duplicate Name' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('returns 404 for a non-existent template slug', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: { templateSlug: 'slug-does-not-exist', name: 'Irrelevant' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Test 3: Overrides applied on top of template defaults ────

  describe('overrides on from-template', () => {
    it('override promptConfig.identity replaces template identity only', async () => {
      const customIdentity = 'Custom identity for this specific agent';

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: {
          templateSlug: TEST_TEMPLATE_SLUG,
          name: 'Override Agent',
          overrides: {
            promptConfig: {
              identity: customIdentity,
            },
          },
        },
      });
      expect(res.statusCode).toBe(201);

      const body = JSON.parse(res.body) as {
        data: { agent: { id: string } };
      };
      const agentId = body.data.agent.id;

      // Read agent from DB to verify promptConfig
      const agent = await testDb.prisma.agent.findUnique({ where: { id: agentId } });
      const pc = agent?.promptConfig as { identity: string; instructions: string; safety: string };
      expect(pc.identity).toBe(customIdentity);
      // Other layers come from template defaults
      expect(pc.instructions).toBe('Send messages to contacts.');
      expect(pc.safety).toBe('Do not share personal data.');
    });

    it('override toolAllowlist replaces the template suggestedTools', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: {
          templateSlug: TEST_TEMPLATE_SLUG,
          name: 'Tool Override Agent',
          overrides: {
            toolAllowlist: ['calculator'],
          },
        },
      });
      expect(res.statusCode).toBe(201);

      const body = JSON.parse(res.body) as {
        data: { agent: { toolAllowlist: string[] } };
      };
      expect(body.data.agent.toolAllowlist).toEqual(['calculator']);
    });

    it('returns 400 when override toolAllowlist contains an unregistered tool', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/from-template`,
        headers: AUTH,
        payload: {
          templateSlug: TEST_TEMPLATE_SLUG,
          name: 'Bad Tool Agent',
          overrides: {
            toolAllowlist: ['tool-that-does-not-exist'],
          },
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
