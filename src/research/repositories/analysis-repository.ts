/**
 * CRUD over `research_analyses`.
 *
 * One analysis per session (unique on sessionId). Re-analysis creates a new
 * record referencing the old one via `previousVersionId`, so historical
 * analyses are preserved for audit.
 */
import type { PrismaClient, ResearchAnalysis } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ResearchAnalysisId } from '../types.js';

// ─── Input types ──────────────────────────────────────────────────

/**
 * Full analysis payload created by the analyzer after the LLM call.
 * All dimension fields are optional — only the level being analyzed
 * will be populated.
 */
export interface CreateAnalysisInput {
  sessionId: string;
  previousVersionId?: string;
  rawJson: Record<string, unknown>;
  llmModel: string;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  llmCostUsd?: number;
  llmReasoningTrace?: string;
  degraded?: boolean;

  // L1 — Surface
  agentName?: string;
  hasPresentationMenu?: boolean;
  menuType?: string;
  toneProfile?: string;
  toneNotes?: string;
  usesEmoji?: boolean;
  responseTimeP50Ms?: number;
  responseTimeP95Ms?: number;
  hasProactiveReengage?: boolean;
  reengageTimeMs?: number;
  languagesDetected?: string[];

  // L2 — Capabilities
  capabilityMap?: Record<string, unknown>;
  canTakeActions?: boolean;
  hasRealtimeLookup?: boolean;
  dataFreshness?: string;
  capabilityNotes?: string;

  // L3 — Architecture
  estimatedLlm?: string;
  llmConfidence?: number;
  llmEvidenceNotes?: string;
  hasRag?: boolean;
  ragDomainScope?: string;
  hasFunctionCalling?: boolean;
  detectedTools?: string[];
  hasCrossSessionMemory?: boolean;
  systemPromptHints?: string;
  promptStructureNotes?: string;

  // L4 — Adversarial
  promptInjectionResistance?: number;
  handlesOffensiveInput?: string;
  competitorMentionPolicy?: string;
  consistencyScore?: number;
  hallucinationRate?: string;
  adversarialNotes?: string;

  // L5 — Longitudinal
  changesFromPrevious?: string;
  significantChanges?: boolean;
  regressions?: string[];
  improvements?: string[];

  // Scores
  scores?: Record<string, unknown>;
  scoreTotal?: number;

  // Best / worst turns
  bestTurnOrder?: number;
  bestTurnText?: string;
  bestTurnJustification?: string;
  worstTurnOrder?: number;
  worstTurnText?: string;
  worstTurnJustification?: string;

  // Synthesis
  keyStrengths?: string[];
  keyWeaknesses?: string[];
  uniqueCapabilities?: string[];
  thingsToReplicate?: string[];
  thingsToAvoid?: string[];
  executiveSummary?: string;
}

export interface UpdateAnalysisInput {
  previousVersionId?: string;
  rawJson?: Record<string, unknown>;
  llmModel?: string;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  llmCostUsd?: number;
  scores?: Record<string, unknown>;
  scoreTotal?: number;
  executiveSummary?: string;
  keyStrengths?: string[];
  keyWeaknesses?: string[];
  uniqueCapabilities?: string[];
  thingsToReplicate?: string[];
  thingsToAvoid?: string[];
  significantChanges?: boolean;
  regressions?: string[];
  improvements?: string[];
  degraded?: boolean;
}

// ─── Interface ───────────────────────────────────────────────────

