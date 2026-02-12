/**
 * E2E tests for REST API CRUD operations.
 * Tests project, session, and prompt layer endpoints with real database.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { ProjectId } from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import { createE2EAgentConfig, seedE2EProject } from './helpers.js';

describe('API CRUD E2E', () => {
  let testDb: TestDatabase;
  let server: FastifyInstance;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server = await createTestServer({ prisma: testDb.prisma });
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  afterAll(async () => {
    await server.close();
    await testDb.disconnect();
  });

  // ─── Health Check ────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { status: string; timestamp: string };
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  // ─── Project CRUD ────────────────────────────────────────────────

  describe('Projects', () => {
    it('POST /projects creates a project', async () => {
      const projectId = nanoid() as ProjectId;
      const config = createE2EAgentConfig(projectId);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'E2E Test Project',
          owner: 'e2e-user',
          tags: ['e2e', 'test'],
          config,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload) as { success: boolean; data: { id: string; name: string; owner: string; tags: string[] } };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('E2E Test Project');
      expect(body.data.owner).toBe('e2e-user');
      expect(body.data.tags).toEqual(['e2e', 'test']);
      expect(body.data.id).toBeDefined();
    });

    it('GET /projects lists all projects (paginated)', async () => {
      await seedE2EProject(testDb);
      await seedE2EProject(testDb);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { items: unknown[]; total: number } };
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.total).toBe(2);
    });

    it('GET /projects?owner=alice filters by owner', async () => {
      // Create project via API with specific owner
      const projectId = nanoid() as ProjectId;
      await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'Alice Project',
          owner: 'alice',
          config: createE2EAgentConfig(projectId),
        },
      });

      await seedE2EProject(testDb); // default owner: test-user

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects?owner=alice',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { items: Array<{ owner: string }>; total: number } };
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.owner).toBe('alice');
    });

    it('GET /projects/:id retrieves a project', async () => {
      const { projectId } = await seedE2EProject(testDb);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { id: string; name: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(projectId);
    });

    it('GET /projects/:id returns 404 for non-existent project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('PUT /projects/:id updates a project', async () => {
      const { projectId } = await seedE2EProject(testDb);

      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/projects/${projectId}`,
        payload: {
          name: 'Updated Name',
          tags: ['updated'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { name: string; tags: string[] } };
      expect(body.data.name).toBe('Updated Name');
      expect(body.data.tags).toEqual(['updated']);
    });

    it('DELETE /projects/:id deletes a project without children', async () => {
      // Create a project without prompt layers (direct DB insert)
      const projectId = nanoid() as ProjectId;
      await testDb.prisma.project.create({
        data: {
          id: projectId,
          name: 'Deletable',
          owner: 'user',
          tags: [],
          configJson: {} as Record<string, unknown>,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);

      // Verify it's gone
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });

  // ─── Session CRUD ────────────────────────────────────────────────

  describe('Sessions', () => {
    let projectId: ProjectId;

    beforeEach(async () => {
      const seed = await seedE2EProject(testDb);
      projectId = seed.projectId;
    });

    it('POST /projects/:projectId/sessions creates a session', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sessions`,
        payload: {
          metadata: { source: 'e2e-test' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload) as { success: boolean; data: { id: string; projectId: string; status: string; metadata: Record<string, unknown> } };
      expect(body.success).toBe(true);
      expect(body.data.projectId).toBe(projectId);
      expect(body.data.status).toBe('active');
      expect(body.data.metadata).toEqual({ source: 'e2e-test' });
    });

    it('POST /projects/:projectId/sessions returns 404 for non-existent project', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects/non-existent/sessions',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it('GET /sessions/:id retrieves a session', async () => {
      // Create session first
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sessions`,
        payload: {},
      });
      const { data: session } = JSON.parse(createResponse.payload) as { data: { id: string } };

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${session.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { id: string } };
      expect(body.data.id).toBe(session.id);
    });

    it('GET /sessions/:id returns 404 for non-existent session', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('PATCH /sessions/:id/status updates session status', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sessions`,
        payload: {},
      });
      const { data: session } = JSON.parse(createResponse.payload) as { data: { id: string } };

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/sessions/${session.id}/status`,
        payload: { status: 'paused' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { updated: boolean } };
      expect(body.data.updated).toBe(true);
    });

    it('GET /projects/:projectId/sessions lists sessions by project (paginated)', async () => {
      // Create multiple sessions
      await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sessions`,
        payload: {},
      });
      await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sessions`,
        payload: {},
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/sessions`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { items: unknown[]; total: number } };
      expect(body.data.items).toHaveLength(2);
      expect(body.data.total).toBe(2);
    });

    it('GET /sessions/:id/messages returns messages for session', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sessions`,
        payload: {},
      });
      const { data: session } = JSON.parse(createResponse.payload) as { data: { id: string } };

      // Add messages directly to DB
      await testDb.prisma.message.create({
        data: {
          id: nanoid(),
          sessionId: session.id,
          role: 'user',
          content: 'Hello',
          createdAt: new Date(),
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${session.id}/messages`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: Array<{ role: string; content: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.role).toBe('user');
      expect(body.data[0]?.content).toBe('Hello');
    });
  });

  // ─── Validation ──────────────────────────────────────────────────

  describe('Request Validation', () => {
    it('POST /projects rejects empty name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: '',
          owner: 'user',
          config: {},
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /projects rejects missing owner', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'Test',
          config: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('PATCH /sessions/:id/status rejects invalid status', async () => {
      const { projectId } = await seedE2EProject(testDb);
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sessions`,
        payload: {},
      });
      const { data: session } = JSON.parse(createResponse.payload) as { data: { id: string } };

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/sessions/${session.id}/status`,
        payload: { status: 'invalid-status' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
