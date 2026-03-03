/**
 * Contact Scorer — generic, configurable scoring for any vertical.
 *
 * `scoreContact` is a pure function: easy to unit-test, no side-effects.
 * `SCORING_PRESETS` provides ready-made configs for common verticals.
 */

import type {
  ContactScore,
  ContactScoringContext,
  ScoringConfig,
  ScoringCondition,
  ScoreSignal,
} from './types.js';

// ─── Condition Evaluator ──────────────────────────────────────────

function evaluateCondition(cond: ScoringCondition, ctx: ContactScoringContext): boolean {
  switch (cond.type) {
    case 'has_tag':
      return ctx.contact.tags.includes(cond.tag);

    case 'min_sessions':
      // withinDays filter can't be applied without per-session timestamps here,
      // so we use the aggregate count (sufficient for the current context shape).
      return ctx.sessionCount >= cond.count;

    case 'min_messages':
      return ctx.messageCount >= cond.count;

    case 'last_session_within_days':
      return ctx.daysSinceLastSession !== null && ctx.daysSinceLastSession <= cond.days;

    case 'no_session_since_days':
      return ctx.daysSinceLastSession === null || ctx.daysSinceLastSession > cond.days;

    case 'was_escalated':
      return ctx.wasEscalated;

    case 'has_role':
      return ctx.contact.role === cond.role;

    case 'metadata_equals': {
      const meta = ctx.contact.metadata ?? {};
      return meta[cond.key] === cond.value;
    }
  }
}

// ─── Pure Scoring Function ────────────────────────────────────────

export function scoreContact(
  context: ContactScoringContext,
  config: ScoringConfig,
): ContactScore {
  const signals: ScoreSignal[] = [];
  let rawScore = 0;

  for (const rule of config.rules) {
    if (evaluateCondition(rule.condition, context)) {
      rawScore += rule.weight;
      signals.push({
        name: rule.name,
        weight: rule.weight,
        detail: rule.description,
      });
    }
  }

  // Clamp to 0-100
  const score = Math.min(100, Math.max(0, rawScore));

  // Determine tier
  let tier: ContactScore['tier'];
  if (score >= config.tiers.hot) {
    tier = 'hot';
  } else if (score >= config.tiers.warm) {
    tier = 'warm';
  } else if (score >= config.tiers.cold) {
    tier = 'cold';
  } else {
    tier = 'inactive';
  }

  // Suggest follow-up
  const followUpAfterDays = config.followUpAfterDays ?? 3;
  let nextFollowUpAt: Date | undefined;
  if (
    context.lastSessionAt !== null &&
    (context.daysSinceLastSession ?? 0) >= followUpAfterDays
  ) {
    nextFollowUpAt = new Date(
      context.lastSessionAt.getTime() + followUpAfterDays * 24 * 60 * 60 * 1000,
    );
  } else if (context.lastSessionAt === null) {
    // Never had a session — suggest follow-up now
    nextFollowUpAt = new Date();
  }

  return {
    contactId: context.contact.id,
    projectId: context.contact.projectId,
    score,
    tier,
    signals,
    lastScoredAt: new Date(),
    nextFollowUpAt,
  };
}

// ─── Presets ──────────────────────────────────────────────────────

