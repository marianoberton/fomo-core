/**
 * Lead Scoring Service for Vehicle Sales
 *
 * Calculates lead quality scores based on:
 * - Budget level (high weight)
 * - Urgency (medium weight)
 * - Vehicle type preference (low weight)
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const LeadDataSchema = z.object({
  budget: z.number().optional(),
  budgetRange: z.enum(['low', 'medium', 'high', 'premium']).optional(),
  urgency: z.enum(['browsing', 'considering', 'ready', 'urgent']),
  vehicleType: z.enum(['sedan', 'suv', 'truck', 'sports', 'electric', 'hybrid', 'other']).optional(),
  hasTradeIn: z.boolean().optional(),
  financingNeeded: z.boolean().optional(),
  preferredContact: z.enum(['phone', 'whatsapp', 'email', 'any']).optional(),
});

export type LeadData = z.infer<typeof LeadDataSchema>;

export interface LeadScore {
  score: number; // 0-100
  tier: 'cold' | 'warm' | 'hot' | 'urgent';
  factors: {
    budget: number;
    urgency: number;
    vehicleType: number;
    bonus: number;
  };
  reasoning: string;
  suggestedActions: string[];
}

// ─── Scoring Logic ──────────────────────────────────────────────

const URGENCY_SCORES = {
  browsing: 10,
  considering: 30,
  ready: 60,
  urgent: 90,
} as const;

const BUDGET_RANGE_SCORES = {
  low: 15,
  medium: 40,
  high: 70,
  premium: 95,
} as const;

const VEHICLE_TYPE_SCORES = {
  sedan: 20,
  suv: 25,
  truck: 30,
  sports: 35,
  electric: 40,
  hybrid: 35,
  other: 15,
} as const;

/**
 * Calculate lead score based on provided data
 */
export function calculateLeadScore(data: LeadData): LeadScore {
  const factors = {
    budget: 0,
    urgency: 0,
    vehicleType: 0,
    bonus: 0,
  };

  // Urgency (40% weight)
  factors.urgency = URGENCY_SCORES[data.urgency] * 0.4;

  // Budget (40% weight)
  if (data.budgetRange) {
    factors.budget = BUDGET_RANGE_SCORES[data.budgetRange] * 0.4;
  } else if (data.budget) {
    // Infer budget range from absolute value
    if (data.budget < 5000000) factors.budget = BUDGET_RANGE_SCORES.low * 0.4;
    else if (data.budget < 15000000) factors.budget = BUDGET_RANGE_SCORES.medium * 0.4;
    else if (data.budget < 30000000) factors.budget = BUDGET_RANGE_SCORES.high * 0.4;
    else factors.budget = BUDGET_RANGE_SCORES.premium * 0.4;
  }

  // Vehicle type (15% weight)
  if (data.vehicleType) {
    factors.vehicleType = VEHICLE_TYPE_SCORES[data.vehicleType] * 0.15;
  }

  // Bonus factors (5% weight)
  if (data.hasTradeIn) factors.bonus += 2.5;
  if (data.financingNeeded === false) factors.bonus += 2.5; // Cash buyer bonus

  const score = Math.round(
    factors.urgency + factors.budget + factors.vehicleType + factors.bonus
  );

  const tier = getScoreTier(score);
  const reasoning = buildReasoning(data, factors, score);
  const suggestedActions = getSuggestedActions(tier, data);

  return {
    score,
    tier,
    factors,
    reasoning,
    suggestedActions,
  };
}

/**
 * Get tier based on score
 */
function getScoreTier(score: number): LeadScore['tier'] {
  if (score >= 75) return 'urgent';
  if (score >= 55) return 'hot';
  if (score >= 35) return 'warm';
  return 'cold';
}

/**
 * Build human-readable reasoning
 */
function buildReasoning(
  data: LeadData,
  factors: LeadScore['factors'],
  score: number
): string {
  const parts: string[] = [];

  parts.push(`Lead score: ${score}/100 (${getScoreTier(score).toUpperCase()})`);

  if (data.urgency === 'urgent') {
    parts.push('High urgency - ready to buy immediately');
  } else if (data.urgency === 'ready') {
    parts.push('Ready to purchase soon');
  } else if (data.urgency === 'considering') {
    parts.push('Actively considering options');
  } else {
    parts.push('Early browsing stage');
  }

  if (data.budgetRange === 'premium' || (data.budget && data.budget >= 30000000)) {
    parts.push('Premium budget range');
  } else if (data.budgetRange === 'high' || (data.budget && data.budget >= 15000000)) {
    parts.push('High budget range');
  }

  if (data.hasTradeIn) {
    parts.push('Has trade-in vehicle');
  }

  if (data.financingNeeded === false) {
    parts.push('Cash buyer (strong signal)');
  }

  return parts.join('. ');
}

/**
 * Get suggested follow-up actions based on tier
 */
function getSuggestedActions(
  tier: LeadScore['tier'],
  _data: LeadData
): string[] {
  void _data;
  switch (tier) {
    case 'urgent':
      return [
        'Contact immediately (within 1 hour)',
        'Prepare personalized offer',
        'Schedule test drive ASAP',
        'Assign to senior sales rep',
        'Follow up every 6 hours if no response',
      ];

    case 'hot':
      return [
        'Contact within 4 hours',
        'Send vehicle options matching criteria',
        'Offer test drive',
        'Follow up in 24 hours if no response',
      ];

    case 'warm':
      return [
        'Contact within 24 hours',
        'Send general catalog',
        'Add to nurture sequence',
        'Follow up in 48 hours',
      ];

    case 'cold':
      return [
        'Add to newsletter list',
        'Send educational content',
        'Follow up in 7 days',
        'Re-engage when urgency increases',
      ];
  }
}

/**
 * Update contact metadata with lead score
 */
export function buildLeadMetadata(
  existingMetadata: unknown,
  leadData: LeadData,
  score: LeadScore
): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    vertical: 'vehicles',
    leadData,
    leadScore: {
      score: score.score,
      tier: score.tier,
      lastCalculated: new Date().toISOString(),
      factors: score.factors,
    },
    lastInteraction: new Date().toISOString(),
  };
}
