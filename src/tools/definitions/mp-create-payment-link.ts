/**
 * mp-create-payment-link — Genera link de pago de MercadoPago (Checkout Pro)
 * Lucas lo usa para ofrecerle al cliente una forma de pagar online.
 * El external_reference incluye email del cliente para matchear el webhook.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface MpPaymentLinkOptions {
  secretService: SecretService;
  coreBaseUrl: string;
}

const inputSchema = z.object({
  clientEmail:  z.string().email().describe('Email del cliente — se usa como referencia para matchear el pago'),
  clientName:   z.string().describe('Nombre del cliente'),
  amount:       z.number().positive().describe('Monto total a cobrar en ARS'),
  description:  z.string().describe('Descripción del pago — ej: "Factura FOMO-003 Plan Starter Abril"'),
  expiresInDays: z.number().default(3).describe('Días hasta que expira el link. Default: 3'),
});

export function createMpCreatePaymentLinkTool(options: MpPaymentLinkOptions): ExecutableTool {
  return {
    id: 'mp-create-payment-link',
    name: 'mp-create-payment-link',
    description: 'Genera un link de pago de MercadoPago Checkout Pro. Lucas lo envía al cliente para que pague online. Cuando el cliente paga, el sistema lo registra automáticamente en Odoo.',
    category: 'payments',
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
      if (!parsed.success) return err(new ToolExecutionError('mp-create-payment-link', parsed.error.message));

      const { clientEmail, clientName, amount, description, expiresInDays } = parsed.data;
      const { projectId } = context;

      const accessToken = await options.secretService.get(projectId, 'MP_ACCESS_TOKEN');
      if (!accessToken) {
        return err(new ToolExecutionError('mp-create-payment-link', 'Falta secret MP_ACCESS_TOKEN'));
      }

      // Fecha de expiración
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + expiresInDays);
      const expirationDate = expDate.toISOString().replace('Z', '-03:00'); // ART

      // external_reference: email + timestamp para matchear el webhook
      const externalRef = `${clientEmail}|${Date.now()}`;

      // Webhook URL — fomo-core recibe la notificación de MP
      const notificationUrl = `${options.coreBaseUrl}/api/v1/webhooks/mercadopago/${projectId}`;

      try {
        const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [{
              title: description,
              quantity: 1,
              unit_price: amount,
              currency_id: 'ARS',
            }],
            payer: {
              email: clientEmail,
              name: clientName,
            },
            external_reference: externalRef,
            notification_url: notificationUrl,
            expiration_date_to: expirationDate,
            back_urls: {
              success: `${options.coreBaseUrl}/payment-success`,
              failure: `${options.coreBaseUrl}/payment-failure`,
              pending: `${options.coreBaseUrl}/payment-pending`,
            },
            auto_return: 'approved',
            statement_descriptor: 'FOMO',
          }),
        });

        const data = await res.json() as {
          id?: string;
          init_point?: string;
          sandbox_init_point?: string;
          error?: string;
          message?: string;
        };

        if (!res.ok || !data.id) {
          throw new Error(data.message ?? data.error ?? 'Error creando preferencia MP');
        }

        // sandbox_init_point para pruebas, init_point para producción
        const isSandbox = accessToken.startsWith('TEST-') || accessToken.includes('-030514-');
        const paymentLink = isSandbox ? (data.sandbox_init_point ?? data.init_point!) : data.init_point!;

        return ok({
          success: true,
          output: {
            preferenceId: data.id,
            paymentLink,
            externalRef,
            amount,
            clientEmail,
            expiresIn: `${expiresInDays} días`,
            message: `Link de pago generado: ${paymentLink}`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('mp-create-payment-link', `MP error: ${(error as Error).message}`));
      }
    },
  };
}
