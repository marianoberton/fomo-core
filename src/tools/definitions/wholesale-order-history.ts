/**
 * Wholesale Order History Tool
 *
 * Retrieves customer order history for personalized recommendations
 */

import { z } from 'zod';
import type { ExecutableTool } from '../registry/types.js';
import type { ExecutionContext } from '../../core/types.js';
import { NexusError } from '../../core/errors.js';
import { prisma } from '../../infrastructure/database.js';
import {
  OrderSchema,
  buildOrderHistory,
  getRecentOrders,
  calculateLTV,
} from '../../verticals/wholesale/order-history.js';

// ─── Tool Definition ────────────────────────────────────────────

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

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────────

async function execute(input: Input, context: ExecutionContext): Promise<Output> {
  const { contactId, limit } = input;
  const { projectId } = context;

  // Get contact and validate
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    throw new NexusError('TOOL_EXECUTION_ERROR', `Contact ${contactId} not found`);
  }

  if (contact.projectId !== projectId) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      `Contact ${contactId} does not belong to project ${projectId}`
    );
  }

  // Get order history from contact metadata
  const metadata = (contact.metadata as Record<string, unknown>) || {};
  const ordersData = (metadata.orders as unknown[]) || [];
  const orders = ordersData.map((o) => OrderSchema.parse(o));

  // Build history summary
  const history = buildOrderHistory(orders);
  const recent = getRecentOrders(orders, limit);
  const ltv = calculateLTV(orders);

  context.logger.info('Order history retrieved', {
    contactId,
    orderCount: orders.length,
    totalSpent: history.totalSpent,
  });

  return {
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
  };
}

async function dryRun(input: Input): Promise<Output> {
  return {
    success: true,
    contactId: input.contactId,
    totalOrders: 5,
    totalSpent: 250000,
    averageOrderValue: 50000,
    lastOrderDate: new Date().toISOString(),
    recentOrders: [
      {
        orderId: 'ORD-001',
        date: new Date().toISOString(),
        total: 50000,
        itemCount: 3,
        status: 'delivered',
      },
    ],
    topProducts: [
      {
        sku: 'PROD-001',
        productName: 'Sample Product',
        totalQuantity: 10,
        totalSpent: 100000,
      },
    ],
    ltv: {
      totalValue: 250000,
      orderCount: 5,
      averageDaysBetweenOrders: 30,
    },
  };
}

// ─── Tool Export ────────────────────────────────────────────────

export const wholesaleOrderHistoryTool: ExecutableTool = {
  id: 'wholesale-order-history',
  name: 'Get Wholesale Order History',
  description:
    'Retrieve customer order history including total spent, recent orders, top products, and lifetime value metrics.',
  inputSchema,
  outputSchema,
  riskLevel: 'low',
  requiresApproval: false,
  tags: ['wholesale', 'crm', 'analytics'],
  execute,
  dryRun,
};
