/**
 * waha-send-message — Envía un mensaje de WhatsApp vía WAHA
 * Lucas lo usa para contacto outbound: primer mensaje al cliente con deuda vencida.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface WahaSendMessageOptions {
  secretService: SecretService;
  wahaBaseUrl?: string;
}

const inputSchema = z.object({
  phone: z.string().describe('Número de teléfono con código de país, ej: 5491112345678'),
  message: z.string().min(1).max(4000).describe('Texto del mensaje a enviar'),
  session: z.string().default('default').describe('Sesión WAHA a usar. Default: default'),
});

export function createWahaSendMessageTool(options: WahaSendMessageOptions): ExecutableTool {
  return {
    id: 'waha-send-message',
    name: 'waha-send-message',
    description: 'Envía un mensaje de WhatsApp vía WAHA. Lucas lo usa para contactar clientes con deuda vencida de forma outbound.',
    category: 'messaging',
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,
    inputSchema,

    // eslint-disable-next-line @typescript-eslint/require-await
    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('waha-send-message', parsed.error.message));
      return ok({ success: true, output: { dryRun: true, wouldSendTo: parsed.data.phone }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('waha-send-message', parsed.error.message));

      const { phone, message, session } = parsed.data;
      const { projectId } = context;

      // Leer WAHA_BASE_URL desde secrets del proyecto, fallback a env o default
      const wahaBaseUrl = await options.secretService.get(projectId, 'WAHA_BASE_URL');

      const wahaApiKey = await options.secretService.get(projectId, 'WAHA_API_KEY');

      // Formato chatId para WAHA: <phone>@c.us
      const chatId = phone.replace(/\D/g, '').replace(/^0+/, '') + '@c.us';

      try {
        const res = await fetch(`${wahaBaseUrl}/api/sendText`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(wahaApiKey ? { 'X-Api-Key': wahaApiKey } : {}),
          },
          body: JSON.stringify({
            chatId,
            text: message,
            session,
          }),
        });

        const data = await res.json() as { id?: string; error?: string; message?: string };

        if (!res.ok) {
          throw new Error(data.message ?? data.error ?? `WAHA error ${res.status}`);
        }

        return ok({
          success: true,
          output: {
            messageId: data.id,
            sentTo: phone,
            chatId,
            preview: message.slice(0, 80) + (message.length > 80 ? '…' : ''),
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('waha-send-message', `WAHA error: ${(error as Error).message}`));
      }
    },
  };
}