export const SCORING_PRESETS: Record<string, ScoringConfig> = {
  /**
   * general — PyME genérica.
   * Prioriza actividad reciente y escalaciones.
   */
  general: {
    tiers: { hot: 65, warm: 40, cold: 15 },
    followUpAfterDays: 3,
    rules: [
      {
        name: 'recent_session',
        description: 'Tuvo sesión en los últimos 2 días',
        weight: 30,
        condition: { type: 'last_session_within_days', days: 2 },
      },
      {
        name: 'active_this_week',
        description: 'Tuvo sesión en los últimos 7 días',
        weight: 20,
        condition: { type: 'last_session_within_days', days: 7 },
      },
      {
        name: 'multiple_sessions',
        description: 'Más de 2 sesiones registradas',
        weight: 20,
        condition: { type: 'min_sessions', count: 3 },
      },
      {
        name: 'high_message_volume',
        description: 'Más de 10 mensajes en total',
        weight: 15,
        condition: { type: 'min_messages', count: 10 },
      },
      {
        name: 'escalated',
        description: 'Fue escalado a humano',
        weight: 15,
        condition: { type: 'was_escalated' },
      },
      {
        name: 'vip_tag',
        description: 'Tiene tag VIP',
        weight: 20,
        condition: { type: 'has_tag', tag: 'vip' },
      },
      {
        name: 'long_inactive',
        description: 'Sin sesión hace más de 30 días',
        weight: -20,
        condition: { type: 'no_session_since_days', days: 30 },
      },
    ],
  },

  /**
   * retail — Comercio / ferretería.
   * Valora compras recurrentes y volumen de interacciones.
   */
  retail: {
    tiers: { hot: 70, warm: 45, cold: 20 },
    followUpAfterDays: 5,
    rules: [
      {
        name: 'recent_session',
        description: 'Consultó en los últimos 3 días',
        weight: 25,
        condition: { type: 'last_session_within_days', days: 3 },
      },
      {
        name: 'repeat_customer',
        description: 'Más de 3 sesiones (cliente recurrente)',
        weight: 30,
        condition: { type: 'min_sessions', count: 4 },
      },
      {
        name: 'high_engagement',
        description: 'Más de 15 mensajes (muy interesado)',
        weight: 20,
        condition: { type: 'min_messages', count: 15 },
      },
      {
        name: 'wholesale_tag',
        description: 'Cliente mayorista',
        weight: 25,
        condition: { type: 'has_tag', tag: 'wholesale' },
      },
      {
        name: 'escalated',
        description: 'Requirió atención humana',
        weight: 15,
        condition: { type: 'was_escalated' },
      },
      {
        name: 'inactive_2_weeks',
        description: 'Sin actividad hace más de 14 días',
        weight: -15,
        condition: { type: 'no_session_since_days', days: 14 },
      },
      {
        name: 'long_inactive',
        description: 'Sin actividad hace más de 60 días',
        weight: -25,
        condition: { type: 'no_session_since_days', days: 60 },
      },
    ],
  },

  /**
   * hospitality — Hotel / restaurante.
   * Valora reservas recientes y fidelización.
   */
  hospitality: {
    tiers: { hot: 60, warm: 35, cold: 15 },
    followUpAfterDays: 2,
    rules: [
      {
        name: 'recent_contact',
        description: 'Contactó en las últimas 48h',
        weight: 35,
        condition: { type: 'last_session_within_days', days: 2 },
      },
      {
        name: 'loyal_guest',
        description: 'Más de 2 estadías/reservas previas',
        weight: 30,
        condition: { type: 'min_sessions', count: 3 },
      },
      {
        name: 'vip_guest',
        description: 'Huésped VIP',
        weight: 25,
        condition: { type: 'has_tag', tag: 'vip' },
      },
      {
        name: 'escalated',
        description: 'Tuvo incidencia o solicitud especial',
        weight: 10,
        condition: { type: 'was_escalated' },
      },
      {
        name: 'high_interaction',
        description: 'Más de 8 mensajes (consulta compleja)',
        weight: 15,
        condition: { type: 'min_messages', count: 8 },
      },
      {
        name: 'inactive_month',
        description: 'Sin contacto hace más de 30 días',
        weight: -20,
        condition: { type: 'no_session_since_days', days: 30 },
      },
    ],
  },

  /**
   * automotive — Concesionaria.
   * Migrada desde vehicle-lead-score: usa tags y escalaciones como señales.
   */
  automotive: {
    tiers: { hot: 70, warm: 45, cold: 20 },
    followUpAfterDays: 2,
    rules: [
      {
        name: 'urgent_buyer',
        description: 'Marcado como comprador urgente',
        weight: 40,
        condition: { type: 'has_tag', tag: 'urgent' },
      },
      {
        name: 'ready_to_buy',
        description: 'Listo para comprar',
        weight: 30,
        condition: { type: 'has_tag', tag: 'ready' },
      },
      {
        name: 'recent_contact',
        description: 'Contactó en los últimos 2 días',
        weight: 25,
        condition: { type: 'last_session_within_days', days: 2 },
      },
      {
        name: 'escalated_to_sales',
        description: 'Escalado al equipo de ventas',
        weight: 20,
        condition: { type: 'was_escalated' },
      },
      {
        name: 'test_drive_tag',
        description: 'Solicitó test drive',
        weight: 20,
        condition: { type: 'has_tag', tag: 'test-drive' },
      },
      {
        name: 'financing_tag',
        description: 'Necesita financiación',
        weight: 15,
        condition: { type: 'has_tag', tag: 'financing' },
      },
      {
        name: 'multiple_visits',
        description: 'Más de 2 visitas/consultas',
        weight: 20,
        condition: { type: 'min_sessions', count: 3 },
      },
      {
        name: 'high_engagement',
        description: 'Conversación extensa (>12 mensajes)',
        weight: 15,
        condition: { type: 'min_messages', count: 12 },
      },
      {
        name: 'inactive_week',
        description: 'Sin contacto hace más de 7 días',
        weight: -15,
        condition: { type: 'no_session_since_days', days: 7 },
      },
      {
        name: 'long_inactive',
        description: 'Sin contacto hace más de 30 días',
        weight: -30,
        condition: { type: 'no_session_since_days', days: 30 },
      },
    ],
  },

  /**
   * services — Servicios técnicos / profesionales.
   * Valora recurrencia y complejidad del problema.
   */
  services: {
    tiers: { hot: 60, warm: 38, cold: 15 },
    followUpAfterDays: 4,
    rules: [
      {
        name: 'recent_request',
        description: 'Solicitud en los últimos 3 días',
        weight: 30,
        condition: { type: 'last_session_within_days', days: 3 },
      },
      {
        name: 'recurring_client',
        description: 'Cliente recurrente (3+ solicitudes)',
        weight: 30,
        condition: { type: 'min_sessions', count: 3 },
      },
      {
        name: 'escalated',
        description: 'Caso escalado a técnico/especialista',
        weight: 25,
        condition: { type: 'was_escalated' },
      },
      {
        name: 'complex_issue',
        description: 'Conversación larga (>10 mensajes)',
        weight: 20,
        condition: { type: 'min_messages', count: 10 },
      },
      {
        name: 'priority_tag',
        description: 'Marcado como prioritario',
        weight: 20,
        condition: { type: 'has_tag', tag: 'priority' },
      },
      {
        name: 'corporate_role',
        description: 'Cliente corporativo',
        weight: 15,
        condition: { type: 'has_role', role: 'corporate' },
      },
      {
        name: 'inactive_2_weeks',
        description: 'Sin contacto hace más de 14 días',
        weight: -20,
        condition: { type: 'no_session_since_days', days: 14 },
      },
    ],
  },
};
