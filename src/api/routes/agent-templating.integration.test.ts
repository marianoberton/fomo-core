/**
 * Integration tests for the templating endpoints — real Postgres round-trip.
 *
 * Covers:
 *  - POST /projects/:projectId/agents/:agentId/export-as-template
 *  - POST /projects/:projectId/agents/:agentId/clone
 *  - PUT  /agent-templates/:slug
 *  - DELETE /agent-templates/:slug
 *
 * Test isolation: each beforeEach truncates + re-seeds, but `agent_templates`
 * is a global catalog table that the truncate pipeline does NOT clear (other
 * official templates share the schema). We tag every template the test creates
 * with a `__test-templating-` prefix and clean them up explicitly.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { Prisma } from '@prisma/client';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import type { ProjectId } from '@/core/types.js';

const API_KEY = 'integration-templating-key';
const AUTH = { authorization: `Bearer ${API_KEY}` } as const;

const TEST_TAG = 'zzz-int-templating';

// Helper to seed an agent in the DB. Mirrors agent-repository.create defaults.
async function seedAgent(
  testDb: TestDatabase,
  projectId: ProjectId,
  overrides: Partial<{
    name: string;
    description: string;
    type: 'conversational' | 'process' | 'backoffice';
    toolAllowlist: string[];
    metadata: Record<string, unknown>;
  }> = {},
): Promise<string> {
  const id = nanoid();
  await testDb.prisma.agent.create({
    data: {
      id,
      projectId,
      name: overrides.name ?? `Test Agent ${nanoid(4)}`,
      description: overrides.description ?? 'integration test agent',
      promptConfig: {
        identity: 'Eres un agente de prueba.',
        instructions: 'Responde con cortesía.',
        safety: 'No compartas datos privados.',
      } as unknown as Prisma.InputJsonValue,
      llmConfig: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.4,
      } as unknown as Prisma.InputJsonValue,
      toolAllowlist: overrides.toolAllowlist ?? ['calculator', 'date-time'],
      mcpServers: [] as unknown as Prisma.InputJsonValue,
      channelConfig: {
        allowedChannels: ['whatsapp'],
      } as unknown as Prisma.InputJsonValue,
      modes: [] as unknown as Prisma.InputJsonValue,
      type: overrides.type ?? 'conversational',
      skillIds: [],
      maxTurns: 12,
      maxTokensPerTurn: 3000,
      budgetPerDayUsd: 7.5,
      status: 'active',
      managerAgentId: null,
      metadata: (overrides.metadata ?? { archetype: 'customer-support' }) as unknown as Prisma.InputJsonValue,
    },
  });
  return id;
}

describe('Agent templating integration', () => {
  let testDb: TestDatabase;
  let server: FastifyInstance;
  let projectId: ProjectId;
  // Track every slug we mint so we can clean up the global catalog at the end.
  const createdSlugs = new Set<string>();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server = await createTestServer({ prisma: testDb.prisma, apiKey: API_KEY });
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;
  });

  afterEach(async () => {
    if (createdSlugs.size > 0) {
      await testDb.prisma.agentTemplate.deleteMany({
        where: { slug: { in: Array.from(createdSlugs) } },
      });
      createdSlugs.clear();
    }
  });

  afterAll(async () => {
    await server.close();
    await testDb.disconnect();
  });

  // ─── export-as-template ────────────────────────────────────────

  describe('POST /projects/:projectId/agents/:agentId/export-as-template', () => {
    it('persists a new AgentTemplate from an existing agent', async () => {
      const agentId = await seedAgent(testDb, projectId, {
        name: 'Soporte Integration',
        toolAllowlist: ['calculator', 'date-time'],
        metadata: { archetype: 'customer-support' },
      });

      const slug = `${TEST_TAG}-export-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.toLowerCase();
      createdSlugs.add(slug);

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/${agentId}/export-as-template`,
        headers: AUTH,
        payload: {
          slug,
          name: 'Soporte Exportado',
          description: 'Plantilla derivada de Soporte Integration',
          tags: ['support', 'integration'],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as {
        data: {
          slug: string;
          name: string;
          isOfficial: boolean;
          suggestedTools: string[];
          promptConfig: { identity: string };
          metadata: { archetype: string; exportedFromAgent: { id: string } };
        };
      };
      expect(body.data.slug).toBe(slug);
      expect(body.data.name).toBe('Soporte Exportado');
      expect(body.data.isOfficial).toBe(false);
      expect(body.data.suggestedTools).toEqual(['calculator', 'date-time']);
      expect(body.data.metadata.archetype).toBe('customer-support');
      expect(body.data.metadata.exportedFromAgent.id).toBe(agentId);

      // Verify it's actually in the DB
      const inDb = await testDb.prisma.agentTemplate.findUnique({ where: { slug } });
      expect(inDb).not.toBeNull();
      expect(inDb?.tags).toEqual(['support', 'integration']);
      // Active project layers were used (test-database seeded "You are a helpful test assistant.")
      expect(body.data.promptConfig.identity).toBe('You are a helpful test assistant.');
    });

    it('returns 409 when slug is already taken', async () => {
      const agentId = await seedAgent(testDb, projectId);
      const slug = `${TEST_TAG}-collision-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.toLowerCase();
      createdSlugs.add(slug);

      // Seed an existing template with that slug
      await testDb.prisma.agentTemplate.create({
        data: {
          slug,
          name: 'Existing',
          description: 'taken',
          type: 'conversational',
          tags: [],
          isOfficial: false,
          promptConfig: { identity: 'a', instructions: 'b', safety: 'c' } as unknown as Prisma.InputJsonValue,
          suggestedTools: [],
          suggestedChannels: [],
          suggestedSkillSlugs: [],
        },
      });

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/${agentId}/export-as-template`,
        headers: AUTH,
        payload: { slug },
      });
      expect(res.statusCode).toBe(409);
    });

    it('honors isOfficial=true under master key', async () => {
      const agentId = await seedAgent(testDb, projectId);
      const slug = `${TEST_TAG}-official-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.toLowerCase();
      createdSlugs.add(slug);

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/${agentId}/export-as-template`,
        headers: AUTH,
        payload: { slug, isOfficial: true },
      });
      expect(res.statusCode).toBe(201);
      const inDb = await testDb.prisma.agentTemplate.findUnique({ where: { slug } });
      expect(inDb?.isOfficial).toBe(true);
    });
  });

  // ─── clone-agent ───────────────────────────────────────────────

  describe('POST /projects/:projectId/agents/:agentId/clone', () => {
    it('clones the source agent into the same project', async () => {
      const sourceId = await seedAgent(testDb, projectId, {
        name: 'Original',
        toolAllowlist: ['calculator'],
      });

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/${sourceId}/clone`,
        headers: AUTH,
        payload: { name: 'Original (copy)' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as {
        data: {
          id: string;
          name: string;
          projectId: string;
          toolAllowlist: string[];
          metadata: Record<string, unknown>;
        };
      };
      expect(body.data.name).toBe('Original (copy)');
      expect(body.data.projectId).toBe(projectId);
      expect(body.data.toolAllowlist).toEqual(['calculator']);
      expect((body.data.metadata['clonedFrom'] as { id: string }).id).toBe(sourceId);
      expect(body.data.id).not.toBe(sourceId);

      // Verify in DB the clone is independent
      const cloneDb = await testDb.prisma.agent.findUnique({ where: { id: body.data.id } });
      expect(cloneDb?.name).toBe('Original (copy)');
      const sourceDb = await testDb.prisma.agent.findUnique({ where: { id: sourceId } });
      expect(sourceDb?.name).toBe('Original'); // source untouched
    });

    it('returns 409 with a suggested name on collision', async () => {
      const sourceId = await seedAgent(testDb, projectId, { name: 'Conflicting' });
      // Seed another agent with the requested target name
      await seedAgent(testDb, projectId, { name: 'Conflicting (copy)' });

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/agents/${sourceId}/clone`,
        headers: AUTH,
        payload: { name: 'Conflicting (copy)' },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body) as {
        error: { code: string; details?: { suggestedName?: string } };
      };
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details?.suggestedName).toBeDefined();
    });
  });

  // ─── PUT template ─────────────────────────────────────────────

  describe('PUT /agent-templates/:slug', () => {
    it('updates mutable fields of a non-official template', async () => {
      const slug = `${TEST_TAG}-put-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.toLowerCase();
      createdSlugs.add(slug);

      await testDb.prisma.agentTemplate.create({
        data: {
          slug,
          name: 'Pre-update',
          description: 'old description',
          type: 'conversational',
          tags: ['old'],
          isOfficial: false,
          promptConfig: { identity: 'a', instructions: 'b', safety: 'c' } as unknown as Prisma.InputJsonValue,
          suggestedTools: [],
          suggestedChannels: [],
          suggestedSkillSlugs: [],
        },
      });

      const res = await server.inject({
        method: 'PUT',
        url: `/api/v1/agent-templates/${slug}`,
        headers: AUTH,
        payload: {
          description: 'new description',
          tags: ['new', 'shiny'],
          maxTurns: 20,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        data: { description: string; tags: string[]; maxTurns: number };
      };
      expect(body.data.description).toBe('new description');
      expect(body.data.tags).toEqual(['new', 'shiny']);
      expect(body.data.maxTurns).toBe(20);
    });

    it('rejects unknown fields (slug/type immutability)', async () => {
      const slug = `${TEST_TAG}-immutable-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.toLowerCase();
      createdSlugs.add(slug);

      await testDb.prisma.agentTemplate.create({
        data: {
          slug,
          name: 'Immutable Test',
          description: 'desc',
          type: 'conversational',
          tags: [],
          isOfficial: false,
          promptConfig: { identity: 'a', instructions: 'b', safety: 'c' } as unknown as Prisma.InputJsonValue,
          suggestedTools: [],
          suggestedChannels: [],
          suggestedSkillSlugs: [],
        },
      });

      const res = await server.inject({
        method: 'PUT',
        url: `/api/v1/agent-templates/${slug}`,
        headers: AUTH,
        payload: { slug: 'something-else' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── DELETE template ──────────────────────────────────────────

  describe('DELETE /agent-templates/:slug', () => {
    it('hard-deletes a non-official template', async () => {
      const slug = `${TEST_TAG}-delete-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`.toLowerCase();
      createdSlugs.add(slug);

      await testDb.prisma.agentTemplate.create({
        data: {
          slug,
          name: 'To Delete',
          description: 'temporary',
          type: 'conversational',
          tags: [],
          isOfficial: false,
          promptConfig: { identity: 'a', instructions: 'b', safety: 'c' } as unknown as Prisma.InputJsonValue,
          suggestedTools: [],
          suggestedChannels: [],
          suggestedSkillSlugs: [],
        },
      });

      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/agent-templates/${slug}`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(204);

      const inDb = await testDb.prisma.agentTemplate.findUnique({ where: { slug } });
      expect(inDb).toBeNull();

      // Drop from cleanup set since it's already gone
      createdSlugs.delete(slug);
    });

    it('returns 404 for an unknown slug', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/agent-templates/${TEST_TAG}-does-not-exist`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
