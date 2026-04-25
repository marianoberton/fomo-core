/**
 * Campaign integration tests — full lifecycle via real Postgres.
 *
 * Covers:
 *  - Campaign CRUD + send stats aggregation
 *  - Pause / resume / cancel state machine
 *  - Audience-source MCP validation (server not found → 400)
 *
 * The `execute` endpoint requires `campaignRunner` (Redis), which is null
 * in the test server. Tests that need execution are marked `.skip` and noted.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { Prisma } from '@prisma/client';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import type { ProjectId } from '@/core/types.js';

// ─── Constants ───────────────────────────────────────────────────

const API_KEY = 'camp-integration-test-key';
const AUTH = { authorization: `Bearer ${API_KEY}` } as const;

// ─── Helpers ─────────────────────────────────────────────────────

/** Insert a minimal active agent directly into the DB. */
async function seedAgent(
  testDb: TestDatabase,
  projectId: ProjectId,
): Promise<string> {
  const agent = await testDb.prisma.agent.create({
    data: {
      id: nanoid(),
      projectId,
      name: `Test Agent ${nanoid(6)}`,
      status: 'active',
      type: 'process',
      promptConfig: {
        identity: 'Test agent',
        instructions: '',
        safety: '',
      } as unknown as Prisma.InputJsonValue,
      toolAllowlist: [],
      skillIds: [],
    },
  });
  return agent.id;
}

/** Insert N contacts directly into the DB. */
async function seedContacts(
  testDb: TestDatabase,
  projectId: ProjectId,
  n: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await testDb.prisma.contact.create({
      data: {
        id: nanoid(),
        projectId,
        name: `Contact ${i}`,
        phone: `+5491100000${i.toString().padStart(3, '0')}`,
        language: 'es',
        tags: [],
      },
    });
    ids.push(c.id);
  }
  return ids;
}

// ─── Suite ───────────────────────────────────────────────────────

