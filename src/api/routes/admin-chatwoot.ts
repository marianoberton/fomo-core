/**
 * Admin Chatwoot attach/health/detach routes.
 *
 * These endpoints formalize the ATTACH-only flow for a pre-existing agent:
 *  - POST   /admin/chatwoot/attach            — connect an agent to a Chatwoot inbox
 *  - GET    /admin/chatwoot/health/:projectId — snapshot integration health + config
 *  - POST   /admin/chatwoot/detach/:projectId — remove integration + strip 'chatwoot' from agents
 *
 * All endpoints require a master API key. Project-scoped keys and missing
 * credentials get 401/403 via the createAdminAuthHook preHandler.
 *
 * Never creates projects or agents — only attaches existing ones.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createAdminAuthHook } from '../admin-auth.js';
import { storeChatwootSecrets } from '@/secrets/chatwoot-secrets.js';
import type {
  ChannelIntegration,
  ChatwootIntegrationConfig,
} from '@/channels/types.js';
import { generateChatwootPathToken } from './chatwoot-webhook.js';
import type { AgentConfig, ChannelConfig, AgentId } from '@/agents/types.js';
import type { ProjectId } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const AttachBodySchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  baseUrl: z.string().url(),
  accountId: z.number().int().positive(),
  inboxId: z.number().int().positive(),
  agentBotId: z.number().int().positive(),
  apiToken: z.string().min(1),
  /** Optional override for the SecretService key name (default: CHATWOOT_API_TOKEN). */
  apiTokenSecretKey: z.string().min(1).max(128).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Append 'chatwoot' to an agent's channelConfig.allowedChannels if missing.
 * Returns true if the agent was updated.
 */
async function addChannelToAgent(
  agentRepository: RouteDependencies['agentRepository'],
  agent: AgentConfig,
  channel: 'chatwoot',
): Promise<boolean> {
  const current: ChannelConfig = agent.channelConfig;
  const channels = Array.isArray(current.allowedChannels) ? [...current.allowedChannels] : [];
  if (channels.includes(channel)) return false;
  channels.push(channel);
  await agentRepository.update(agent.id, {
    channelConfig: { ...current, allowedChannels: channels },
  });
  return true;
}

/**
 * Remove 'chatwoot' from an agent's channelConfig.allowedChannels if present.
 * Returns true if the agent was updated.
 */
async function removeChannelFromAgent(
  agentRepository: RouteDependencies['agentRepository'],
  agent: AgentConfig,
  channel: 'chatwoot',
): Promise<boolean> {
  const current: ChannelConfig = agent.channelConfig;
  const channels = Array.isArray(current.allowedChannels) ? current.allowedChannels : [];
  if (!channels.includes(channel)) return false;
  await agentRepository.update(agent.id, {
    channelConfig: { ...current, allowedChannels: channels.filter((c) => c !== channel) },
  });
  return true;
}

/**
 * Perform a lightweight health check against the Chatwoot account endpoint.
 * Returns 'ok' if we get a 2xx, 'unreachable' for any other outcome.
 */
