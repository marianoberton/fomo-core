import { z } from 'zod';
import type { ProbeLevel } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { ScoringRubric } from '../types.js';
import { ResearchError } from '../errors.js';
import { calculateWeightedScore } from './score-calculator.js';
import type { ScoreDimensionResult } from './score-calculator.js';

// ─── Parsed Analysis type ────────────────────────────────────────────────────

export interface ParsedAnalysis {
  // L1 — Superficie
  agentName: string | null;
  hasPresentationMenu: boolean | null;
  menuType: 'numbered' | 'free-text' | 'hybrid' | 'none' | null;
  toneProfile: 'formal' | 'informal' | 'neutral' | 'robotic' | 'empathetic' | null;
  toneNotes: string | null;
  usesEmoji: boolean | null;
  responseTimeP50Ms: number | null;
  responseTimeP95Ms: number | null;
  hasProactiveReengage: boolean | null;
  reengageTimeMs: number | null;
  languagesDetected: string[];

  // L2 — Capabilities
  capabilityMap: Record<string, boolean> | null;
  canTakeActions: boolean | null;
  hasRealtimeLookup: boolean | null;
  dataFreshness: 'realtime' | 'cached' | 'static' | 'hallucinated' | 'mixed' | null;
  capabilityNotes: string | null;

  // L3 — Architecture
  estimatedLlm: string | null;
  llmConfidence: number | null;
  llmEvidenceNotes: string | null;
  hasRag: boolean | null;
  ragDomainScope: string | null;
  hasFunctionCalling: boolean | null;
  detectedTools: string[];
  hasCrossSessionMemory: boolean | null;
  systemPromptHints: string | null;
  promptStructureNotes: string | null;

  // L4 — Adversarial
  promptInjectionResistance: number | null;
  handlesOffensiveInput: 'blocks' | 'ignores' | 'escalates' | 'matches_tone' | 'fails' | null;
  competitorMentionPolicy: 'avoids' | 'neutral' | 'promotes_self' | 'no_policy' | null;
  consistencyScore: number | null;
  hallucinationRate: 'none' | 'low' | 'medium' | 'high' | null;
  adversarialNotes: string | null;

  // L5 — Longitudinal
  changesFromPrevious: string | null;
  significantChanges: boolean;
  improvements: string[];
  regressions: string[];

  // Computed scores
  scores: Record<string, ScoreDimensionResult> | null;
  scoreTotal: number | null;

  // Best/worst turns
  bestTurnOrder: number | null;
  bestTurnText: string | null;
  bestTurnJustification: string | null;
  worstTurnOrder: number | null;
  worstTurnText: string | null;
  worstTurnJustification: string | null;

  // Synthesis
  keyStrengths: string[];
  keyWeaknesses: string[];
  uniqueCapabilities: string[];
  thingsToReplicate: string[];
  thingsToAvoid: string[];
  executiveSummary: string | null;

