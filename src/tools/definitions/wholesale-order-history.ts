/**
 * Wholesale Order History Tool
 *
 * Retrieves customer order history for personalized recommendations
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  OrderSchema,
  buildOrderHistory,
  getRecentOrders,
  calculateLTV,
} from '@/verticals/wholesale/order-history.js';

const logger = createLogger({ name: 'wholesale-order-history' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to get order history for'),
  limit: z.number().optional().default(10).describe('Max orders to return'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  totalOrders: z.number(),
  totalSpent: z.number(),
  averageOrderValue: z.number(),
  lastOrderDate: z.string().nullable(),
  recentOrders: z.array(
    z.object({
      orderId: z.string(),
      date: z.string(),
      total: z.number(),
      itemCount: z.number(),
      status: z.string(),
    })
  ),
  topProducts: z.array(
    z.object({
      sku: z.string(),
      productName: z.string(),
      totalQuantity: z.number(),
      totalSpent: z.number(),
    })
  ),
  ltv: z.object({
    totalValue: z.number(),
    orderCount: z.number(),
    averageDaysBetweenOrders: z.number(),
  }),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createWholesaleOrderHistoryTool(): ExecutableTool {
  return {
    id: 'wholesale-order-history',
    name: 'Get Wholesale Order History',
    description:
      'Retrieve customer order history including total spent, recent orders, top products, and lifetime value metrics.',
    category: 'wholesale',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('wholesale-order-history', 'Invalid input', parsed.error));
      }
      const { contactId, limit } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('wholesale-order-history', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'wholesale-order-history',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const metadata = (contact.metadata ?? {}) as Record<string, unknown>;
        const ordersData = (metadata['orders'] ?? []) as unknown[];
        const orders = ordersData.map((o) => OrderSchema.parse(o));

        const history = buildOrderHistory(orders);
        const recent = getRecentOrders(orders, limit);
        const ltv = calculateLTV(orders);

        logger.info('Order history retrieved', {
          component: 'wholesale-order-history',
          contactId,
          orderCount: orders.length,
          totalSpent: history.totalSpent,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            totalOrders: history.totalOrders,
            totalSpent: history.totalSpent,
            averageOrderValue: history.averageOrderValue,
            lastOrderDate: history.lastOrderDate,
            recentOrders: recent.map((order) => ({
              orderId: order.orderId,
              date: order.date,
              total: order.total,
              itemCount: order.items.length,
              status: order.status,
            })),
            topProducts: history.topProducts.slice(0, 5),
            ltv: {
              totalValue: ltv.totalValue,
              orderCount: ltv.orderCount,
              averageDaysBetweenOrders: ltv.averageDaysBetweenOrders,
            },
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Order history retrieval failed', {
          component: 'wholesale-order-history',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'wholesale-order-history',
          'Order history retrieval failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('wholesale-order-history', 'Invalid input', parsed.error)));
      }

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId: parsed.data.contactId,
          totalOrders: 5,
          totalSpent: 250000,
          averageOrderValue: 50000,
          lastOrderDate: new Date().toISOString(),
          recentOrders: [{
            orderId: 'ORD-001',
            date: new Date().toISOString(),
            total: 50000,
            itemCount: 3,
            status: 'delivered',
          }],
          topProducts: [{
            sku: 'PROD-001',
            productName: 'Sample Product',
            totalQuantity: 10,
            totalSpent: 100000,
          }],
          ltv: {
            totalValue: 250000,
            orderCount: 5,
            averageDaysBetweenOrders: 30,
          },
        },
        durationMs: 0,
      }));
    },
  };
}
