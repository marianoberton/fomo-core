/**
 * Project routes — CRUD operations for agent projects.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentConfig, ProjectId } from '@/core/types.js';
import { loadProjectConfig } from '@/config/loader.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

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

const importProjectSchema = z.object({
  filePath: z.string().min(1),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register project CRUD routes. */
export function projectRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { projectRepository } = deps;

  // GET /projects — list with optional filters and pagination
  fastify.get('/projects', async (request, reply) => {
    const query = paginationSchema.merge(projectFiltersSchema).parse(request.query);
    const { limit, offset, ...filterParams } = query;
    const filters = {
      owner: filterParams.owner,
      status: filterParams.status,
      tags: filterParams.tags ? filterParams.tags.split(',') : undefined,
    };
    const projects = await projectRepository.list(filters);
    return sendSuccess(reply, paginate(projects, limit, offset));
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

  // POST /projects/:id/pause
  fastify.post<{ Params: { id: string } }>('/projects/:id/pause', async (request, reply) => {
    const project = await projectRepository.update(request.params.id as ProjectId, {
      status: 'paused',
    });
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // POST /projects/:id/resume
  fastify.post<{ Params: { id: string } }>('/projects/:id/resume', async (request, reply) => {
    const project = await projectRepository.update(request.params.id as ProjectId, {
      status: 'active',
    });
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // POST /projects/import — create a project from a JSON config file
  fastify.post('/projects/import', async (request, reply) => {
    const { filePath } = importProjectSchema.parse(request.body);
    const configResult = await loadProjectConfig(filePath);

    if (!configResult.ok) {
      return sendError(reply, 'CONFIG_ERROR', configResult.error.message, 400);
    }

    const configFile = configResult.value;
    const project = await projectRepository.create({
      name: configFile.name,
      description: configFile.description,
      environment: configFile.environment,
      owner: configFile.owner,
      tags: configFile.tags,
      config: configFile.agentConfig as unknown as AgentConfig,
    });

    return sendSuccess(reply, project, 201);
  });
}