  /** True when the analysis was produced by partial coercion after a failed re-prompt. */
  _degraded?: boolean;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const scoreDimensionSchema = z.object({
  score: z.number().min(1).max(10),
  justification: z.string(),
});

const baseSchema = z.object({
  // L1
  agentName: z.string().nullable().optional().default(null),
  hasPresentationMenu: z.boolean().nullable().optional().default(null),
  menuType: z
    .enum(['numbered', 'free-text', 'hybrid', 'none'])
    .nullable()
    .optional()
    .default(null),
  toneProfile: z
    .enum(['formal', 'informal', 'neutral', 'robotic', 'empathetic'])
    .nullable()
    .optional()
    .default(null),
  toneNotes: z.string().nullable().optional().default(null),
  usesEmoji: z.boolean().nullable().optional().default(null),
  responseTimeP50Ms: z.number().nullable().optional().default(null),
  responseTimeP95Ms: z.number().nullable().optional().default(null),
  hasProactiveReengage: z.boolean().nullable().optional().default(null),
  reengageTimeMs: z.number().nullable().optional().default(null),
  languagesDetected: z.array(z.string()).optional().default([]),

  // L2
  capabilityMap: z.record(z.boolean()).nullable().optional().default(null),
  canTakeActions: z.boolean().nullable().optional().default(null),
  hasRealtimeLookup: z.boolean().nullable().optional().default(null),
  dataFreshness: z
    .enum(['realtime', 'cached', 'static', 'hallucinated', 'mixed'])
    .nullable()
    .optional()
    .default(null),
  capabilityNotes: z.string().nullable().optional().default(null),

  // L3
  estimatedLlm: z.string().nullable().optional().default(null),
  llmConfidence: z.number().nullable().optional().default(null),
  llmEvidenceNotes: z.string().nullable().optional().default(null),
  hasRag: z.boolean().nullable().optional().default(null),
  ragDomainScope: z.string().nullable().optional().default(null),
  hasFunctionCalling: z.boolean().nullable().optional().default(null),
  detectedTools: z.array(z.string()).optional().default([]),
  hasCrossSessionMemory: z.boolean().nullable().optional().default(null),
  systemPromptHints: z.string().nullable().optional().default(null),
  promptStructureNotes: z.string().nullable().optional().default(null),

  // L4
  promptInjectionResistance: z.number().nullable().optional().default(null),
  handlesOffensiveInput: z
    .enum(['blocks', 'ignores', 'escalates', 'matches_tone', 'fails'])
    .nullable()
    .optional()
    .default(null),
  competitorMentionPolicy: z
    .enum(['avoids', 'neutral', 'promotes_self', 'no_policy'])
    .nullable()
    .optional()
    .default(null),
  consistencyScore: z.number().nullable().optional().default(null),
  hallucinationRate: z
    .enum(['none', 'low', 'medium', 'high'])
    .nullable()
    .optional()
    .default(null),
  adversarialNotes: z.string().nullable().optional().default(null),

  // L5
  changesFromPrevious: z.string().nullable().optional().default(null),
  significantChanges: z.boolean().optional().default(false),
  improvements: z.array(z.string()).optional().default([]),
  regressions: z.array(z.string()).optional().default([]),

  // Scores
  scores: z.record(scoreDimensionSchema).nullable().optional().default(null),

  // Best/worst
  bestTurnOrder: z.number().nullable().optional().default(null),
  bestTurnText: z.string().nullable().optional().default(null),
  bestTurnJustification: z.string().nullable().optional().default(null),
  worstTurnOrder: z.number().nullable().optional().default(null),
  worstTurnText: z.string().nullable().optional().default(null),
  worstTurnJustification: z.string().nullable().optional().default(null),

  // Synthesis
  keyStrengths: z.array(z.string()).optional().default([]),
  keyWeaknesses: z.array(z.string()).optional().default([]),
  uniqueCapabilities: z.array(z.string()).optional().default([]),
  thingsToReplicate: z.array(z.string()).optional().default([]),
  thingsToAvoid: z.array(z.string()).optional().default([]),
  executiveSummary: z.string().nullable().optional().default(null),
});

type BaseSchemaOutput = z.infer<typeof baseSchema>;

/** Level-specific refinements that add required-field checks on top of the base schema. */
export function buildZodSchemaForLevel(level: ProbeLevel): z.ZodTypeAny {
  switch (level) {
    case 'L1_SURFACE':
      return baseSchema.refine(
        (d) => d.toneProfile !== null && d.executiveSummary !== null,
        { message: 'L1 requires toneProfile and executiveSummary' },
      );

    case 'L2_CAPABILITIES':
      return baseSchema.refine(
        (d) =>
          d.toneProfile !== null &&
          d.executiveSummary !== null &&
          d.capabilityMap !== null &&
          d.canTakeActions !== null,
        { message: 'L2 requires toneProfile, executiveSummary, capabilityMap, canTakeActions' },
      );

    case 'L3_ARCHITECTURE':
      return baseSchema.refine(
        (d) =>
          d.toneProfile !== null &&
          d.executiveSummary !== null &&
          d.estimatedLlm !== null &&
          d.hasRag !== null &&
          d.hasFunctionCalling !== null,
        {
          message:
            'L3 requires toneProfile, executiveSummary, estimatedLlm, hasRag, hasFunctionCalling',
        },
      );

    case 'L4_ADVERSARIAL':
      return baseSchema.refine(
        (d) =>
          d.toneProfile !== null &&
          d.executiveSummary !== null &&
          d.estimatedLlm !== null &&
          d.hasRag !== null &&
          d.promptInjectionResistance !== null &&
          d.handlesOffensiveInput !== null,
        {
          message:
            'L4 requires all L3 fields plus promptInjectionResistance and handlesOffensiveInput',
        },
      );

    case 'L5_LONGITUDINAL':
      return baseSchema.refine((d) => d.changesFromPrevious !== null, {
        message: 'L5 requires changesFromPrevious',
      });
  }
}

// ─── JSON extractor ──────────────────────────────────────────────────────────

/**
 * Extracts the first balanced JSON object or array from a string.
 * Handles the common case where the LLM wraps its response in a markdown
 * code fence (```json ... ```).
 */
export function extractJson(raw: string): string | null {
  // Strip markdown fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch !== null ? fenceMatch[1]!.trim() : raw.trim();

  // Find the first { or [
  const startBrace = candidate.indexOf('{');
  const startBracket = candidate.indexOf('[');
  const start =
    startBrace === -1
      ? startBracket
      : startBracket === -1
        ? startBrace
        : Math.min(startBrace, startBracket);

  if (start === -1) return null;

  const opener = candidate[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }

  return null;
}

// ─── Partial coercion (degraded fallback) ────────────────────────────────────

function coercePartialAnalysis(raw: unknown): Omit<ParsedAnalysis, 'scoreTotal'> {
  const safe = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    agentName: typeof safe['agentName'] === 'string' ? safe['agentName'] : null,
    hasPresentationMenu: typeof safe['hasPresentationMenu'] === 'boolean' ? safe['hasPresentationMenu'] : null,
    menuType: null,
    toneProfile: null,
    toneNotes: typeof safe['toneNotes'] === 'string' ? safe['toneNotes'] : null,
    usesEmoji: typeof safe['usesEmoji'] === 'boolean' ? safe['usesEmoji'] : null,
    responseTimeP50Ms: null,
    responseTimeP95Ms: null,
    hasProactiveReengage: null,
    reengageTimeMs: null,
    languagesDetected: Array.isArray(safe['languagesDetected']) ? (safe['languagesDetected'] as string[]) : [],
    capabilityMap: null,
    canTakeActions: null,
    hasRealtimeLookup: null,
    dataFreshness: null,
    capabilityNotes: null,
    estimatedLlm: typeof safe['estimatedLlm'] === 'string' ? safe['estimatedLlm'] : null,
    llmConfidence: null,
    llmEvidenceNotes: null,
    hasRag: typeof safe['hasRag'] === 'boolean' ? safe['hasRag'] : null,
    ragDomainScope: null,
    hasFunctionCalling: typeof safe['hasFunctionCalling'] === 'boolean' ? safe['hasFunctionCalling'] : null,
    detectedTools: [],
    hasCrossSessionMemory: typeof safe['hasCrossSessionMemory'] === 'boolean' ? safe['hasCrossSessionMemory'] : null,
    systemPromptHints: null,
    promptStructureNotes: null,
    promptInjectionResistance: null,
    handlesOffensiveInput: null,
    competitorMentionPolicy: null,
    consistencyScore: null,
    hallucinationRate: null,
    adversarialNotes: null,
    changesFromPrevious: typeof safe['changesFromPrevious'] === 'string' ? safe['changesFromPrevious'] : null,
    significantChanges: false,
    improvements: [],
    regressions: [],
    scores: null,
    bestTurnOrder: null,
    bestTurnText: null,
    bestTurnJustification: null,
    worstTurnOrder: null,
    worstTurnText: null,
    worstTurnJustification: null,
    keyStrengths: Array.isArray(safe['keyStrengths']) ? (safe['keyStrengths'] as string[]) : [],
    keyWeaknesses: Array.isArray(safe['keyWeaknesses']) ? (safe['keyWeaknesses'] as string[]) : [],
    uniqueCapabilities: [],
    thingsToReplicate: [],
    thingsToAvoid: [],
    executiveSummary: typeof safe['executiveSummary'] === 'string' ? safe['executiveSummary'] : null,
  };
}

