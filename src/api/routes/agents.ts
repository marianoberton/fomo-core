/**
 * Agent routes — CRUD for agents + invoke.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type {
  AgentId,
  AgentMessageId,
  AgentMode,
  AgentLLMConfig,
} from '@/agents/types.js';
import type { ProjectId } from '@/core/types.js';
import type { IntegrationProvider } from '@/channels/types.js';
import { checkChannelCollision } from '@/channels/agent-channel-router.js';
import { createAgentTemplateRepository } from '@/infrastructure/repositories/agent-template-repository.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';
import {
  prepareChatRun,
  extractAssistantResponse,
  extractToolCalls,
} from './chat-setup.js';
import type { ChatSetupResult } from './chat-setup.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { ExecutionTrace } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';
import type { TaskRegistry } from '@/channels/openclaw-task-registry.js';
import { requireProjectRole } from '../auth-middleware.js';

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
  type: z.enum(['conversational', 'process', 'backoffice']).optional(),
  skillIds: z.array(z.string()).optional(),
  limits: limitsSchema.optional(),
  managerAgentId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const fromTemplateSchema = z.object({
  templateSlug: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  overrides: z
    .object({
      description: z.string().max(500).optional(),
      promptConfig: z
        .object({
          identity: z.string().min(1).optional(),
          instructions: z.string().min(1).optional(),
          safety: z.string().min(1).optional(),
        })
        .optional(),
      llmConfig: z
        .object({
          provider: z.enum(['anthropic', 'openai', 'google', 'openrouter', 'ollama']),
          model: z.string().min(1),
          temperature: z.number().min(0).max(2).optional(),
        })
        .optional(),
      toolAllowlist: z.array(z.string()).optional(),
      channelConfig: z.object({ channels: z.array(z.string()) }).optional(),
      maxTurns: z.number().int().min(1).max(100).optional(),
      maxTokensPerTurn: z.number().int().min(100).max(32000).optional(),
      budgetPerDayUsd: z.number().min(0).max(1000).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      managerAgentId: z.string().optional(),
    })
    .optional(),
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
  type: z.enum(['conversational', 'process', 'backoffice']).optional(),
  skillIds: z.array(z.string()).optional(),
  limits: limitsSchema.optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
  managerAgentId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Structured task packet from OpenClaw orchestrator. */
const taskPacketSchema = z.object({
  /** Unique task ID from OpenClaw for correlation. */
  taskId: z.string().min(1).max(128),
  /** What the agent should accomplish. */
  objective: z.string().min(1).max(10_000),
  /** Boundaries — what is in/out of scope. */
  scope: z.string().max(10_000).optional(),
  /** How to determine if the task succeeded. */
  acceptanceCriteria: z.array(z.string().max(2_000)).optional(),
  /** Priority hint for the agent. */
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  /** Deadline hint (ISO datetime string). */
  deadline: z.string().datetime().optional(),
  /** Structured context key-value pairs from OpenClaw. */
  context: z.record(z.string(), z.unknown()).optional(),
});

const invokeAgentSchema = z.object({
  /** Plain text message (optional when task is provided). */
  message: z.string().min(1).max(100_000).optional(),
  /** Structured task packet from OpenClaw (optional when message is provided). */
  task: taskPacketSchema.optional(),
  sessionId: z.string().min(1).optional(),
  sourceChannel: z.string().min(1).optional(),
  contactRole: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  /** If true, stream SSE events instead of returning JSON. */
  stream: z.boolean().optional(),
  /** Callback URL for async webhook delivery (returns 202 immediately). */
  callbackUrl: z.string().url().optional(),
}).refine(
  (data) => data.message ?? data.task,
  { message: 'Either message or task must be provided' },
);

