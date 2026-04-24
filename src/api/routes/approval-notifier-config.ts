/**
 * Approval notifier config routes.
 *
 * Per-project configuration for the dashboard-link Telegram approval
 * notifier. GET/PUT/DELETE store credentials in SecretService (token)
 * and project.metadata (chatId, dashboard URL, last-test outcome). A
 * POST /test helper sends a probe message without persisting state so
 * admins can validate the config before committing to it.
 *
 * Authentication is inherited from the globally registered
 * `requireProjectAccess` hook — master keys see every project, project
 * keys only their own. No extra preHandler is needed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createLogger } from '@/observability/logger.js';
import type { TelegramConfig } from '@/infrastructure/repositories/approval-notifier-config-repository.js';

const logger = createLogger({ name: 'approval-notifier-config-routes' });

// ─── Zod schemas ───────────────────────────────────────────────

/**
 * Telegram bot token format: numeric id, a colon, 35 characters from
 * the URL-safe alphabet. This matches every token BotFather has ever
 * handed out — strict enough to catch typos, loose enough to keep
 * working if Telegram ever widens the alphabet.
 */
const TELEGRAM_BOT_TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]{35,}$/;

/**
 * chatId accepts either a plain numeric id (`123456789`) or a group /
 * channel id (`-100123456789`). We keep validation loose because
 * Telegram does not publicise a formal spec for the length.
 */
const TELEGRAM_CHAT_ID_REGEX = /^-?\d+$/;

const telegramPutSchema = z.object({
  enabled: z.boolean().optional(),
  botToken: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => v === undefined || v === null || v === '' || TELEGRAM_BOT_TOKEN_REGEX.test(v),
      { message: 'botToken does not match the expected Telegram format' },
    ),
  chatId: z
    .string()
    .min(1)
    .max(64)
    .regex(TELEGRAM_CHAT_ID_REGEX, 'chatId must be a numeric Telegram id (optionally starting with "-")')
    .optional(),
  dashboardBaseUrl: z
    .string()
    .min(1)
    .max(500)
    .refine((v) => {
      try {
        const url = new URL(v);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'dashboardBaseUrl must be a valid http(s) URL' })
    .optional(),
});

const putBodySchema = z.object({
  telegram: telegramPutSchema,
});

const testBodySchema = z
  .object({
    chatId: z
      .string()
      .min(1)
      .max(64)
      .regex(TELEGRAM_CHAT_ID_REGEX, 'chatId must be a numeric Telegram id (optionally starting with "-")')
      .optional(),
  })
  .optional();

// ─── Response builders ────────────────────────────────────────

function telegramResponse(config: TelegramConfig): { telegram: TelegramConfig } {
  return { telegram: config };
}

// ─── Factory ──────────────────────────────────────────────────

/**
 * Extras that don't belong in the shared `RouteDependencies` envelope —
 * `fetchImpl` is injected by tests, and the env fallback URL comes
 * straight from `process.env` in main.ts.
 */
export interface ApprovalNotifierConfigRouteExtras {
  fetchImpl?: typeof fetch;
  envDashboardBaseUrl?: string;
}

