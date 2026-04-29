/**
 * PII scrubber for research module inbound transcripts.
 *
 * Runs regex-based redaction before persisting ResearchTurn content.
 * Patterns are country-specific; only 'AR' (Argentina) is implemented today.
 *
 * The function is intentionally pure (no side-effects, no I/O) so it can be
 * called synchronously in the hot path of the inbound webhook processor.
 */

export type PiiCountry = 'AR';

export interface PiiScrubResult {
  /** Text with all detected PII replaced by redaction tags. */
  clean: string;
  /** Total number of PII fragments removed. */
  redactionsCount: number;
}

interface PiiPattern {
  /** Flags must include 'g'. Creates a new RegExp per scrub call to avoid lastIndex leakage. */
  readonly source: string;
  readonly flags: string;
  readonly tag: string;
}

// ─── Argentine (AR) patterns ───────────────────────────────────────────────
//
// Order matters: longer / more specific patterns run first to prevent partial
// matches from blocking more specific ones.
//
//  1. Email — structurally distinct, no digit collisions.
//  2. CUIT/CUIL — 11 digits WITH hyphens (XX-XXXXXXXX-X). Must precede plain 8-digit DNI.
//  3. Credit card with separators — 4×4 groups separated by space or dash.
//  4. Credit card plain — 16 consecutive digits.
//  5. Phone (international +54) — covers mobile & landline international format.
//  6. Phone (local 0xx area code) — 011-XXXX-XXXX, 0351-XXX-XXXX, etc.
//  7. Phone (parenthesized area code) — (011) 4444-5555.
//  8. DNI with dot separators — XX.XXX.XXX.
//  9. DNI plain — exactly 8 consecutive digits not already replaced.

const PATTERNS_AR: readonly PiiPattern[] = [
  {
    source: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
    flags: 'gi',
    tag: '[EMAIL]',
  },
  {
    // CUIT/CUIL: XX-XXXXXXXX-X  (2-8-1 structure, first group typically 20/23/24/27/30/33/34)
    source: '\\b\\d{2}-\\d{8}-\\d\\b',
    flags: 'g',
    tag: '[CUIT]',
  },
  {
    // 16 digits in groups of 4 separated by space or hyphen
    source: '\\b\\d{4}[\\s\\-]\\d{4}[\\s\\-]\\d{4}[\\s\\-]\\d{4}\\b',
    flags: 'g',
    tag: '[TARJETA]',
  },
  {
    // 16 consecutive digits (no separators)
    source: '\\b\\d{16}\\b',
    flags: 'g',
    tag: '[TARJETA]',
  },
  {
    // +54 [9] <area-2-4> <3-4> <4>  (with optional spaces/dashes between segments)
    // \d{3,4} handles both CABA (4+4 local digits) and interior cities (3+4, e.g. 0351)
    source: '\\+54[\\s\\-]?9?[\\s\\-]?\\d{2,4}[\\s\\-]?\\d{3,4}[\\s\\-]?\\d{4}',
    flags: 'g',
    tag: '[TELEFONO]',
  },
  {
    // 0<area>-<local>: 011-4444-5555, 0351-444-5555, 0221 4444-5555
    source: '\\b0\\d{2,3}[\\s\\-]\\d{3,4}[\\s\\-]\\d{4}\\b',
    flags: 'g',
    tag: '[TELEFONO]',
  },
  {
    // (011) 4444-5555 or (0351) 444-5555
    source: '\\(0?\\d{2,4}\\)[\\s\\-]?\\d{3,4}[\\s\\-]?\\d{4}',
    flags: 'g',
    tag: '[TELEFONO]',
  },
  {
    // DNI with dots: 12.345.678 or 5.123.456 (7-digit older format included)
    source: '\\b\\d{1,2}\\.\\d{3}\\.\\d{3}\\b',
    flags: 'g',
    tag: '[DNI]',
  },
  {
    // DNI plain: exactly 8 consecutive digits — runs last so CUIT/CC/phone are already gone
    source: '\\b\\d{8}\\b',
    flags: 'g',
    tag: '[DNI]',
  },
];

const PATTERNS_BY_COUNTRY: Record<PiiCountry, readonly PiiPattern[]> = {
  AR: PATTERNS_AR,
};

/**
 * Redact PII from `text` using country-specific regex rules.
 *
 * Each match is replaced with a human-readable tag (e.g. `[DNI]`, `[EMAIL]`).
 * The function is non-destructive: it returns a new string; the original is
 * never modified.
 *
 * @param text    Raw text (e.g. inbound WhatsApp message body).
 * @param country ISO 3166-1 alpha-2 country code. Only 'AR' is currently supported.
 * @returns `{ clean, redactionsCount }` — scrubbed text + total replacements made.
 */
export function scrubPii(text: string, country: PiiCountry): PiiScrubResult {
  const patterns = PATTERNS_BY_COUNTRY[country];
  let clean = text;
  let redactionsCount = 0;

  for (const p of patterns) {
    // Fresh RegExp each call: avoids lastIndex state leaking between invocations
    // when the same module-level regex object would be reused.
    const regex = new RegExp(p.source, p.flags);
    clean = clean.replace(regex, () => {
      redactionsCount++;
      return p.tag;
    });
  }

  return { clean, redactionsCount };
}
