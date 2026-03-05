/**
 * notify-owner — Notifica al dueño del negocio vía Telegram
 * Usado por Lucas cuando recibe un comprobante o necesita escalar un caso.
 * El dueño configura su Telegram chat_id en el secret OWNER_TELEGRAM_CHAT_ID
 * y el bot token en TELEGRAM_BOT_TOKEN.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface NotifyOwnerOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  subject: z.enum(['comprobante_recibido', 'promesa_de_pago', 'cliente_no_responde', 'quiere_cancelar', 'escalamiento'])
    .describe('Tipo de notificación'),
  clientName:  z.string().describe('Nombre del cliente'),
  clientEmail: z.string().describe('Email del cliente'),
  amount:      z.number().optional().describe('Monto involucrado'),
  details:     z.string().describe('Detalle del caso — qué dijo el cliente, qué se registró'),
});

const SUBJECTS: Record<string, string> = {
  comprobante_recibido:   '💸 Comprobante recibido — requiere verificación',
  promesa_de_pago:        '📅 Promesa de pago registrada',
  cliente_no_responde:    '🔕 Cliente sin respuesta — requiere seguimiento',
  quiere_cancelar:        '⚠️ Cliente quiere cancelar el servicio',
  escalamiento:           '🚨 Caso escalado — requiere atención',
};

export function createNotifyOwnerTool(options: NotifyOwnerOptions): ExecutableTool {
  return {
    id: 'notify-owner',
    name: 'notify-owner',
    description: 'Notifica al dueño del negocio vía Telegram sobre un evento de cobranzas. Usarlo cuando: se recibe un comprobante, se registra una promesa importante, el cliente no responde, quiere cancelar, o hay que escalar.',
    category: 'notifications',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: false,
    inputSchema,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      return ok({ success: true, output: { dryRun: true, input }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('notify-owner', parsed.error.message));

      const { subject, clientName, clientEmail, amount, details } = parsed.data;
      const { projectId } = context;

      const botToken  = await options.secretService.get(projectId, 'TELEGRAM_BOT_TOKEN');
      const chatId    = await options.secretService.get(projectId, 'OWNER_TELEGRAM_CHAT_ID');

      if (!botToken || !chatId) {
        return err(new ToolExecutionError('notify-owner', 'Faltan secrets: TELEGRAM_BOT_TOKEN y/o OWNER_TELEGRAM_CHAT_ID'));
      }

      const title   = SUBJECTS[subject] ?? subject;
      const amtLine = amount ? `\n💰 Monto: $${amount.toLocaleString('es-AR')}` : '';
      const text    = `*Lucas — Cobranzas*\n\n${title}\n\n👤 Cliente: ${clientName}\n📧 Email: ${clientEmail}${amtLine}\n\n📝 ${details}`;

      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
        });
        const data = await res.json() as { ok: boolean; description?: string };
        if (!data.ok) throw new Error(data.description ?? 'Telegram error');

        return ok({
          success: true,
          output: { message: `Notificación enviada al dueño: ${title}` },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('notify-owner', `Error enviando notificación: ${(error as Error).message}`));
      }
    },
  };
}
