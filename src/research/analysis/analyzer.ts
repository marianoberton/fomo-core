/**
 * ResearchAnalyzer — orchestrates the full analysis pipeline.
 *
 * Flow (§4.1):
 *   1. Load session + turns + target + vertical + script
 *   2. Select model by probe level (§4.1a)
 *   3. Build prompt via prompt-builder
 *   4. Call LLM (Anthropic), stream and accumulate
 *   5. Parse + validate via response-parser (with re-prompt on failure)
 *   6. Persist ResearchAnalysis with tokens + cost
 *   7. Return analysis
 */
import type { PrismaClient, ResearchAnalysis, ProbeLevel } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { createAnthropicProvider } from '@/providers/anthropic.js';
import { getModelMeta } from '@/providers/models.js';
import { buildAnalysisPrompt } from './prompt-builder.js';
import type {
  TranscriptTurn,
  VerticalContext,
  TargetContext,
  ScriptContext,
  PreviousAnalysisSummary,
} from './prompt-builder.js';
import { parseAnalysisResponse } from './response-parser.js';
import { createResearchAnalysisRepository } from '../repositories/analysis-repository.js';
import type { ResearchAnalysisRepository } from '../repositories/analysis-repository.js';
import { ResearchError } from '../errors.js';
import type { ResearchSessionId, ScoringRubric } from '../types.js';

// ─── Model selection (§4.1a) ──────────────────────────────────────

const MODEL_BY_LEVEL: Record<ProbeLevel, string> = {
  L1_SURFACE: 'claude-haiku-4-5-20251001',
  L2_CAPABILITIES: 'claude-sonnet-4-6',
  L3_ARCHITECTURE: 'claude-opus-4-6',
  L4_ADVERSARIAL: 'claude-opus-4-6',
  L5_LONGITUDINAL: 'claude-sonnet-4-6',
};

// ─── Public interface ─────────────────────────────────────────────

export interface AnalyzeOptions {
  /** Override the model used for this analysis run. */
  modelOverride?: string;
}

export interface ResearchAnalyzer {
  /**
   * Run analysis for a completed session. Idempotent — if an analysis already
   * exists for this session, it is overwritten (re-analysis flow).
   */
  analyze(
    sessionId: ResearchSessionId,
    opts?: AnalyzeOptions,
  ): Promise<Result<ResearchAnalysis, ResearchError>>;
}

// ─── Deps ─────────────────────────────────────────────────────────

export interface ResearchAnalyzerDeps {
  prisma: PrismaClient;
  analysisRepo?: ResearchAnalysisRepository;
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var if not provided. */
  anthropicApiKey?: string;
  logger: Logger;
}

// ─── LLM call helper ─────────────────────────────────────────────

interface LlmCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callLlm(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
): Promise<LlmCallResult> {
  const provider = createAnthropicProvider({ apiKey, model });
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = provider.chat({
    messages: [{ role: 'user', content: userPrompt }],
    systemPrompt,
    maxTokens: 4096,
    temperature: 0,
  });

  for await (const event of stream) {
    if (event.type === 'content_delta') {
      text += event.text;
    } else if (event.type === 'message_end') {
      inputTokens = event.usage.inputTokens;
      outputTokens = event.usage.outputTokens;
    }
  }

  return { text, inputTokens, outputTokens };
}

// ─── Factory ─────────────────────────────────────────────────────

