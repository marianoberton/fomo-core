/**
 * Synthesizer — aggregates analyses for a vertical into IntelligenceInsights
 * and PromptPatterns via an LLM call (§6.1).
 *
 * Flow:
 *   1. Load analyses for the vertical (min 3 required)
 *   2. Build synthesis corpus
 *   3. Call LLM via CostGuard pattern (same as analyzer.ts)
 *   4. Parse JSON response (with re-prompt on failure)
 *   5. Persist insights (approved=false) + patterns (pending, v1)
 */
import type { PrismaClient, ResearchAnalysis } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { createAnthropicProvider } from '@/providers/anthropic.js';
import { getModelMeta } from '@/providers/models.js';
import { z } from 'zod';
import { ResearchError } from '../errors.js';
import { createResearchAnalysisRepository } from '../repositories/analysis-repository.js';
import { createInsightRepository } from '../repositories/insight-repository.js';
import { createPatternRepository } from '../repositories/pattern-repository.js';

// ─── LLM model for synthesis (§2136 plan) ────────────────────────

const SYNTHESIS_MODEL = 'claude-opus-4-7';

// ─── Zod schemas for LLM output ──────────────────────────────────

const insightOutputSchema = z.object({
  category: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  evidence: z.string().optional(),
  seenInCount: z.number().int().min(1).optional(),
});

const patternOutputSchema = z.object({
  category: z.string().min(1),
  patternText: z.string().min(1),
  patternVariables: z.array(z.string()).optional(),
  seenInCount: z.number().int().min(1).optional(),
  avgScoreWhen: z.number().optional(),
  notes: z.string().optional(),
});

const synthesisResponseSchema = z.object({
  insights: z.array(insightOutputSchema),
  patterns: z.array(patternOutputSchema),
});

type SynthesisResponse = z.infer<typeof synthesisResponseSchema>;

// ─── Public types ─────────────────────────────────────────────────

export interface SynthesisResult {
  insightIds: string[];
  patternIds: string[];
  llmInputTokens: number;
  llmOutputTokens: number;
  llmCostUsd: number;
}

export interface Synthesizer {
  synthesizeVertical(verticalSlug: string): Promise<Result<SynthesisResult, ResearchError>>;
}

// ─── Deps ─────────────────────────────────────────────────────────

