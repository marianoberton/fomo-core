/**
 * Generic webhook routes — CRUD for webhooks + dynamic trigger endpoint.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { WebhookEvent } from '@/webhooks/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const createWebhookSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  triggerPrompt: z.string().min(1),
  secretEnvVar: z.string().optional(),
  allowedIps: z.array(z.string()).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

const updateWebhookSchema = z.object({
  agentId: z.string().optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  triggerPrompt: z.string().min(1).optional(),
  secretEnvVar: z.string().optional(),
  allowedIps: z.array(z.string()).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export async function webhookGenericRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): Promise<void> {
  const { webhookRepository, webhookProcessor, logger } = deps;

  // ─── List Webhooks ──────────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/webhooks',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      const webhooks = await webhookRepository.list(projectId);

      return reply.send({ webhooks });
    },
  );

  // ─── Get Webhook ────────────────────────────────────────────────

  fastify.get(
    '/webhooks/:webhookId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { webhookId } = request.params as { webhookId: string };

      const webhook = await webhookRepository.findById(webhookId);

      if (!webhook) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }

      return reply.send({ webhook });
    },
  );

  // ─── Create Webhook ─────────────────────────────────────────────

  fastify.post(
    '/webhooks',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createWebhookSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      const webhook = await webhookRepository.create(parseResult.data);

      logger.info('Created webhook', {
        component: 'webhooks-generic',
        webhookId: webhook.id,
        name: webhook.name,
      });

      return reply.status(201).send({ webhook });
    },
  );

  // ─── Update Webhook ─────────────────────────────────────────────

  fastify.patch(
    '/webhooks/:webhookId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { webhookId } = request.params as { webhookId: string };

      const parseResult = updateWebhookSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const webhook = await webhookRepository.update(webhookId, parseResult.data);

        logger.info('Updated webhook', {
          component: 'webhooks-generic',
          webhookId: webhook.id,
        });

        return reply.send({ webhook });
      } catch (error) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }
    },
  );

  // ─── Delete Webhook ─────────────────────────────────────────────

  fastify.delete(
    '/webhooks/:webhookId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { webhookId } = request.params as { webhookId: string };

      try {
        await webhookRepository.delete(webhookId);

        logger.info('Deleted webhook', {
          component: 'webhooks-generic',
          webhookId,
        });

        return reply.status(204).send();
      } catch (error) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }
    },
  );

  // ─── Dynamic Webhook Trigger ────────────────────────────────────

  fastify.post(
    '/trigger/:webhookId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { webhookId } = request.params as { webhookId: string };

      // Get source IP (handle proxies)
      const sourceIp =
        (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        request.ip;

      const event: WebhookEvent = {
        webhookId,
        payload: request.body,
        headers: request.headers as Record<string, string>,
        sourceIp,
        receivedAt: new Date(),
      };

      logger.debug('Received webhook trigger', {
        component: 'webhooks-generic',
        webhookId,
        sourceIp,
      });

      // Process the webhook
      const result = await webhookProcessor.process(event);

      if (result.success) {
        return reply.send({
          success: true,
          sessionId: result.sessionId,
          response: result.response,
          durationMs: result.durationMs,
        });
      }

      // Return appropriate status code based on error
      const statusCode =
        result.error === 'Webhook not found' ? 404 :
        result.error === 'Webhook is paused' ? 503 :
        result.error === 'IP not allowed' ? 403 :
        result.error === 'Missing signature' ? 401 :
        result.error === 'Invalid signature' ? 401 :
        500;

      return reply.status(statusCode).send({
        success: false,
        error: result.error,
        durationMs: result.durationMs,
      });
    },
  );

  // ─── Test Webhook ───────────────────────────────────────────────

  fastify.post(
    '/webhooks/:webhookId/test',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { webhookId } = request.params as { webhookId: string };

      const webhook = await webhookRepository.findById(webhookId);

      if (!webhook) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }

      // Create a test event
      const event: WebhookEvent = {
        webhookId,
        payload: request.body || { test: true, timestamp: new Date().toISOString() },
        headers: {},
        receivedAt: new Date(),
      };

      const result = await webhookProcessor.process(event);

      return reply.send({
        webhook: {
          id: webhook.id,
          name: webhook.name,
        },
        result,
      });
    },
  );
}
