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
  WhatsAppWahaIntegrationConfigSchema,
  SlackIntegrationConfigSchema,
  ChatwootIntegrationConfigSchema,
  VapiIntegrationConfigSchema,
} from '@/channels/types.js';
import type { IntegrationProvider, IntegrationConfigUnion, WhatsAppWahaIntegrationConfig } from '@/channels/types.js';

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
    provider: z.literal('whatsapp-waha'),
    // wahaBaseUrl is optional at creation time — defaults to WAHA_DEFAULT_URL env var
    config: z.object({
      wahaBaseUrl: z.string().url().optional().transform(
        (v) => v ?? process.env['WAHA_DEFAULT_URL'] ?? 'http://localhost:3003',
      ),
      sessionName: z.string().min(1).max(64).optional(),
    }),
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
  z.object({
    provider: z.literal('vapi'),
    config: VapiIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
]);

const UpdateIntegrationStatusSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
});

const WahaSessionActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
});

// ─── WAHA Helpers ────────────────────────────────────────────────

interface WahaSessionStatus {
  status?: string;
  name?: string;
}

/** Build headers for WAHA API requests, including API key if configured. */
function getWahaHeaders(): Record<string, string> {
  const apiKey = process.env['WAHA_API_KEY'];
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
  };
}

/** Extract WAHA config from an integration config JSON. */
function getWahaConfig(config: Record<string, unknown>): { wahaBaseUrl: string; sessionName: string } {
  return {
    wahaBaseUrl: config['wahaBaseUrl'] as string,
    sessionName: (config['sessionName'] as string) || 'default',
  };
}

