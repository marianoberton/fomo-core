/**
 * Branded ID types for the Research module.
 *
 * Same `Brand<T, B>` pattern as `src/core/types.ts` — keeps the brand
 * symbol private to this file so external code must cast (`as ResearchSessionId`)
 * to fabricate IDs. This catches accidental mix-ups at compile time
 * (passing a TargetId where a SessionId is expected, etc.).
 */

declare const __researchBrand: unique symbol;
type Brand<T, B> = T & { readonly [__researchBrand]: B };

export type ResearchVerticalId = Brand<string, 'ResearchVerticalId'>;
export type ResearchPhoneId = Brand<string, 'ResearchPhoneId'>;
export type ResearchTargetId = Brand<string, 'ResearchTargetId'>;
export type ProbeScriptId = Brand<string, 'ProbeScriptId'>;
export type ResearchSessionId = Brand<string, 'ResearchSessionId'>;
export type ResearchTurnId = Brand<string, 'ResearchTurnId'>;
export type ResearchAnalysisId = Brand<string, 'ResearchAnalysisId'>;
export type ResearchSessionScheduleId = Brand<string, 'ResearchSessionScheduleId'>;
export type IntelligenceInsightId = Brand<string, 'IntelligenceInsightId'>;
export type PromptPatternId = Brand<string, 'PromptPatternId'>;
export type PromptPatternVersionId = Brand<string, 'PromptPatternVersionId'>;
export type PromptPatternUseId = Brand<string, 'PromptPatternUseId'>;
export type ResearchAuditLogId = Brand<string, 'ResearchAuditLogId'>;

// ─── Probe Script Turn ──────────────────────────────────────────────
//
// The `turns` column on ProbeScript is JSON; this is the runtime shape.

export interface ProbeTurn {
  /** 1-indexed position within the script. */
  order: number;
  /** Outbound text the runner sends. */
  message: string;
  /** Maximum time to wait for a response before recording timeout. */
  waitForResponseMs: number;
  /** Internal note describing what we hope to learn from this turn. */
  notes: string;
  /** If true, the runner continues even when no response arrives. */
  isOptional?: boolean;
  /** Substrings whose presence in the response triggers a special log. */
  triggerKeywords?: string[];
  /** If true, the runner does not advance currentTurn even after sending. */
  continueOnTimeout?: boolean;
}

// ─── Scoring Rubric ─────────────────────────────────────────────────
//
// The `scoringRubric` column on ResearchVertical is JSON; this is the shape.

export interface ScoringDimension {
  /** Stable identifier referenced in analyses. */
  key: string;
  /** Human-readable label rendered in UI. */
  label: string;
  /** Weight in the final score; all weights for a vertical must sum to 1. */
  weight: number;
}

export interface ScoringRubric {
  dimensions: ScoringDimension[];
}

// ─── Audience Source for ResearchTarget evidence ───────────────────
//
// Compliance: every target must have documented evidence of being a
// publicly published business contact. See NEXUS_INTELLIGENCE_PLAN.md
// §Compliance.

export interface TargetSourceEvidence {
  type: 'url' | 'screenshot' | 'referral' | 'other';
  value: string;
  collectedBy: string;
  collectedAt: Date;
}
