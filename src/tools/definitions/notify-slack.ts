/**
 * notify-slack — Notifica a un canal de Slack sobre un lead calificado o evento importante.
 * Usa Incoming Webhook URL configurado como secret SLACK_WEBHOOK_URL.
 * Diseñado para FAMA (agente de atención de FOMO) y cualquier agente customer-facing.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface NotifySlackOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  eventType: z.enum([
    'lead_calificado',
    'demo_agendada',
    'lead_capturado',
    'escalamiento',
    'consulta_precio',
  ]).describe('Tipo de evento a notificar'),
  name: z.string().describe('Nombre del prospecto o contacto'),
  company: z.string().optional().describe('Empresa del prospecto'),
  contact: z.string().optional().describe('Email o teléfono de contacto'),
  channel: z.enum(['web', 'whatsapp', 'telegram', 'otro']).describe('Canal de entrada del lead'),
  summary: z.string().describe('Resumen de la conversación: qué necesitan, qué les interesó, próximo paso'),
  calendlyBooked: z.boolean().optional().describe('Si ya agendó en Calendly'),
});

const EVENT_LABELS: Record<string, string> = {
  lead_calificado: '🎯 Lead calificado',
  demo_agendada: '📅 Demo agendada',
  lead_capturado: '👤 Nuevo lead capturado',
  escalamiento: '🚨 Escalamiento — requiere atención',
  consulta_precio: '💰 Consulta de precio',
};

const CHANNEL_EMOJI: Record<string, string> = {
  web: '🌐',
  whatsapp: '📱',
  telegram: '✈️',
  otro: '📡',
};

export function createNotifySlackTool(options: NotifySlackOptions): ExecutableTool {
  return {
    id: 'notify-slack',
    name: 'notify-slack',
    description: 'Notifica a Slack sobre un lead calificado, demo agendada, o escalamiento. Usarlo cuando: el prospecto mostró interés real, agendó una demo, pidió precio, o necesita atención humana.',
    category: 'notifications',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: false,
    inputSchema,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      return ok({ success: true, output: { dryRun: true }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('notify-slack', parsed.error.message));

      const { eventType, name, company, contact, channel, summary, calendlyBooked } = parsed.data;
      const { projectId } = context;

      const webhookUrl = await options.secretService.get(projectId, 'SLACK_WEBHOOK_URL');
      if (!webhookUrl) {
        return err(new ToolExecutionError('notify-slack', 'Secret SLACK_WEBHOOK_URL no configurado'));
      }

      const label = EVENT_LABELS[eventType] ?? eventType;
      const chEmoji = CHANNEL_EMOJI[channel] ?? '📡';
      const companyLine = company ? `\n>*Empresa:* ${company}` : '';
      const contactLine = contact ? `\n>*Contacto:* ${contact}` : '';
      const calendlyLine = calendlyBooked ? '\n>✅ *Ya agendó en Calendly*' : '';

      const text = `${label}\n\n>*Nombre:* ${name}${companyLine}${contactLine}\n>*Canal:* ${chEmoji} ${channel}${calendlyLine}\n\n*Resumen:*\n${summary}`;

      const payload = {
        text,
        unfurl_links: false,
      };

      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Slack webhook error ${String(res.status)}: ${body}`);
        }

        return ok({
          success: true,
          output: { message: `Notificación enviada a Slack: ${label}` },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('notify-slack', `Error: ${(error as Error).message}`));
      }
    },
  };
}
