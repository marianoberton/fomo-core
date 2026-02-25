/**
 * Telegram Bot Webhook — handles HITL responses via buttons and instructions.
 *
 * Three interaction modes:
 *   1. **Responder button** (callback_query): Owner taps 📝 Responder → enters
 *      "waiting" mode → next text message becomes the instructions (auto-approves)
 *   2. **Rechazar button** (callback_query): Owner taps ❌ Rechazar → denies the request
 *   3. **Text reply** (fallback): Owner replies to the notification with custom
 *      instructions → auto-approves with the reply text as the note
 *
 * Register with Telegram once per bot (replace TOKEN and URL):
 *   curl -X POST https://api.telegram.org/bot{TOKEN}/setWebhook \
 *     -H 'Content-Type: application/json' \
 *     -d '{"url": "https://your-server.com/api/v1/webhooks/telegram-approval"}'
 */
import type { FastifyInstance } from 'fastify';
import type { ApprovalGate } from '@/security/approval-gate.js';
import type { ApprovalId } from '@/core/types.js';
import type { SecretService } from '@/secrets/types.js';
import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramMessage,
  TELEGRAM_SECRET_KEYS,
} from '@/hitl/telegram-approval-notifier.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'telegram-approval-webhook' });

// ─── Telegram Update Types ───────────────────────────────────────

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number };
  text?: string;
  reply_to_message?: {
    message_id: number;
    chat: { id: number };
  };
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: {
    message_id: number;
    chat: { id: number };
  };
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

// ─── Deps ────────────────────────────────────────────────────────

export interface TelegramApprovalWebhookDeps {
  approvalGate: ApprovalGate;
  /** SecretService for per-project bot token resolution. */
  secretService: SecretService;
  /** Shared map of `${chatId}:${messageId}` → approvalId for reply tracking. */
  messageApprovalMap: Map<string, string>;
  /** Map of `${chatId}` → approvalId for "waiting for instructions" mode. */
  instructionWaitMap: Map<string, string>;
  /**
   * Called after the approval is resolved so the agent can auto-resume.
   * Fire-and-forget: the webhook returns 200 immediately and this runs async.
   */
  onResolved: (params: {
    approvalId: string;
    decision: 'approved' | 'denied';
    resolvedBy: string;
    note?: string;
  }) => Promise<void>;
}

// ─── Route ───────────────────────────────────────────────────────

/**
 * Register the Telegram approval webhook route.
 * POST /webhooks/telegram-approval
 */
export function telegramApprovalWebhookRoutes(
  fastify: FastifyInstance,
  deps: TelegramApprovalWebhookDeps,
): void {
  const { instructionWaitMap } = deps;

  fastify.post('/webhooks/telegram-approval', async (request, reply) => {
    const update = request.body as TelegramUpdate;

    // Mode 1: Inline keyboard button press (instruct / deny)
    if (update.callback_query?.data) {
      const cbData = update.callback_query.data;

      if (cbData.startsWith('instruct:')) {
        await handleInstructionRequest(update.callback_query, deps);
      } else if (cbData.startsWith('deny:')) {
        await handleDenyCallback(update.callback_query, deps);
      }
      return reply.status(200).send({ ok: true });
    }

    // Mode 2: Text message — check "waiting for instructions" first
    if (update.message?.text) {
      const chatId = String(update.message.chat.id);

      if (instructionWaitMap.has(chatId)) {
        await handleInstructionMessage(update.message, deps);
        return reply.status(200).send({ ok: true });
      }

      // Fallback: text reply to a notification message
      if (update.message.reply_to_message) {
        await handleTextReply(update.message, deps);
        return reply.status(200).send({ ok: true });
      }
    }

    // Ignore other update types
    return reply.status(200).send({ ok: true });
  });
}

// ─── Deny Button Handler ─────────────────────────────────────────