/** Start a WAHA session and configure its webhook. Non-throwing. */
async function setupWahaSession(
  wahaBaseUrl: string,
  sessionName: string,
  webhookUrl: string,
  logger: { info: (msg: string, ctx: { component: string; [k: string]: unknown }) => void; warn: (msg: string, ctx: { component: string; [k: string]: unknown }) => void },
): Promise<void> {
  const webhookConfig = { webhooks: [{ url: webhookUrl, events: ['message'] }] };
  try {
    // Try modern path-based API first: POST /api/sessions/{name}/start
    const pathRes = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/start`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ config: webhookConfig }),
    });

    if (pathRes.ok) {
      logger.info('WAHA session started (path API) and webhook configured', {
        component: 'integrations',
        sessionName,
        webhookUrl,
      });
      return;
    }

    // Session may already be running — try PUT to reconfigure webhook
    const putRes = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}`, {
      method: 'PUT',
      headers: getWahaHeaders(),
      body: JSON.stringify({ config: webhookConfig }),
    });
    if (putRes.ok) {
      logger.info('WAHA session webhook reconfigured (PUT)', {
        component: 'integrations',
        sessionName,
        webhookUrl,
      });
      return;
    }

    // Fall back to legacy API: POST /api/sessions/start with name in body
    const legacyRes = await fetch(`${wahaBaseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ name: sessionName, config: webhookConfig }),
    });

    if (legacyRes.ok) {
      logger.info('WAHA session started (legacy API) and webhook configured', {
        component: 'integrations',
        sessionName,
        webhookUrl,
      });
    } else {
      const text = await legacyRes.text();
      logger.warn(`WAHA session start returned ${String(legacyRes.status)}: ${text}`, {
        component: 'integrations',
        sessionName,
      });
    }
  } catch {
    logger.warn('WAHA not reachable — session will need manual setup', {
      component: 'integrations',
      wahaBaseUrl,
      sessionName,
    });
  }
}

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
    case 'whatsapp-waha':
      return []; // WAHA uses direct URL, no secrets
    case 'chatwoot': {
      const keys: string[] = [];
      if (config['apiTokenSecretKey']) keys.push(config['apiTokenSecretKey'] as string);
      if (config['webhookSecretKey']) keys.push(config['webhookSecretKey'] as string);
      return keys;
    }
    case 'vapi': {
      const keys = [config['vapiApiKeySecretKey'] as string];
      if (config['vapiWebhookSecretKey']) keys.push(config['vapiWebhookSecretKey'] as string);
      return keys.filter(Boolean);
    }
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
      const secretKeys = getReferencedSecretKeys(input.provider, input.config as unknown as Record<string, unknown>);
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

        // Auto-setup WAHA session + webhook when creating a whatsapp-waha integration
        if (integration.provider === 'whatsapp-waha') {
          const nexusPublicUrl = process.env['NEXUS_PUBLIC_URL'];
          if (nexusPublicUrl) {
            const wahaConfig = integration.config as unknown as Record<string, unknown>;
            const { wahaBaseUrl, sessionName } = getWahaConfig(wahaConfig);
            const wahaWebhookUrl = `${nexusPublicUrl}/api/v1/webhooks/whatsapp-waha/${integration.id}`;
            // Fire-and-forget — don't block the response
            void setupWahaSession(wahaBaseUrl, sessionName, wahaWebhookUrl, logger);
          } else {
            logger.warn('NEXUS_PUBLIC_URL not set — skipping WAHA auto-setup', {
              component: 'integrations',
              integrationId: integration.id,
            });
          }
        }

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
          'whatsapp-waha': WhatsAppWahaIntegrationConfigSchema,
          slack: SlackIntegrationConfigSchema,
          chatwoot: ChatwootIntegrationConfigSchema,
          vapi: VapiIntegrationConfigSchema,
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

      // Stop WAHA session before deleting the integration (prevents stale sessions)
      if (existing.provider === 'whatsapp-waha') {
        const wahaConfig = existing.config as unknown as Record<string, unknown>;
        const { wahaBaseUrl, sessionName } = getWahaConfig(wahaConfig);
        try {
          await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/stop`, {
            method: 'POST',
            headers: getWahaHeaders(),
          });
          logger.info('WAHA session stopped on integration delete', {
            component: 'integrations',
            sessionName,
          });
        } catch {
          // WAHA unreachable — session may already be gone
        }
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

  // ─── WAHA-specific endpoints ──────────────────────────────────

  // ─── GET .../waha/status ──────────────────────────────────────

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/waha/status',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }
      if (integration.provider !== 'whatsapp-waha') {
        return sendError(reply, 'INVALID_PROVIDER', 'This endpoint is only for WhatsApp (QR) integrations', 400);
      }

      const wahaConfig = integration.config as unknown as WhatsAppWahaIntegrationConfig;
      const wahaBaseUrl = wahaConfig.wahaBaseUrl;
      const sessionName = wahaConfig.sessionName ?? 'default';

      try {
        const response = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}`, {
          headers: getWahaHeaders(),
        });
        if (!response.ok) {
          await sendSuccess(reply, { sessionStatus: 'STOPPED', sessionName }); return;
        }
        const data = (await response.json()) as unknown as WahaSessionStatus;
        await sendSuccess(reply, {
          sessionStatus: data.status ?? 'UNKNOWN',
          sessionName: data.name ?? sessionName,
        }); return;
      } catch {
        return sendSuccess(reply, { sessionStatus: 'UNREACHABLE', sessionName });
      }
    },
  );

  // ─── GET .../waha/qr ──────────────────────────────────────────

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/waha/qr',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }
      if (integration.provider !== 'whatsapp-waha') {
        return sendError(reply, 'INVALID_PROVIDER', 'This endpoint is only for WhatsApp (QR) integrations', 400);
      }

      const wahaConfig = integration.config as unknown as WhatsAppWahaIntegrationConfig;
      const wahaBaseUrl = wahaConfig.wahaBaseUrl;
      const sessionName = wahaConfig.sessionName ?? 'default';

      try {
        const response = await fetch(
          `${wahaBaseUrl}/api/${sessionName}/auth/qr?format=image`,
          { headers: getWahaHeaders() },
        );
        if (!response.ok) {
          await sendError(reply, 'QR_UNAVAILABLE', 'QR code not available (session may already be connected)', 404); return;
        }
        const contentType = response.headers.get('content-type') ?? 'image/png';
        const buffer = Buffer.from(await response.arrayBuffer());
        // Allow cross-origin <img> loads (dashboard is on a different port)
        reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
        await reply.type(contentType).send(buffer);
        return;
      } catch {
        return sendError(reply, 'WAHA_UNREACHABLE', 'Cannot reach WAHA service', 502);
      }
    },
  );

  // ─── POST .../waha/session ────────────────────────────────────

  fastify.post<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/waha/session',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }
      if (integration.provider !== 'whatsapp-waha') {
        return sendError(reply, 'INVALID_PROVIDER', 'This endpoint is only for WhatsApp (QR) integrations', 400);
      }

      const wahaConfig = integration.config as unknown as WhatsAppWahaIntegrationConfig;
      const wahaBaseUrl = wahaConfig.wahaBaseUrl;
      const sessionName = wahaConfig.sessionName ?? 'default';

      const { action } = WahaSessionActionSchema.parse(request.body);
      const nexusPublicUrl = process.env['NEXUS_PUBLIC_URL'] ?? '';
      const webhookUrl = nexusPublicUrl
        ? `${nexusPublicUrl}/api/v1/webhooks/whatsapp-waha/${request.params.integrationId}`
        : '';

      const webhookConfig = webhookUrl
        ? { webhooks: [{ url: webhookUrl, events: ['message'] }] }
        : undefined;

      try {
        if (action === 'stop') {
          // Try modern path-based API, fall back to legacy
          await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/stop`, {
            method: 'POST',
            headers: getWahaHeaders(),
            body: JSON.stringify({}),
          }).catch(() =>
            fetch(`${wahaBaseUrl}/api/sessions/stop`, {
              method: 'POST',
              headers: getWahaHeaders(),
              body: JSON.stringify({ name: sessionName }),
            }),
          );
          await sendSuccess(reply, { action: 'stop', success: true }); return;
        }

        if (action === 'restart') {
          // Stop first, then fall through to start (which configures the webhook)
          await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/stop`, {
            method: 'POST',
            headers: getWahaHeaders(),
            body: JSON.stringify({}),
          }).catch(() => undefined);
        }

        // Start — try modern path-based API first
        const pathStartRes = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/start`, {
          method: 'POST',
          headers: getWahaHeaders(),
          body: JSON.stringify(webhookConfig ? { config: webhookConfig } : {}),
        });

        if (pathStartRes.ok) {
          logger.info(`WAHA session ${action}ed (path API)`, { component: 'integrations', sessionName, webhookUrl });
          await sendSuccess(reply, { action, success: true }); return;
        }

        // Fall back to legacy API (POST /api/sessions/start with name in body)
        const legacyBody: Record<string, unknown> = { name: sessionName };
        if (webhookConfig) legacyBody['config'] = webhookConfig;

        const legacyStartRes = await fetch(`${wahaBaseUrl}/api/sessions/start`, {
          method: 'POST',
          headers: getWahaHeaders(),
          body: JSON.stringify(legacyBody),
        });

        if (!legacyStartRes.ok) {
          const text = await legacyStartRes.text();
          await sendError(reply, 'WAHA_ERROR', `WAHA returned ${String(legacyStartRes.status)}: ${text}`, 502); return;
        }

        logger.info(`WAHA session ${action}ed (legacy API)`, { component: 'integrations', sessionName, webhookUrl });
        await sendSuccess(reply, { action, success: true }); return;
      } catch {
        return sendError(reply, 'WAHA_UNREACHABLE', 'Cannot reach WAHA service', 502);
      }
    },
  );
}
