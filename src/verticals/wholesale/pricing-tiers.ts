/**
 * Pricing Tiers Service for Wholesale
 *
 * Manages differentiated pricing based on customer tier/category
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const PricingTierSchema = z.enum([
  'retail', // Retail price
  'bronze', // Small wholesale - 10% discount
  'silver', // Medium wholesale - 20% discount
  'gold', // Large wholesale - 30% discount
  'platinum', // VIP wholesale - 40% discount
]);

export type PricingTier = z.infer<typeof PricingTierSchema>;

export interface TierDiscount {
  tier: PricingTier;
  discountPercent: number;
  minOrderValue: number;
  description: string;
}

export interface PricedProduct {
  sku: string;
  name: string;
  basePrice: number;
  tierPrice: number;
  discount: number;
  tier: PricingTier;
}

// ─── Tier Configuration ─────────────────────────────────────────

export const TIER_CONFIG: Record<PricingTier, TierDiscount> = {
  retail: {
    tier: 'retail',
    discountPercent: 0,
    minOrderValue: 0,
    description: 'Precio de lista',
  },
  bronze: {
    tier: 'bronze',
    discountPercent: 10,
    minOrderValue: 50000,
    description: 'Cliente mayorista bronce - 10% descuento',
  },
  silver: {
    tier: 'silver',
    discountPercent: 20,
    minOrderValue: 150000,
    description: 'Cliente mayorista plata - 20% descuento',
  },
  gold: {
    tier: 'gold',
    discountPercent: 30,
    minOrderValue: 300000,
    description: 'Cliente mayorista oro - 30% descuento',
  },
  platinum: {
    tier: 'platinum',
    discountPercent: 40,
    minOrderValue: 500000,
    description: 'Cliente VIP - 40% descuento',
  },
};

// ─── Pricing Logic ──────────────────────────────────────────────

/**
 * Calculate price for a customer tier
 */
export function calculateTierPrice(basePrice: number, tier: PricingTier): number {
  const config = TIER_CONFIG[tier];
  const discount = (basePrice * config.discountPercent) / 100;
  return Math.round(basePrice - discount);
}

/**
 * Apply tier pricing to products
 */
export function applyTierPricing(
  products: Array<{ sku: string; name: string; price: number }>,
  tier: PricingTier
): PricedProduct[] {
  const config = TIER_CONFIG[tier];

  return products.map((product) => ({
    sku: product.sku,
    name: product.name,
    basePrice: product.price,
    tierPrice: calculateTierPrice(product.price, tier),
    discount: config.discountPercent,
    tier,
  }));
}

/**
 * Determine tier based on purchase history
 */
export function calculateTierFromHistory(
  totalSpent: number,
  orderCount: number
): PricingTier {
  // Tier based on total lifetime spend
  if (totalSpent >= 500000 && orderCount >= 10) {
    return 'platinum';
  } else if (totalSpent >= 300000 && orderCount >= 5) {
    return 'gold';
  } else if (totalSpent >= 150000 && orderCount >= 3) {
    return 'silver';
  } else if (totalSpent >= 50000 && orderCount >= 2) {
    return 'bronze';
  } else {
    return 'retail';
  }
}

/**
 * Get next tier info
 */
export function getNextTierInfo(
  currentTier: PricingTier,
  currentSpent: number
): {
  nextTier: PricingTier | null;
  remainingAmount: number;
  message: string;
} | null {
  const tiers: PricingTier[] = ['retail', 'bronze', 'silver', 'gold', 'platinum'];
  const currentIndex = tiers.indexOf(currentTier);

  if (currentIndex === tiers.length - 1) {
    // Already at max tier
    return null;
  }

  const nextTier = tiers[currentIndex + 1];
  const nextConfig = TIER_CONFIG[nextTier];
  const remainingAmount = Math.max(0, nextConfig.minOrderValue - currentSpent);

  const message =
    remainingAmount === 0
      ? `¡Felicitaciones! Ya alcanzaste el nivel ${nextTier.toUpperCase()} con ${nextConfig.discountPercent}% de descuento`
      : `Te faltan $${remainingAmount.toLocaleString('es-AR')} para alcanzar el nivel ${nextTier.toUpperCase()} (${nextConfig.discountPercent}% descuento)`;

  return {
    nextTier,
    remainingAmount,
    message,
  };
}

/**
 * Calculate order total with tier pricing
 */
export function calculateOrderTotal(
  items: Array<{ sku: string; quantity: number; basePrice: number }>,
  tier: PricingTier
): {
  subtotal: number;
  discount: number;
  total: number;
  savings: number;
  tierDiscount: number;
} {
  const subtotal = items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);
  const tierDiscount = TIER_CONFIG[tier].discountPercent;
  const discount = Math.round((subtotal * tierDiscount) / 100);
  const total = subtotal - discount;

  return {
    subtotal,
    discount,
    total,
    savings: discount,
    tierDiscount,
  };
}

/**
 * Build pricing metadata for contact
 */
export function buildPricingMetadata(
  existingMetadata: unknown,
  tier: PricingTier,
  totalSpent: number,
  orderCount: number
): Record<string, unknown> {
  const metadata = (existingMetadata as Record<string, unknown>) || {};

  return {
    ...metadata,
    vertical: 'wholesale',
    pricing: {
      tier,
      discount: TIER_CONFIG[tier].discountPercent,
      totalSpent,
      orderCount,
      lastUpdated: new Date().toISOString(),
    },
  };
}

/**
 * Format tier info for customer
 */
export function formatTierInfo(tier: PricingTier): string {
  const config = TIER_CONFIG[tier];

  const lines = [
    `📊 Tu nivel actual: ${tier.toUpperCase()}`,
    `💰 Descuento: ${config.discountPercent}%`,
  ];

  if (tier !== 'retail') {
    lines.push(`✨ ${config.description}`);
  }

  return lines.join('\n');
}
