/**
 * WhatsApp Templates routes — list and send Meta WhatsApp Business templates.
 *
 * GET  /projects/:projectId/whatsapp/templates       — list approved templates from Meta WABA API
 * POST /projects/:projectId/whatsapp/templates/send  — send a template message to a recipient
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import {
  fetchWhatsAppTemplates,
  sendWhatsAppTemplate,
} from '@/channels/adapters/whatsapp.js';
import type { ProjectId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const sendTemplateSchema = z.object({
  to: z.string().min(1).max(30),
  templateName: z.string().min(1).max(512),
  language: z.string().min(2).max(10),
  components: z.array(z.record(z.unknown())).optional(),
  integrationId: z.string().optional(),
});

// ─── Route Registration ─────────────────────────────────────────

/** Register WhatsApp template routes on a Fastify instance. */
export function whatsappTemplateRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { secretService, channelResolver, logger } = opts;

  // ─── GET /projects/:projectId/whatsapp/templates ─────────────
  fastify.get(
    '/projects/:projectId/whatsapp/templates',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const { projectId } = request.params;

      let wabaId: string;
      let accessToken: string;

      try {
        wabaId = await secretService.get(projectId as ProjectId, 'WHATSAPP_WABA_ID');
      } catch {
        await sendError(reply, 'MISSING_SECRET', 'Secret WHATSAPP_WABA_ID not configured for this project', 400);
        return;
      }

      try {
        accessToken = await secretService.get(projectId as ProjectId, 'WHATSAPP_ACCESS_TOKEN');
      } catch {
        await sendError(reply, 'MISSING_SECRET', 'Secret WHATSAPP_ACCESS_TOKEN not configured for this project', 400);
        return;
      }

      try {
        const templates = await fetchWhatsAppTemplates(wabaId, accessToken);
        // Return only approved templates
        const approved = templates.filter((t) => t.status === 'APPROVED');
        await sendSuccess(reply, approved);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch templates';
        logger.error('Failed to fetch WhatsApp templates', {
          component: 'whatsapp-templates',
          projectId,
          error: message,
        });
        await sendError(reply, 'FETCH_FAILED', message, 502);
      }
    },
  );

  // ─── POST /projects/:projectId/whatsapp/templates/send ───────
  fastify.post(
    '/projects/:projectId/whatsapp/templates/send',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const { projectId } = request.params;

      const parseResult = sendTemplateSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const { to, templateName, language, components } = parseResult.data;

      let phoneNumberId: string;
      let accessToken: string;

      try {
        phoneNumberId = await secretService.get(projectId as ProjectId, 'WHATSAPP_PHONE_NUMBER_ID');
      } catch {
        await sendError(reply, 'MISSING_SECRET', 'Secret WHATSAPP_PHONE_NUMBER_ID not configured for this project', 400);
        return;
      }

      try {
        accessToken = await secretService.get(projectId as ProjectId, 'WHATSAPP_ACCESS_TOKEN');
      } catch {
        await sendError(reply, 'MISSING_SECRET', 'Secret WHATSAPP_ACCESS_TOKEN not configured for this project', 400);
        return;
      }

      logger.info('Sending WhatsApp template message', {
        component: 'whatsapp-templates',
        projectId,
        templateName,
        language,
        to,
      });

      const result = await sendWhatsAppTemplate(
        phoneNumberId,
        accessToken,
        to,
        templateName,
        language,
        components as object[] | undefined,
      );

      if (result.success) {
        await sendSuccess(reply, {
          channelMessageId: result.channelMessageId,
          to,
          templateName,
          language,
        });
      } else {
        logger.error('Failed to send WhatsApp template', {
          component: 'whatsapp-templates',
          projectId,
          error: result.error,
        });
        await sendError(reply, 'SEND_FAILED', result.error ?? 'Failed to send template', 502);
      }
    },
  );

  void channelResolver; // used indirectly via secretService; suppress unused warning
}
