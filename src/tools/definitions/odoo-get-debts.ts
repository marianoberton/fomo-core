/**
 * odoo-get-debts — Consulta facturas vencidas o por vencer en Odoo 19
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface OdooToolOptions {
  odooBaseUrl: string;
  secretService: SecretService;
}

const inputSchema = z.object({
  email:       z.string().optional().describe('Email del cliente a buscar'),
  companyName: z.string().optional().describe('Nombre de la empresa a buscar'),
  onlyOverdue: z.boolean().default(true).describe('Si true, solo facturas vencidas. Si false, incluye las próximas 7 días'),
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

export function createOdooGetDebtsTool(options: OdooToolOptions): ExecutableTool {
  return {
    id: 'odoo-get-debts',
    name: 'odoo-get-debts',
    description: 'Consulta facturas pendientes de pago en Odoo. Busca por email o nombre de empresa, o trae todas las vencidas. Retorna monto, días vencidos, historial y contacto.',
    category: 'erp',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,
    inputSchema,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      return ok({ success: true, output: { dryRun: true, input }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('odoo-get-debts', parsed.error.message));
      }
      const { email, companyName, onlyOverdue } = parsed.data;
      const { projectId } = context;

      const odooUser = await options.secretService.get(projectId, 'ODOO_USER');
      const odooPass = await options.secretService.get(projectId, 'ODOO_PASSWORD');
      const odooDB   = await options.secretService.get(projectId, 'ODOO_DB');
      if (!odooUser || !odooPass || !odooDB) {
        return err(new ToolExecutionError('odoo-get-debts', 'Faltan credenciales Odoo (ODOO_USER, ODOO_PASSWORD, ODOO_DB)'));
      }

      try {
        const session = await odooAuth(options.odooBaseUrl, odooDB, odooUser, odooPass);
        const today   = new Date().toISOString().split('T')[0]!;
        const in7days = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]!;

        let partnerFilter: unknown[] = [];
        if (email) {
          const ids = await odooCall(options.odooBaseUrl, session, 'res.partner', 'search', [[['email', '=', email]]]) as number[];
          if (!ids.length) return ok({ success: true, output: { debts: [], message: 'No se encontró cliente con ese email' }, durationMs: Date.now() - start });
          partnerFilter = [['partner_id', 'in', ids]];
        } else if (companyName) {
          const ids = await odooCall(options.odooBaseUrl, session, 'res.partner', 'search', [[['name', 'ilike', companyName]]]) as number[];
          if (!ids.length) return ok({ success: true, output: { debts: [], message: 'No se encontró empresa con ese nombre' }, durationMs: Date.now() - start });
          partnerFilter = [['partner_id', 'in', ids]];
        }

        const domain = [
          ['move_type', '=', 'out_invoice'],
          ['payment_state', 'in', ['not_paid', 'partial']],
          ['state', '=', 'posted'],
          ...(onlyOverdue ? [['invoice_date_due', '<', today]] : [['invoice_date_due', '<=', in7days]]),
          ...partnerFilter,
        ];

        const invoices = await odooCall(options.odooBaseUrl, session, 'account.move', 'search_read', [domain], {
          fields: ['id', 'name', 'partner_id', 'invoice_date_due', 'amount_total', 'amount_residual', 'payment_state', 'narration'],
          order: 'invoice_date_due asc',
          limit: 20,
        }) as Array<{ id: number; name: string; partner_id: [number, string]; invoice_date_due: string; amount_total: number; amount_residual: number; payment_state: string; narration: string }>;

        if (!invoices.length) {
          return ok({ success: true, output: { debts: [], message: 'No hay facturas pendientes' }, durationMs: Date.now() - start });
        }

        const partnerIds = [...new Set(invoices.map(i => i.partner_id[0]))];
        const partners = await odooCall(options.odooBaseUrl, session, 'res.partner', 'search_read', [[['id', 'in', partnerIds]]], {
          fields: ['id', 'name', 'phone', 'email', 'comment'],
        }) as Array<{ id: number; name: string; phone: string; email: string; comment: string }>;
        const partnerMap = Object.fromEntries(partners.map(p => [p.id, p]));

        const debts = invoices.map(inv => {
          const diffDays = Math.floor((Date.now() - new Date(inv.invoice_date_due).getTime()) / 86400000);
          const partner  = partnerMap[inv.partner_id[0]];
          return {
            invoiceId:     inv.id,
            invoiceName:   inv.name,
            clientName:    inv.partner_id[1],
            clientPhone:   partner?.phone ?? null,
            clientEmail:   partner?.email ?? null,
            clientHistory: partner?.comment ?? null,
            dueDate:       inv.invoice_date_due,
            daysOverdue:   diffDays,
            totalAmount:   inv.amount_total,
            pendingAmount: inv.amount_residual,
            paymentState:  inv.payment_state === 'partial' ? 'pago_parcial' : 'sin_pagar',
            notes:         inv.narration,
          };
        });

        return ok({
          success: true,
          output: {
            debts,
            summary: {
              totalInvoices: debts.length,
              totalPendingAmount: debts.reduce((s, d) => s + d.pendingAmount, 0),
              clients: [...new Set(debts.map(d => d.clientName))],
            },
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('odoo-get-debts', `Odoo error: ${(error as Error).message}`));
      }
    },
  };
}
