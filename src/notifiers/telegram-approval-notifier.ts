/**
 * Telegram Approval Notifier (dashboard-link variant).
 *
 * Fires a brief Telegram message with a link to the dashboard approval
 * view every time the ApprovalGate receives a new request. The message
 * never contains PII beyond a name + channel reference — the full
 * context lives behind the dashboard link.
 *
 * Resolution order for the target chat_id:
 *   1. project.metadata.approvalNotifier.telegram.chatId (if `enabled: true`).
 *   2. TELEGRAM_APPROVAL_DEFAULT_CHAT_ID env var.
 *
 * If neither the bot token nor any chat_id can be resolved, the notifier
 * becomes a silent no-op. A single warn is logged at startup (not per
 * request) so log volume stays flat even under heavy campaign traffic.
 *
 * NOTE: This is separate from the interactive HITL notifier in
 * `src/hitl/telegram-approval-notifier.ts`, which uses per-project
 * SecretService credentials and inline callback buttons. The two can
 * coexist — each has its own bot token env var / secret key.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { ApprovalNotificationContext, ApprovalContextNotifier } from './types.js';

// ─── Config ────────────────────────────────────────────────────

export interface TelegramApprovalNotifierConfig {
  /** Bot token from BotFather. Read from TELEGRAM_APPROVAL_BOT_TOKEN. */
  botToken: string | undefined;
  /** Default chat_id used when a project has no override. Read from TELEGRAM_APPROVAL_DEFAULT_CHAT_ID. */
  defaultChatId: string | undefined;
  /** Base URL of the dashboard used to build the approval link. */
  dashboardBaseUrl: string | undefined;
  /** Prisma client for resolving per-project overrides. */
  prisma: PrismaClient;
  logger: Logger;
  /**
   * Override for `fetch` — tests inject a mock. Defaults to global fetch.
   */
  fetchImpl?: typeof fetch;
}

// ─── Project Metadata Shape ────────────────────────────────────

interface ProjectMetadataShape {
  approvalNotifier?: {
    telegram?: {
      enabled?: boolean;
      chatId?: string;
    };
  };
}

// ─── Factory ───────────────────────────────────────────────────

/**
 * Create the Telegram approval notifier.
 *
 * Returns a no-op notifier when disabled — callers don't need to
 * branch on configuration state.
 */
export function createTelegramApprovalNotifier(
  config: TelegramApprovalNotifierConfig,
): ApprovalContextNotifier {
  const { botToken, defaultChatId, dashboardBaseUrl, prisma, logger } = config;
  const doFetch = config.fetchImpl ?? fetch;

  // Disabled if the bot token is missing. The dashboard URL is required
  // to build the link; without it we can't send anything useful either.
  if (!botToken || !dashboardBaseUrl) {
    logger.warn('Telegram approval notifier disabled (missing env vars)', {
      component: 'telegram-approval-notifier',
      hasBotToken: Boolean(botToken),
      hasDashboardBaseUrl: Boolean(dashboardBaseUrl),
      hasDefaultChatId: Boolean(defaultChatId),
    });
    return (): Promise<void> => Promise.resolve();
  }

  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  const normalizedDashboardUrl = dashboardBaseUrl.replace(/\/$/, '');

  return async (context: ApprovalNotificationContext): Promise<void> => {
    const chatId = await resolveChatId(prisma, context.projectId, defaultChatId, logger);
    if (!chatId) {
      logger.warn('Telegram approval notifier: no chat_id resolved for project', {
        component: 'telegram-approval-notifier',
        projectId: context.projectId,
        approvalId: context.approvalId,
      });
      return;
    }

    const text = buildMessage(context, normalizedDashboardUrl);

    try {
      const response = await doFetch(`${baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };

      if (!response.ok || body.ok === false) {
        logger.error('Telegram approval notifier: API error', {
          component: 'telegram-approval-notifier',
          approvalId: context.approvalId,
          chatId,
          httpStatus: response.status,
          description: body.description,
        });
        return;
      }

      logger.info('Telegram approval notifier: approval_sent', {
        component: 'telegram-approval-notifier',
        event: 'approval_sent',
        approvalId: context.approvalId,
        chatId,
      });
    } catch (error) {
      logger.error('Telegram approval notifier: fetch failed', {
        component: 'telegram-approval-notifier',
        approvalId: context.approvalId,
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Resolve the chat_id for a project — prefer the per-project override,
 * fall back to the default env var.
 */
async function resolveChatId(
  prisma: PrismaClient,
  projectId: string,
  defaultChatId: string | undefined,
  logger: Logger,
): Promise<string | null> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { metadata: true },
    });
    const metadata = (project?.metadata ?? null) as ProjectMetadataShape | null;
    const override = metadata?.approvalNotifier?.telegram;
    if (override?.enabled && typeof override.chatId === 'string' && override.chatId.length > 0) {
      return override.chatId;
    }
  } catch (error) {
    // Defensive — if the lookup blows up we fall back to default; we do
    // NOT want notifier failure to break the approval flow.
    logger.warn('Telegram approval notifier: project metadata lookup failed', {
      component: 'telegram-approval-notifier',
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return defaultChatId && defaultChatId.length > 0 ? defaultChatId : null;
}

/**
 * Build the markdown message body. Kept pure + exported for tests.
 *
 * Deliberately PII-light: we include the lead name + channel reference
 * but never prices, sizes, or free-form tool arguments.
 */
export function buildMessage(
  context: ApprovalNotificationContext,
  dashboardBaseUrl: string,
): string {
  const agentLine = `*Agente:* ${escapeMarkdown(context.agentName)} (${escapeMarkdown(context.projectName)})`;
  const leadLine = context.leadContact
    ? `*Lead:* ${escapeMarkdown(context.leadName)} — ${escapeMarkdown(context.leadContact)}`
    : `*Lead:* ${escapeMarkdown(context.leadName)}`;
  const actionLine = `*Acción:* ${escapeMarkdown(context.actionSummary)}`;
  const riskLine = `*Riesgo:* ${escapeMarkdown(context.riskLabel)}`;
  const linkLine = `[Ver y aprobar](${dashboardBaseUrl}/approvals/${encodeURIComponent(context.approvalId)})`;

  return [
    '🔔 *Acción requiere aprobación*',
    '',
    agentLine,
    leadLine,
    actionLine,
    riskLine,
    '',
    linkLine,
  ].join('\n');
}

/**
 * Escape the characters Telegram's legacy Markdown parser treats as
 * formatting tokens inside inline text. We specifically preserve `*` /
 * `_` / `[` / `]` / `(` / `)` at the positions we control and only
 * escape the variable substitutions.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()`])/g, '\\$1');
}
