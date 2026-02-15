/**
 * Onboarding routes — provision new clients in a single API call.
 *
 * Creates a complete project setup: Project + Prompt Layers + Channel Integration + Agent.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentConfig, ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import type { ChannelIntegrationRepository, ChatwootIntegrationConfig } from '@/channels/types.js';

// ─── Extended Dependencies ──────────────────────────────────────

export interface OnboardingDeps extends RouteDependencies {
  channelIntegrationRepository: ChannelIntegrationRepository;
}

// ─── Zod Schemas ────────────────────────────────────────────────

const chatwootConfigSchema = z.object({
  baseUrl: z.string().url(),
  accountId: z.number().int().positive(),
  inboxId: z.number().int().positive(),
  agentBotId: z.number().int().positive(),
  apiTokenEnvVar: z.string().min(1),
});

const providerConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  model: z.string().min(1),
  apiKeyEnvVar: z.string().min(1).optional(),
});

const promptsSchema = z.object({
  identity: z.string().min(1).max(100_000),
  instructions: z.string().min(1).max(100_000),
  safety: z.string().min(1).max(100_000),
});

const budgetSchema = z.object({
  dailyUSD: z.number().positive().default(10),
  monthlyUSD: z.number().positive().default(100),
  maxPerRunUSD: z.number().positive().default(2),
});

const provisionSchema = z.object({
  clientName: z.string().min(1).max(200),
  owner: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  environment: z.enum(['production', 'staging', 'development']).default('production'),
  provider: providerConfigSchema,
  chatwoot: chatwootConfigSchema,
  prompts: promptsSchema,
  budget: budgetSchema.optional(),
  tools: z.array(z.string()).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register onboarding routes. */
export function onboardingRoutes(
  fastify: FastifyInstance,
  deps: OnboardingDeps,
): void {
  const {
    projectRepository,
    promptLayerRepository,
    agentRepository,
    channelIntegrationRepository,
    logger,
  } = deps;

  /**
   * POST /onboarding/provision — provision a new client in one call.
   *
   * Creates: Project + 3 Prompt Layers (active) + Channel Integration + Agent.
   */
  fastify.post('/onboarding/provision', async (request, reply) => {
    const input = provisionSchema.parse(request.body);

    try {
      // 1. Create project
      const defaultBudget = { dailyUSD: 10, monthlyUSD: 100, maxPerRunUSD: 2 };
      const budget = input.budget ?? defaultBudget;

      const projectConfig: AgentConfig = {
        projectId: '' as ProjectId, // Will be set after creation
        agentRole: 'customer-support',
        provider: {
          provider: input.provider.provider,
          model: input.provider.model,
          apiKeyEnvVar: input.provider.apiKeyEnvVar ?? `${input.provider.provider.toUpperCase()}_API_KEY`,
        },
        allowedTools: input.tools ?? ['calculator', 'date-time', 'json-transform'],
        failover: {
          onRateLimit: true,
          onServerError: true,
          onTimeout: true,
          timeoutMs: 120_000,
          maxRetries: 2,
        },
        memoryConfig: {
          longTerm: {
            enabled: false,
            maxEntries: 1000,
            retrievalTopK: 5,
            embeddingProvider: 'openai',
            decayEnabled: false,
            decayHalfLifeDays: 30,
          },
          contextWindow: {
            reserveTokens: 100_000,
            pruningStrategy: 'turn-based',
            maxTurnsInContext: 20,
            compaction: {
              enabled: true,
              memoryFlushBeforeCompaction: false,
            },
          },
        },
        costConfig: {
          dailyBudgetUSD: budget.dailyUSD,
          monthlyBudgetUSD: budget.monthlyUSD,
          maxTokensPerTurn: 4000,
          maxTurnsPerSession: 15,
          maxToolCallsPerTurn: 5,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 20,
          maxRequestsPerHour: 200,
        },
        maxTurnsPerSession: 15,
        maxConcurrentSessions: 100,
      };

      const project = await projectRepository.create({
        name: input.clientName,
        description: input.description,
        environment: input.environment,
        owner: input.owner,
        tags: input.tags ?? [],
        config: projectConfig as unknown as AgentConfig,
      });

      const projectId = project.id as ProjectId;

      // Update projectId in config (it was empty before creation)
      projectConfig.projectId = projectId;
      await projectRepository.update(projectId, {
        config: projectConfig as unknown as AgentConfig,
      });

      // 2. Create and activate prompt layers
      const layerTypes = ['identity', 'instructions', 'safety'] as const;
      const layerContents = {
        identity: input.prompts.identity,
        instructions: input.prompts.instructions,
        safety: input.prompts.safety,
      };

      for (const layerType of layerTypes) {
        const layer = await promptLayerRepository.create({
          projectId,
          layerType,
          content: layerContents[layerType],
          createdBy: input.owner,
          changeReason: 'Initial onboarding setup',
        });

        await promptLayerRepository.activate(layer.id);
      }

      // 3. Create channel integration (Chatwoot)
      const chatwootConfig: ChatwootIntegrationConfig = {
        baseUrl: input.chatwoot.baseUrl,
        accountId: input.chatwoot.accountId,
        inboxId: input.chatwoot.inboxId,
        agentBotId: input.chatwoot.agentBotId,
        apiTokenEnvVar: input.chatwoot.apiTokenEnvVar,
      };

      const integration = await channelIntegrationRepository.create({
        projectId,
        provider: 'chatwoot',
        config: chatwootConfig,
      });

      // 4. Create agent
      const agent = await agentRepository.create({
        projectId,
        name: `${input.clientName} Agent`,
        description: `AI agent for ${input.clientName}`,
        promptConfig: {
          identity: input.prompts.identity,
          instructions: input.prompts.instructions,
          safety: input.prompts.safety,
        },
        toolAllowlist: input.tools ?? ['calculator', 'date-time', 'json-transform'],
        channelConfig: {
          allowedChannels: ['chatwoot'],
          defaultChannel: 'chatwoot',
        },
        limits: {
          maxTurns: 15,
          maxTokensPerTurn: 4000,
          budgetPerDayUsd: budget.dailyUSD,
        },
      });

      logger.info('Client provisioned successfully', {
        component: 'onboarding',
        projectId,
        agentId: agent.id,
        integrationId: integration.id,
        clientName: input.clientName,
      });

      return sendSuccess(reply, {
        projectId,
        agentId: agent.id,
        channelIntegrationId: integration.id,
        chatwootWebhookUrl: '/api/v1/webhooks/chatwoot',
        status: 'provisioned',
      }, 201);
    } catch (error) {
      logger.error('Failed to provision client', {
        component: 'onboarding',
        clientName: input.clientName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return sendError(
        reply,
        'ONBOARDING_FAILED',
        error instanceof Error ? error.message : 'Failed to provision client',
        500,
      );
    }
  });
}