/** Register approval notifier config routes. */
export function approvalNotifierConfigRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
  extras: ApprovalNotifierConfigRouteExtras = {},
): void {
  const { prisma, approvalNotifierConfigRepository: configRepo } = deps;
  const { envDashboardBaseUrl } = extras;
  const doFetch = extras.fetchImpl ?? fetch;

  // GET /projects/:projectId/approval-notifier-config
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/approval-notifier-config',
    async (request, reply) => {
      const { projectId } = request.params;
      const config = await configRepo.getTelegramConfig(projectId);
      if (!config) return sendNotFound(reply, 'Project', projectId);
      return sendSuccess(reply, telegramResponse(config));
    },
  );

  // PUT /projects/:projectId/approval-notifier-config
  fastify.put<{ Params: { projectId: string } }>(
    '/projects/:projectId/approval-notifier-config',
    async (request, reply) => {
      const { projectId } = request.params;

      const existing = await configRepo.getTelegramConfig(projectId);
      if (!existing) return sendNotFound(reply, 'Project', projectId);

      const body = putBodySchema.parse(request.body);

      const updated = await configRepo.setTelegramConfig(projectId, {
        enabled: body.telegram.enabled,
        botToken: body.telegram.botToken,
        chatId: body.telegram.chatId,
        dashboardBaseUrl: body.telegram.dashboardBaseUrl,
      });

      logger.info('Approval notifier config updated', {
        component: 'approval-notifier-config-routes',
        projectId,
        tokenChanged: body.telegram.botToken !== undefined,
        enabled: updated.enabled,
        hasToken: updated.hasToken,
      });

      return sendSuccess(reply, telegramResponse(updated));
    },
  );

  // DELETE /projects/:projectId/approval-notifier-config/telegram
  fastify.delete<{ Params: { projectId: string } }>(
    '/projects/:projectId/approval-notifier-config/telegram',
    async (request, reply) => {
      const { projectId } = request.params;

      const existing = await configRepo.getTelegramConfig(projectId);
      if (!existing) return sendNotFound(reply, 'Project', projectId);

      await configRepo.deleteTelegramConfig(projectId);

      logger.info('Approval notifier config deleted', {
        component: 'approval-notifier-config-routes',
        projectId,
      });

      return sendSuccess(reply, { deleted: true });
    },
  );

  // POST /projects/:projectId/approval-notifier-config/test
  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/approval-notifier-config/test',
    async (request, reply) => {
      const { projectId } = request.params;

      const existing = await configRepo.getTelegramConfig(projectId);
      if (!existing) return sendNotFound(reply, 'Project', projectId);

      const body = testBodySchema.parse(request.body ?? {});
      const overrideChatId = body?.chatId;

      const resolved = await configRepo.resolveTelegramConfig(projectId);

      // Chat id precedence: explicit override > resolved per-project chatId.
      const chatId = overrideChatId ?? resolved?.chatId;
      const botToken = resolved?.botToken;

      if (!botToken || !chatId) {
        return sendError(
          reply,
          'NOTIFIER_NOT_CONFIGURED',
          'Telegram notifier is not configured for this project. Set botToken + chatId via PUT before running /test.',
          400,
          {
            hasToken: Boolean(botToken),
            hasChatId: Boolean(chatId),
          },
        );
      }

      const projectName = await loadProjectName(prisma, projectId);
      const dashboardBaseUrl =
        resolved?.dashboardBaseUrl ?? envDashboardBaseUrl ?? null;

      const text = buildTestMessage({
        projectName,
        timestampIso: new Date().toISOString(),
        dashboardBaseUrl,
      });

      try {
        const response = await doFetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: 'Markdown',
              disable_web_page_preview: true,
            }),
          },
        );

        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          description?: string;
        };

        if (!response.ok || json.ok === false) {
          const reason =
            json.description ?? `http_${String(response.status)}`;
          await configRepo.recordTestResult(projectId, `failed: ${reason}`);
          return sendSuccess(reply, {
            success: false,
            error: reason,
          });
        }

        const sentAt = new Date().toISOString();
        await configRepo.recordTestResult(projectId, 'success');
        return sendSuccess(reply, { success: true, sentAt });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error);
        await configRepo.recordTestResult(projectId, `failed: ${reason}`);
        logger.error('Approval notifier test send failed', {
          component: 'approval-notifier-config-routes',
          projectId,
          error: reason,
        });
        return sendSuccess(reply, { success: false, error: reason });
      }
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────

interface TestMessageParts {
  projectName: string;
  timestampIso: string;
  dashboardBaseUrl: string | null;
}

/** Exported for tests — the expected test message body. */
export function buildTestMessage(parts: TestMessageParts): string {
  const lines = [
    '✅ *Prueba de notifier*',
    '',
    'Si recibís este mensaje, la configuración de Telegram está funcionando correctamente.',
    '',
    `*Proyecto:* ${escapeMarkdown(parts.projectName)}`,
    `*Fecha:* ${parts.timestampIso}`,
  ];
  if (parts.dashboardBaseUrl) {
    lines.push(`*Dashboard:* ${parts.dashboardBaseUrl.replace(/\/$/, '')}`);
  }
  return lines.join('\n');
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()`])/g, '\\$1');
}

async function loadProjectName(
  prisma: RouteDependencies['prisma'],
  projectId: string,
): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  return project?.name ?? projectId;
}