export interface ResearchAnalysisRepository {
  create(data: CreateAnalysisInput): Promise<ResearchAnalysis>;
  findById(id: ResearchAnalysisId): Promise<ResearchAnalysis | null>;
  /** Returns the most recent analysis for a session (by analyzedAt desc). */
  findBySession(sessionId: string): Promise<ResearchAnalysis | null>;
  /**
   * List analyses for all sessions under a given vertical.
   * Requires a 2-hop join: analysis → session → target → verticalSlug.
   */
  listByVertical(verticalSlug: string, limit?: number): Promise<ResearchAnalysis[]>;
  update(id: ResearchAnalysisId, data: UpdateAnalysisInput): Promise<ResearchAnalysis>;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createResearchAnalysisRepository(
  prisma: PrismaClient,
): ResearchAnalysisRepository {
  return {
    async create(data) {
      return await prisma.researchAnalysis.create({
        data: {
          sessionId: data.sessionId,
          previousVersionId: data.previousVersionId,
          rawJson: data.rawJson as Prisma.InputJsonValue,
          llmModel: data.llmModel,
          llmInputTokens: data.llmInputTokens,
          llmOutputTokens: data.llmOutputTokens,
          llmCostUsd: data.llmCostUsd,
          llmReasoningTrace: data.llmReasoningTrace,
          degraded: data.degraded ?? false,

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
          languagesDetected: data.languagesDetected ?? [],

          capabilityMap: data.capabilityMap as Prisma.InputJsonValue | undefined,
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
          detectedTools: data.detectedTools ?? [],
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
          significantChanges: data.significantChanges ?? false,
          regressions: data.regressions ?? [],
          improvements: data.improvements ?? [],

          scores: data.scores as Prisma.InputJsonValue | undefined,
          scoreTotal: data.scoreTotal,

          bestTurnOrder: data.bestTurnOrder,
          bestTurnText: data.bestTurnText,
          bestTurnJustification: data.bestTurnJustification,
          worstTurnOrder: data.worstTurnOrder,
          worstTurnText: data.worstTurnText,
          worstTurnJustification: data.worstTurnJustification,

          keyStrengths: data.keyStrengths ?? [],
          keyWeaknesses: data.keyWeaknesses ?? [],
          uniqueCapabilities: data.uniqueCapabilities ?? [],
          thingsToReplicate: data.thingsToReplicate ?? [],
          thingsToAvoid: data.thingsToAvoid ?? [],
          executiveSummary: data.executiveSummary,
        },
      });
    },

    async findById(id) {
      return await prisma.researchAnalysis.findUnique({ where: { id } });
    },

    async findBySession(sessionId) {
      return await prisma.researchAnalysis.findUnique({ where: { sessionId } });
    },

    async listByVertical(verticalSlug, limit = 100) {
      return await prisma.researchAnalysis.findMany({
        where: {
          session: {
            target: { verticalSlug },
          },
        },
        orderBy: { analyzedAt: 'desc' },
        take: limit,
      });
    },

    async update(id, data) {
      return await prisma.researchAnalysis.update({
        where: { id },
        data: {
          ...(data.previousVersionId !== undefined && {
            previousVersionId: data.previousVersionId,
          }),
          ...(data.rawJson !== undefined && {
            rawJson: data.rawJson as Prisma.InputJsonValue,
          }),
          ...(data.llmModel !== undefined && { llmModel: data.llmModel }),
          ...(data.llmInputTokens !== undefined && { llmInputTokens: data.llmInputTokens }),
          ...(data.llmOutputTokens !== undefined && { llmOutputTokens: data.llmOutputTokens }),
          ...(data.llmCostUsd !== undefined && { llmCostUsd: data.llmCostUsd }),
          ...(data.scores !== undefined && {
            scores: data.scores as Prisma.InputJsonValue,
          }),
          ...(data.scoreTotal !== undefined && { scoreTotal: data.scoreTotal }),
          ...(data.executiveSummary !== undefined && {
            executiveSummary: data.executiveSummary,
          }),
          ...(data.keyStrengths !== undefined && { keyStrengths: data.keyStrengths }),
          ...(data.keyWeaknesses !== undefined && { keyWeaknesses: data.keyWeaknesses }),
          ...(data.uniqueCapabilities !== undefined && {
            uniqueCapabilities: data.uniqueCapabilities,
          }),
          ...(data.thingsToReplicate !== undefined && {
            thingsToReplicate: data.thingsToReplicate,
          }),
          ...(data.thingsToAvoid !== undefined && { thingsToAvoid: data.thingsToAvoid }),
          ...(data.significantChanges !== undefined && {
            significantChanges: data.significantChanges,
          }),
          ...(data.regressions !== undefined && { regressions: data.regressions }),
          ...(data.improvements !== undefined && { improvements: data.improvements }),
          ...(data.degraded !== undefined && { degraded: data.degraded }),
        },
      });
    },
  };
}
