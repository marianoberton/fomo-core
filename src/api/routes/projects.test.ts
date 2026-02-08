/**
 * Tests for project CRUD routes.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { projectRoutes } from './projects.js';
import { registerErrorHandler } from '../error-handler.js';
import { createMockDeps, createSampleProject } from '@/testing/fixtures/routes.js';

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

function createApp(): { app: FastifyInstance; deps: ReturnType<typeof createMockDeps> } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  projectRoutes(app, deps);
  return { app, deps };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('project routes', () => {
  // ── GET /projects ───────────────────────────────────────────

  describe('GET /projects', () => {
    it('returns a list of projects', async () => {
      const { app, deps } = createApp();
      const sample = createSampleProject();
      deps.projectRepository.list.mockResolvedValue([sample]);

      const res = await app.inject({ method: 'GET', url: '/projects' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody<unknown[]>;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it('returns an empty array when no projects exist', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.list.mockResolvedValue([]);

      const res = await app.inject({ method: 'GET', url: '/projects' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody<unknown[]>;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });

    it('passes owner filter to repository', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.list.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/projects?owner=alice' });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.projectRepository.list).toHaveBeenCalledWith({
        owner: 'alice',
        status: undefined,
        tags: undefined,
      });
    });

    it('passes status filter to repository', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.list.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/projects?status=paused' });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.projectRepository.list).toHaveBeenCalledWith({
        owner: undefined,
        status: 'paused',
        tags: undefined,
      });
    });

    it('splits tags query param into an array', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.list.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/projects?tags=a,b,c' });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.projectRepository.list).toHaveBeenCalledWith({
        owner: undefined,
        status: undefined,
        tags: ['a', 'b', 'c'],
      });
    });
  });

  // ── GET /projects/:id ──────────────────────────────────────

  describe('GET /projects/:id', () => {
    it('returns a project by id', async () => {
      const { app, deps } = createApp();
      const sample = createSampleProject();
      deps.projectRepository.findById.mockResolvedValue(sample);

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('returns 404 when project is not found', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.findById.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/projects/missing-id' });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('missing-id');
    });
  });

  // ── POST /projects ─────────────────────────────────────────

  describe('POST /projects', () => {
    const validBody = {
      name: 'New Project',
      owner: 'alice',
      config: { provider: 'anthropic' },
    };

    it('creates a project and returns 201', async () => {
      const { app, deps } = createApp();
      const created = createSampleProject({ name: 'New Project' });
      deps.projectRepository.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('passes parsed input to repository.create', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.create.mockResolvedValue(createSampleProject());

      await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'With Extras',
          owner: 'bob',
          description: 'A described project',
          environment: 'staging',
          tags: ['alpha', 'beta'],
          config: { provider: 'openai' },
        }),
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.projectRepository.create).toHaveBeenCalledWith({
        name: 'With Extras',
        owner: 'bob',
        description: 'A described project',
        environment: 'staging',
        tags: ['alpha', 'beta'],
        config: { provider: 'openai' },
      });
    });

    it('returns 400 when body is empty (ZodError)', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when name is missing', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: 'alice', config: {} }),
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when owner is missing', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Valid', config: {} }),
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when config is missing', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Valid', owner: 'alice' }),
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── PUT /projects/:id ──────────────────────────────────────

  describe('PUT /projects/:id', () => {
    it('updates a project and returns 200', async () => {
      const { app, deps } = createApp();
      const updated = createSampleProject({ name: 'Updated Name' });
      deps.projectRepository.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PUT',
        url: '/projects/proj-1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('passes partial fields to repository.update', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.update.mockResolvedValue(createSampleProject());

      await app.inject({
        method: 'PUT',
        url: '/projects/proj-1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'paused', tags: ['updated'] }),
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.projectRepository.update).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          status: 'paused',
          tags: ['updated'],
        }),
      );
    });

    it('returns 404 when project is not found', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.update.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/projects/missing-id',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Does Not Matter' }),
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('missing-id');
    });
  });

  // ── DELETE /projects/:id ───────────────────────────────────

  describe('DELETE /projects/:id', () => {
    it('deletes a project and returns 200', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.delete.mockResolvedValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/projects/proj-1' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody<{ deleted: boolean }>;
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('calls repository.delete with the correct id', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.delete.mockResolvedValue(true);

      await app.inject({ method: 'DELETE', url: '/projects/proj-99' });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.projectRepository.delete).toHaveBeenCalledWith('proj-99');
    });

    it('returns 404 when project is not found', async () => {
      const { app, deps } = createApp();
      deps.projectRepository.delete.mockResolvedValue(false);

      const res = await app.inject({ method: 'DELETE', url: '/projects/missing-id' });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('missing-id');
    });
  });
});