async function checkChatwootHealth(
  baseUrl: string,
  accountId: number,
  apiToken: string,
  logger: Logger,
): Promise<'ok' | 'unreachable'> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/accounts/${String(accountId)}`, {
      method: 'GET',
      headers: { 'api_access_token': apiToken },
    });
    if (response.ok) return 'ok';
    logger.warn('Chatwoot health check non-2xx', {
      component: 'admin-chatwoot',
      status: response.status,
    });
    return 'unreachable';
  } catch (error) {
    logger.warn('Chatwoot health check threw', {
      component: 'admin-chatwoot',
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unreachable';
  }
}

/**
 * Upsert a ChannelIntegration(projectId, provider='chatwoot') — reuse the
 * existing row (via findByProjectAndProvider + update) or create a new one.
 */
async function upsertChatwootIntegration(
  channelIntegrationRepository: RouteDependencies['channelIntegrationRepository'],
  projectId: ProjectId,
  config: ChatwootIntegrationConfig,
): Promise<ChannelIntegration> {
  const existing = await channelIntegrationRepository.findByProjectAndProvider(projectId, 'chatwoot');
  if (existing) {
    return channelIntegrationRepository.update(existing.id, { config, status: 'active' });
  }
  return channelIntegrationRepository.create({
    projectId,
    provider: 'chatwoot',
    config,
    status: 'active',
  });
}

// ─── Route Registration ─────────────────────────────────────────

/** Register admin Chatwoot routes. All endpoints require a master API key. */
export function adminChatwootRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const {
    channelIntegrationRepository,
    projectRepository,
    agentRepository,
    secretService,
    channelResolver,
    logger,
  } = deps;

  fastify.addHook('preHandler', createAdminAuthHook(deps.apiKeyService));

  // ─── POST /admin/chatwoot/attach ───────────────────────────────

  fastify.post(
    '/admin/chatwoot/attach',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = AttachBodySchema.parse(request.body);
      const projectId = body.projectId as ProjectId;

      const project = await projectRepository.findById(projectId);
      if (!project) {
        return sendNotFound(reply, 'Project', projectId);
      }

      const agent = await agentRepository.findById(body.agentId as AgentId);
      if (agent?.projectId !== projectId) {
        return sendNotFound(reply, 'Agent', body.agentId);
      }

      // Store the API token (Chatwoot has no webhook signing secret in
      // v4.12.x — auth is via the path token in the URL).
      const { apiTokenKey } = await storeChatwootSecrets(secretService, {
        projectId,
        apiToken: body.apiToken,
        ...(body.apiTokenSecretKey !== undefined && { apiTokenKey: body.apiTokenSecretKey }),
      });

      // Reuse the existing pathToken when re-attaching, so the URL the user
      // pasted into Chatwoot keeps working. Only mint a new one on first
      // attach.
      const existing = await channelIntegrationRepository.findByProjectAndProvider(
        projectId,
        'chatwoot',
      );
      const existingConfig = existing?.config as ChatwootIntegrationConfig | undefined;
      const pathToken = existingConfig?.pathToken ?? generateChatwootPathToken();

      const config: ChatwootIntegrationConfig = {
        baseUrl: body.baseUrl,
        accountId: body.accountId,
        inboxId: body.inboxId,
        agentBotId: body.agentBotId,
        pathToken,
        apiTokenSecretKey: apiTokenKey,
      };

      const integration = await upsertChatwootIntegration(
        channelIntegrationRepository,
        projectId,
        config,
      );

      const channelConfigUpdated = await addChannelToAgent(agentRepository, agent, 'chatwoot');
      channelResolver.invalidate(projectId);

      const health = await checkChatwootHealth(body.baseUrl, body.accountId, body.apiToken, logger);
      const webhookUrl = `/api/v1/webhooks/chatwoot/${pathToken}`;

      logger.info('Chatwoot integration attached', {
        component: 'admin-chatwoot',
        projectId,
        agentId: body.agentId,
        integrationId: integration.id,
        channelConfigUpdated,
        health,
        apiTokenSecretKey: apiTokenKey,
      });

      await sendSuccess(reply, {
        integrationId: integration.id,
        projectId,
        agentId: body.agentId,
        health,
        channelConfigUpdated,
        apiTokenSecretKey: apiTokenKey,
        webhookUrl,
      }, 200);
    },
  );

  // ─── GET /admin/chatwoot/health/:projectId ─────────────────────

  fastify.get<{ Params: { projectId: string } }>(
    '/admin/chatwoot/health/:projectId',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const project = await projectRepository.findById(projectId);
      if (!project) {
        return sendNotFound(reply, 'Project', projectId);
      }

      const integration = await channelIntegrationRepository.findByProjectAndProvider(projectId, 'chatwoot');
      if (!integration) {
        return sendError(reply, 'NOT_ATTACHED', 'No Chatwoot integration for this project', 404);
      }

      const cwConfig = integration.config as ChatwootIntegrationConfig;
      const pathTokenConfigured = Boolean(cwConfig.pathToken);

      // Resolve the adapter and ping health (best-effort).
      let chatwootReachable = false;
      try {
        const adapter = await channelResolver.resolveAdapter(projectId, 'chatwoot');
        chatwootReachable = adapter ? await adapter.isHealthy() : false;
      } catch {
        chatwootReachable = false;
      }

      await sendSuccess(reply, {
        integrationId: integration.id,
        status: integration.status,
        baseUrl: cwConfig.baseUrl,
        accountId: cwConfig.accountId,
        inboxId: cwConfig.inboxId,
        agentBotId: cwConfig.agentBotId,
        apiTokenSecretKey: cwConfig.apiTokenSecretKey ?? null,
        pathTokenConfigured,
        webhookUrl: pathTokenConfigured
          ? `/api/v1/webhooks/chatwoot/${cwConfig.pathToken}`
          : null,
        chatwootReachable,
        createdAt: integration.createdAt.toISOString(),
        updatedAt: integration.updatedAt.toISOString(),
      });
    },
  );

  // ─── POST /admin/chatwoot/detach/:projectId ────────────────────

  fastify.post<{ Params: { projectId: string } }>(
    '/admin/chatwoot/detach/:projectId',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const integration = await channelIntegrationRepository.findByProjectAndProvider(projectId, 'chatwoot');
      if (!integration) {
        // Idempotent: nothing to remove.
        await sendSuccess(reply, { detached: true, alreadyDetached: true }, 200);
        return;
      }

      await channelIntegrationRepository.delete(integration.id);

      const agents = await agentRepository.list(projectId);
      let agentsUpdated = 0;
      for (const agent of agents) {
        const changed = await removeChannelFromAgent(agentRepository, agent, 'chatwoot');
        if (changed) agentsUpdated += 1;
      }

      channelResolver.invalidate(projectId);

      logger.info('Chatwoot integration detached', {
        component: 'admin-chatwoot',
        projectId,
        integrationId: integration.id,
        agentsUpdated,
      });

      await sendSuccess(reply, { detached: true, agentsUpdated });
    },
  );
}
