/**
 * Channel integration CRUD routes — manage per-project channel integrations.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';
import {
  TelegramIntegrationConfigSchema,
  WhatsAppIntegrationConfigSchema,
  SlackIntegrationConfigSchema,
  ChatwootIntegrationConfigSchema,
} from '@/channels/types.js';
import type { IntegrationProvider, IntegrationConfigUnion } from '@/channels/types.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const CreateIntegrationSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('telegram'),
    config: TelegramIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
  z.object({
    provider: z.literal('whatsapp'),
    config: WhatsAppIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
  z.object({
    provider: z.literal('slack'),
    config: SlackIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
  z.object({
    provider: z.literal('chatwoot'),
    config: ChatwootIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
]);

const UpdateIntegrationStatusSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
});

// ─── Secret Key Extraction ──────────────────────────────────────

/** Extract secret key references from an integration config for validation. */
function getReferencedSecretKeys(provider: IntegrationProvider, config: Record<string, unknown>): string[] {
  switch (provider) {
    case 'telegram':
      return [config['botTokenSecretKey'] as string].filter(Boolean);
    case 'whatsapp': {
      const keys = [config['accessTokenSecretKey'] as string];
      if (config['verifyTokenSecretKey']) keys.push(config['verifyTokenSecretKey'] as string);
      return keys.filter(Boolean);
    }
    case 'slack': {
      const keys = [config['botTokenSecretKey'] as string];
      if (config['signingSecretSecretKey']) keys.push(config['signingSecretSecretKey'] as string);
      return keys.filter(Boolean);
    }
    case 'chatwoot':
      return []; // Chatwoot uses env vars, not secrets table
    default:
      return [];
  }
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register channel integration CRUD routes. */
export function integrationRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { channelIntegrationRepository, channelResolver, secretService, logger } = deps;

  // ─── GET /projects/:projectId/integrations ─────────────────────

  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/integrations',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;
      const integrations = await channelIntegrationRepository.findByProject(projectId);

      const items = integrations.map((i) => ({
        ...i,
        webhookUrl: i.provider === 'chatwoot'
          ? '/api/v1/webhooks/chatwoot'
          : `/api/v1/webhooks/${i.provider}/${i.id}`,
      }));

      return sendSuccess(reply, { items, total: items.length });
    },
  );

  // ─── POST /projects/:projectId/integrations ────────────────────

  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/integrations',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;
      const input = CreateIntegrationSchema.parse(request.body);

      // Validate referenced secret keys exist
      const secretKeys = getReferencedSecretKeys(input.provider, input.config as Record<string, unknown>);
      for (const key of secretKeys) {
        const exists = await secretService.exists(projectId, key);
        if (!exists) {
          return sendError(
            reply,
            'SECRET_NOT_FOUND',
            `Secret "${key}" not found for project. Create it first via POST /projects/${projectId}/secrets`,
            400,
          );
        }
      }

      try {
        const integration = await channelIntegrationRepository.create({
          projectId,
          provider: input.provider,
          config: input.config,
          status: input.status,
        });

        channelResolver.invalidate(projectId);

        const webhookUrl = integration.provider === 'chatwoot'
          ? '/api/v1/webhooks/chatwoot'
          : `/api/v1/webhooks/${integration.provider}/${integration.id}`;

        logger.info('Channel integration created', {
          component: 'integrations',
          projectId,
          provider: integration.provider,
          integrationId: integration.id,
        });

        await sendSuccess(reply, { ...integration, webhookUrl }, 201); return;
      } catch (error) {
        // Handle unique constraint violation (one integration per provider per project)
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(
            reply,
            'DUPLICATE_INTEGRATION',
            `A ${input.provider} integration already exists for this project`,
            409,
          );
        }
        throw error;
      }
    },
  );

  // ─── GET /projects/:projectId/integrations/:integrationId ──────

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      const webhookUrl = integration.provider === 'chatwoot'
        ? '/api/v1/webhooks/chatwoot'
        : `/api/v1/webhooks/${integration.provider}/${integration.id}`;

      return sendSuccess(reply, { ...integration, webhookUrl });
    },
  );

  // ─── PUT /projects/:projectId/integrations/:integrationId ──────

  fastify.put<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const existing = await channelIntegrationRepository.findById(request.params.integrationId);
      if (existing?.projectId !== projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      // Parse status (always valid regardless of provider)
      const body = request.body as Record<string, unknown>;
      const statusInput = UpdateIntegrationStatusSchema.parse({ status: body['status'] });

      // If config is being updated, validate against the provider's schema
      let validatedConfig: IntegrationConfigUnion | undefined;
      if (body['config'] !== undefined) {
        const configSchemas: Record<string, z.ZodType> = {
          telegram: TelegramIntegrationConfigSchema,
          whatsapp: WhatsAppIntegrationConfigSchema,
          slack: SlackIntegrationConfigSchema,
          chatwoot: ChatwootIntegrationConfigSchema,
        };
        const schema = configSchemas[existing.provider];
        if (schema) {
          validatedConfig = schema.parse(body['config']) as IntegrationConfigUnion;
        }

        // Validate referenced secret keys
        if (validatedConfig) {
          const secretKeys = getReferencedSecretKeys(existing.provider, validatedConfig as unknown as Record<string, unknown>);
          for (const key of secretKeys) {
            const exists = await secretService.exists(projectId, key);
            if (!exists) {
              return sendError(
                reply,
                'SECRET_NOT_FOUND',
                `Secret "${key}" not found for project`,
                400,
              );
            }
          }
        }
      }

      const updated = await channelIntegrationRepository.update(request.params.integrationId, {
        ...(validatedConfig !== undefined && { config: validatedConfig }),
        ...statusInput,
      });
      channelResolver.invalidate(projectId);

      logger.info('Channel integration updated', {
        component: 'integrations',
        projectId,
        integrationId: updated.id,
      });

      return sendSuccess(reply, updated);
    },
  );

  // ─── DELETE /projects/:projectId/integrations/:integrationId ───

  fastify.delete<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const existing = await channelIntegrationRepository.findById(request.params.integrationId);
      if (existing?.projectId !== projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      await channelIntegrationRepository.delete(request.params.integrationId);
      channelResolver.invalidate(projectId);

      logger.info('Channel integration deleted', {
        component: 'integrations',
        projectId,
        integrationId: request.params.integrationId,
      });

      return sendSuccess(reply, { deleted: true });
    },
  );

  // ─── GET /projects/:projectId/integrations/:integrationId/health

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/health',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      const adapter = await channelResolver.resolveAdapter(projectId, integration.provider);
      if (!adapter) {
        return sendSuccess(reply, {
          healthy: false,
          provider: integration.provider,
          status: integration.status,
          error: 'Failed to resolve adapter (check secrets)',
        });
      }

      try {
        const healthy = await adapter.isHealthy();
        await sendSuccess(reply, {
          healthy,
          provider: integration.provider,
          status: integration.status,
        }); return;
      } catch {
        await sendSuccess(reply, {
          healthy: false,
          provider: integration.provider,
          status: integration.status,
          error: 'Health check failed',
        });
      }
    },
  );
}
