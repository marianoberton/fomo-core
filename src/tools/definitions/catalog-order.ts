/**
 * Catalog Order Tool
 * Creates draft orders from catalog items.
 * Agents can prepare orders but cannot finalize without human approval.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'catalog-order' });

// ─── Catalog Order Options ─────────────────────────────────────

export interface CatalogOrderToolOptions {
  /** Custom order creator. If not provided, uses mock implementation. */
  orderCreator?: (orderData: unknown) => Promise<{ orderId: string; status: string }>;
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  customerId: z.string().optional().describe('Customer ID or identifier'),
  customerName: z.string().min(1).max(200).describe('Customer name'),
  customerContact: z.object({
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
  }).describe('Customer contact information'),
  items: z.array(z.object({
    productId: z.string().describe('Product ID from catalog'),
    productName: z.string().describe('Product name'),
    quantity: z.number().int().positive().describe('Quantity to order'),
    unitPrice: z.number().positive().describe('Unit price'),
    currency: z.string().default('ARS').describe('Currency code'),
  })).min(1).describe('List of items to order'),
  notes: z.string().max(1000).optional().describe('Order notes or special requests'),
  deliveryDate: z.string().optional().describe('Requested delivery date (ISO 8601 format)'),
});

const outputSchema = z.object({
  orderId: z.string().describe('Generated order ID'),
  status: z.enum(['draft', 'pending_approval', 'confirmed', 'rejected']).describe('Order status'),
  totalAmount: z.number().describe('Total order amount'),
  currency: z.string().describe('Currency code'),
  itemCount: z.number().describe('Number of items in order'),
  createdAt: z.string().describe('Order creation timestamp (ISO 8601)'),
  approvalRequired: z.boolean().describe('Whether the order requires human approval'),
  message: z.string().describe('Message to show the customer'),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createCatalogOrderTool(options: CatalogOrderToolOptions = {}): ExecutableTool {
  return {
    id: 'catalog-order',
    name: 'catalog_order',
    description: 'Create a draft order from catalog items. The order is saved as a draft and requires human approval to finalize. Use this when a customer wants to place an order.',
    category: 'data',
    riskLevel: 'medium',
    requiresApproval: false, // Creating draft is safe, finalizing requires approval
    sideEffects: true, // Creates records in database
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    // ─── Execution ────────────────────────────────────────────────

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('catalog-order', 'Invalid input', parsed.error));
      }
      const validated = parsed.data;

      logger.debug('Creating draft order', {
        component: 'catalog-order',
        projectId: context.projectId,
        sessionId: context.sessionId,
        customerName: validated.customerName,
        itemCount: validated.items.length,
      });

      try {
        // Calculate total
        const totalAmount = validated.items.reduce((sum, item) => {
          return sum + (item.quantity * item.unitPrice);
        }, 0);

        // Generate order ID
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        if (options.orderCreator) {
          const result = await options.orderCreator({
            ...validated,
            totalAmount,
            orderId,
          });
          
          logger.debug('Order created via custom creator', {
            component: 'catalog-order',
            projectId: context.projectId,
            orderId: result.orderId,
          });
          
          return ok({
            success: true,
            output: {
              orderId: result.orderId,
              status: result.status as 'draft' | 'pending_approval' | 'confirmed' | 'rejected',
              totalAmount,
              currency: validated.items[0]?.currency ?? 'ARS',
              itemCount: validated.items.length,
              createdAt: new Date().toISOString(),
              approvalRequired: true,
              message: `Pedido ${result.orderId} creado exitosamente.`,
            },
            durationMs: Date.now() - startTime,
          });
        } else {
          // Default mock implementation
          logger.debug('Draft order created (mock)', {
            component: 'catalog-order',
            projectId: context.projectId,
            orderId,
            totalAmount,
            currency: validated.items[0]?.currency ?? 'ARS',
          });

          return ok({
            success: true,
            output: {
              orderId,
              status: 'draft' as const,
              totalAmount,
              currency: validated.items[0]?.currency ?? 'ARS',
              itemCount: validated.items.length,
              createdAt: new Date().toISOString(),
              approvalRequired: true,
              message: `Pedido ${orderId} creado como borrador. Total: ${totalAmount} ${validated.items[0]?.currency ?? 'ARS'}. Un representante se contactará para confirmar.`,
            },
            durationMs: Date.now() - startTime,
          });
        }
      } catch (error) {
        logger.error('Order creation failed', {
          component: 'catalog-order',
          projectId: context.projectId,
          error,
        });
        return err(new ToolExecutionError('catalog-order', 'Order creation failed', error instanceof Error ? error : undefined));
      }
    },

    // ─── Dry Run ──────────────────────────────────────────────────

    dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('catalog-order', 'Invalid input', parsed.error)));
      }

      logger.debug('Dry run: catalog order', {
        component: 'catalog-order',
        mode: 'dry-run',
        projectId: context.projectId,
        customerName: parsed.data.customerName,
      });

      const totalAmount = parsed.data.items.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice);
      }, 0);

      return Promise.resolve(ok({
        success: true,
        output: {
          orderId: 'DRY-RUN-ORDER',
          status: 'draft' as const,
          totalAmount,
          currency: parsed.data.items[0]?.currency ?? 'ARS',
          itemCount: parsed.data.items.length,
          createdAt: new Date().toISOString(),
          approvalRequired: true,
          message: 'Dry run - no order created',
        },
        durationMs: 0,
      }));
    },
  };
}
