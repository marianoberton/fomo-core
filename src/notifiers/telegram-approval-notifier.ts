/**
 * Telegram Approval Notifier (dashboard-link variant).
 *
 * Fires a brief Telegram message with a link to the dashboard approval
 * view every time the ApprovalGate receives a new request. The message
 * never contains PII beyond a name + channel reference — the full
 * context lives behind the dashboard link.
 *
 * Resolution order for a send (checked per-request):
 *   1. Per-project config — if a `configRepo` is wired, it reads the
 *      encrypted bot token from SecretService and chatId / enabled /
 *      dashboardBaseUrl from `project.metadata.approvalNotifier.telegram`.
 *      Falls through silently when `enabled: false` or anything required
 *      is missing.
 *   2. Env-var fallback — `TELEGRAM_APPROVAL_BOT_TOKEN`,
 *      `TELEGRAM_APPROVAL_DEFAULT_CHAT_ID`, `APPROVAL_DASHBOARD_BASE_URL`.
 *      The legacy `project.metadata.approvalNotifier.telegram.chatId`
 *      override is still honoured in env-only mode for backward compat.
 *   3. No-op — a single warn per projectId is emitted at most once every
 *      `warnThrottleMs` (default 5 min) so campaign traffic doesn't
 *      flood the logs.
 *
 * NOTE: This is separate from the interactive HITL notifier in
 * `src/hitl/telegram-approval-notifier.ts`, which uses per-project
 * SecretService credentials and inline callback buttons. The two can
 * coexist — each has its own bot token key.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { ApprovalNotifierConfigRepository } from '@/infrastructure/repositories/approval-notifier-config-repository.js';
import type { ApprovalNotificationContext, ApprovalContextNotifier } from './types.js';

// ─── Config ────────────────────────────────────────────────────

export interface TelegramApprovalNotifierConfig {
  /**
   * Bot token from BotFather. Read from TELEGRAM_APPROVAL_BOT_TOKEN.
   * Used as fallback when per-project config is absent.
   */
  botToken: string | undefined;
  /**
   * Default chat_id used when a project has no override. Read from
   * TELEGRAM_APPROVAL_DEFAULT_CHAT_ID.
   */
  defaultChatId: string | undefined;
  /** Base URL of the dashboard used to build the approval link. */
  dashboardBaseUrl: string | undefined;
  /** Prisma client for resolving per-project overrides (legacy path). */
  prisma: PrismaClient;
  logger: Logger;
  /**
   * Per-project config repo. When provided, the notifier resolves the
   * bot token + chatId + dashboard URL from SecretService + project
   * metadata per-request. When absent, only env vars are used.
   */
  configRepo?: ApprovalNotifierConfigRepository;
  /**
   * Override for `fetch` — tests inject a mock. Defaults to global fetch.
   */
  fetchImpl?: typeof fetch;
  /**
   * How long between "no config resolved" warns for the same project.
   * Keeps log volume bounded under heavy campaign traffic. Defaults to
   * 5 minutes.
   */
  warnThrottleMs?: number;
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

interface ResolvedSendConfig {
  botToken: string;
  chatId: string;
  dashboardBaseUrl: string;
}

const DEFAULT_WARN_THROTTLE_MS = 5 * 60_000;

// ─── Factory ───────────────────────────────────────────────────

/**
 * Create the Telegram approval notifier.
 *
 * When the notifier can't resolve any config at all (no configRepo, no
 * env vars) it logs one warn at startup and returns a no-op so callers
 * don't need to branch on configuration state.
 */