describe('Campaign integration', () => {
  let testDb: TestDatabase;
  let server: FastifyInstance;
  let projectId: ProjectId;
  let agentId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server = await createTestServer({ prisma: testDb.prisma, apiKey: API_KEY });
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;
    agentId = await seedAgent(testDb, projectId);
  });

  afterAll(async () => {
    await server.close();
    await testDb.disconnect();
  });

  // ─── Test 1: CRUD lifecycle + sendStats ────────────────────────

  describe('CRUD lifecycle with sendStats', () => {
    it('creates, lists, and gets a campaign with aggregated send stats', async () => {
      // 1. Create campaign
      const createRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'Test Campaign',
          template: 'Hola {{name}}!',
          channel: 'whatsapp',
          audienceFilter: { tags: [] },
        },
      });
      expect(createRes.statusCode).toBe(201);
      const created = (JSON.parse(createRes.body) as { data: { id: string; status: string; name: string } }).data;
      expect(created.name).toBe('Test Campaign');
      expect(created.status).toBe('draft');

      const campaignId = created.id;

      // 2. List campaigns — must find the created one
      const listRes = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
      });
      expect(listRes.statusCode).toBe(200);
      const list = JSON.parse(listRes.body) as { data: { items: Array<{ id: string }>; total: number } };
      expect(list.data.total).toBe(1);
      expect(list.data.items[0]?.id).toBe(campaignId);

      // 3. GET campaign → no sends yet → sendStats all 0
      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}`,
        headers: AUTH,
      });
      expect(getRes.statusCode).toBe(200);
      const fetched = JSON.parse(getRes.body) as {
        data: { id: string; sendStats: { total: number; queued: number; sent: number } };
      };
      expect(fetched.data.sendStats.total).toBe(0);

      // 4. Insert 3 send records directly — 2 queued, 1 sent
      const contacts = await seedContacts(testDb, projectId, 3);
      await testDb.prisma.campaignSend.createMany({
        data: [
          { id: nanoid(), campaignId, agentId, contactId: contacts[0]!, status: 'queued' },
          { id: nanoid(), campaignId, agentId, contactId: contacts[1]!, status: 'queued' },
          { id: nanoid(), campaignId, agentId, contactId: contacts[2]!, status: 'sent' },
        ],
      });

      // 5. GET again → sendStats reflect inserts
      const getAfterRes = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}`,
        headers: AUTH,
      });
      expect(getAfterRes.statusCode).toBe(200);
      const afterStats = JSON.parse(getAfterRes.body) as {
        data: { sendStats: { total: number; queued: number; sent: number } };
      };
      expect(afterStats.data.sendStats.total).toBe(3);
      expect(afterStats.data.sendStats.queued).toBe(2);
      expect(afterStats.data.sendStats.sent).toBe(1);

      // 6. PATCH name
      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}`,
        headers: AUTH,
        payload: { name: 'Renamed Campaign' },
      });
      expect(patchRes.statusCode).toBe(200);
      const patched = JSON.parse(patchRes.body) as { data: { name: string } };
      expect(patched.data.name).toBe('Renamed Campaign');

      // 7. DELETE
      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}`,
        headers: AUTH,
      });
      expect(delRes.statusCode).toBe(204);

      // 8. GET after delete → 404
      const get404 = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}`,
        headers: AUTH,
      });
      expect(get404.statusCode).toBe(404);
    });

    it('mark-delivered transitions send from sent → delivered', async () => {
      const contacts = await seedContacts(testDb, projectId, 1);
      const campaign = await testDb.prisma.campaign.create({
        data: {
          id: nanoid(),
          projectId,
          agentId,
          name: 'Deliver Test',
          template: 'Hello',
          channel: 'whatsapp',
          audienceFilter: {} as Prisma.InputJsonValue,
          status: 'active',
        },
      });
      const send = await testDb.prisma.campaignSend.create({
        data: {
          id: nanoid(),
          campaignId: campaign.id,
          agentId,
          contactId: contacts[0]!,
          status: 'sent',
        },
      });

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaign.id}/sends/${send.id}/mark-delivered`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { data: { status: string; deliveredAt: string } };
      expect(body.data.status).toBe('delivered');
      expect(body.data.deliveredAt).toBeTruthy();
    });

    it('mark-unsubscribed adds opted_out tag to contact', async () => {
      const contacts = await seedContacts(testDb, projectId, 1);
      const campaign = await testDb.prisma.campaign.create({
        data: {
          id: nanoid(),
          projectId,
          agentId,
          name: 'Unsub Test',
          template: 'Bye',
          channel: 'whatsapp',
          audienceFilter: {} as Prisma.InputJsonValue,
          status: 'active',
        },
      });
      const send = await testDb.prisma.campaignSend.create({
        data: {
          id: nanoid(),
          campaignId: campaign.id,
          agentId,
          contactId: contacts[0]!,
          status: 'sent',
        },
      });

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaign.id}/sends/${send.id}/mark-unsubscribed`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { data: { status: string; contactUpdated: boolean } };
      expect(body.data.status).toBe('unsubscribed');
      expect(body.data.contactUpdated).toBe(true);

      // Verify the contact got the tag
      const contact = await testDb.prisma.contact.findUnique({ where: { id: contacts[0]! } });
      expect(contact?.tags).toContain('opted_out');
    });
  });

  // ─── Test 2: Pause / resume / cancel state machine ────────────

  describe('Pause / resume / cancel state machine', () => {
    it('pauses, resumes, and cancels a campaign', async () => {
      // Create campaign and set to active
      const createRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'Lifecycle Campaign',
          template: 'Hola!',
          channel: 'whatsapp',
          audienceFilter: {},
        },
      });
      expect(createRes.statusCode).toBe(201);
      const campaignId = (JSON.parse(createRes.body) as { data: { id: string } }).data.id;

      // Activate via PATCH
      const activateRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}`,
        headers: AUTH,
        payload: { status: 'active' },
      });
      expect(activateRes.statusCode).toBe(200);

      // Pause → status='paused', pausedAt set
      const pauseRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/pause`,
        headers: AUTH,
      });
      expect(pauseRes.statusCode).toBe(200);
      const paused = JSON.parse(pauseRes.body) as { data: { status: string; pausedAt: string } };
      expect(paused.data.status).toBe('paused');
      expect(paused.data.pausedAt).toBeTruthy();

      // Pause again → 409 (not active)
      const pauseAgain = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/pause`,
        headers: AUTH,
      });
      expect(pauseAgain.statusCode).toBe(409);

      // Resume → status='active', resumedAt set
      const resumeRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/resume`,
        headers: AUTH,
      });
      expect(resumeRes.statusCode).toBe(200);
      const resumed = JSON.parse(resumeRes.body) as { data: { status: string; resumedAt: string } };
      expect(resumed.data.status).toBe('active');
      expect(resumed.data.resumedAt).toBeTruthy();

      // Cancel → status='cancelled', cancelledAt set
      const cancelRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/cancel`,
        headers: AUTH,
      });
      expect(cancelRes.statusCode).toBe(200);
      const cancelled = JSON.parse(cancelRes.body) as { data: { status: string; cancelledAt: string } };
      expect(cancelled.data.status).toBe('cancelled');
      expect(cancelled.data.cancelledAt).toBeTruthy();

      // Cancel already-cancelled → 409
      const cancelAgain = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/cancel`,
        headers: AUTH,
      });
      expect(cancelAgain.statusCode).toBe(409);

      // Verify final DB state
      const final = await testDb.prisma.campaign.findUnique({ where: { id: campaignId } });
      expect(final?.status).toBe('cancelled');
      expect(final?.cancelledAt).toBeTruthy();
    });

    it('cannot pause a draft campaign (only active campaigns can be paused)', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'Draft Pause Test',
          template: 'Hello',
          channel: 'whatsapp',
          audienceFilter: {},
        },
      });
      const campaignId = (JSON.parse(createRes.body) as { data: { id: string } }).data.id;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/pause`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(409);
    });

    it('execute returns 503 when campaignRunner is not configured', async () => {
      // Create + activate a campaign
      const createRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'Execute Test',
          template: 'Hello',
          channel: 'whatsapp',
          audienceFilter: {},
        },
      });
      const campaignId = (JSON.parse(createRes.body) as { data: { id: string } }).data.id;

      await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}`,
        headers: AUTH,
        payload: { status: 'active' },
      });

      // Execute → 503 because campaignRunner is null in test server
      const execRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/execute`,
        headers: AUTH,
      });
      expect(execRes.statusCode).toBe(503);
    });
  });

  // ─── Test 3: Audience source validation ────────────────────────

  describe('Audience source validation', () => {
    it('creates campaign with contacts audienceFilter (no audienceSource)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'Contacts Campaign',
          template: 'Hola {{name}}',
          channel: 'whatsapp',
          audienceFilter: { tags: ['prospect'] },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { data: { channel: string } };
      expect(body.data.channel).toBe('whatsapp');
    });

    it('rejects campaign with MCP audienceSource when server is not connected', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'MCP Campaign',
          template: 'Hola',
          channel: 'whatsapp',
          audienceSource: {
            kind: 'mcp',
            serverName: 'hubspot-not-configured',
            toolName: 'search-contacts',
            args: {},
            mapping: { contactIdField: 'id', phoneField: 'phone' },
            ttlHours: 24,
          },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects campaign when neither audienceFilter nor audienceSource is provided', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'No Audience',
          template: 'Hello',
          channel: 'whatsapp',
          // no audienceFilter, no audienceSource
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects campaign when agentId does not belong to the project', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId: 'agent-from-another-project',
          name: 'Bad Agent Campaign',
          template: 'Hello',
          channel: 'whatsapp',
          audienceFilter: {},
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refresh-audience returns 503 when campaignRunner is not configured', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        headers: AUTH,
        payload: {
          agentId,
          name: 'MCP Refresh Test',
          template: 'Hello',
          channel: 'whatsapp',
          audienceFilter: {},
        },
      });
      const campaignId = (JSON.parse(createRes.body) as { data: { id: string } }).data.id;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns/${campaignId}/refresh-audience`,
        headers: AUTH,
      });
      // campaignRunner is null in test server → 503
      expect(res.statusCode).toBe(503);
    });
  });
});