async function handleDenyCallback(
  callbackQuery: TelegramCallbackQuery,
  deps: TelegramApprovalWebhookDeps,
): Promise<void> {
  const { approvalGate, secretService, messageApprovalMap, onResolved } = deps;

  const approvalId = callbackQuery.data?.split(':')[1];
  if (!approvalId) return;

  const resolvedBy = callbackQuery.from.username
    ? `@${callbackQuery.from.username}`
    : (callbackQuery.from.first_name ?? 'Telegram');

  logger.info('Telegram deny callback received', {
    component: 'telegram-approval-webhook',
    approvalId,
    resolvedBy,
  });

  // Look up the approval to get projectId and current status
  const approval = await approvalGate.get(approvalId as ApprovalId);
  if (!approval) {
    logger.warn('Approval not found for deny callback', { component: 'telegram-approval-webhook', approvalId });
    return;
  }

  // If already resolved, just acknowledge
  if (approval.status !== 'pending') {
    try {
      const token = await secretService.get(approval.projectId, TELEGRAM_SECRET_KEYS.botToken);
      await answerTelegramCallback(token, callbackQuery.id, '❌ Ya procesado');
    } catch {
      // Non-critical
    }
    return;
  }

  // Resolve bot token from project secrets
  let botToken: string;
  try {
    botToken = await secretService.get(approval.projectId, TELEGRAM_SECRET_KEYS.botToken);
  } catch {
    logger.error('Cannot resolve bot token for project', {
      component: 'telegram-approval-webhook',
      projectId: approval.projectId,
      approvalId,
    });
    return;
  }

  // Resolve the approval as denied
  const resolved = await approvalGate.resolve(approvalId as ApprovalId, 'denied', resolvedBy);

  if (!resolved) {
    await answerTelegramCallback(botToken, callbackQuery.id, '❌ Aprobación no encontrada o expirada');
    return;
  }

  // Acknowledge button press
  await answerTelegramCallback(botToken, callbackQuery.id, '❌ Rechazado');

  // Update the original Telegram message to show the decision (removes inline buttons)
  if (callbackQuery.message) {
    await editTelegramMessage(
      botToken,
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      `❌ *RECHAZADO* por ${resolvedBy}`,
    );

    // Clean up the map entry
    const mapKey = `${callbackQuery.message.chat.id}:${callbackQuery.message.message_id}`;
    messageApprovalMap.delete(mapKey);
  }

  // Trigger auto-resume with denied decision (agent will ask customer how to continue)
  onResolved({ approvalId, decision: 'denied', resolvedBy }).catch((error: unknown) => {
    logger.error('Error in approval auto-resume (deny)', {
      component: 'telegram-approval-webhook',
      approvalId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

// ─── Instructions Button Handler ─────────────────────────────────

async function handleInstructionRequest(
  callbackQuery: TelegramCallbackQuery,
  deps: TelegramApprovalWebhookDeps,
): Promise<void> {
  const { approvalGate, secretService, instructionWaitMap } = deps;

  const approvalId = callbackQuery.data?.split(':')[1];
  if (!approvalId) return;

  const approval = await approvalGate.get(approvalId as ApprovalId);
  if (approval?.status !== 'pending') {
    try {
      const token = await secretService.get(
        approval?.projectId ?? ('' as import('@/core/types.js').ProjectId),
        TELEGRAM_SECRET_KEYS.botToken,
      );
      await answerTelegramCallback(token, callbackQuery.id, '⚠️ Ya procesado');
    } catch {
      // Non-critical
    }
    return;
  }

  let botToken: string;
  try {
    botToken = await secretService.get(approval.projectId, TELEGRAM_SECRET_KEYS.botToken);
  } catch {
    logger.error('Cannot resolve bot token for project', {
      component: 'telegram-approval-webhook',
      projectId: approval.projectId,
      approvalId,
    });
    return;
  }

  // Acknowledge the button press
  await answerTelegramCallback(botToken, callbackQuery.id, '📝 Escribí las instrucciones');

  // Edit message to remove buttons and show waiting state
  if (callbackQuery.message) {
    await editTelegramMessage(
      botToken,
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      '⏳ *Esperando instrucciones...*\n\nEscribí un mensaje con las instrucciones para el agente.\n_Ej: "Ofrecele 6.5 millones y el primer service bonificado"_',
    );
  }

  // Track that this chat is waiting for instructions for this approval
  const chatId = String(callbackQuery.message?.chat.id ?? callbackQuery.from.id);
  instructionWaitMap.set(chatId, approvalId);

  logger.info('Waiting for instructions from owner', {
    component: 'telegram-approval-webhook',
    approvalId,
    chatId,
  });
}

// ─── Instruction Message Handler (after tapping 📝) ─────────────

async function handleInstructionMessage(
  message: TelegramMessage,
  deps: TelegramApprovalWebhookDeps,
): Promise<void> {
  const { approvalGate, secretService, instructionWaitMap, onResolved } = deps;

  const chatId = String(message.chat.id);
  const approvalId = instructionWaitMap.get(chatId);
  if (!approvalId) return;

  // Clean up immediately to prevent double-fire
  instructionWaitMap.delete(chatId);

  const instructions = message.text ?? '';
  const resolvedBy = message.from?.username
    ? `@${message.from.username}`
    : (message.from?.first_name ?? 'Telegram');

  logger.info('Instructions received from owner', {
    component: 'telegram-approval-webhook',
    approvalId,
    resolvedBy,
    instructionsPreview: instructions.slice(0, 100),
  });

  const approval = await approvalGate.get(approvalId as ApprovalId);
  if (approval?.status !== 'pending') {
    logger.warn('Approval not found or already resolved for instructions', {
      component: 'telegram-approval-webhook',
      approvalId,
    });
    return;
  }

  let botToken: string;
  try {
    botToken = await secretService.get(approval.projectId, TELEGRAM_SECRET_KEYS.botToken);
  } catch {
    logger.error('Cannot resolve bot token for project', {
      component: 'telegram-approval-webhook',
      projectId: approval.projectId,
      approvalId,
    });
    return;
  }

  // Resolve as approved with instructions
  const resolved = await approvalGate.resolve(
    approvalId as ApprovalId,
    'approved',
    resolvedBy,
    instructions,
  );

  if (!resolved) {
    await sendTelegramMessage(botToken, message.chat.id, '❌ Aprobación no encontrada o expirada.');
    return;
  }

  // Confirm to the owner
  await sendTelegramMessage(
    botToken,
    message.chat.id,
    `✅ *Instrucciones enviadas al agente* por ${resolvedBy}\n\n_"${escapeMd(instructions)}"_`,
  );

  // Trigger auto-resume with the instructions as note
  onResolved({
    approvalId,
    decision: 'approved',
    resolvedBy,
    note: instructions,
  }).catch((error: unknown) => {
    logger.error('Error in approval auto-resume (instructions)', {
      component: 'telegram-approval-webhook',
      approvalId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

// ─── Text Reply Handler (Fallback) ──────────────────────────────

async function handleTextReply(
  message: TelegramMessage,
  deps: TelegramApprovalWebhookDeps,
): Promise<void> {
  const { approvalGate, secretService, messageApprovalMap, onResolved } = deps;

  const replyTo = message.reply_to_message;
  if (!replyTo) return;

  // Look up which approval this reply refers to
  const mapKey = `${replyTo.chat.id}:${replyTo.message_id}`;
  const approvalId = messageApprovalMap.get(mapKey);

  if (!approvalId) {
    // Not a reply to an approval notification — ignore
    return;
  }

  const instructions = message.text ?? '';
  const resolvedBy = message.from?.username
    ? `@${message.from.username}`
    : (message.from?.first_name ?? 'Telegram');

  logger.info('Telegram approval reply with instructions', {
    component: 'telegram-approval-webhook',
    approvalId,
    resolvedBy,
    instructionsPreview: instructions.slice(0, 100),
  });

  // Look up approval to get projectId
  const approval = await approvalGate.get(approvalId as ApprovalId);
  if (approval?.status !== 'pending') {
    logger.warn('Approval not found or already resolved for reply', {
      component: 'telegram-approval-webhook',
      approvalId,
    });
    return;
  }

  // Resolve bot token
  let botToken: string;
  try {
    botToken = await secretService.get(approval.projectId, TELEGRAM_SECRET_KEYS.botToken);
  } catch {
    logger.error('Cannot resolve bot token for project', {
      component: 'telegram-approval-webhook',
      projectId: approval.projectId,
      approvalId,
    });
    return;
  }

  // Auto-approve with the instructions as note
  const resolved = await approvalGate.resolve(
    approvalId as ApprovalId,
    'approved',
    resolvedBy,
    instructions,
  );

  if (!resolved) {
    await sendTelegramMessage(botToken, message.chat.id, '❌ Aprobación no encontrada o expirada.');
    return;
  }

  // Confirm to the owner
  await sendTelegramMessage(
    botToken,
    message.chat.id,
    `✅ *Instrucciones enviadas al agente* por ${resolvedBy}\n\n_"${escapeMd(instructions)}"_`,
  );

  // Update the original notification to show it's resolved
  await editTelegramMessage(
    botToken,
    replyTo.chat.id,
    replyTo.message_id,
    `✅ *APROBADO con instrucciones* por ${resolvedBy}`,
  );

  // Clean up
  messageApprovalMap.delete(mapKey);

  // Trigger auto-resume with the instructions as note
  onResolved({
    approvalId,
    decision: 'approved',
    resolvedBy,
    note: instructions,
  }).catch((error: unknown) => {
    logger.error('Error in approval auto-resume (instructions)', {
      component: 'telegram-approval-webhook',
      approvalId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

// ─── Internal ────────────────────────────────────────────────────

function escapeMd(text: string): string {
  return text.replace(/_/g, '\\_');
}
