/**
 * Automatic Follow-up Service for Vehicle Leads
 *
 * Handles proactive follow-up scheduling based on lead tier and last interaction
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const FollowUpConfigSchema = z.object({
  tier: z.enum(['cold', 'warm', 'hot', 'urgent']),
  lastInteractionAt: z.string().datetime(),
  lastFollowUpAt: z.string().datetime().optional(),
  followUpCount: z.number().default(0),
});

export type FollowUpConfig = z.infer<typeof FollowUpConfigSchema>;

export interface FollowUpSchedule {
  shouldFollowUp: boolean;
  reason: string;
  delayHours: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  suggestedMessage: string;
}

// ─── Follow-up Timing Rules ────────────────────────────────────

const FOLLOW_UP_DELAYS = {
  urgent: {
    first: 6, // 6 hours
    second: 12, // 12 hours
    third: 24, // 1 day
    max: 48, // stop after 2 days
  },
  hot: {
    first: 24, // 1 day
    second: 48, // 2 days
    third: 96, // 4 days
    max: 168, // stop after 1 week
  },
  warm: {
    first: 48, // 2 days
    second: 120, // 5 days
    third: 168, // 7 days
    max: 336, // stop after 2 weeks
  },
  cold: {
    first: 168, // 7 days
    second: 336, // 14 days
    third: 504, // 21 days
    max: 720, // stop after 30 days
  },
} as const;

// ─── Follow-up Logic ────────────────────────────────────────────

/**
 * Determine if a follow-up is needed and when
 */
export function calculateFollowUp(config: FollowUpConfig): FollowUpSchedule {
  const lastInteraction = new Date(config.lastInteractionAt);
  const now = new Date();
  const hoursSinceInteraction = (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);

  const delays = FOLLOW_UP_DELAYS[config.tier];
  const followUpCount = config.followUpCount;

  // Determine which follow-up we're on
  let expectedDelay: number;
  let priority: FollowUpSchedule['priority'];

  if (followUpCount === 0) {
    expectedDelay = delays.first;
    priority = config.tier === 'urgent' ? 'urgent' : 'high';
  } else if (followUpCount === 1) {
    expectedDelay = delays.second;
    priority = config.tier === 'urgent' || config.tier === 'hot' ? 'high' : 'medium';
  } else if (followUpCount === 2) {
    expectedDelay = delays.third;
    priority = 'medium';
  } else {
    // Max follow-ups reached
    if (hoursSinceInteraction >= delays.max) {
      return {
        shouldFollowUp: false,
        reason: 'Max follow-up attempts reached. Lead has gone cold.',
        delayHours: delays.max,
        priority: 'low',
        suggestedMessage: '',
      };
    }
    expectedDelay = delays.max;
    priority = 'low';
  }

  const shouldFollowUp = hoursSinceInteraction >= expectedDelay;

  if (!shouldFollowUp) {
    return {
      shouldFollowUp: false,
      reason: `Too soon. Next follow-up in ${Math.round(expectedDelay - hoursSinceInteraction)} hours.`,
      delayHours: expectedDelay,
      priority: 'low',
      suggestedMessage: '',
    };
  }

  const suggestedMessage = generateFollowUpMessage(config.tier, followUpCount);

  return {
    shouldFollowUp: true,
    reason: `${followUpCount + 1}° follow-up due (${config.tier} lead, ${Math.round(hoursSinceInteraction)}h since last interaction)`,
    delayHours: expectedDelay,
    priority,
    suggestedMessage,
  };
}

/**
 * Generate context-appropriate follow-up message
 */
function generateFollowUpMessage(
  tier: FollowUpConfig['tier'],
  followUpCount: number
): string {
  const templates = {
    urgent: [
      '¡Hola! Vi que estabas interesado/a en nuestros vehículos. ¿Sigues buscando? Tengo algunas opciones que podrían interesarte.',
      'Hola de nuevo. ¿Pudiste evaluar las opciones que te pasé? Estoy para ayudarte con lo que necesites.',
      '¿Cómo va la búsqueda? Si seguís interesado/a, tenemos algunas novedades que podrían gustarte.',
    ],
    hot: [
      'Hola! ¿Cómo va todo? Quería saber si seguís interesado/a en los vehículos que vimos.',
      '¿Pudiste pensar en las opciones? Acá estoy para resolver cualquier duda.',
      'Te escribo para saber si necesitás más información o si querés coordinar una visita.',
    ],
    warm: [
      'Hola! ¿Cómo estás? Te escribo para saber cómo sigue tu búsqueda de vehículo.',
      '¿Qué tal? ¿Avanzaste en tu búsqueda? Cualquier cosa, acá estoy.',
      'Hola de nuevo. ¿Seguís buscando o ya encontraste algo?',
    ],
    cold: [
      'Hola! Te escribo para saber si en algún momento retomás la búsqueda de vehículo.',
      '¿Cómo va todo? Si en algún momento necesitás algo, acordate que acá estamos.',
      'Hola! Paso a saludar. Si retomás la búsqueda, avisame.',
    ],
  };

  const tierTemplates = templates[tier];
  const index = Math.min(followUpCount, tierTemplates.length - 1);
  return tierTemplates[index];
}

/**
 * Build metadata for follow-up tracking
 */
export function buildFollowUpMetadata(
  existingMetadata: unknown,
  followUpSchedule: FollowUpSchedule
): Record<string, unknown> {
  const metadata = (existingMetadata as Record<string, unknown>) || {};
  const followUp = (metadata.followUp as Record<string, unknown>) || {};

  return {
    ...metadata,
    followUp: {
      ...followUp,
      lastChecked: new Date().toISOString(),
      nextFollowUpAt: followUpSchedule.shouldFollowUp
        ? new Date().toISOString()
        : new Date(Date.now() + followUpSchedule.delayHours * 60 * 60 * 1000).toISOString(),
      priority: followUpSchedule.priority,
      suggestedMessage: followUpSchedule.suggestedMessage,
    },
  };
}

/**
 * Increment follow-up counter in metadata
 */
export function incrementFollowUpCount(existingMetadata: unknown): Record<string, unknown> {
  const metadata = (existingMetadata as Record<string, unknown>) || {};
  const leadScore = (metadata.leadScore as Record<string, unknown>) || {};

  return {
    ...metadata,
    leadScore: {
      ...leadScore,
      followUpCount: ((leadScore.followUpCount as number) || 0) + 1,
    },
    lastInteraction: new Date().toISOString(),
  };
}
