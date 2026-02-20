/**
 * MCP Server routes — template catalog + per-project instances.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ProjectId } from '@/core/types.js';
import type { MCPServerRepository } from '@/infrastructure/repositories/mcp-server-repository.js';
import type { Logger } from '@/observability/logger.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';

// ─── Schemas ────────────────────────────────────────────────────

const createInstanceSchema = z.object({
  templateId: z.string().optional(),
  name: z.string().min(1).max(100),
  displayName: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  transport: z.enum(['stdio', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  envSecretKeys: z.record(z.string()).optional(),
  url: z.string().optional(),
  toolPrefix: z.string().max(50).optional(),
});

const updateInstanceSchema = z.object({
  displayName: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  transport: z.enum(['stdio', 'sse']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  envSecretKeys: z.record(z.string()).optional(),
  url: z.string().optional(),
  toolPrefix: z.string().max(50).optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
});

// ─── Dependencies ───────────────────────────────────────────────

export interface MCPServerRouteDeps {
  mcpServerRepository: MCPServerRepository;
  logger: Logger;
}

// ─── Route Registration ─────────────────────────────────────────

export function mcpServerRoutes(
  fastify: FastifyInstance,
  deps: MCPServerRouteDeps,
): void {
  const { mcpServerRepository, logger } = deps;

  // ─── List Templates ──────────────────────────────────────────────

  fastify.get(
    '/mcp-server-templates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { category?: string };
      const templates = await mcpServerRepository.listTemplates(query.category);
      return sendSuccess(reply, templates);
    },
  );

  // ─── Get Template ────────────────────────────────────────────────

  fastify.get(
    '/mcp-server-templates/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const template = await mcpServerRepository.findTemplateById(id);
      if (!template) {
        return sendNotFound(reply, 'MCPServerTemplate', id);
      }
      return sendSuccess(reply, template);
    },
  );

  // ─── List Project Instances ──────────────────────────────────────

  fastify.get(
    '/projects/:projectId/mcp-servers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = request.query as { status?: string };
      const instances = await mcpServerRepository.listInstances(
        projectId as ProjectId,
        query.status,
      );
      return sendSuccess(reply, instances);
    },
  );

  // ─── Get Instance ────────────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/mcp-servers/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { projectId: string; id: string };
      const instance = await mcpServerRepository.findInstanceById(id);
      if (!instance) {
        return sendNotFound(reply, 'MCPServerInstance', id);
      }
      return sendSuccess(reply, instance);
    },
  );

  // ─── Create Instance ─────────────────────────────────────────────

  fastify.post(
    '/projects/:projectId/mcp-servers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = createInstanceSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      // If creating from template, pre-fill defaults
      let input = { ...parseResult.data, projectId: projectId as ProjectId };
      if (parseResult.data.templateId) {
        const template = await mcpServerRepository.findTemplateById(parseResult.data.templateId);
        if (!template) {
          return sendNotFound(reply, 'MCPServerTemplate', parseResult.data.templateId);
        }
        // Fill transport, command, args, url from template if not provided
        input = {
          ...input,
          transport: input.transport ?? template.transport,
          command: input.command ?? template.command,
          args: input.args ?? template.args,
          url: input.url ?? template.url,
          toolPrefix: input.toolPrefix ?? template.toolPrefix,
        } as typeof input;
      }

      try {
        const instance = await mcpServerRepository.createInstance(input);
        logger.info('MCP server instance created', {
          component: 'mcp-servers',
          instanceId: instance.id,
          projectId,
          templateId: parseResult.data.templateId,
        });
        await sendSuccess(reply, instance, 201); return;
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(
            reply,
            'CONFLICT',
            'MCP server with this name already exists in the project',
            409,
          );
        }
        throw error;
      }
    },
  );

  // ─── Update Instance ─────────────────────────────────────────────

  fastify.patch(
    '/projects/:projectId/mcp-servers/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { projectId: string; id: string };
      const parseResult = updateInstanceSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const instance = await mcpServerRepository.updateInstance(id, parseResult.data);
        logger.info('MCP server instance updated', { component: 'mcp-servers', instanceId: id });
        await sendSuccess(reply, instance); return;
      } catch {
        return sendNotFound(reply, 'MCPServerInstance', id);
      }
    },
  );

  // ─── Delete Instance ─────────────────────────────────────────────

  fastify.delete(
    '/projects/:projectId/mcp-servers/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { projectId: string; id: string };

      try {
        await mcpServerRepository.deleteInstance(id);
        logger.info('MCP server instance deleted', { component: 'mcp-servers', instanceId: id });
        return await reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: 'MCP server instance not found' });
      }
    },
  );
}