// ─── Parser deps ─────────────────────────────────────────────────────────────

export interface ParserDeps {
  logger?: Logger;
  /**
   * Injectable callback for one-shot re-prompt correction.
   * The orchestrator (analyzer.ts) provides this wired to the actual LLM call.
   * If absent, parse failures return err immediately without retry.
   *
   * @param failedContent - The raw content that failed to parse.
   * @param issues - Human-readable description of what was wrong.
   * @returns The corrected raw content to attempt parsing again.
   */
  rePrompt?: (failedContent: string, issues: string[]) => Promise<string>;
  /** Maximum number of re-prompt retries (default: 1). */
  maxRetries?: number;
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parses and validates the raw LLM response from the Analysis Engine.
 *
 * Steps:
 * 1. Extract the first balanced JSON block (strips markdown fences).
 * 2. JSON.parse + Zod validate against the level-appropriate schema.
 * 3. If validation fails and `deps.rePrompt` is provided, retry once.
 * 4. If all attempts fail, coerce whatever is valid and mark `_degraded=true`.
 *
 * Pure in terms of I/O — the only async operation is the optional re-prompt
 * callback injected by the caller.
 */
export async function parseAnalysisResponse(
  rawContent: string,
  level: ProbeLevel,
  rubric: ScoringRubric,
  deps?: ParserDeps,
  _retryCount = 0,
): Promise<Result<ParsedAnalysis, ResearchError>> {
  const logger = deps?.logger;
  const maxRetries = deps?.maxRetries ?? 1;

  // Step 1: extract JSON
  const jsonStr = extractJson(rawContent);
  if (jsonStr === null) {
    const issues = ['No JSON block found in response'];

    if (_retryCount < maxRetries && deps?.rePrompt !== undefined) {
      logger?.warn('Analysis response has no JSON — re-prompting', {
        component: 'research-parser',
        retryCount: _retryCount,
        issues,
      });
      const corrected = await deps.rePrompt(rawContent, issues);
      return await parseAnalysisResponse(corrected, level, rubric, deps, _retryCount + 1);
    }

    logger?.error('Analysis parse failed — no JSON found, degrading', {
      component: 'research-parser',
    });
    const degraded: ParsedAnalysis = { ...coercePartialAnalysis({}), scoreTotal: null, _degraded: true };
    return ok(degraded);
  }

  // Step 2: parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (cause) {
    const issues = ['JSON syntax error: ' + String(cause)];

    if (_retryCount < maxRetries && deps?.rePrompt !== undefined) {
      logger?.warn('Analysis response is malformed JSON — re-prompting', {
        component: 'research-parser',
        retryCount: _retryCount,
        issues,
      });
      const corrected = await deps.rePrompt(rawContent, issues);
      return await parseAnalysisResponse(corrected, level, rubric, deps, _retryCount + 1);
    }

    logger?.error('Analysis parse failed — malformed JSON, degrading', {
      component: 'research-parser',
    });
    const degraded: ParsedAnalysis = { ...coercePartialAnalysis({}), scoreTotal: null, _degraded: true };
    return ok(degraded);
  }

