/**
 * Tests for session routes — CRUD and message retrieval.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { sessionRoutes } from './sessions.js';
import { registerErrorHandler } from '../error-handler.js';
import {
  createMockDeps,
  createSampleSession,
  createSampleProject,
  createSampleMessage,
} from '@/testing/fixtures/routes.js';
import type { ApiResponse } from '../types.js';
import type { Session, StoredMessage } from '@/infrastructure/repositories/session-repository.js';

// ─── Helpers ────────────────────────────────────────────────────

type MockDeps = ReturnType<typeof createMockDeps>;

function createApp(): { app: FastifyInstance; deps: MockDeps } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  sessionRoutes(app, deps);
  return { app, deps };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('session routes', () => {
  let app: FastifyInstance;
  let deps: MockDeps;

  beforeEach(() => {
    const created = createApp();
    app = created.app;
    deps = created.deps;
  });

  // ── GET /projects/:projectId/sessions ──────────────────────

  describe('GET /projects/:projectId/sessions', () => {
    it('returns a list of sessions for the project', async () => {
      const sessions: Session[] = [
        createSampleSession({ id: 'sess-1' as Session['id'] }),
        createSampleSession({ id: 'sess-2' as Session['id'], status: 'closed' }),
      ];
      deps.sessionRepository.listByProject.mockResolvedValue(sessions);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/sessions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<Session[]>;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

       
      expect(deps.sessionRepository.listByProject).toHaveBeenCalledWith(
        'proj-1',
        undefined,
      );
    });

    it('passes the status query parameter when provided', async () => {
      deps.sessionRepository.listByProject.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/sessions?status=active',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<Session[]>;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);

       
      expect(deps.sessionRepository.listByProject).toHaveBeenCalledWith(
        'proj-1',
        'active',
      );
    });
  });

  // ── GET /sessions/:id ──────────────────────────────────────

  describe('GET /sessions/:id', () => {
    it('returns the session when found', async () => {
      const session = createSampleSession();
      deps.sessionRepository.findById.mockResolvedValue(session);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/sess-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<Session>;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();

       
      expect(deps.sessionRepository.findById).toHaveBeenCalledWith('sess-1');
    });

    it('returns 404 when the session is not found', async () => {
      deps.sessionRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as ApiResponse<never>;
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('NOT_FOUND');
      expect(body.error?.message).toContain('nonexistent');
    });
  });

  // ── POST /projects/:projectId/sessions ─────────────────────

  describe('POST /projects/:projectId/sessions', () => {
    it('creates a session and returns 201', async () => {
      const project = createSampleProject();
      const session = createSampleSession();
      deps.projectRepository.findById.mockResolvedValue(project);
      deps.sessionRepository.create.mockResolvedValue(session);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/sessions',
        payload: { metadata: { source: 'web' } },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as ApiResponse<Session>;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();

       
      expect(deps.projectRepository.findById).toHaveBeenCalledWith('proj-1');
       
      expect(deps.sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          metadata: { source: 'web' },
        }),
      );
    });

    it('creates a session with expiresAt when provided', async () => {
      const project = createSampleProject();
      const session = createSampleSession({ expiresAt: new Date('2025-12-31T00:00:00.000Z') });
      deps.projectRepository.findById.mockResolvedValue(project);
      deps.sessionRepository.create.mockResolvedValue(session);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/sessions',
        payload: { expiresAt: '2025-12-31T00:00:00.000Z' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as ApiResponse<Session>;
      expect(body.success).toBe(true);

       
      expect(deps.sessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          expiresAt: new Date('2025-12-31T00:00:00.000Z'),
        }),
      );
    });

    it('creates a session with empty body (all fields optional)', async () => {
      const project = createSampleProject();
      const session = createSampleSession();
      deps.projectRepository.findById.mockResolvedValue(project);
      deps.sessionRepository.create.mockResolvedValue(session);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/sessions',
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as ApiResponse<Session>;
      expect(body.success).toBe(true);
    });

    it('returns 404 if the project does not exist', async () => {
      deps.projectRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/nonexistent/sessions',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as ApiResponse<never>;
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('NOT_FOUND');
      expect(body.error?.message).toContain('nonexistent');

       
      expect(deps.sessionRepository.create).not.toHaveBeenCalled();
    });
  });

  // ── PATCH /sessions/:id/status ─────────────────────────────

  describe('PATCH /sessions/:id/status', () => {
    it('updates the session status', async () => {
      deps.sessionRepository.updateStatus.mockResolvedValue(true);

      const response = await app.inject({
        method: 'PATCH',
        url: '/sessions/sess-1/status',
        payload: { status: 'paused' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<{ updated: boolean }>;
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ updated: true });

       
      expect(deps.sessionRepository.updateStatus).toHaveBeenCalledWith('sess-1', 'paused');
    });

    it('accepts all valid status values', async () => {
      const validStatuses = ['active', 'paused', 'closed', 'expired'] as const;

      for (const status of validStatuses) {
        deps.sessionRepository.updateStatus.mockResolvedValue(true);

        const response = await app.inject({
          method: 'PATCH',
          url: '/sessions/sess-1/status',
          payload: { status },
        });

        expect(response.statusCode).toBe(200);
      }
    });

    it('returns 404 when the session is not found', async () => {
      deps.sessionRepository.updateStatus.mockResolvedValue(false);

      const response = await app.inject({
        method: 'PATCH',
        url: '/sessions/nonexistent/status',
        payload: { status: 'closed' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as ApiResponse<never>;
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('NOT_FOUND');
      expect(body.error?.message).toContain('nonexistent');
    });

    it('returns 400 for an invalid status value', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/sessions/sess-1/status',
        payload: { status: 'invalid-status' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ApiResponse<never>;
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when status field is missing', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/sessions/sess-1/status',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ApiResponse<never>;
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── GET /sessions/:id/messages ─────────────────────────────

  describe('GET /sessions/:id/messages', () => {
    it('returns messages for the session', async () => {
      const session = createSampleSession();
      const messages: StoredMessage[] = [
        createSampleMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
        createSampleMessage({ id: 'msg-2', role: 'assistant', content: 'Hi there' }),
      ];
      deps.sessionRepository.findById.mockResolvedValue(session);
      deps.sessionRepository.getMessages.mockResolvedValue(messages);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/sess-1/messages',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<StoredMessage[]>;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

       
      expect(deps.sessionRepository.findById).toHaveBeenCalledWith('sess-1');
       
      expect(deps.sessionRepository.getMessages).toHaveBeenCalledWith('sess-1');
    });

    it('returns 404 when the session is not found', async () => {
      deps.sessionRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/nonexistent/messages',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as ApiResponse<never>;
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('NOT_FOUND');
      expect(body.error?.message).toContain('nonexistent');

       
      expect(deps.sessionRepository.getMessages).not.toHaveBeenCalled();
    });

    it('returns an empty array when the session has no messages', async () => {
      const session = createSampleSession();
      deps.sessionRepository.findById.mockResolvedValue(session);
      deps.sessionRepository.getMessages.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/sessions/sess-1/messages',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ApiResponse<StoredMessage[]>;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });
});
