/**
 * Opt-out message detector for research probes (Argentine Spanish).
 *
 * When the target agent sends an opt-out signal the probe must abort
 * immediately and mark the target as permanently banned.
 * See NEXUS_INTELLIGENCE_PLAN.md §Compliance — "Opt-out en cada conversación".
 *
 * Patterns are intentionally broad: false positives add safety overhead;
 * false negatives create legal and reputational exposure.
 */

const OPT_OUT_PATTERNS: readonly RegExp[] = [
  // Explicit command "/baja"
  /\/baja\b/i,

  // "no quiero más mensajes / contacto / comunicaciones"
  /no\s+quiero\s+(m[aá]s\s+)?(mensajes?|contacto|llamadas?|comunicaciones?|noticias)/i,

  // "no me contacten / llamen / escriban / molesten"
  /no\s+me\s+(contacten?|llamen?|escriban?|molesten?|manden?\s+mensajes?)/i,

  // "dejen de contactarme / escribirme / llamarme"
  /dejen?\s+de\s+(contactarme|llamarme|escribirme|molestarme|enviarme|mandarme)/i,

  // "quiero darme de baja" / "darme de baja"
  /darme\s+de\s+baja/i,

  // "no deseo recibir más" / "no deseo ser contactado"
  /no\s+deseo\s+(recibir|m[aá]s|ser\s+contactado)/i,

  // "eliminen mi número / datos / contacto"
  /eliminen?\s+(mi\s+)?(n[úu]mero|dato|contacto|cuenta)/i,

  // "saquen mi número"
  /saquen?\s+(mi\s+)?n[úu]mero/i,

  // "borren mi número" / "bórrenme"
  /b[oó]rrenme?\b|borren\s+(mi\s+)?n[úu]mero/i,

  // "no autorizo"
  /\bno\s+autorizo\b/i,

  // "voy a bloquearlos / bloquearte / bloquear"
  /voy\s+a\s+bloquear(lo?s?|te|les?)?\b/i,

  // "no me interesa más este servicio / sus mensajes"
  /no\s+me\s+interesa\s+(m[aá]s\s+)?(esto|eso|el\s+servicio|sus?\s+mensajes?|ser\s+contactado)/i,

  // English standard opt-out keywords — require standalone/near-standalone
  // to avoid false positives ("the bus stop is nearby" must not match).
  /^\s*stop[.!]?\s*$/i,
  /^\s*unsubscribe[.!]?\s*$/i,
  /^\s*opt[- ]?out[.!]?\s*$/i,

  // "no quiero que me contacten más" (longer variants)
  /no\s+(quiero|deseo)\s+que\s+me\s+(contacten?|llamen?|escriban?)/i,
];

/**
 * Returns `true` when `text` contains an opt-out signal indicating the
 * target does not want to be contacted.
 *
 * - Case-insensitive, normalised whitespace is not stripped (patterns handle it).
 * - Matching is designed for short WhatsApp messages (< 200 chars).
 * - When in doubt, returns `true` — safety over false-negatives.
 */
export function isOptOutMessage(text: string): boolean {
  return OPT_OUT_PATTERNS.some((re) => re.test(text));
}