  // Step 3: Zod validation
  const schema = buildZodSchemaForLevel(level);
  const validated = schema.safeParse(parsed);

  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

    if (_retryCount < maxRetries && deps?.rePrompt !== undefined) {
      logger?.warn('Analysis response failed schema validation — re-prompting', {
        component: 'research-parser',
        retryCount: _retryCount,
        issues,
      });
      const corrected = await deps.rePrompt(rawContent, issues);
      return await parseAnalysisResponse(corrected, level, rubric, deps, _retryCount + 1);
    }

    logger?.error('Analysis parse failed — schema invalid after max retries, degrading', {
      component: 'research-parser',
      issues,
    });

    // Degrade: coerce partial from parsed object
    const partial = coercePartialAnalysis(parsed);
    const degraded: ParsedAnalysis = { ...partial, scoreTotal: null, _degraded: true };
    return ok(degraded);
  }

  // Step 4: compute scoreTotal from rubric
  const data = validated.data as BaseSchemaOutput;
  const scoreTotal =
    data.scores !== null && data.scores !== undefined
      ? calculateWeightedScore(data.scores, rubric)
      : null;

  const result: ParsedAnalysis = {
    agentName: data.agentName,
    hasPresentationMenu: data.hasPresentationMenu,
    menuType: data.menuType,
    toneProfile: data.toneProfile,
    toneNotes: data.toneNotes,
    usesEmoji: data.usesEmoji,
    responseTimeP50Ms: data.responseTimeP50Ms,
    responseTimeP95Ms: data.responseTimeP95Ms,
    hasProactiveReengage: data.hasProactiveReengage,
    reengageTimeMs: data.reengageTimeMs,
    languagesDetected: data.languagesDetected,
    capabilityMap: data.capabilityMap,
    canTakeActions: data.canTakeActions,
    hasRealtimeLookup: data.hasRealtimeLookup,
    dataFreshness: data.dataFreshness,
    capabilityNotes: data.capabilityNotes,
    estimatedLlm: data.estimatedLlm,
    llmConfidence: data.llmConfidence,
    llmEvidenceNotes: data.llmEvidenceNotes,
    hasRag: data.hasRag,
    ragDomainScope: data.ragDomainScope,
    hasFunctionCalling: data.hasFunctionCalling,
    detectedTools: data.detectedTools,
    hasCrossSessionMemory: data.hasCrossSessionMemory,
    systemPromptHints: data.systemPromptHints,
    promptStructureNotes: data.promptStructureNotes,
    promptInjectionResistance: data.promptInjectionResistance,
    handlesOffensiveInput: data.handlesOffensiveInput,
    competitorMentionPolicy: data.competitorMentionPolicy,
    consistencyScore: data.consistencyScore,
    hallucinationRate: data.hallucinationRate,
    adversarialNotes: data.adversarialNotes,
    changesFromPrevious: data.changesFromPrevious,
    significantChanges: data.significantChanges,
    improvements: data.improvements,
    regressions: data.regressions,
    scores: data.scores,
    scoreTotal,
    bestTurnOrder: data.bestTurnOrder,
    bestTurnText: data.bestTurnText,
    bestTurnJustification: data.bestTurnJustification,
    worstTurnOrder: data.worstTurnOrder,
    worstTurnText: data.worstTurnText,
    worstTurnJustification: data.worstTurnJustification,
    keyStrengths: data.keyStrengths,
    keyWeaknesses: data.keyWeaknesses,
    uniqueCapabilities: data.uniqueCapabilities,
    thingsToReplicate: data.thingsToReplicate,
    thingsToAvoid: data.thingsToAvoid,
    executiveSummary: data.executiveSummary,
  };

  return ok(result);
}
