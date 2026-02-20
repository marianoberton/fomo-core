/**
 * Agent routes — CRUD for agents.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { AgentId, AgentMessageId } from '@/agents/types.js';
import { checkChannelCollision } from '@/channels/agent-channel-router.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

// ─── Schemas ────────────────────────────────────────────────────

const mcpServerSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse']).default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  toolPrefix: z.string().optional(),
});

const channelConfigSchema = z.object({
  allowedChannels: z.array(z.string()),
  defaultChannel: z.string().optional(),
});

const promptConfigSchema = z.object({
  identity: z.string().min(1),
  instructions: z.string().optional().default(''),
  safety: z.string().optional().default(''),
});

const limitsSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxTokensPerTurn: z.number().int().positive().optional(),
  budgetPerDayUsd: z.number().positive().optional(),
});

const llmConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama']).optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

const agentModeSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().max(100).optional(),
  promptOverrides: z.object({
    identity: z.string().optional(),
    instructions: z.string().optional(),
    safety: z.string().optional(),
  }).optional(),
  toolAllowlist: z.array(z.string()).optional(),
  mcpServerNames: z.array(z.string()).optional(),
  channelMapping: z.array(z.string()).min(1),
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  promptConfig: promptConfigSchema,
  llmConfig: llmConfigSchema.optional(),
  toolAllowlist: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServerSchema).optional(),
  channelConfig: channelConfigSchema.optional(),
  modes: z.array(agentModeSchema).optional(),
  limits: limitsSchema.optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  promptConfig: promptConfigSchema.optional(),
  llmConfig: llmConfigSchema.optional(),
  toolAllowlist: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServerSchema).optional(),
  channelConfig: channelConfigSchema.optional(),
  modes: z.array(agentModeSchema).optional(),
  limits: limitsSchema.optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
});

const sendMessageSchema = z.object({
  fromAgentId: z.string().min(1),
  content: z.string().min(1),
  context: z.record(z.unknown()).optional(),
  replyToId: z.string().optional(),
  waitForReply: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export function agentRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { agentRepository, agentRegistry, agentComms, logger } = deps;

  // ─── List Agents ────────────────────────────────────────────────

  const listAgentsQuerySchema = z.object({
    status: z.string().optional(),
  });

  fastify.get(
    '/projects/:projectId/agents',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = paginationSchema.merge(listAgentsQuerySchema).parse(request.query);
      const { limit, offset, status } = query;

      let agents;
      if (status === 'active') {
        agents = await agentRepository.listActive(projectId);
      } else {
        agents = await agentRepository.list(projectId);
      }

      return sendSuccess(reply, paginate(agents, limit, offset));
    },
  );

  // ─── Get Agent ──────────────────────────────────────────────────

  fastify.get(
    '/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const agent = await agentRegistry.get(agentId as AgentId);

      if (!agent) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      return sendSuccess(reply, agent);
    },
  );

  // ─── Get Agent by Name ──────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/agents/name/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, name } = request.params as { projectId: string; name: string };

      const agent = await agentRegistry.getByName(projectId, name);

      if (!agent) {
        return sendNotFound(reply, 'Agent', name);
      }

      return sendSuccess(reply, agent);
    },
  );

  // ─── Create Agent ───────────────────────────────────────────────

  fastify.post(
    '/projects/:projectId/agents',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = createAgentSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      const input = {
        projectId,
        ...parseResult.data,
      };

      // Validate no channel collision with other agents
      if (input.modes && input.modes.length > 0) {
        const collision = await checkChannelCollision(
          agentRepository, projectId, undefined, input.modes,
        );
        if (collision) {
          return sendError(
            reply,
            'CHANNEL_COLLISION',
            `Channel "${collision.channel}" is already claimed by agent "${collision.agentName}"`,
            409,
          );
        }
      }

      try {
        const agent = await agentRepository.create(input);
        logger.info('Agent created', { component: 'agents', agentId: agent.id, projectId });
        await sendSuccess(reply, agent, 201); return;
      } catch (error) {
        // Handle unique constraint violation
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(
            reply,
            'CONFLICT',
            'Agent with this name already exists in the project',
            409,
          );
        }
        throw error;
      }
    },
  );

  // ─── Update Agent ───────────────────────────────────────────────

  fastify.patch(
    '/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const parseResult = updateAgentSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      // Validate no channel collision with other agents
      if (parseResult.data.modes && parseResult.data.modes.length > 0) {
        const existing = await agentRepository.findById(agentId as AgentId);
        if (existing) {
          const collision = await checkChannelCollision(
            agentRepository, existing.projectId, agentId, parseResult.data.modes,
          );
          if (collision) {
            return sendError(
              reply,
              'CHANNEL_COLLISION',
              `Channel "${collision.channel}" is already claimed by agent "${collision.agentName}"`,
              409,
            );
          }
        }
      }

      try {
        const agent = await agentRepository.update(agentId as AgentId, parseResult.data);

        // Invalidate cache after update
        agentRegistry.invalidate(agentId as AgentId);

        logger.info('Agent updated', { component: 'agents', agentId });
        await sendSuccess(reply, agent); return;
      } catch {
        // Prisma throws if record not found
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );

  // ─── Delete Agent ───────────────────────────────────────────────

  fastify.delete(
    '/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      try {
        await agentRepository.delete(agentId as AgentId);

        // Invalidate cache after delete
        agentRegistry.invalidate(agentId as AgentId);

        logger.info('Agent deleted', { component: 'agents', agentId });
        return await reply.status(204).send();
      } catch {
        // Prisma throws if record not found
        return reply.status(404).send({ error: 'Agent not found' });
      }
    },
  );

  // ─── Send Message to Agent ──────────────────────────────────────

  fastify.post(
    '/agents/:agentId/message',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const parseResult = sendMessageSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      // Verify target agent exists
      const targetAgent = await agentRegistry.get(agentId as AgentId);
      if (!targetAgent) {
        return reply.status(404).send({ error: 'Target agent not found' });
      }

      const { fromAgentId, content, context, replyToId, waitForReply, timeoutMs } =
        parseResult.data;

      const message = {
        fromAgentId: fromAgentId as AgentId,
        toAgentId: agentId as AgentId,
        content,
        context,
        replyToId: replyToId as AgentMessageId | undefined,
      };

      if (waitForReply) {
        try {
          const replyContent = await agentComms.sendAndWait(message, timeoutMs);
          return await reply.send({ reply: replyContent });
        } catch (error) {
          if (error instanceof Error && error.message.includes('timeout')) {
            return reply.status(408).send({ error: 'Message timeout waiting for reply' });
          }
          throw error;
        }
      }

      const messageId = await agentComms.send(message);
      return reply.status(202).send({ messageId });
    },
  );

  // ─── Refresh Agent Cache ────────────────────────────────────────

  fastify.post(
    '/agents/:agentId/refresh',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      await agentRegistry.refresh(agentId as AgentId);

      logger.debug('Agent cache refreshed', { component: 'agents', agentId });
      return reply.status(204).send();
    },
  );

  // ─── Pause Agent ─────────────────────────────────────────────────

  fastify.post(
    '/projects/:projectId/agents/:agentId/pause',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };

      try {
        const agent = await agentRepository.update(agentId as AgentId, { status: 'paused' });
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent paused', { component: 'agents', agentId });
        await sendSuccess(reply, agent); return;
      } catch {
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );

  // ─── Resume Agent ────────────────────────────────────────────────

  fastify.post(
    '/projects/:projectId/agents/:agentId/resume',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };

      try {
        const agent = await agentRepository.update(agentId as AgentId, { status: 'active' });
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent resumed', { component: 'agents', agentId });
        await sendSuccess(reply, agent); return;
      } catch {
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );
}
