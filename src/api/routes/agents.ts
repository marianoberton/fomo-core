/**
 * Agent routes — CRUD for agents + invoke.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { AgentId, AgentMessageId } from '@/agents/types.js';
import { checkChannelCollision } from '@/channels/agent-channel-router.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';
import {
  prepareChatRun,
  extractAssistantResponse,
  extractToolCalls,
} from './chat-setup.js';
import { createAgentRunner } from '@/core/agent-runner.js';

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
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  baseUrl: z.string().optional(),
  apiKeySecretName: z.string().optional(),
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
  operatingMode: z.enum(['customer-facing', 'internal', 'copilot', 'manager']).optional(),
  skillIds: z.array(z.string()).optional(),
  limits: limitsSchema.optional(),
  managerAgentId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
  operatingMode: z.enum(['customer-facing', 'internal', 'copilot', 'manager']).optional(),
  skillIds: z.array(z.string()).optional(),
  limits: limitsSchema.optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
  managerAgentId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const invokeAgentSchema = z.object({
  message: z.string().min(1).max(100_000),
  sessionId: z.string().min(1).optional(),
  sourceChannel: z.string().min(1).optional(),
  contactRole: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
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

  // ─── Get Agent (project-scoped) ─────────────────────────────────

  fastify.get(
    '/projects/:projectId/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, agentId } = request.params as { projectId: string; agentId: string };

      const agent = await agentRegistry.get(agentId as AgentId);

      if (!agent || agent.projectId !== projectId) {
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

  // ─── Update Agent (project-scoped, accepts PUT) ────────────────

  fastify.put(
    '/projects/:projectId/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, agentId } = request.params as { projectId: string; agentId: string };
      const parseResult = updateAgentSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      const existing = await agentRepository.findById(agentId as AgentId);
      if (!existing || existing.projectId !== projectId) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      if (parseResult.data.modes && parseResult.data.modes.length > 0) {
        const collision = await checkChannelCollision(
          agentRepository, projectId, agentId, parseResult.data.modes,
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
        const agent = await agentRepository.update(agentId as AgentId, parseResult.data);
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent updated', { component: 'agents', agentId });
        await sendSuccess(reply, agent); return;
      } catch {
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

  // ─── Delete Agent (project-scoped) ────────────────────────────

  fastify.delete(
    '/projects/:projectId/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, agentId } = request.params as { projectId: string; agentId: string };

      const existing = await agentRepository.findById(agentId as AgentId);
      if (!existing || existing.projectId !== projectId) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      try {
        await agentRepository.delete(agentId as AgentId);
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent deleted', { component: 'agents', agentId });
        return await reply.status(204).send();
      } catch {
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

  // ─── Invoke Agent (shared handler) ──────────────────────────────

  async function handleInvokeAgent(
    request: FastifyRequest,
    reply: FastifyReply,
    agentId: string,
    projectIdOverride?: string,
  ) {
    const parseResult = invokeAgentSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.flatten(),
      });
    }

    // 1. Verify agent exists and is active
    const agent = await agentRegistry.get(agentId as AgentId);
    if (!agent) {
      return sendNotFound(reply, 'Agent', agentId);
    }

    // If project-scoped, verify agent belongs to that project
    if (projectIdOverride && agent.projectId !== projectIdOverride) {
      return sendNotFound(reply, 'Agent', agentId);
    }

    if (agent.status !== 'active') {
      return sendError(
        reply,
        'AGENT_NOT_ACTIVE',
        `Agent "${agentId}" is ${agent.status}`,
        409,
      );
    }

    const { message, sessionId, sourceChannel, contactRole, metadata } =
      parseResult.data;

    // 2. Run shared chat setup (sanitize, load project/session/prompt, create services)
    const setupResult = await prepareChatRun(
      {
        projectId: agent.projectId,
        agentId,
        sessionId,
        sourceChannel,
        contactRole,
        message,
        metadata,
      },
      deps,
    );

    if (!setupResult.ok) {
      return sendError(
        reply,
        setupResult.error.code,
        setupResult.error.message,
        setupResult.error.statusCode,
      );
    }

    const setup = setupResult.value;

    // 3. Create abort controller tied to client disconnect
    const abortController = new AbortController();
    request.raw.on('close', () => {
      if (!request.raw.complete) {
        abortController.abort();
      }
    });

    // 4. Create agent runner and execute
    const agentRunner = createAgentRunner({
      provider: setup.provider,
      fallbackProvider: setup.fallbackProvider,
      toolRegistry: deps.toolRegistry,
      memoryManager: setup.memoryManager,
      costGuard: setup.costGuard,
      logger,
    });

    const result = await agentRunner.run({
      message: setup.sanitizedMessage,
      agentConfig: setup.agentConfig,
      sessionId: setup.sessionId,
      systemPrompt: setup.systemPrompt,
      promptSnapshot: setup.promptSnapshot,
      conversationHistory: setup.conversationHistory,
      abortSignal: abortController.signal,
    });

    if (!result.ok) {
      throw result.error;
    }

    const trace = result.value;

    // 5. Persist execution trace
    await deps.executionTraceRepository.save(trace);

    // 6. Persist messages
    await deps.sessionRepository.addMessage(setup.sessionId, {
      role: 'user',
      content: setup.sanitizedMessage,
    }, trace.id);

    const assistantText = extractAssistantResponse(trace.events);
    const toolCalls = extractToolCalls(trace.events);

    await deps.sessionRepository.addMessage(setup.sessionId, {
      role: 'assistant',
      content: assistantText,
    }, trace.id);

    logger.info('Agent invoked', { component: 'agents', agentId, traceId: trace.id });

    // 7. Return response
    return sendSuccess(reply, {
      agentId,
      sessionId: setup.sessionId,
      traceId: trace.id,
      response: assistantText,
      toolCalls,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: trace.totalTokensUsed,
        outputTokens: 0,
        costUSD: trace.totalCostUSD,
      },
    });
  }

  // ─── Invoke Agent (project-scoped — primary) ───────────────────

  fastify.post(
    '/projects/:projectId/agents/:agentId/invoke',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, agentId } = request.params as { projectId: string; agentId: string };
      return handleInvokeAgent(request, reply, agentId, projectId);
    },
  );

  // ─── Invoke Agent (backward-compatible alias) ──────────────────

  fastify.post(
    '/agents/:agentId/invoke',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      return handleInvokeAgent(request, reply, agentId);
    },
  );
}
