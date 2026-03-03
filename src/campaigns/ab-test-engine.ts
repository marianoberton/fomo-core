/**
 * A/B Test Engine — variant selection and winner calculation for campaigns.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  CampaignId,
  Campaign,
  CampaignVariant,
  CampaignVariantMetrics,
} from './types.js';

// ─── Deterministic Seed ─────────────────────────────────────────

/**
 * Simple hash function to convert a string seed into a number in [0, 1).
 * Uses the same contact ID each time so the same contact always gets the
 * same variant on re-sends.
 */
function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // convert to 32-bit int
  }
  // Normalize to [0, 1)
  return (Math.abs(hash) % 1_000_000) / 1_000_000;
}

// ─── Variant Selection ──────────────────────────────────────────

/**
 * Select which variant to send to a contact given a seed (contactId).
 * Uses weighted random selection — deterministic for the same seed so
 * a contact always receives the same variant on re-sends.
 */
export function selectVariant(variants: CampaignVariant[], seed: string = ''): CampaignVariant {
  if (variants.length === 0) {
    throw new Error('Cannot select variant from empty list');
  }
  if (variants.length === 1) {
    return variants[0]!;
  }

  const rand = seededRandom(seed) * 100; // 0-100

  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (rand < cumulative) {
      return variant;
    }
  }

  // Fallback to last variant (handles floating point edge cases)
  return variants[variants.length - 1]!;
}

// ─── Chi-Square Winner Calculation ─────────────────────────────

/**
 * Simplified chi-square test for 2 variants with reply_rate.
 *
 * observed = [[replies_A, no_replies_A], [replies_B, no_replies_B]]
 * chi2 = sum((observed - expected)^2 / expected)
 *
 * Hardcoded table (df=1):
 *   chi2 > 6.63 → p < 0.01 → confidence = 0.99
 *   chi2 > 3.84 → p < 0.05 → confidence = 0.95
 *   else        → no significant winner
 */
function chiSquare2x2(
  a_success: number, a_total: number,
  b_success: number, b_total: number,
): number {
  const total = a_total + b_total;
  if (total === 0) return 0;

  const total_success = a_success + b_success;
  const total_fail = (a_total - a_success) + (b_total - b_success);

  if (total_success === 0 || total_fail === 0) return 0;

  // Expected values
  const e_a_s = (a_total * total_success) / total;
  const e_a_f = (a_total * total_fail) / total;
  const e_b_s = (b_total * total_success) / total;
  const e_b_f = (b_total * total_fail) / total;

  if (e_a_s === 0 || e_a_f === 0 || e_b_s === 0 || e_b_f === 0) return 0;

  const a_fail = a_total - a_success;
  const b_fail = b_total - b_success;

  return (
    Math.pow(a_success - e_a_s, 2) / e_a_s +
    Math.pow(a_fail - e_a_f, 2) / e_a_f +
    Math.pow(b_success - e_b_s, 2) / e_b_s +
    Math.pow(b_fail - e_b_f, 2) / e_b_f
  );
}

export function calculateWinner(variantMetrics: CampaignVariantMetrics[]): {
  winner: string | null;
  confidence: number;
} {
  if (variantMetrics.length < 2) {
    return { winner: null, confidence: 0 };
  }

  // Sort by reply rate descending
  const sorted = [...variantMetrics].sort((a, b) => b.replyRate - a.replyRate);
  const best = sorted[0]!;
  const second = sorted[1]!;

  const chi2 = chiSquare2x2(
    best.totalReplies, best.totalSent,
    second.totalReplies, second.totalSent,
  );

  let confidence = 0;
  if (chi2 > 6.63) {
    confidence = 0.99;
  } else if (chi2 > 3.84) {
    confidence = 0.95;
  }

  if (confidence >= 0.95) {
    return { winner: best.variantId, confidence };
  }

  return { winner: null, confidence };
}

// ─── Variant Metrics Aggregation ───────────────────────────────

/**
 * Aggregate per-variant metrics from CampaignSend records.
 * Relies on `variantId` stored in CampaignSend (from A/B test execution).
 */
export async function getVariantMetrics(
  prisma: PrismaClient,
  campaignId: CampaignId,
): Promise<CampaignVariantMetrics[]> {
  // Load campaign for variant config
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return [];

  const abTest = campaign.metadata as Record<string, unknown> | null;
  const abConfig = (campaign.metadata as Record<string, unknown> | null)?.['abTest'] as {
    variants?: Array<{ id: string; name: string; weight: number }>;
  } | undefined;

  // Load all sends for this campaign
  const sends = await (prisma.campaignSend as { findMany: (args: unknown) => Promise<Array<{ variantId: string | null; status: string }>> }).findMany({
    where: { campaignId },
    select: { variantId: true, status: true },
  });

  // Group by variantId
  const byVariant = new Map<string, { sent: number; replies: number; name: string; weight: number }>();

  // Initialize from variant config if available
  if (abConfig?.variants) {
    for (const v of abConfig.variants) {
      byVariant.set(v.id, { sent: 0, replies: 0, name: v.name, weight: v.weight });
    }
  }

  for (const send of sends) {
    const vid = send.variantId ?? '__control__';
    const existing = byVariant.get(vid) ?? { sent: 0, replies: 0, name: vid, weight: 0 };
    existing.sent++;
    byVariant.set(vid, existing);
  }

  const results: CampaignVariantMetrics[] = [];
  for (const [variantId, data] of byVariant.entries()) {
    const replyRate = data.sent > 0 ? data.replies / data.sent : 0;
    results.push({
      campaignId,
      variantId,
      variantName: data.name,
      weight: data.weight,
      totalSent: data.sent,
      totalReplies: data.replies,
      replyRate,
      conversionRate: 0, // requires conversion event tracking
    });
  }

  return results;
}

// ─── Auto-select Winner ─────────────────────────────────────────

/**
 * Check if the campaign has a statistically significant winner and, if
 * `autoSelectWinnerAfterHours` has elapsed, persist the winner to the
 * campaign metadata.
 */
export async function checkAndSelectWinner(
  prisma: PrismaClient,
  campaign: Campaign,
): Promise<{ selected: boolean; variantId: string | null }> {
  const abTest = campaign.abTest;
  if (!abTest?.enabled || !abTest.autoSelectWinnerAfterHours) {
    return { selected: false, variantId: null };
  }

  // Check time elapsed since campaign creation
  const hoursElapsed =
    (Date.now() - campaign.createdAt.getTime()) / (1000 * 60 * 60);

  if (hoursElapsed < abTest.autoSelectWinnerAfterHours) {
    return { selected: false, variantId: null };
  }

  const variantMetrics = await getVariantMetrics(prisma, campaign.id);
  const { winner, confidence } = calculateWinner(variantMetrics);

  if (!winner || confidence < 0.95) {
    return { selected: false, variantId: null };
  }

  // Persist winner into campaign metadata
  const existingMeta = (campaign.metadata ?? {}) as Record<string, unknown>;
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      metadata: {
        ...existingMeta,
        abTest: {
          ...(existingMeta['abTest'] as Record<string, unknown> | undefined ?? {}),
          winner,
          winnerSelectedAt: new Date().toISOString(),
          confidence,
        },
      },
    },
  });

  return { selected: true, variantId: winner };
}
