/**
 * Order History Service for Wholesale
 *
 * Tracks customer purchase history for personalized recommendations
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const OrderItemSchema = z.object({
  sku: z.string(),
  productName: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  total: z.number(),
});

export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  orderId: z.string(),
  date: z.string().datetime(),
  items: z.array(OrderItemSchema),
  total: z.number(),
  status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']),
  notes: z.string().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

export interface OrderHistory {
  contactId: string;
  orders: Order[];
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  lastOrderDate: string | null;
  topProducts: {
    sku: string;
    productName: string;
    totalQuantity: number;
    totalSpent: number;
  }[];
  frequentCategories: string[];
}

// ─── Order History Logic ────────────────────────────────────────

/**
 * Build order history summary
 */
export function buildOrderHistory(orders: Order[]): Omit<OrderHistory, 'contactId'> {
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((sum, order) => sum + order.total, 0);
  const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
  const lastOrderDate = orders.length > 0 ? (orders[0]?.date ?? null) : null;

  // Aggregate products
  const productMap = new Map<
    string,
    { sku: string; productName: string; totalQuantity: number; totalSpent: number }
  >();

  for (const order of orders) {
    for (const item of order.items) {
      const existing = productMap.get(item.sku);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.totalSpent += item.total;
      } else {
        productMap.set(item.sku, {
          sku: item.sku,
          productName: item.productName,
          totalQuantity: item.quantity,
          totalSpent: item.total,
        });
      }
    }
  }

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  return {
    orders,
    totalOrders,
    totalSpent,
    averageOrderValue,
    lastOrderDate,
    topProducts,
    frequentCategories: [], // Could be calculated from product metadata
  };
}

/**
 * Get recent orders
 */
export function getRecentOrders(orders: Order[], limit = 5): Order[] {
  return orders
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

/**
 * Check if customer has ordered a product before
 */
export function hasOrderedProduct(orders: Order[], sku: string): boolean {
  return orders.some((order) => order.items.some((item) => item.sku === sku));
}

/**
 * Get product purchase frequency
 */
export function getProductFrequency(
  orders: Order[],
  sku: string
): {
  timesPurchased: number;
  totalQuantity: number;
  lastPurchased: string | null;
  averageQuantity: number;
} {
  const relevantOrders = orders.filter((order) =>
    order.items.some((item) => item.sku === sku)
  );

  const totalQuantity = relevantOrders.reduce((sum, order) => {
    const item = order.items.find((i) => i.sku === sku);
    return sum + (item?.quantity ?? 0);
  }, 0);

  const lastPurchased =
    relevantOrders.length > 0
      ? (relevantOrders.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        )[0]?.date ?? null)
      : null;

  return {
    timesPurchased: relevantOrders.length,
    totalQuantity,
    lastPurchased,
    averageQuantity: relevantOrders.length > 0 ? totalQuantity / relevantOrders.length : 0,
  };
}

/**
 * Get recommended products based on history
 */
export function getRecommendations(
  orders: Order[],
  availableProducts: string[]
): string[] {
  // Get all purchased SKUs
  const purchasedSkus = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      purchasedSkus.add(item.sku);
    }
  }

  // Find products not yet purchased
  const newProducts = availableProducts.filter((sku) => !purchasedSkus.has(sku));

  // If customer has purchase history, prioritize new products
  if (orders.length > 0 && newProducts.length > 0) {
    return newProducts.slice(0, 5);
  }

  // Otherwise return frequently purchased items for reorder
  const history = buildOrderHistory(orders);
  return history.topProducts.slice(0, 5).map((p) => p.sku);
}

/**
 * Calculate customer lifetime value
 */
export function calculateLTV(orders: Order[]): {
  totalValue: number;
  averageOrderValue: number;
  orderCount: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceFirstOrder: number;
  averageDaysBetweenOrders: number;
} {
  if (orders.length === 0) {
    return {
      totalValue: 0,
      averageOrderValue: 0,
      orderCount: 0,
      firstOrderDate: null,
      lastOrderDate: null,
      daysSinceFirstOrder: 0,
      averageDaysBetweenOrders: 0,
    };
  }

  const sorted = orders.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const firstOrder = sorted[0];
  const lastOrder = sorted[sorted.length - 1];
  if (!firstOrder || !lastOrder) {
    return {
      totalValue: 0,
      averageOrderValue: 0,
      orderCount: 0,
      firstOrderDate: null,
      lastOrderDate: null,
      daysSinceFirstOrder: 0,
      averageDaysBetweenOrders: 0,
    };
  }
  const firstOrderDate = firstOrder.date;
  const lastOrderDate = lastOrder.date;
  const totalValue = orders.reduce((sum, order) => sum + order.total, 0);
  const averageOrderValue = totalValue / orders.length;

  const daysSinceFirstOrder = Math.floor(
    (new Date().getTime() - new Date(firstOrderDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  let averageDaysBetweenOrders = 0;
  if (orders.length > 1) {
    const totalDays =
      new Date(lastOrderDate).getTime() - new Date(firstOrderDate).getTime();
    averageDaysBetweenOrders = Math.floor(
      totalDays / (1000 * 60 * 60 * 24) / (orders.length - 1)
    );
  }

  return {
    totalValue,
    averageOrderValue,
    orderCount: orders.length,
    firstOrderDate,
    lastOrderDate,
    daysSinceFirstOrder,
    averageDaysBetweenOrders,
  };
}
