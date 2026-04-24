/**
 * ApprovalNotifierConfigRepository — per-project config for the
 * dashboard-link approval notifiers (currently Telegram).
 *
 * The bot token is stored encrypted in SecretService under the fixed
 * key `TELEGRAM_APPROVAL_BOT_TOKEN` (the SecretService already scopes
 * secrets per-project, so no extra prefix is needed). Everything else
 * (chatId, enabled flag, dashboardBaseUrl, last test outcome) lives in
 * `project.metadata.approvalNotifier.telegram` so the dashboard can
 * read it via the standard project endpoints if it ever wants to.
 *
 * `getTelegramConfig` never returns the plaintext token — only a
 * `hasToken` boolean. The token is only ever decrypted inside the
 * notifier (via `resolveTelegramConfig`) or the /test endpoint.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SecretService } from '@/secrets/types.js';

// ─── Secret key ────────────────────────────────────────────────

/**
 * Well-known secret key for the Telegram bot token used by the
 * dashboard-link approval notifier. Deliberately different from the
 * HITL `TELEGRAM_BOT_TOKEN` so the two notifiers can use independent
 * bots if the operator wants that separation.
 */
export const TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY = 'TELEGRAM_APPROVAL_BOT_TOKEN';

// ─── Public types ──────────────────────────────────────────────

/** Safe-to-surface config snapshot. Never contains the plaintext token. */
export interface TelegramConfig {
  enabled: boolean;
  hasToken: boolean;
  chatId: string | null;
  dashboardBaseUrl: string | null;
  lastTestedAt: string | null;
  lastTestResult: string | null;
}

/**
 * Input for `setTelegramConfig`. Every field is optional so callers
 * can PATCH single fields (e.g. toggle `enabled` without re-submitting
 * the token).
 *
 * `botToken` semantics:
 *   - `undefined` → leave the stored token untouched.
 *   - `""` or `null` → delete the stored token.
 *   - any other string → overwrite the stored token.
 */
export interface TelegramConfigInput {
  enabled?: boolean;
  botToken?: string | null;
  chatId?: string;
  dashboardBaseUrl?: string;
}

/** Full resolved config ready to use — includes the decrypted token. */
export interface ResolvedTelegramConfig {
  botToken: string;
  chatId: string;
  dashboardBaseUrl: string | null;
  enabled: boolean;
}

/** Compact test result label stored in metadata. */
export type TelegramTestResult = 'success' | `failed: ${string}`;

/** Repository interface — routes and the notifier both depend on this. */
export interface ApprovalNotifierConfigRepository {
  /** Returns null when the project does not exist. */
  getTelegramConfig(projectId: string): Promise<TelegramConfig | null>;
  setTelegramConfig(projectId: string, input: TelegramConfigInput): Promise<TelegramConfig>;
  deleteTelegramConfig(projectId: string): Promise<void>;
  recordTestResult(projectId: string, result: TelegramTestResult): Promise<void>;
  /**
   * Resolve the config for an actual send. Returns null when anything
   * required (token, chatId) is missing or the notifier is disabled.
   */
  resolveTelegramConfig(projectId: string): Promise<ResolvedTelegramConfig | null>;
}

// ─── Internal metadata shape ───────────────────────────────────

interface ProjectMetadataShape {
  approvalNotifier?: {
    telegram?: {
      enabled?: boolean;
      chatId?: string;
      dashboardBaseUrl?: string;
      lastTestedAt?: string;
      lastTestResult?: string;
    };
  };
  [key: string]: unknown;
}

// ─── Factory ───────────────────────────────────────────────────

interface Deps {
  prisma: PrismaClient;
  secretService: SecretService;
}