export function createResearchAnalyzer(deps: ResearchAnalyzerDeps): ResearchAnalyzer {
  const { prisma, logger } = deps;
  const analysisRepo = deps.analysisRepo ?? createResearchAnalysisRepository(prisma);
  const apiKey = deps.anthropicApiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';

  return {
    async analyze(sessionId, opts = {}) {
      // ── 1. Load session with all relations ────────────────────
      const session = await prisma.researchSession.findUnique({
        where: { id: sessionId },
        include: {
          turns: { orderBy: [{ turnOrder: 'asc' }, { direction: 'asc' }] },
          target: {
            include: {
              vertical: true,
            },
          },
          script: true,
        },
      });

      if (!session) {
        return err(
          new ResearchError({
            message: `Session ${sessionId} not found`,
            code: 'SCRIPT_INVALID',
          }),
        );
      }

      const level = session.script.level as ProbeLevel;
      const vertical = session.target.vertical;
      const rubric = vertical.scoringRubric as unknown as ScoringRubric;

      // ── 2. Build L5 previous analysis summary ─────────────────
      let previousAnalysis: PreviousAnalysisSummary | undefined;
      if (level === 'L5_LONGITUDINAL') {
        // Find most recent analysis for the same target (different session)
        const prev = await prisma.researchAnalysis.findFirst({
          where: {
            session: {
              targetId: session.targetId,
              id: { not: sessionId },
              status: 'completed',
            },
          },
          orderBy: { analyzedAt: 'desc' },
        });

        if (prev) {
          previousAnalysis = {
            analyzedAt: prev.analyzedAt,
            estimatedLlm: prev.estimatedLlm,
            hasRag: prev.hasRag,
            scoreTotal: prev.scoreTotal ? Number(prev.scoreTotal) : null,
            keyStrengths: prev.keyStrengths,
            keyWeaknesses: prev.keyWeaknesses,
          };
        }
      }

      // ── 3. Build prompt ───────────────────────────────────────
      const transcriptTurns: TranscriptTurn[] = session.turns
        .filter((t) => t.direction === 'outbound' || !t.isTimeout)
        .map((t) => ({
          turnOrder: t.turnOrder,
          direction: t.direction as 'outbound' | 'inbound',
          message: t.message,
          latencyMs: t.latencyMs,
          isTimeout: t.isTimeout,
          timestamp: t.timestamp,
        }));

      const verticalCtx: VerticalContext = {
        slug: vertical.slug,
        name: vertical.name,
        analysisInstructions: vertical.analysisInstructions,
        scoringRubric: rubric,
      };

      const targetCtx: TargetContext = {
        name: session.target.name,
        company: session.target.company,
        country: session.target.country,
      };

      const scriptCtx: ScriptContext = {
        name: session.script.name,
        objective: session.script.objective ?? '',
        level,
      };

      const prompt = buildAnalysisPrompt({
        turns: transcriptTurns,
        vertical: verticalCtx,
        level,
        target: targetCtx,
        script: scriptCtx,
        previousAnalysis,
      });

      // ── 4. Select model + call LLM ────────────────────────────
      const model = opts.modelOverride ?? MODEL_BY_LEVEL[level];

      logger.info('research analyzer: calling LLM', {
        component: 'research-analyzer',
        sessionId,
        level,
        model,
      });

      let llmResult: LlmCallResult;
      try {
        llmResult = await callLlm(model, prompt.system, prompt.user, apiKey);
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        logger.error('research analyzer: LLM call failed', {
          component: 'research-analyzer',
          sessionId,
          model,
          error: msg,
        });
        return err(
          new ResearchError({
            message: `LLM call failed: ${msg}`,
            code: 'ANALYSIS_PARSE_FAILED',
            cause: cause instanceof Error ? cause : undefined,
          }),
        );
      }

      // ── 5. Parse response (with re-prompt on failure) ─────────
      const parseResult = await parseAnalysisResponse(
        llmResult.text,
        level,
        rubric,
        {
          logger,
          maxRetries: 1,
          rePrompt: async (failedContent, issues) => {
            const rePromptUser = [
              'Your previous response had parsing issues:',
              issues.join('\n'),
              '',
              'Original response:',
              failedContent,
              '',
              'Please provide a corrected, valid JSON response following the schema exactly.',
            ].join('\n');

            try {
              const corrected = await callLlm(model, prompt.system, rePromptUser, apiKey);
              return corrected.text;
            } catch {
              return failedContent;
            }
          },
        },
      );

      if (!parseResult.ok) {
        return err(parseResult.error);
      }

      const parsed = parseResult.value;

      // ── 6. Compute cost ───────────────────────────────────────
      const meta = getModelMeta(model);
      const costUsd =
        (llmResult.inputTokens / 1_000_000) * meta.inputPricePer1M +
        (llmResult.outputTokens / 1_000_000) * meta.outputPricePer1M;

      logger.info('research analyzer: LLM call completed', {
        component: 'research-analyzer',
        sessionId,
        model,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        costUsd: costUsd.toFixed(4),
        degraded: parsed._degraded,
      });

      // ── 7. Persist analysis ───────────────────────────────────
      // If an analysis already exists for this session, record its id for history
      const existing = await analysisRepo.findBySession(sessionId);

      let rawJson: Record<string, unknown>;
      try {
        rawJson = JSON.parse(llmResult.text) as Record<string, unknown>;
      } catch {
        rawJson = { raw: llmResult.text };
      }

      const analysis = await analysisRepo.create({
        sessionId,
        previousVersionId: existing?.id,
        rawJson,
        llmModel: model,
        llmInputTokens: llmResult.inputTokens,
        llmOutputTokens: llmResult.outputTokens,
        llmCostUsd: costUsd,
        degraded: parsed._degraded,

        agentName: parsed.agentName ?? undefined,
        hasPresentationMenu: parsed.hasPresentationMenu ?? undefined,
        menuType: parsed.menuType ?? undefined,
        toneProfile: parsed.toneProfile ?? undefined,
        toneNotes: parsed.toneNotes ?? undefined,
        usesEmoji: parsed.usesEmoji ?? undefined,
        responseTimeP50Ms: parsed.responseTimeP50Ms ?? undefined,
        responseTimeP95Ms: parsed.responseTimeP95Ms ?? undefined,
        hasProactiveReengage: parsed.hasProactiveReengage ?? undefined,
        reengageTimeMs: parsed.reengageTimeMs ?? undefined,
        languagesDetected: parsed.languagesDetected,

        capabilityMap: parsed.capabilityMap ?? undefined,
        canTakeActions: parsed.canTakeActions ?? undefined,
        hasRealtimeLookup: parsed.hasRealtimeLookup ?? undefined,
        dataFreshness: parsed.dataFreshness ?? undefined,
        capabilityNotes: parsed.capabilityNotes ?? undefined,

        estimatedLlm: parsed.estimatedLlm ?? undefined,
        llmConfidence: parsed.llmConfidence ?? undefined,
        llmEvidenceNotes: parsed.llmEvidenceNotes ?? undefined,
        hasRag: parsed.hasRag ?? undefined,
        ragDomainScope: parsed.ragDomainScope ?? undefined,
        hasFunctionCalling: parsed.hasFunctionCalling ?? undefined,
        detectedTools: parsed.detectedTools,
        hasCrossSessionMemory: parsed.hasCrossSessionMemory ?? undefined,
        systemPromptHints: parsed.systemPromptHints ?? undefined,
        promptStructureNotes: parsed.promptStructureNotes ?? undefined,

        promptInjectionResistance: parsed.promptInjectionResistance ?? undefined,
        handlesOffensiveInput: parsed.handlesOffensiveInput ?? undefined,
        competitorMentionPolicy: parsed.competitorMentionPolicy ?? undefined,
        consistencyScore: parsed.consistencyScore ?? undefined,
        hallucinationRate: parsed.hallucinationRate ?? undefined,
        adversarialNotes: parsed.adversarialNotes ?? undefined,

        changesFromPrevious: parsed.changesFromPrevious ?? undefined,
        significantChanges: parsed.significantChanges,
        improvements: parsed.improvements,
        regressions: parsed.regressions,

        scores: parsed.scores ?? undefined,
        scoreTotal: parsed.scoreTotal ?? undefined,

        bestTurnOrder: parsed.bestTurnOrder ?? undefined,
        bestTurnText: parsed.bestTurnText ?? undefined,
        bestTurnJustification: parsed.bestTurnJustification ?? undefined,
        worstTurnOrder: parsed.worstTurnOrder ?? undefined,
        worstTurnText: parsed.worstTurnText ?? undefined,
        worstTurnJustification: parsed.worstTurnJustification ?? undefined,

        keyStrengths: parsed.keyStrengths,
        keyWeaknesses: parsed.keyWeaknesses,
        uniqueCapabilities: parsed.uniqueCapabilities,
        thingsToReplicate: parsed.thingsToReplicate,
        thingsToAvoid: parsed.thingsToAvoid,
        executiveSummary: parsed.executiveSummary ?? undefined,
      });

      logger.info('research analyzer: analysis persisted', {
        component: 'research-analyzer',
        sessionId,
        analysisId: analysis.id,
        scoreTotal: analysis.scoreTotal,
      });

      // Refresh the intelligence dashboard materialized view (best-effort).
      prisma
        .$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY research_vertical_stats`
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn('research analyzer: failed to refresh materialized view', {
            component: 'research-analyzer',
            error: msg,
          });
        });

      return ok(analysis);
    },
  };
}
