/**
 * Telegram Approval Notifier — sends HITL approval requests to a Telegram chat.
 *
 * When escalate-to-human fires, this notifier sends a rich notification to the
 * owner's Telegram with:
 *   - Conversation summary (last messages)
 *   - What action needs approval
 *   - Inline buttons [✅ Aprobar] [❌ Denegar]
 *   - Option to reply with custom instructions (auto-approves with note)
 *
 * Setup (per project):
 *   1. Store two secrets via the Dashboard → Secrets:
 *        - key: "TELEGRAM_BOT_TOKEN"        → Bot API token from BotFather
 *        - key: "TELEGRAM_APPROVAL_CHAT_ID" → Owner's Telegram chat_id
 *   2. Register the webhook URL with Telegram (once per bot):
 *        https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://server/api/v1/webhooks/telegram-approval
 */
import type { ApprovalNotifier } from '@/security/approval-gate.js';
import type { ApprovalRequest } from '@/security/types.js';
import type { SecretService } from '@/secrets/types.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { Logger } from '@/observability/logger.js';
import { SecretNotFoundError } from '@/core/errors.js';


// ─── Types ───────────────────────────────────────────────────────

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: { message_id: number };
}

export interface TelegramApprovalNotifierConfig {
  /** SecretService for per-project credential resolution. */
  secretService: SecretService;
  /** SessionRepository to load conversation history for context. */
  sessionRepository: SessionRepository;
  logger: Logger;
  /** Shared map to track sent Telegram message_id → approvalId for reply handling. */
  messageApprovalMap: Map<string, string>;
}

/** Well-known secret keys for Telegram HITL approvals (uppercase to match dashboard UI). */
export const TELEGRAM_SECRET_KEYS = {
  botToken: 'TELEGRAM_BOT_TOKEN',
  approvalChatId: 'TELEGRAM_APPROVAL_CHAT_ID',
} as const;

/** Max conversation messages to include in the notification. */
const MAX_CONTEXT_MESSAGES = 6;
/** Max chars per message in the summary. */
const MAX_MESSAGE_LENGTH = 200;

// ─── Notifier Factory ────────────────────────────────────────────

/**
 * Creates an ApprovalNotifier that sends interactive Telegram messages.
 *
 * Resolves bot token, owner chat ID, and conversation history per-project at runtime.
 * Projects without Telegram secrets configured are silently skipped.
 *
 * The owner receives:
 *   1. A summary of the recent conversation
 *   2. The escalation reason
 *   3. Inline buttons for quick approve/deny
 *   4. Instructions to reply with custom text for conditional approval
 */
export function createTelegramApprovalNotifier(
  config: TelegramApprovalNotifierConfig,
): ApprovalNotifier {
  const { secretService, sessionRepository, logger, messageApprovalMap } = config;

  return async (request: ApprovalRequest): Promise<void> => {
    // Resolve per-project Telegram credentials
    let botToken: string;
    let ownerChatId: string;
    try {
      botToken = await secretService.get(request.projectId, TELEGRAM_SECRET_KEYS.botToken);
      ownerChatId = await secretService.get(request.projectId, TELEGRAM_SECRET_KEYS.approvalChatId);
    } catch (error) {
      if (error instanceof SecretNotFoundError) {
        logger.warn('Telegram HITL not configured for project (missing secrets)', {
          component: 'telegram-approval-notifier',
          projectId: request.projectId,
          approvalId: request.id,
        });
        return;
      }
      throw error;
    }

    const baseUrl = `https://api.telegram.org/bot${botToken}`;

    // Load recent conversation for context
    const messages = await sessionRepository.getMessages(request.sessionId);
    const recentMessages = messages.slice(-MAX_CONTEXT_MESSAGES);

    // Build the notification text
    let text = `🔔 *Aprobación Requerida*\n`;

    // Conversation summary
    if (recentMessages.length > 0) {
      text += `\n📝 *Conversación reciente:*\n`;
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? '👤 Cliente' : '🤖 Agente';
        const content = msg.content.length > MAX_MESSAGE_LENGTH
          ? msg.content.slice(0, MAX_MESSAGE_LENGTH) + '...'
          : msg.content;
        text += `${role}: ${escapeMd(content)}\n`;
      }
    }

    // Escalation details
    const query = (request.toolInput['query'] as string | undefined) ?? 'Sin detalle';
    const context = (request.toolInput['context'] as string | undefined) ?? '';

    text += `\n📋 *Solicitud:* ${escapeMd(query)}`;
    if (context) {
      text += `\n💬 *Contexto:* ${escapeMd(context)}`;
    }
    text += `\n⚠️ _Riesgo: ${request.riskLevel}_`;

    // Instructions for the owner
    text += `\n\n_Tocá 📝 Responder para dar instrucciones al agente, o ❌ Rechazar._`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '📝 Responder', callback_data: `instruct:${request.id}` },
          { text: '❌ Rechazar', callback_data: `deny:${request.id}` },
        ],
      ],
    };

    try {
      const response = await fetch(`${baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ownerChatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }),
      });

      const data = (await response.json()) as TelegramApiResponse;

      if (!data.ok) {
        logger.warn('Telegram approval notification failed', {
          component: 'telegram-approval-notifier',
          approvalId: request.id,
          error: data.description,
        });
      } else {
        // Track message_id → approvalId so we can handle text replies
        if (data.result?.message_id) {
          const mapKey = `${ownerChatId}:${data.result.message_id}`;
          messageApprovalMap.set(mapKey, request.id);
        }
        logger.info('Telegram approval notification sent', {
          component: 'telegram-approval-notifier',
          approvalId: request.id,
        });
      }
    } catch (error) {
      logger.error('Error sending Telegram approval notification', {
        component: 'telegram-approval-notifier',
        approvalId: request.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

// ─── Telegram API Helpers ────────────────────────────────────────

/**
 * Answer a Telegram callback query (removes the loading spinner from the button).
 * Always call this after handling a callback_query update.
 */
export async function answerTelegramCallback(
  botToken: string,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  try {
    await fetch(`${baseUrl}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: false,
      }),
    });
  } catch {
    // Non-critical — just removes the loading spinner
  }
}

/**
 * Edit an existing Telegram message (used to replace buttons with the final decision text).
 */
export async function editTelegramMessage(
  botToken: string,
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<void> {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  try {
    await fetch(`${baseUrl}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch {
    // Non-critical — cosmetic only
  }
}

/**
 * Send a plain text reply in the owner's chat (used to confirm instruction receipt).
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string,
): Promise<void> {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  try {
    await fetch(`${baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch {
    // Non-critical — cosmetic only
  }
}

// ─── Internal ────────────────────────────────────────────────────

/** Escape underscores to prevent accidental italic formatting in Telegram Markdown. */
function escapeMd(text: string): string {
  return text.replace(/_/g, '\\_');
}
