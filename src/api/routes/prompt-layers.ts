/**
 * Prompt layer routes — create, list, and activate independently-versioned prompt layers.
 *
 * Each project has 3 layer types (identity, instructions, safety).
 * Layers are immutable. Rollback = deactivate current, activate previous.
 * Only one layer per (project, layerType) can be active at a time.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProjectId, PromptLayerId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const layerTypeEnum = z.enum(['identity', 'instructions', 'safety']);

const createPromptLayerSchema = z.object({
  layerType: layerTypeEnum,
  content: z.string().min(1).max(100_000),
  createdBy: z.string().min(1).max(200),
  changeReason: z.string().min(1).max(2000),
  performanceNotes: z.string().max(5000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register prompt layer routes. */
export function promptLayerRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { promptLayerRepository } = deps;

  // GET /projects/:projectId/prompt-layers — list all layers (optional ?layerType= filter)
  fastify.get<{ Params: { projectId: string }; Querystring: { layerType?: string } }>(
    '/projects/:projectId/prompt-layers',
    async (request, reply) => {
      const { layerType } = request.query;
      const parsedType = layerType ? layerTypeEnum.parse(layerType) : undefined;

      const layers = await promptLayerRepository.listByProject(
        request.params.projectId as ProjectId,
        parsedType,
      );
      return sendSuccess(reply, layers);
    },
  );

  // GET /projects/:projectId/prompt-layers/active — get the 3 active layers
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/prompt-layers/active',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;
      const [identity, instructions, safety] = await Promise.all([
        promptLayerRepository.getActiveLayer(projectId, 'identity'),
        promptLayerRepository.getActiveLayer(projectId, 'instructions'),
        promptLayerRepository.getActiveLayer(projectId, 'safety'),
      ]);
      return sendSuccess(reply, { identity, instructions, safety });
    },
  );

  // GET /prompt-layers/:id — get a specific layer by ID
  fastify.get<{ Params: { id: string } }>(
    '/prompt-layers/:id',
    async (request, reply) => {
      const layer = await promptLayerRepository.findById(
        request.params.id as PromptLayerId,
      );
      if (!layer) return sendNotFound(reply, 'PromptLayer', request.params.id);
      return sendSuccess(reply, layer);
    },
  );

  // POST /projects/:projectId/prompt-layers — create a new layer version
  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/prompt-layers',
    async (request, reply) => {
      const input = createPromptLayerSchema.parse(request.body);
      const layer = await promptLayerRepository.create({
        ...input,
        projectId: request.params.projectId as ProjectId,
      });
      return sendSuccess(reply, layer, 201);
    },
  );

  // POST /prompt-layers/:id/activate — activate a specific layer
  fastify.post<{ Params: { id: string } }>(
    '/prompt-layers/:id/activate',
    async (request, reply) => {
      const activated = await promptLayerRepository.activate(
        request.params.id as PromptLayerId,
      );
      if (!activated) return sendNotFound(reply, 'PromptLayer', request.params.id);
      return sendSuccess(reply, { activated: true });
    },
  );
}