const sendMessageSchema = z.object({
  fromAgentId: z.string().min(1),
  content: z.string().min(1),
  context: z.record(z.unknown()).optional(),
  replyToId: z.string().optional(),
  waitForReply: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

/** Body schema for POST /projects/:projectId/agents/:agentId/export-as-template. */
const exportAsTemplateSchema = z.object({
  /** Optional override for the new template's slug. Defaults to kebab-case(name). */
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase kebab-case (a-z0-9 separated by single hyphens)',
  }).optional(),
  /** Optional override for the template's name. Defaults to the agent's name. */
  name: z.string().min(1).max(100).optional(),
  /** Optional override for the template's description. Defaults to the agent's description. */
  description: z.string().max(500).optional(),
  /** Whether to mark the template as official. Only honored when caller is master-key. */
  isOfficial: z.boolean().optional(),
  /** Catalog tags. */
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

/** Body schema for POST /projects/:projectId/agents/:agentId/clone. */
const cloneAgentSchema = z.object({
  /** Name for the new agent. Must not collide with another agent in the project. */
  name: z.string().min(1).max(100),
  /**
   * If true (default), seed missing project-level PromptLayers from the source
   * agent's promptConfig — same flow as `from-template` materialization.
   * If false, only the per-agent promptConfig snapshot is copied.
   */
  includePromptLayers: z.boolean().optional().default(true),
});

// ─── Route Registration ─────────────────────────────────────────

export function agentRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { agentRepository, agentRegistry, agentComms, logger, memberRepository } = deps;
  const rbacOperator = requireProjectRole('operator', { memberRepository, logger });

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

      if (agent?.projectId !== projectId) {
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
    { preHandler: rbacOperator },
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

  // ─── Create Agent from Template ─────────────────────────────────

  fastify.post(
    '/projects/:projectId/agents/from-template',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = fromTemplateSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }
      const body = parseResult.data;
      const warnings: string[] = [];

      // 1. Template exists
      const templateRepo = createAgentTemplateRepository(deps.prisma);
      const template = await templateRepo.findBySlug(body.templateSlug);
      if (!template) {
        await sendNotFound(reply, 'AgentTemplate', body.templateSlug);
        return;
      }

      // 2. Project exists
      const project = await deps.projectRepository.findById(projectId as ProjectId);
      if (!project) {
        await sendNotFound(reply, 'Project', projectId);
        return;
      }

      // 3. Name collision
      const conflict = await agentRepository.findByName(projectId, body.name);
      if (conflict) {
        await sendError(
          reply,
          'CONFLICT',
          `Agent "${body.name}" already exists in this project`,
          409,
        );
        return;
      }

      // 4. Tool allowlist — every tool must exist in the registry
      const toolAllowlist = body.overrides?.toolAllowlist ?? template.suggestedTools;
      for (const toolId of toolAllowlist) {
        if (!deps.toolRegistry.has(toolId)) {
          await sendError(
            reply,
            'VALIDATION_ERROR',
            `Tool "${toolId}" is not registered`,
            400,
          );
          return;
        }
      }

      // 5. managerAgentId — must exist in same project with type='backoffice'
      const managerAgentId = body.overrides?.managerAgentId;
      if (managerAgentId !== undefined && managerAgentId !== '') {
        const manager = await agentRepository.findById(managerAgentId as AgentId);
        if (
          !manager ||
          manager.projectId !== projectId ||
          manager.type !== 'backoffice'
        ) {
          await sendError(
            reply,
            'VALIDATION_ERROR',
            `managerAgentId "${managerAgentId}" must exist in this project with type='backoffice'`,
            400,
          );
          return;
        }
      }

      // 6. Channel availability — warnings only, not errors
      const channels =
        body.overrides?.channelConfig?.channels ?? template.suggestedChannels;
      const integrations =
        await deps.channelIntegrationRepository.findByProject(projectId as ProjectId);
      const activeProviders = new Set(
        integrations.filter((i) => i.status === 'active').map((i) => i.provider),
      );
      for (const ch of channels) {
        if (ch === 'dashboard') continue; // always available in-app
        if (!activeProviders.has(ch as IntegrationProvider)) {
          warnings.push(`channel '${ch}' not configured`);
        }
      }

      // 7. Modes — channel collision with other agents (only copilot-owner has modes)
      const modes = (template.suggestedModes ?? []) as AgentMode[];
      if (modes.length > 0) {
        const collision = await checkChannelCollision(
          agentRepository,
          projectId,
          undefined,
          modes,
        );
        if (collision) {
          await sendError(
            reply,
            'CHANNEL_COLLISION',
            `Channel "${collision.channel}" is already claimed by agent "${collision.agentName}"`,
            409,
          );
          return;
        }
      }

      // 8. Prompt layers — seed project-level layers if missing (immutable rule)
      const mergedPrompt = {
        identity:
          body.overrides?.promptConfig?.identity ?? template.promptConfig.identity,
        instructions:
          body.overrides?.promptConfig?.instructions ??
          template.promptConfig.instructions,
        safety:
          body.overrides?.promptConfig?.safety ?? template.promptConfig.safety,
      };
      const layerTypes = ['identity', 'instructions', 'safety'] as const;
      for (const layerType of layerTypes) {
        const existingLayer = await deps.promptLayerRepository.getActiveLayer(
          projectId as ProjectId,
          layerType,
        );
        if (!existingLayer) {
          await deps.promptLayerRepository.create({
            projectId: projectId as ProjectId,
            layerType,
            content: mergedPrompt[layerType],
            createdBy: `template:${template.slug}`,
            changeReason: `Seeded from AgentTemplate "${template.slug}" v${template.version}`,
          });
        }
      }

      // 9. Skill instances — resolve slug → templateId, then instantiate
      const skillIds: string[] = [];
      for (const skillSlug of template.suggestedSkillSlugs) {
        const skillTmpl = await deps.prisma.skillTemplate.findFirst({
          where: { name: skillSlug },
        });
        if (!skillTmpl) {
          warnings.push(`skill template '${skillSlug}' not found — skipped`);
          continue;
        }
        const instance = await deps.skillService.createFromTemplate(
          projectId,
          skillTmpl.id,
        );
        skillIds.push(instance.id);
      }

      // 10. Suggested MCPs — v2 feature, warn if present
      if (
        Array.isArray(template.suggestedMcps) &&
        template.suggestedMcps.length > 0
      ) {
        warnings.push(
          'suggested MCP servers are not auto-provisioned yet — attach them manually',
        );
      }

      // 11. Compose llmConfig from overrides or template
      const llmConfig: AgentLLMConfig | undefined = body.overrides?.llmConfig
        ? body.overrides.llmConfig
        : template.suggestedLlm
          ? {
              provider:
                template.suggestedLlm.provider as AgentLLMConfig['provider'],
              model: template.suggestedLlm.model,
              ...(template.suggestedLlm.temperature !== undefined && {
                temperature: template.suggestedLlm.temperature,
              }),
            }
          : undefined;

      // 12. Create agent
      try {
        const agent = await agentRepository.create({
          projectId,
          name: body.name,
          description: body.overrides?.description ?? template.description,
          promptConfig: mergedPrompt,
          ...(llmConfig && { llmConfig }),
          toolAllowlist,
          channelConfig: { allowedChannels: channels },
          modes,
          type: template.type,
          skillIds,
          limits: {
            maxTurns: body.overrides?.maxTurns ?? template.maxTurns,
            maxTokensPerTurn:
              body.overrides?.maxTokensPerTurn ?? template.maxTokensPerTurn,
            budgetPerDayUsd:
              body.overrides?.budgetPerDayUsd ?? template.budgetPerDayUsd,
          },
          ...(managerAgentId !== undefined &&
            managerAgentId !== '' && { managerAgentId }),
          metadata: {
            ...(template.metadata ?? {}),
            ...(body.overrides?.metadata ?? {}),
            createdFromTemplate: template.slug,
            templateVersion: template.version,
          },
        });

        logger.info('Agent created from template', {
          component: 'agents',
          projectId,
          agentId: agent.id,
          templateSlug: template.slug,
          skillIds: skillIds.length,
          warnings: warnings.length,
        });

        await sendSuccess(reply, { agent, warnings }, 201);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          await sendError(
            reply,
            'CONFLICT',
            `Agent with name "${body.name}" already exists`,
            409,
          );
          return;
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
    { preHandler: rbacOperator },
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
      if (existing?.projectId !== projectId) {
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
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, agentId } = request.params as { projectId: string; agentId: string };

      const existing = await agentRepository.findById(agentId as AgentId);
      if (existing?.projectId !== projectId) {
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

  // ─── Export Agent → AgentTemplate ──────────────────────────────

  fastify.post(
    '/projects/:projectId/agents/:agentId/export-as-template',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, agentId } = request.params as {
        projectId: string;
        agentId: string;
      };

      const parsed = exportAsTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }
      const body = parsed.data;

      // 1. Project exists
      const project = await deps.projectRepository.findById(projectId as ProjectId);
      if (!project) {
        await sendNotFound(reply, 'Project', projectId);
        return;
      }

      // 2. Agent exists in this project
      const agent = await agentRepository.findById(agentId as AgentId);
      if (agent?.projectId !== projectId) {
        await sendNotFound(reply, 'Agent', agentId);
        return;
      }

      // 3. Resolve final name + slug
      const templateName = body.name ?? agent.name;
      const templateSlug = body.slug ?? toKebabSlug(templateName);
      if (templateSlug.length === 0) {
        await sendError(
          reply,
          'VALIDATION_ERROR',
          'Could not derive a slug from name — provide an explicit slug',
          400,
        );
        return;
      }

      // 4. isOfficial gating — only master keys can mint official templates
      const isMaster = request.apiKeyProjectId === null;
      const isOfficial = body.isOfficial === true && isMaster;

      // 5. Slug collision (409)
      const templateRepo = createAgentTemplateRepository(deps.prisma);
      const existing = await templateRepo.findBySlug(templateSlug);
      if (existing) {
        await sendError(
          reply,
          'CONFLICT',
          `AgentTemplate with slug "${templateSlug}" already exists`,
          409,
          { slug: templateSlug },
        );
        return;
      }

      // 6. PromptConfig — prefer the project's currently active layers, fall
      //    back to the agent's own promptConfig snapshot if a layer is missing.
      const layerTypes = ['identity', 'instructions', 'safety'] as const;
      const activeLayers = await Promise.all(
        layerTypes.map((lt) =>
          deps.promptLayerRepository.getActiveLayer(projectId as ProjectId, lt),
        ),
      );
      const promptConfig = {
        identity: activeLayers[0]?.content ?? agent.promptConfig.identity,
        instructions: activeLayers[1]?.content ?? agent.promptConfig.instructions,
        safety: activeLayers[2]?.content ?? agent.promptConfig.safety,
      };

      // 7. suggestedSkillSlugs — best-effort resolve from the agent's skill instances
      const suggestedSkillSlugs: string[] = [];
      for (const skillId of agent.skillIds) {
        const instance = await deps.skillService.getInstance(skillId);
        if (!instance?.templateId) continue;
        const tmpl = await deps.skillService.getTemplate(instance.templateId);
        if (tmpl?.name) suggestedSkillSlugs.push(tmpl.name);
      }

      // 8. metadata — preserve archetype if present
      const agentMeta: Record<string, unknown> = agent.metadata ?? {};
      const rawArchetype = agentMeta['archetype'];
      const archetype = typeof rawArchetype === 'string' ? rawArchetype : undefined;
      const templateMetadata: Record<string, unknown> = {
        ...(archetype !== undefined && { archetype }),
        exportedFromAgent: { id: agent.id, projectId, name: agent.name },
      };

      // 9. Build llm config snapshot if both fields present
      const suggestedLlm =
        agent.llmConfig?.provider && agent.llmConfig.model
          ? {
              provider: agent.llmConfig.provider,
              model: agent.llmConfig.model,
              ...(agent.llmConfig.temperature !== undefined && {
                temperature: agent.llmConfig.temperature,
              }),
            }
          : null;

      // 10. Create the template
      try {
        const template = await templateRepo.create({
          slug: templateSlug,
          name: templateName,
          description: body.description ?? agent.description ?? agent.name,
          type: agent.type,
          tags: body.tags ?? [],
          isOfficial,
          promptConfig,
          suggestedTools: agent.toolAllowlist,
          suggestedLlm,
          suggestedModes: agent.modes.length > 0 ? agent.modes : null,
          suggestedChannels: agent.channelConfig.allowedChannels,
          suggestedMcps: agent.mcpServers.length > 0 ? agent.mcpServers : null,
          suggestedSkillSlugs,
          metadata: templateMetadata,
          maxTurns: agent.limits.maxTurns,
          maxTokensPerTurn: agent.limits.maxTokensPerTurn,
          budgetPerDayUsd: agent.limits.budgetPerDayUsd,
        });

        logger.info('Agent exported as template', {
          component: 'agents',
          projectId,
          agentId,
          templateSlug,
          isOfficial,
        });

        await sendSuccess(reply, template, 201);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          await sendError(
            reply,
            'CONFLICT',
            `AgentTemplate with slug "${templateSlug}" already exists`,
            409,
            { slug: templateSlug },
          );
          return;
        }
        throw error;
      }
    },
  );

  // ─── Clone Agent (project-scoped duplicate) ───────────────────

  fastify.post(
    '/projects/:projectId/agents/:agentId/clone',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, agentId } = request.params as {
        projectId: string;
        agentId: string;
      };

      const parsed = cloneAgentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }
      const { name: newName, includePromptLayers } = parsed.data;

      // 1. Source agent exists in this project
      const source = await agentRepository.findById(agentId as AgentId);
      if (source?.projectId !== projectId) {
        await sendNotFound(reply, 'Agent', agentId);
        return;
      }

      // 2. Name collision — surface a suggestion to ease retry
      const conflict = await agentRepository.findByName(projectId, newName);
      if (conflict) {
        await sendError(
          reply,
          'CONFLICT',
          `Agent "${newName}" already exists in this project`,
          409,
          { suggestedName: suggestUniqueName(newName) },
        );
        return;
      }

      // 3. Optionally seed missing project-level PromptLayers (mirror materializer)
      if (includePromptLayers) {
        const layerTypes = ['identity', 'instructions', 'safety'] as const;
        for (const layerType of layerTypes) {
          const existing = await deps.promptLayerRepository.getActiveLayer(
            projectId as ProjectId,
            layerType,
          );
          if (!existing) {
            await deps.promptLayerRepository.create({
              projectId: projectId as ProjectId,
              layerType,
              content: source.promptConfig[layerType],
              createdBy: `clone:${source.id}`,
              changeReason: `Seeded by clone of agent "${source.name}"`,
            });
          }
        }
      }

      // 4. Build CreateAgentInput from source — drop modes (channel-bound, would
      //    collide) and status (start active by default).
      const cloneMetadata: Record<string, unknown> = {
        ...(source.metadata ?? {}),
        clonedFrom: { id: source.id, name: source.name },
      };
      // Strip any "createdFromTemplate" provenance — the clone is a copy of the
      // source agent, not of the template the source was originally built from.
      delete cloneMetadata['createdFromTemplate'];
      delete cloneMetadata['templateVersion'];

      try {
        const cloned = await agentRepository.create({
          projectId,
          name: newName,
          ...(source.description !== undefined && { description: source.description }),
          promptConfig: { ...source.promptConfig },
          ...(source.llmConfig !== undefined && { llmConfig: { ...source.llmConfig } }),
          toolAllowlist: [...source.toolAllowlist],
          mcpServers: source.mcpServers.map((m) => ({ ...m })),
          channelConfig: { ...source.channelConfig },
          type: source.type,
          skillIds: [...source.skillIds],
          limits: { ...source.limits },
          ...(source.managerAgentId !== undefined &&
            source.managerAgentId !== null && {
              managerAgentId: source.managerAgentId,
            }),
          metadata: cloneMetadata,
        });

        logger.info('Agent cloned', {
          component: 'agents',
          projectId,
          sourceAgentId: source.id,
          clonedAgentId: cloned.id,
          includePromptLayers,
        });

        await sendSuccess(reply, cloned, 201);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          await sendError(
            reply,
            'CONFLICT',
            `Agent "${newName}" already exists in this project`,
            409,
            { suggestedName: suggestUniqueName(newName) },
          );
          return;
        }
        throw error;
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
    { preHandler: rbacOperator },
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
    { preHandler: rbacOperator },
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
  ): Promise<void> {
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

    const { message, task, sessionId, sourceChannel, contactRole, metadata, stream, callbackUrl } =
      parseResult.data;

    // 2. Compose message — from task packet if provided, otherwise use raw message
    const composedMessage = task
      ? composeTaskMessage(task, message)
      : message ?? '';

    // Merge task into metadata for trace correlation
    const mergedMetadata = task
      ? { ...metadata, _task: task }
      : metadata;

    // 3. Run shared chat setup (sanitize, load project/session/prompt, create services)
    const setupResult = await prepareChatRun(
      {
        projectId: agent.projectId,
        agentId,
        sessionId,
        sourceChannel,
        contactRole,
        message: composedMessage,
        metadata: mergedMetadata,
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

    // 4. Create abort controller tied to client disconnect
    const abortController = new AbortController();
    request.raw.on('close', () => {
      if (!request.raw.complete) {
        abortController.abort();
      }
    });

    // 5. Create agent runner
    const agentRunner = createAgentRunner({
      provider: setup.provider,
      fallbackProvider: setup.fallbackProvider,
      toolRegistry: deps.toolRegistry,
      memoryManager: setup.memoryManager,
      costGuard: setup.costGuard,
      logger,
    });

    // ─── SSE Streaming Path ──────────────────────────────────────
    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const writeSSE = (eventType: string, data: unknown): void => {
        reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const result = await agentRunner.run({
        message: setup.sanitizedMessage,
        agentConfig: setup.agentConfig,
        sessionId: setup.sessionId,
        systemPrompt: setup.systemPrompt,
        promptSnapshot: setup.promptSnapshot,
        conversationHistory: setup.conversationHistory,
        abortSignal: abortController.signal,
        onEvent: (event) => {
          writeSSE(event.type, event);
        },
      });

      if (result.ok) {
        const trace = result.value;
        await persistTraceAndMessages(deps, setup, trace);

        writeSSE('done', {
          type: 'agent_complete',
          agentId,
          sessionId: setup.sessionId,
          traceId: trace.id,
          response: extractAssistantResponse(trace.events),
          taskId: task?.taskId,
          usage: { totalTokens: trace.totalTokensUsed, costUSD: trace.totalCostUSD },
          status: trace.status,
        });
      } else {
        writeSSE('error', { type: 'error', code: 'EXECUTION_FAILED', message: result.error.message });
      }

      reply.raw.end();
      return;
    }

    // ─── Async Callback Path ─────────────────────────────────────
    if (callbackUrl) {
      const taskId = task?.taskId ?? `task_${Date.now()}`;

      // Register in task registry if available
      deps.taskRegistry?.create(taskId, agentId, agent.projectId, callbackUrl);

      // Return 202 immediately
      void reply.status(202).send({
        success: true,
        data: { taskId, agentId, status: 'running', sessionId: setup.sessionId },
      });

      // Execute in background — fire-and-forget with error handling
      void (async () => {
        try {
          const result = await agentRunner.run({
            message: setup.sanitizedMessage,
            agentConfig: setup.agentConfig,
            sessionId: setup.sessionId,
            systemPrompt: setup.systemPrompt,
            promptSnapshot: setup.promptSnapshot,
            conversationHistory: setup.conversationHistory,
            abortSignal: abortController.signal,
            onEvent: (event) => {
              deps.taskRegistry?.addEvent(taskId, event);
            },
          });

          if (result.ok) {
            const trace = result.value;
            await persistTraceAndMessages(deps, setup, trace);

            const assistantText = extractAssistantResponse(trace.events);
            const callbackPayload = {
              taskId,
              agentId,
              sessionId: setup.sessionId,
              traceId: trace.id,
              status: 'completed',
              response: assistantText,
              toolCalls: extractToolCalls(trace.events),
              timestamp: new Date().toISOString(),
              usage: { totalTokens: trace.totalTokensUsed, costUSD: trace.totalCostUSD },
            };

            deps.taskRegistry?.complete(taskId, callbackPayload);
            await deliverCallback(callbackUrl, callbackPayload, logger);
          } else {
            const errorPayload = { taskId, agentId, status: 'failed', error: result.error.message };
            deps.taskRegistry?.fail(taskId, result.error.message);
            await deliverCallback(callbackUrl, errorPayload, logger);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          logger.error('Async agent invoke failed', { component: 'agents', agentId, taskId, error: msg });
          deps.taskRegistry?.fail(taskId, msg);
          await deliverCallback(callbackUrl, { taskId, agentId, status: 'failed', error: msg }, logger);
        }
      })();

      return;
    }

    // ─── Synchronous Path (default) ──────────────────────────────
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
    await persistTraceAndMessages(deps, setup, trace);

    const assistantText = extractAssistantResponse(trace.events);
    const toolCalls = extractToolCalls(trace.events);

    logger.info('Agent invoked', { component: 'agents', agentId, traceId: trace.id });

    // Return response
    return sendSuccess(reply, {
      agentId,
      sessionId: setup.sessionId,
      traceId: trace.id,
      response: assistantText,
      toolCalls,
      taskId: task?.taskId,
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
    { preHandler: rbacOperator },
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

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Convert an arbitrary string to a lowercase kebab-case slug.
 * - normalizes accented chars to ASCII via NFD
 * - replaces any run of non-alphanumeric chars with a single hyphen
 * - trims leading/trailing hyphens
 *
 * Returns an empty string when the input has no alphanumeric content; the
 * caller is responsible for surfacing a 400 in that case.
 */
function toKebabSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Suggest a non-colliding name by appending " (copy)" or " (copy N)". */
function suggestUniqueName(name: string): string {
  return /\(copy(?: \d+)?\)$/.test(name) ? `${name} 2` : `${name} (copy)`;
}

/** Compose a structured message from an OpenClaw task packet. */
function composeTaskMessage(
  task: z.infer<typeof taskPacketSchema>,
  additionalMessage?: string,
): string {
  const parts: string[] = [];

  parts.push(`## Task: ${task.taskId}`);
  parts.push(`**Objective**: ${task.objective}`);

  if (task.scope) {
    parts.push(`**Scope**: ${task.scope}`);
  }

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    parts.push('**Acceptance Criteria**:');
    for (const criterion of task.acceptanceCriteria) {
      parts.push(`- ${criterion}`);
    }
  }

  parts.push(`**Priority**: ${task.priority}`);

  if (task.deadline) {
    parts.push(`**Deadline**: ${task.deadline}`);
  }

  if (task.context && Object.keys(task.context).length > 0) {
    parts.push('**Context**:');
    for (const [key, value] of Object.entries(task.context)) {
      parts.push(`- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }

  if (additionalMessage) {
    parts.push('', '---', '', additionalMessage);
  }

  return parts.join('\n');
}

/** Persist execution trace and conversation messages. */
async function persistTraceAndMessages(
  deps: RouteDependencies,
  setup: ChatSetupResult,
  trace: ExecutionTrace,
): Promise<void> {
  await deps.executionTraceRepository.save(trace);

  await deps.sessionRepository.addMessage(setup.sessionId, {
    role: 'user',
    content: setup.sanitizedMessage,
  }, trace.id);

  const assistantText = extractAssistantResponse(trace.events);

  await deps.sessionRepository.addMessage(setup.sessionId, {
    role: 'assistant',
    content: assistantText,
  }, trace.id);
}

/** Deliver a callback POST to the OpenClaw manager with retries. */
async function deliverCallback(
  url: string,
  payload: unknown,
  log: Logger,
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        log.info('Callback delivered', { component: 'agents', url, attempt });
        return;
      }

      log.warn('Callback delivery failed', {
        component: 'agents',
        url,
        status: response.status,
        attempt,
      });
    } catch (error) {
      log.warn('Callback delivery error', {
        component: 'agents',
        url,
        attempt,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => { setTimeout(resolve, 1000 * 2 ** attempt); });
    }
  }

  log.error('Callback delivery exhausted retries', { component: 'agents', url });
}