export function createTelegramApprovalNotifier(
  config: TelegramApprovalNotifierConfig,
): ApprovalContextNotifier {
  const { botToken, defaultChatId, dashboardBaseUrl, prisma, logger, configRepo } = config;
  const doFetch = config.fetchImpl ?? fetch;
  const warnThrottleMs = config.warnThrottleMs ?? DEFAULT_WARN_THROTTLE_MS;

  // When no per-project config source is available we need at minimum
  // the env token + dashboard URL — otherwise we can't build a link for
  // any project. In that case short-circuit to a no-op.
  if (!configRepo && (!botToken || !dashboardBaseUrl)) {
    logger.warn('Telegram approval notifier disabled (missing env vars)', {
      component: 'telegram-approval-notifier',
      hasBotToken: Boolean(botToken),
      hasDashboardBaseUrl: Boolean(dashboardBaseUrl),
      hasDefaultChatId: Boolean(defaultChatId),
    });
    return (): Promise<void> => Promise.resolve();
  }

  // Warn throttling state — bounds log volume when many approvals come
  // through for a project that still hasn't been configured.
  const lastWarnAt = new Map<string, number>();
  function maybeWarnUnconfigured(context: ApprovalNotificationContext): void {
    const now = Date.now();
    const last = lastWarnAt.get(context.projectId) ?? 0;
    if (now - last < warnThrottleMs) return;
    lastWarnAt.set(context.projectId, now);
    logger.warn('Telegram approval notifier: no config resolved for project', {
      component: 'telegram-approval-notifier',
      projectId: context.projectId,
      approvalId: context.approvalId,
    });
  }

  return async (context: ApprovalNotificationContext): Promise<void> => {
    const resolved = await resolveSendConfig(context, {
      configRepo,
      prisma,
      logger,
      envBotToken: botToken,
      envDefaultChatId: defaultChatId,
      envDashboardBaseUrl: dashboardBaseUrl,
    });

    if (!resolved) {
      maybeWarnUnconfigured(context);
      return;
    }

    const text = buildMessage(context, resolved.dashboardBaseUrl.replace(/\/$/, ''));
    const baseUrl = `https://api.telegram.org/bot${resolved.botToken}`;

    try {
      const response = await doFetch(`${baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: resolved.chatId,
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
          chatId: resolved.chatId,
          httpStatus: response.status,
          description: body.description,
        });
        return;
      }

      logger.info('Telegram approval notifier: approval_sent', {
        component: 'telegram-approval-notifier',
        event: 'approval_sent',
        approvalId: context.approvalId,
        chatId: resolved.chatId,
      });
    } catch (error) {
      logger.error('Telegram approval notifier: fetch failed', {
        component: 'telegram-approval-notifier',
        approvalId: context.approvalId,
        chatId: resolved.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

// ─── Resolution helpers ────────────────────────────────────────

interface ResolveDeps {
  configRepo: ApprovalNotifierConfigRepository | undefined;
  prisma: PrismaClient;
  logger: Logger;
  envBotToken: string | undefined;
  envDefaultChatId: string | undefined;
  envDashboardBaseUrl: string | undefined;
}

/**
 * Per-request resolution: prefer configRepo, fall back to env vars.
 * Returns null when neither source produces a complete config.
 */
async function resolveSendConfig(
  context: ApprovalNotificationContext,
  deps: ResolveDeps,
): Promise<ResolvedSendConfig | null> {
  const {
    configRepo,
    prisma,
    logger,
    envBotToken,
    envDefaultChatId,
    envDashboardBaseUrl,
  } = deps;

  // 1. Per-project config via repo (preferred when available).
  if (configRepo) {
    try {
      const perProject = await configRepo.resolveTelegramConfig(context.projectId);
      if (perProject) {
        const dashboardBaseUrl =
          perProject.dashboardBaseUrl && perProject.dashboardBaseUrl.length > 0
            ? perProject.dashboardBaseUrl
            : envDashboardBaseUrl;
        if (dashboardBaseUrl && dashboardBaseUrl.length > 0) {
          return {
            botToken: perProject.botToken,
            chatId: perProject.chatId,
            dashboardBaseUrl,
          };
        }
      }
    } catch (error) {
      // Don't let a repo failure kill the approval flow — fall through
      // to env fallback.
      logger.warn('Telegram approval notifier: per-project resolution failed', {
        component: 'telegram-approval-notifier',
        projectId: context.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 2. Env fallback — supports the legacy metadata.chatId override.
  if (!envBotToken || !envDashboardBaseUrl) return null;

  const chatId = await resolveLegacyChatId(prisma, context.projectId, envDefaultChatId, logger);
  if (!chatId) return null;

  return {
    botToken: envBotToken,
    chatId,
    dashboardBaseUrl: envDashboardBaseUrl,
  };
}

/**
 * Legacy per-project chat_id override used by env-only deployments.
 * Reads `project.metadata.approvalNotifier.telegram.chatId` when
 * `enabled: true`; falls back to the default env chat_id otherwise.
 */
async function resolveLegacyChatId(
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
