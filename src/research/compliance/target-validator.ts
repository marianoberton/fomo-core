/**
 * Target compliance validator.
 *
 * Called at `POST /research/targets` and bulk-import time before any DB write.
 * Enforces hard compliance rules defined in NEXUS_INTELLIGENCE_PLAN.md §Compliance:
 *
 *  1. Country is not in an EU/GDPR-equivalent jurisdiction.
 *  2. Phone number does not match known emergency / crisis service patterns.
 *  3. Source evidence is present and structurally valid.
 *
 * Returns `Result<void, ResearchError>` — the route handler surfaces the
 * error message directly to the client.
 */
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ResearchError } from '../errors.js';

// ─── Country blocks ──────────────────────────────────────────────
//
// Jurisdictions with GDPR or equivalent law that creates material legal risk
// when processing personal data (phone numbers) without explicit consent.
// Conservative list: includes EU27 + EEA + UK + Switzerland.

const GDPR_BLOCKED_COUNTRIES = new Set([
  // EU27
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
  'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL',
  'PT', 'RO', 'SE', 'SI', 'SK',
  // EEA (not EU but GDPR-applicable)
  'IS', 'LI', 'NO',
  // UK (retained GDPR post-Brexit)
  'GB',
  // Switzerland (nFADP — analogous restrictions)
  'CH',
]);

// ─── Emergency / crisis number detection ─────────────────────────
//
// Argentine emergency services (911, 107, SAME, etc.) use special short-dial
// codes that have NO standard E.164 representation — they cannot appear as
// a valid WhatsApp Business number in +54XXXXXXXXXX format.
//
// Detection therefore relies on keywords in the target name / company rather
// than phone number prefixes (which would produce false positives, e.g.
// +549 11 XXXXXXXX is a normal Buenos Aires mobile and starts with "+54911").
//
// No prefix list here — see CRISIS_KEYWORDS_LOWER below.

// ─── Mental-health / crisis keyword blocklist ─────────────────────
//
// If the target company or name contains these keywords, the probe is
// blocked even if the phone number looks normal. Crisis lines sometimes
// use regular mobile numbers for their WhatsApp presence.

const CRISIS_KEYWORDS_LOWER: readonly string[] = [
  'suicidio',
  'linea 141',
  'línea 141',
  'linea141',
  'línea141',
  'linea 145',
  'línea 145',
  'prevención suicidio',
  'centro de crisis',
  'salud mental',
  'salud mental y adicciones',
  'crisis suicida',
  'servicio de emergencias médicas',
  'sistema de atención médica de emergencias',
  'emergencias médicas',
  'central de emergencias',
];

// ─── Validator input ──────────────────────────────────────────────

export interface ValidateTargetSourceInput {
  /** Phone number in E.164 format (e.g. '+5491156781234'). */
  phoneNumber: string;
  /** ISO 3166-1 alpha-2 country code (e.g. 'AR'). */
  country: string;
  /** Slug of the vertical this target belongs to. */
  verticalSlug: string;
  /** Where the phone number was found. */
  sourceType: 'url' | 'screenshot' | 'referral' | 'other';
  /** The URL or path/reference to evidence. */
  sourceValue: string;
  /** Business name visible on the agent's WhatsApp profile (optional). */
  name?: string;
  /** Company name (optional, used for crisis-keyword detection). */
  company?: string;
}

// ─── Validator ────────────────────────────────────────────────────

/**
 * Validates that a target is eligible for research probing under the
 * compliance rules of the Nexus Intelligence module.
 *
 * Returns `ok(undefined)` when all checks pass.
 * Returns `err(ResearchError)` with code `COMPLIANCE_BLOCKED` when any
 * check fails — the `message` is safe to surface to the calling super_admin.
 */
export function validateTargetSource(
  input: ValidateTargetSourceInput,
): Result<void, ResearchError> {
  const countryUpper = input.country.toUpperCase();

  // 1. Country block
  if (GDPR_BLOCKED_COUNTRIES.has(countryUpper)) {
    return err(
      new ResearchError({
        message: `Targets in jurisdiction "${input.country}" are blocked under GDPR/equivalent law. Only non-EEA countries are allowed.`,
        code: 'COMPLIANCE_BLOCKED',
        context: { country: input.country },
      }),
    );
  }

  // 2. Source evidence — value must not be empty
  if (!input.sourceValue.trim()) {
    return err(
      new ResearchError({
        message: 'sourceValue is required. Every target must have documented evidence of being a publicly published business contact.',
        code: 'COMPLIANCE_BLOCKED',
        context: { sourceType: input.sourceType },
      }),
    );
  }

  // 3. URL format check when sourceType is 'url'
  if (input.sourceType === 'url') {
    try {
      new URL(input.sourceValue);
    } catch {
      return err(
        new ResearchError({
          message: `sourceValue must be a valid URL when sourceType is 'url'. Got: "${input.sourceValue.slice(0, 100)}".`,
          code: 'COMPLIANCE_BLOCKED',
          context: { sourceValue: input.sourceValue.slice(0, 100) },
        }),
      );
    }
  }

  // 4. Crisis / mental-health keyword check on name + company
  const combinedText =
    `${input.name ?? ''} ${input.company ?? ''}`.toLowerCase();

  for (const keyword of CRISIS_KEYWORDS_LOWER) {
    if (combinedText.includes(keyword)) {
      return err(
        new ResearchError({
          message: `Target name/company contains a crisis or emergency service keyword ("${keyword}"). Probing these services is not allowed.`,
          code: 'COMPLIANCE_BLOCKED',
          context: { keyword, name: input.name, company: input.company },
        }),
      );
    }
  }

  return ok(undefined);
}

/**
 * Countries in the GDPR-blocked set, exposed for use in Zod schemas / UI
 * to reject targets at input time.
 */
export function getBlockedCountryCodes(): readonly string[] {
  return [...GDPR_BLOCKED_COUNTRIES];
}
