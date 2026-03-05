/**
 * odoo-register-payment — Registra pago o promesa de pago en Odoo 19
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { OdooToolOptions } from './odoo-get-debts.js';

const inputSchema = z.object({
  invoiceId:   z.number().describe('ID de la factura en Odoo'),
  amount:      z.number().optional().describe('Monto pagado'),
  paymentDate: z.string().optional().describe('Fecha del pago (YYYY-MM-DD). Default: hoy'),
  memo:        z.string().optional().describe('Nota del pago'),
  isPromise:   z.boolean().default(false).describe('Si true, solo registra promesa de pago como nota'),
  promiseDate: z.string().optional().describe('Fecha prometida de pago. Solo si isPromise=true'),
});

async function odooAuth(baseUrl: string, db: string, user: string, password: string) {
  const res = await fetch(`${baseUrl}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db, login: user, password } }),
  });
  const data = await res.json() as { result?: { uid: number }; error?: { data: { message: string } } };
  if (data.error) throw new Error(data.error.data.message);
  return { cookie: res.headers.get('set-cookie') ?? '' };
}

async function odooCall(baseUrl: string, session: { cookie: string }, model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/web/dataset/call_kw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
  });
  const data = await res.json() as { result?: unknown; error?: { data: { message: string } } };
  if (data.error) throw new Error(data.error.data.message);
  return data.result;
}

export function createOdooRegisterPaymentTool(options: OdooToolOptions): ExecutableTool {
  return {
    id: 'odoo-register-payment',
    name: 'odoo-register-payment',
    description: 'Registra un pago (total o parcial) en Odoo, o guarda una promesa de pago como nota. Usar cuando el cliente confirma pago o acuerda una fecha.',
    category: 'erp',
    riskLevel: 'medium',
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
      if (!parsed.success) return err(new ToolExecutionError('odoo-register-payment', parsed.error.message));

      const { invoiceId, amount, paymentDate, memo, isPromise, promiseDate } = parsed.data;
      const { projectId } = context;

      const odooUser = await options.secretService.get(projectId, 'ODOO_USER');
      const odooPass = await options.secretService.get(projectId, 'ODOO_PASSWORD');
      const odooDB   = await options.secretService.get(projectId, 'ODOO_DB');
      if (!odooUser || !odooPass || !odooDB) {
        return err(new ToolExecutionError('odoo-register-payment', 'Faltan credenciales Odoo'));
      }

      try {
        const session = await odooAuth(options.odooBaseUrl, odooDB, odooUser, odooPass);
        const today = new Date().toISOString().split('T')[0]!;

        // Promesa de pago — solo nota en la factura
        if (isPromise) {
          const note = `[PROMESA DE PAGO] Cliente prometió abonar el ${promiseDate ?? 'sin fecha'}. ${memo ?? ''}`.trim();
          await odooCall(options.odooBaseUrl, session, 'account.move', 'write', [[invoiceId], { narration: note }]);
          return ok({
            success: true,
            output: { message: `Promesa registrada para el ${promiseDate ?? 'sin fecha'}`, invoiceId },
            durationMs: Date.now() - start,
          });
        }

        if (!amount) return err(new ToolExecutionError('odoo-register-payment', 'Se requiere amount para registrar un pago'));

        const journals = await odooCall(options.odooBaseUrl, session, 'account.journal', 'search', [[['type', 'in', ['bank', 'cash']]]]) as number[];
        if (!journals.length) throw new Error('No hay journal de banco/caja configurado');

        const invoices = await odooCall(options.odooBaseUrl, session, 'account.move', 'read', [[invoiceId]], {
          fields: ['partner_id', 'amount_residual'],
        }) as Array<{ partner_id: [number, string]; amount_residual: number }>;
        if (!invoices.length) throw new Error(`Factura ${invoiceId} no encontrada`);
        const invoice = invoices[0]!;

        const paymentId = await odooCall(options.odooBaseUrl, session, 'account.payment', 'create', [{
          payment_type: 'inbound',
          partner_type: 'customer',
          partner_id:   invoice.partner_id[0],
          amount,
          journal_id:   journals[0],
          date:         paymentDate ?? today,
          memo:         memo ?? 'Pago registrado por Lucas (agente de cobranzas)',
        }]) as number;

        await odooCall(options.odooBaseUrl, session, 'account.payment', 'action_post', [[paymentId]]);

        const isPartial = amount < invoice.amount_residual;
        const remaining = invoice.amount_residual - amount;

        return ok({
          success: true,
          output: {
            paymentId,
            invoiceId,
            amountPaid: amount,
            isPartial,
            remainingAmount: isPartial ? remaining : 0,
            message: isPartial
              ? `Pago parcial de $${amount.toLocaleString()} registrado. Saldo: $${remaining.toLocaleString()}`
              : `Pago completo de $${amount.toLocaleString()} registrado`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('odoo-register-payment', `Odoo error: ${(error as Error).message}`));
      }
    },
  };
}