/** Prisma + SecretService-backed implementation. */
export function createApprovalNotifierConfigRepository(
  deps: Deps,
): ApprovalNotifierConfigRepository {
  const { prisma, secretService } = deps;

  async function loadMetadata(projectId: string): Promise<ProjectMetadataShape | null> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { metadata: true },
    });
    if (!project) return null;
    return (project.metadata as ProjectMetadataShape | null) ?? {};
  }

  async function saveMetadata(
    projectId: string,
    metadata: ProjectMetadataShape,
  ): Promise<void> {
    await prisma.project.update({
      where: { id: projectId },
      data: { metadata: metadata as unknown as Prisma.InputJsonValue },
    });
  }

  async function snapshot(
    projectId: string,
    metadata: ProjectMetadataShape,
  ): Promise<TelegramConfig> {
    const telegram = metadata.approvalNotifier?.telegram ?? {};
    const hasToken = await secretService.exists(
      projectId,
      TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
    );
    return {
      enabled: telegram.enabled ?? false,
      hasToken,
      chatId: telegram.chatId ?? null,
      dashboardBaseUrl: telegram.dashboardBaseUrl ?? null,
      lastTestedAt: telegram.lastTestedAt ?? null,
      lastTestResult: telegram.lastTestResult ?? null,
    };
  }

  return {
    async getTelegramConfig(projectId: string): Promise<TelegramConfig | null> {
      const metadata = await loadMetadata(projectId);
      if (metadata === null) return null;
      return snapshot(projectId, metadata);
    },

    async setTelegramConfig(
      projectId: string,
      input: TelegramConfigInput,
    ): Promise<TelegramConfig> {
      // Persist/delete the token first — if it fails we haven't yet
      // mutated the metadata, so the caller retries idempotently.
      if (input.botToken !== undefined) {
        if (input.botToken === null || input.botToken === '') {
          await secretService.delete(projectId, TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY);
        } else {
          await secretService.set(
            projectId,
            TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
            input.botToken,
            'Telegram bot token for dashboard-link approval notifier',
          );
        }
      }

      const existing = (await loadMetadata(projectId)) ?? {};
      const existingTelegram = existing.approvalNotifier?.telegram ?? {};

      // Default `enabled` to true the first time we see a chatId, so
      // admins don't have to send a second PUT just to flip the switch.
      const nextEnabled =
        input.enabled !== undefined
          ? input.enabled
          : (existingTelegram.enabled ?? (input.chatId !== undefined || existingTelegram.chatId !== undefined));

      const mergedTelegram: NonNullable<
        NonNullable<ProjectMetadataShape['approvalNotifier']>['telegram']
      > = {
        ...existingTelegram,
        enabled: nextEnabled,
        ...(input.chatId !== undefined && { chatId: input.chatId }),
        ...(input.dashboardBaseUrl !== undefined && {
          dashboardBaseUrl: input.dashboardBaseUrl,
        }),
      };

      const newMetadata: ProjectMetadataShape = {
        ...existing,
        approvalNotifier: {
          ...existing.approvalNotifier,
          telegram: mergedTelegram,
        },
      };

      await saveMetadata(projectId, newMetadata);
      return snapshot(projectId, newMetadata);
    },

    async deleteTelegramConfig(projectId: string): Promise<void> {
      await secretService.delete(projectId, TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY);
      const existing = (await loadMetadata(projectId)) ?? {};
      const existingTelegram = existing.approvalNotifier?.telegram ?? {};
      const newMetadata: ProjectMetadataShape = {
        ...existing,
        approvalNotifier: {
          ...existing.approvalNotifier,
          telegram: {
            ...existingTelegram,
            enabled: false,
          },
        },
      };
      await saveMetadata(projectId, newMetadata);
    },

    async recordTestResult(
      projectId: string,
      result: TelegramTestResult,
    ): Promise<void> {
      const existing = (await loadMetadata(projectId)) ?? {};
      const existingTelegram = existing.approvalNotifier?.telegram ?? {};
      const newMetadata: ProjectMetadataShape = {
        ...existing,
        approvalNotifier: {
          ...existing.approvalNotifier,
          telegram: {
            ...existingTelegram,
            lastTestedAt: new Date().toISOString(),
            lastTestResult: result,
          },
        },
      };
      await saveMetadata(projectId, newMetadata);
    },

    async resolveTelegramConfig(
      projectId: string,
    ): Promise<ResolvedTelegramConfig | null> {
      const metadata = await loadMetadata(projectId);
      if (metadata === null) return null;
      const telegram = metadata.approvalNotifier?.telegram;
      if (!telegram) return null;
      if (telegram.enabled === false) return null;
      const chatId = telegram.chatId;
      if (!chatId || chatId.length === 0) return null;

      const hasToken = await secretService.exists(
        projectId,
        TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
      );
      if (!hasToken) return null;

      const botToken = await secretService.get(
        projectId,
        TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
      );
      return {
        botToken,
        chatId,
        dashboardBaseUrl: telegram.dashboardBaseUrl ?? null,
        enabled: telegram.enabled ?? true,
      };
    },
  };
}