export interface SynthesizerDeps {
  prisma: PrismaClient;
  anthropicApiKey?: string;
  logger: Logger;
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildCorpus(analyses: ResearchAnalysis[]): string {
  return analyses
    .map((a, i) => {
      const score = a.scoreTotal ? `Score: ${Number(a.scoreTotal).toFixed(1)}` : 'Score: N/A';
      const strengths = (a.keyStrengths as string[]).join('; ') || 'N/A';
      const weaknesses = (a.keyWeaknesses as string[]).join('; ') || 'N/A';
      const replicate = (a.thingsToReplicate as string[]).join('; ') || 'N/A';
      const avoid = (a.thingsToAvoid as string[]).join('; ') || 'N/A';
      const systemHints = a.systemPromptHints ?? 'N/A';
      const capabilities = (a.uniqueCapabilities as string[]).join('; ') || 'N/A';
      const bestTurn = a.bestTurnText ? `"${a.bestTurnText}"` : 'N/A';

      return [
        `## Agente ${i + 1} (${score})`,
        `Fortalezas: ${strengths}`,
        `Debilidades: ${weaknesses}`,
        `Para replicar: ${replicate}`,
        `Evitar: ${avoid}`,
        `Capacidades únicas: ${capabilities}`,
        `Hints de prompt: ${systemHints}`,
        `Mejor turno: ${bestTurn}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

function buildSynthesisPrompt(verticalName: string, count: number, corpus: string): string {
  return [
    `Eres un experto en diseño de prompts y agentes IA para ${verticalName}.`,
    '',
    `Tienes ${count} análisis de agentes IA competidores en esta vertical.`,
    '',
    '# Corpus de análisis',
    '',
    corpus,
    '',
    '# Patrones a identificar',
    '',
    '1. ONBOARDING: ¿Qué patrones de bienvenida aparecen en los mejores agentes (score > 7)?',
    '   Extrae frases exactas o templates.',
    '',
    '2. MANEJO DE OBJECIONES: ¿Cómo responden los mejores a objeciones comunes?',
    '',
    '3. ESCALACIÓN: ¿Cuál es el patrón de escalación más efectivo?',
    '',
    '4. CIERRE: ¿Cómo cierran los mejores agentes una conversación?',
    '',
    '5. CAPACIDADES DIFERENCIADORAS: ¿Qué hacen los mejores que los demás no hacen?',
    '',
    '6. ERRORES COMUNES: ¿Qué hacen mal la mayoría? ¿Qué debemos evitar?',
    '',
    `Para cada insight identificado:`,
    '- Dale un título claro y accionable',
    '- Incluye evidencia (cita del transcript o descripción del comportamiento)',
    `- Indica en cuántos de los ${count} agentes viste este patrón`,
    '- Si hay una frase o template extractable, inclúyela en `patterns`',
    '',
    'Las variables en patternText van con doble llave: {{variable_name}}',
    '',
    'Responde ÚNICAMENTE con JSON válido con este schema exacto:',
    '{"insights": [{"category": "onboarding|objection-handling|escalation|closing|capabilities|avoid", "title": "...", "content": "...", "evidence": "...", "seenInCount": N}], "patterns": [{"category": "onboarding|objection-handling|escalation|closing|capabilities|avoid", "patternText": "...", "patternVariables": ["var1"], "seenInCount": N, "avgScoreWhen": X.X, "notes": "..."}]}',
  ].join('\n');
}

async function callLlm(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const provider = createAnthropicProvider({ apiKey, model });
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = provider.chat({
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: 'You are an expert AI agent analyst. Always respond with valid JSON only.',
    maxTokens: 8192,
    temperature: 0.2,
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

function parseResponse(text: string): SynthesisResponse | null {
  // Extract JSON from response (handles ```json blocks)
  const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/) ?? text.match(/(\{[\s\S]+\})/);
  const jsonText = jsonMatch?.[1] ?? text;

  try {
    const raw: unknown = JSON.parse(jsonText);
    const parsed = synthesisResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ─── Factory ─────────────────────────────────────────────────────

export function createSynthesizer(deps: SynthesizerDeps): Synthesizer {
  const { prisma, logger } = deps;
  const apiKey = deps.anthropicApiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';

  const analysisRepo = createResearchAnalysisRepository(prisma);
  const insightRepo = createInsightRepository(prisma);
  const patternRepo = createPatternRepository(prisma);

  return {
    async synthesizeVertical(verticalSlug) {
      // ── 1. Load vertical + analyses ───────────────────────────
      const vertical = await prisma.researchVertical.findUnique({ where: { slug: verticalSlug } });
      if (!vertical) {
        return err(
          new ResearchError({
            message: `Vertical "${verticalSlug}" not found`,
            code: 'SCRIPT_INVALID',
          }),
        );
      }

      const analyses = await analysisRepo.listByVertical(verticalSlug, 200);

      if (analyses.length < 3) {
        return err(
          new ResearchError({
            message: `Need at least 3 analyses for vertical "${verticalSlug}" to synthesize (found ${analyses.length})`,
            code: 'SCRIPT_INVALID',
          }),
        );
      }

      // ── 2. Build corpus + prompt ──────────────────────────────
      const corpus = buildCorpus(analyses);
      const prompt = buildSynthesisPrompt(vertical.name, analyses.length, corpus);

      logger.info('research synthesizer: calling LLM', {
        component: 'research-synthesizer',
        verticalSlug,
        analysisCount: analyses.length,
        model: SYNTHESIS_MODEL,
      });

      // ── 3. Call LLM ───────────────────────────────────────────
      let llmResult: { text: string; inputTokens: number; outputTokens: number };

      try {
        llmResult = await callLlm(SYNTHESIS_MODEL, prompt, apiKey);
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);

        if (msg.toLowerCase().includes('budget') || msg.toLowerCase().includes('quota')) {
          return err(
            new ResearchError({
              message: `Budget exceeded during synthesis: ${msg}`,
              code: 'ANALYSIS_BUDGET_EXCEEDED',
              cause: cause instanceof Error ? cause : undefined,
            }),
          );
        }

        return err(
          new ResearchError({
            message: `LLM call failed: ${msg}`,
            code: 'ANALYSIS_PARSE_FAILED',
            cause: cause instanceof Error ? cause : undefined,
          }),
        );
      }

      // ── 4. Parse (with one re-prompt) ─────────────────────────
      let parsed = parseResponse(llmResult.text);

      if (!parsed) {
        logger.warn('research synthesizer: parse failed, re-prompting', {
          component: 'research-synthesizer',
          verticalSlug,
        });

        const rePrompt = [
          'Your previous response could not be parsed as valid JSON.',
          'Original response:',
          llmResult.text,
          '',
          'Please fix it and respond ONLY with valid JSON matching the schema:',
          '{"insights": [...], "patterns": [...]}',
        ].join('\n');

        try {
          const corrected = await callLlm(SYNTHESIS_MODEL, rePrompt, apiKey);
          parsed = parseResponse(corrected.text);
          llmResult.inputTokens += corrected.inputTokens;
          llmResult.outputTokens += corrected.outputTokens;
        } catch {
          // ignore re-prompt error — fall through to parse failure
        }
      }

      if (!parsed) {
        return err(
          new ResearchError({
            message: 'Synthesis LLM response could not be parsed even after re-prompt',
            code: 'ANALYSIS_PARSE_FAILED',
          }),
        );
      }

      // ── 5. Compute cost ───────────────────────────────────────
      const meta = getModelMeta(SYNTHESIS_MODEL);
      const llmCostUsd =
        (llmResult.inputTokens / 1_000_000) * meta.inputPricePer1M +
        (llmResult.outputTokens / 1_000_000) * meta.outputPricePer1M;

      logger.info('research synthesizer: LLM completed', {
        component: 'research-synthesizer',
        verticalSlug,
        insights: parsed.insights.length,
        patterns: parsed.patterns.length,
        costUsd: llmCostUsd.toFixed(4),
      });

      // ── 6. Persist insights ───────────────────────────────────
      const insightIds: string[] = [];
      for (const raw of parsed.insights) {
        const insight = await insightRepo.create({
          verticalSlug,
          category: raw.category,
          title: raw.title,
          content: raw.content,
          evidence: raw.evidence,
          seenInCount: raw.seenInCount,
          sourceAnalysisIds: analyses.map((a) => a.id),
        });
        insightIds.push(insight.id);
      }

      // ── 7. Persist patterns ───────────────────────────────────
      const patternIds: string[] = [];
      for (const raw of parsed.patterns) {
        const pattern = await patternRepo.create({
          verticalSlug,
          category: raw.category,
          patternText: raw.patternText,
          patternVariables: raw.patternVariables,
          seenInCount: raw.seenInCount,
          avgScoreWhen: raw.avgScoreWhen,
          notes: raw.notes,
          sourceAnalysisIds: analyses.map((a) => a.id),
        });
        patternIds.push(pattern.id);
      }

      logger.info('research synthesizer: synthesis complete', {
        component: 'research-synthesizer',
        verticalSlug,
        insightIds: insightIds.length,
        patternIds: patternIds.length,
      });

      return ok({
        insightIds,
        patternIds,
        llmInputTokens: llmResult.inputTokens,
        llmOutputTokens: llmResult.outputTokens,
        llmCostUsd,
      });
    },
  };
}
