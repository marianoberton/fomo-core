/**
 * Tests for agent run monitoring routes.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { agentRunRoutes } from './agent-runs.js';
import { registerErrorHandler } from '../error-handler.js';
import {
  createMockDeps,
  createSampleAgentRun,
  createSampleAgentRunStep,
} from '@/testing/fixtures/routes.js';

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
  agentRunRoutes(app, deps);
  return { app, deps };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('agent run routes', () => {
  // ── GET /agent-runs ────────────────────────────────────────

  describe('GET /agent-runs', () => {
    it('returns a list of runs', async () => {
      const { app, deps } = createApp();
      const sample = createSampleAgentRun();
      deps.agentRunRepository.list.mockResolvedValue({ items: [sample], total: 1 });

      const res = await app.inject({ method: 'GET', url: '/agent-runs' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody<{ items: unknown[]; total: number }>;
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.total).toBe(1);
    });

    it('returns empty list when no runs exist', async () => {
      const { app, deps } = createApp();
      deps.agentRunRepository.list.mockResolvedValue({ items: [], total: 0 });

      const res = await app.inject({ method: 'GET', url: '/agent-runs' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody<{ items: unknown[]; total: number }>;
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(0);
    });

    it('passes filters to repository', async () => {
      const { app, deps } = createApp();
      deps.agentRunRepository.list.mockResolvedValue({ items: [], total: 0 });

      await app.inject({
        method: 'GET',
        url: '/agent-runs?status=running&externalProject=f1-simulator',
      });

      expect(deps.agentRunRepository.list).toHaveBeenCalledWith(
        { status: 'running', externalProject: 'f1-simulator', projectId: undefined },
        20,
        0,
      );
    });

    it('passes pagination params', async () => {
      const { app, deps } = createApp();
      deps.agentRunRepository.list.mockResolvedValue({ items: [], total: 0 });

      await app.inject({ method: 'GET', url: '/agent-runs?limit=5&offset=10' });

      expect(deps.agentRunRepository.list).toHaveBeenCalledWith(
        expect.any(Object),
        5,
        10,
      );
    });
  });

  // ── GET /agent-runs/:id ────────────────────────────────────

  describe('GET /agent-runs/:id', () => {
    it('returns a run with steps', async () => {
      const { app, deps } = createApp();
      const sample = createSampleAgentRun({ steps: [createSampleAgentRunStep()] });
      deps.agentRunRepository.findById.mockResolvedValue(sample);

      const res = await app.inject({ method: 'GET', url: '/agent-runs/run-1' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('returns 404 when run is not found', async () => {
      const { app, deps } = createApp();
      deps.agentRunRepository.findById.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/agent-runs/missing-id' });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── POST /agent-runs ──────────────────────────────────────

  describe('POST /agent-runs', () => {
    const validBody = {
      projectId: 'proj-1',
      runType: 'feature',
      description: 'New feature pipeline',
      totalSteps: 3,
    };

    it('creates a run and returns 201', async () => {
      const { app, deps } = createApp();
      const created = createSampleAgentRun();
      deps.agentRunRepository.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/agent-runs',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
    });

    it('accepts externalProject and metadata', async () => {
      const { app, deps } = createApp();
      deps.agentRunRepository.create.mockResolvedValue(createSampleAgentRun());

      await app.inject({
        method: 'POST',
        url: '/agent-runs',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          externalProject: 'f1-fantasy-simulator',
          metadata: { pipelineId: 'abc' },
        }),
      });

      expect(deps.agentRunRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          externalProject: 'f1-fantasy-simulator',
          metadata: { pipelineId: 'abc' },
        }),
      );
    });

    it('returns 400 when projectId is missing', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'POST',
        url: '/agent-runs',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runType: 'feature', totalSteps: 3 }),
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as ErrorBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when totalSteps is missing', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'POST',
        url: '/agent-runs',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-1', runType: 'feature' }),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /agent-runs/:id ─────────────────────────────────

  describe('PATCH /agent-runs/:id', () => {
    it('updates a run status', async () => {
      const { app, deps } = createApp();
      const updated = createSampleAgentRun({ status: 'done' });
      deps.agentRunRepository.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: '/agent-runs/run-1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done', durationMs: 5000 }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
    });

    it('returns 404 when run is not found', async () => {
      const { app, deps } = createApp();
      deps.agentRunRepository.update.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/agent-runs/missing-id',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'failed' }),
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid status', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'PATCH',
        url: '/agent-runs/run-1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'invalid-status' }),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /agent-runs/:id/steps ────────────────────────────

  describe('POST /agent-runs/:id/steps', () => {
    it('creates a step and returns 201', async () => {
      const { app, deps } = createApp();
      const step = createSampleAgentRunStep();
      deps.agentRunRepository.createStep.mockResolvedValue(step);

      const res = await app.inject({
        method: 'POST',
        url: '/agent-runs/run-1/steps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stepIndex: 0,
          agentName: 'tech-lead',
          input: 'Analyze requirements',
        }),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
    });

    it('returns 400 when agentName is missing', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'POST',
        url: '/agent-runs/run-1/steps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepIndex: 0 }),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /agent-runs/:runId/steps/:stepId ────────────────

  describe('PATCH /agent-runs/:runId/steps/:stepId', () => {
    it('updates a step status', async () => {
      const { app, deps } = createApp();
      const step = createSampleAgentRunStep({ status: 'done' });
      deps.agentRunRepository.updateStep.mockResolvedValue(step);

      const res = await app.inject({
        method: 'PATCH',
        url: '/agent-runs/run-1/steps/step-1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done', output: 'Step completed' }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody;
      expect(body.success).toBe(true);
    });

    it('returns 404 when step is not found', async () => {
      const { app, deps } = createApp();
      deps.agentRunRepository.updateStep.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/agent-runs/run-1/steps/missing-id',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid step status', async () => {
      const { app } = createApp();

      const res = await app.inject({
        method: 'PATCH',
        url: '/agent-runs/run-1/steps/step-1',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'bananas' }),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /agent-runs/:id/steps ────────────────────────────

  describe('GET /agent-runs/:id/steps', () => {
    it('returns steps for a run', async () => {
      const { app, deps } = createApp();
      const steps = [
        createSampleAgentRunStep({ stepIndex: 0 }),
        createSampleAgentRunStep({ stepIndex: 1, agentName: 'backend-dev' }),
      ];
      deps.agentRunRepository.listSteps.mockResolvedValue(steps);

      const res = await app.inject({ method: 'GET', url: '/agent-runs/run-1/steps' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SuccessBody<unknown[]>;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
    });
  });
});
