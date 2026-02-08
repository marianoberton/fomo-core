/**
 * Project routes — CRUD operations for agent projects.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentConfig, ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  environment: z.enum(['production', 'staging', 'development']).optional(),
  owner: z.string().min(1).max(200),
  tags: z.array(z.string().max(50)).max(20).optional(),
  config: z.record(z.unknown()),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  environment: z.enum(['production', 'staging', 'development']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  config: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'paused', 'deleted']).optional(),
});

const projectFiltersSchema = z.object({
  owner: z.string().optional(),
  status: z.string().optional(),
  tags: z.string().optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register project CRUD routes. */
export function projectRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { projectRepository } = deps;

  // GET /projects — list with optional filters
  fastify.get('/projects', async (request, reply) => {
    const query = projectFiltersSchema.parse(request.query);
    const filters = {
      owner: query.owner,
      status: query.status,
      tags: query.tags ? query.tags.split(',') : undefined,
    };
    const projects = await projectRepository.list(filters);
    return sendSuccess(reply, projects);
  });

  // GET /projects/:id
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const project = await projectRepository.findById(request.params.id as ProjectId);
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // POST /projects
  fastify.post('/projects', async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const project = await projectRepository.create({
      ...input,
      config: input.config as unknown as AgentConfig,
    });
    return sendSuccess(reply, project, 201);
  });

  // PUT /projects/:id
  fastify.put<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const input = updateProjectSchema.parse(request.body);
    const project = await projectRepository.update(
      request.params.id as ProjectId,
      {
        ...input,
        config: input.config ? input.config as unknown as AgentConfig : undefined,
      },
    );
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // DELETE /projects/:id
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const deleted = await projectRepository.delete(request.params.id as ProjectId);
    if (!deleted) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, { deleted: true });
  });
}
