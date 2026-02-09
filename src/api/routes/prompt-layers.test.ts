import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { promptLayerRoutes } from './prompt-layers.js';
import { registerErrorHandler } from '../error-handler.js';
import {
  createMockDeps,
  createSamplePromptLayer,
} from '@/testing/fixtures/routes.js';
import type { RouteDependencies } from '../types.js';

// ─── Setup ──────────────────────────────────────────────────────

let app: FastifyInstance;
let deps: ReturnType<typeof createMockDeps>;

beforeEach(async () => {
  deps = createMockDeps();
  app = Fastify();
  registerErrorHandler(app);
  await app.register(
    (instance, opts: RouteDependencies, done) => {
      promptLayerRoutes(instance, opts);
      done();
    },
    deps,
  );
  await app.ready();
});

// ─── Tests ──────────────────────────────────────────────────────

describe('GET /projects/:projectId/prompt-layers', () => {
  it('returns layers for a project', async () => {
    const layers = [
      createSamplePromptLayer({ layerType: 'identity' }),
      createSamplePromptLayer({ layerType: 'instructions' }),
    ];
    deps.promptLayerRepository.listByProject.mockResolvedValue(layers);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/prompt-layers',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it('filters by layerType query param', async () => {
    deps.promptLayerRepository.listByProject.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/projects/proj-1/prompt-layers?layerType=identity',
    });

     
    expect(deps.promptLayerRepository.listByProject).toHaveBeenCalledWith(
      'proj-1',
      'identity',
    );
  });
});

describe('GET /projects/:projectId/prompt-layers/active', () => {
  it('returns 3 active layers', async () => {
    const identity = createSamplePromptLayer({ layerType: 'identity' });
    const instructions = createSamplePromptLayer({ layerType: 'instructions' });
    const safety = createSamplePromptLayer({ layerType: 'safety' });

    deps.promptLayerRepository.getActiveLayer.mockImplementation(
      (_projectId: string, type: string) => {
        void _projectId;
        const map: Record<string, unknown> = { identity, instructions, safety };
        return Promise.resolve(map[type] ?? null);
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/prompt-layers/active',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { identity: unknown; instructions: unknown; safety: unknown };
    };
    expect(body.success).toBe(true);
    expect(body.data.identity).toBeTruthy();
    expect(body.data.instructions).toBeTruthy();
    expect(body.data.safety).toBeTruthy();
  });
});

describe('GET /prompt-layers/:id', () => {
  it('returns a layer by ID', async () => {
    const layer = createSamplePromptLayer();
    deps.promptLayerRepository.findById.mockResolvedValue(layer);

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-layers/pl-1',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 404 when layer not found', async () => {
    deps.promptLayerRepository.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-layers/missing',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /projects/:projectId/prompt-layers', () => {
  it('creates a new layer', async () => {
    const created = createSamplePromptLayer({ version: 1 });
    deps.promptLayerRepository.create.mockResolvedValue(created);

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/prompt-layers',
      payload: {
        layerType: 'identity',
        content: 'You are a helpful assistant.',
        createdBy: 'test-user',
        changeReason: 'Initial version',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('rejects invalid layerType', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/prompt-layers',
      payload: {
        layerType: 'invalid',
        content: 'test',
        createdBy: 'test-user',
        changeReason: 'test',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /prompt-layers/:id/activate', () => {
  it('activates a layer', async () => {
    deps.promptLayerRepository.activate.mockResolvedValue(true);

    const response = await app.inject({
      method: 'POST',
      url: '/prompt-layers/pl-1/activate',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 404 when layer not found', async () => {
    deps.promptLayerRepository.activate.mockResolvedValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/prompt-layers/missing/activate',
    });

    expect(response.statusCode).toBe(404);
  });
});
