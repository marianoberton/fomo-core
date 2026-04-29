import type { ProbeLevel } from '@prisma/client';
import type { ScoringRubric } from '../types.js';

// ─── Input types ────────────────────────────────────────────────────────────

export interface TranscriptTurn {
  turnOrder: number;
  direction: 'outbound' | 'inbound';
  message: string;
  latencyMs: number | null;
  isTimeout: boolean;
  timestamp: Date;
}

export interface VerticalContext {
  slug: string;
  name: string;
  analysisInstructions: string;
  scoringRubric: ScoringRubric;
}

export interface TargetContext {
  name: string;
  company: string | null;
  country: string;
}

export interface ScriptContext {
  name: string;
  objective: string;
  level: ProbeLevel;
}

export interface PreviousAnalysisSummary {
  analyzedAt: Date;
  estimatedLlm: string | null;
  hasRag: boolean | null;
  scoreTotal: number | null;
  keyStrengths: string[];
  keyWeaknesses: string[];
}

export interface AnalysisPromptInput {
  turns: TranscriptTurn[];
  vertical: VerticalContext;
  level: ProbeLevel;
  target?: TargetContext;
  script?: ScriptContext;
  previousAnalysis?: PreviousAnalysisSummary;
}

export interface AnalysisPrompt {
  system: string;
  user: string;
}

// ─── Level display helpers ───────────────────────────────────────────────────

const LEVEL_DISPLAY: Record<ProbeLevel, string> = {
  L1_SURFACE: 'L1 — Superficie',
  L2_CAPABILITIES: 'L2 — Capacidades',
  L3_ARCHITECTURE: 'L3 — Arquitectura',
  L4_ADVERSARIAL: 'L4 — Adversarial',
  L5_LONGITUDINAL: 'L5 — Longitudinal',
};

// ─── Transcript formatter ────────────────────────────────────────────────────

function formatTranscript(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => {
      const prefix = t.direction === 'outbound' ? '→ [INVESTIGADOR]' : '← [AGENTE]';
      const latency = t.latencyMs !== null ? ` (+${t.latencyMs}ms)` : '';
      const timeout = t.isTimeout ? ' [TIMEOUT — sin respuesta]' : '';
      return `${prefix}${latency}${timeout}\n${t.message}`;
    })
    .join('\n\n');
}

// ─── Timing metric calculator ────────────────────────────────────────────────

interface TimingMetrics {
  avgMs: number | null;
  maxMs: number | null;
  minMs: number | null;
  timeoutCount: number;
  totalInbound: number;
}

function computeTimingMetrics(turns: TranscriptTurn[]): TimingMetrics {
  const inbound = turns.filter((t) => t.direction === 'inbound');
  const latencies = inbound.map((t) => t.latencyMs).filter((l): l is number => l !== null);

  return {
    avgMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
    minMs: latencies.length > 0 ? Math.min(...latencies) : null,
    timeoutCount: inbound.filter((t) => t.isTimeout).length,
    totalInbound: inbound.length,
  };
}

// ─── JSON schema strings per level ──────────────────────────────────────────

function buildJsonSchemaSection(level: ProbeLevel): string {
  const l1Fields = `  "agentName": "string | null — nombre que usa el agente al presentarse",
  "hasPresentationMenu": "boolean | null",
  "menuType": "'numbered' | 'free-text' | 'hybrid' | 'none' | null",
  "toneProfile": "'formal' | 'informal' | 'neutral' | 'robotic' | 'empathetic' | null",
  "toneNotes": "string | null — descripción del tono con ejemplos del transcript",
  "usesEmoji": "boolean | null",
  "responseTimeP50Ms": "number | null — mediana de latencia estimada",
  "responseTimeP95Ms": "number | null — percentil 95 estimado",
  "hasProactiveReengage": "boolean | null — si re-contactó ante silencio",
  "reengageTimeMs": "number | null — en cuántos ms re-contactó",
  "languagesDetected": ["string — ej: 'es', 'en'"],
  "scores": {
    "[dimension_key]": { "score": "number 1-10", "justification": "string — cita del transcript" }
  },
  "bestTurnOrder": "number | null",
  "bestTurnText": "string | null",
  "bestTurnJustification": "string | null",
  "worstTurnOrder": "number | null",
  "worstTurnText": "string | null",
  "worstTurnJustification": "string | null",
  "keyStrengths": ["string — máximo 5, concretos"],
  "keyWeaknesses": ["string — máximo 5, concretos"],
  "uniqueCapabilities": ["string"],
  "thingsToReplicate": ["string"],
  "thingsToAvoid": ["string"],
  "executiveSummary": "string — 2-3 oraciones para ejecutivo no técnico"`;

  const l2Fields = `  "capabilityMap": { "[capability_name]": "boolean" },
  "canTakeActions": "boolean | null — puede hacer algo concreto (reservar, pedir) o solo informa",
  "hasRealtimeLookup": "boolean | null — evidencia de consulta a sistema externo en tiempo real",
  "dataFreshness": "'realtime' | 'cached' | 'static' | 'hallucinated' | 'mixed' | null",
  "capabilityNotes": "string | null"`;

  const l3Fields = `  "estimatedLlm": "string | null — 'GPT-4' | 'Claude 3.x' | 'Gemini' | 'custom/fine-tuned' | 'unknown'",
  "llmConfidence": "number | null — 1 a 10",
  "llmEvidenceNotes": "string | null — qué en el transcript llevó a esta conclusión",
  "hasRag": "boolean | null",
  "ragDomainScope": "string | null — qué tipo de datos parece tener en el RAG",
  "hasFunctionCalling": "boolean | null — evidencia de tool calls reales",
  "detectedTools": ["string — herramientas evidenciadas"],
  "hasCrossSessionMemory": "boolean | null",
  "systemPromptHints": "string | null",
  "promptStructureNotes": "string | null"`;

  const l4Fields = `  "promptInjectionResistance": "number | null — 1 (muy vulnerable) a 10 (muy resistente)",
  "handlesOffensiveInput": "'blocks' | 'ignores' | 'escalates' | 'matches_tone' | 'fails' | null",
  "competitorMentionPolicy": "'avoids' | 'neutral' | 'promotes_self' | 'no_policy' | null",
  "consistencyScore": "number | null — 1 a 10",
  "hallucinationRate": "'none' | 'low' | 'medium' | 'high' | null",
  "adversarialNotes": "string | null"`;

  const l5Fields = `  "changesFromPrevious": "string | null — qué cambió respecto al análisis anterior",
  "significantChanges": "boolean",
  "improvements": ["string"],
  "regressions": ["string"]`;

  const fieldsByLevel: Record<ProbeLevel, string[]> = {
    L1_SURFACE: [l1Fields],
    L2_CAPABILITIES: [l1Fields, l2Fields],
    L3_ARCHITECTURE: [l1Fields, l2Fields, l3Fields],
    L4_ADVERSARIAL: [l1Fields, l2Fields, l3Fields, l4Fields],
    L5_LONGITUDINAL: [l5Fields],
  };

  return `{\n${fieldsByLevel[level].join(',\n')}\n}`;
}

// ─── Rubric formatter ────────────────────────────────────────────────────────

function formatScoringRubric(rubric: ScoringRubric): string {
  return rubric.dimensions
    .map((d) => `- **${d.label}** (clave: \`${d.key}\`, peso: ${d.weight}): score 1-10`)
    .join('\n');
}

// ─── Main builder ────────────────────────────────────────────────────────────

/**
 * Builds the system and user prompts for the Analysis Engine LLM call.
 *
 * Pure function — no network, no state. The orchestrator (`analyzer.ts`)
 * calls this, sends the result to the LLM, then passes the raw response
 * to `parseAnalysisResponse`.
 */
export function buildAnalysisPrompt(input: AnalysisPromptInput): AnalysisPrompt {
  const { turns, vertical, level, target, script, previousAnalysis } = input;

  // ── System ──────────────────────────────────────────────────────────────
  const system = [
    'Eres un experto en ingeniería inversa de agentes IA de atención al cliente.',
    'Tu tarea es analizar conversaciones de WhatsApp con agentes IA de empresas',
    'y extraer inteligencia estructurada sobre su arquitectura, capacidades y calidad.',
    '',
    'Debes responder ÚNICAMENTE con un JSON válido siguiendo el schema proporcionado.',
    'No agregues texto, markdown, ni explicaciones fuera del JSON.',
    'Si no podés determinar un campo con confianza, usá null.',
    '',
    '## Instrucciones específicas para la vertical',
    '',
    vertical.analysisInstructions,
  ].join('\n');

  // ── User ────────────────────────────────────────────────────────────────
  const parts: string[] = [];

  // Context header
  parts.push('# Conversación a analizar');
  parts.push('');

  if (target !== undefined) {
    parts.push(`**Target**: ${target.name}${target.company !== null ? ` (${target.company})` : ''}`);
    parts.push(`**País**: ${target.country}`);
  }

  parts.push(`**Vertical**: ${vertical.name}`);

  if (script !== undefined) {
    parts.push(`**Script ejecutado**: ${script.name} (${LEVEL_DISPLAY[level]})`);
    parts.push(`**Objetivo del script**: ${script.objective}`);
  } else {
    parts.push(`**Nivel de análisis**: ${LEVEL_DISPLAY[level]}`);
  }

  parts.push('');

  // Transcript
  parts.push('## Transcript');
  parts.push('');
  parts.push(formatTranscript(turns));
  parts.push('');

  // Timing metrics
  const timing = computeTimingMetrics(turns);
  parts.push('## Métricas de timing');
  parts.push('');
  parts.push(`- Latencia promedio de respuesta: ${timing.avgMs !== null ? `${timing.avgMs}ms` : 'N/D'}`);
  parts.push(`- Latencia máxima: ${timing.maxMs !== null ? `${timing.maxMs}ms` : 'N/D'}`);
  parts.push(`- Latencia mínima: ${timing.minMs !== null ? `${timing.minMs}ms` : 'N/D'}`);
  parts.push(`- Timeouts: ${timing.timeoutCount} de ${timing.totalInbound} turns inbound`);
  parts.push('');

  // Architecture context for L3+
  if (
    level === 'L3_ARCHITECTURE' ||
    level === 'L4_ADVERSARIAL' ||
    level === 'L5_LONGITUDINAL'
  ) {
    parts.push('## Contexto adicional para análisis de arquitectura');
    parts.push('');
    parts.push('El script fue diseñado para detectar:');
    parts.push('- Uso de RAG vs. respuestas estáticas');
    parts.push('- Presencia de tool calling (picos de latencia > 3s sin escritura)');
    parts.push('- Capacidad de memoria cross-session');
    parts.push('- Posible LLM subyacente (patrones de razonamiento, errores típicos)');
    parts.push('');
  }

  // Previous analysis diff for L5
  if (level === 'L5_LONGITUDINAL' && previousAnalysis !== undefined) {
    parts.push('## Análisis previo (base para comparación)');
    parts.push('');
    parts.push(`**Fecha**: ${previousAnalysis.analyzedAt.toISOString().slice(0, 10)}`);
    parts.push(`**LLM estimado**: ${previousAnalysis.estimatedLlm ?? 'desconocido'}`);
    parts.push(`**RAG detectado**: ${previousAnalysis.hasRag !== null ? (previousAnalysis.hasRag ? 'sí' : 'no') : 'N/D'}`);
    parts.push(`**Score total**: ${previousAnalysis.scoreTotal !== null ? previousAnalysis.scoreTotal.toFixed(1) : 'N/D'}`);
    parts.push(`**Fortalezas**: ${previousAnalysis.keyStrengths.join(', ') || 'ninguna registrada'}`);
    parts.push(`**Debilidades**: ${previousAnalysis.keyWeaknesses.join(', ') || 'ninguna registrada'}`);
    parts.push('');
    parts.push('Identifica qué cambió desde ese análisis. El objetivo no es re-analizar todo,');
    parts.push('sino detectar evoluciones, mejoras o regresiones específicas.');
    parts.push('');
  } else if (level === 'L5_LONGITUDINAL' && previousAnalysis === undefined) {
    parts.push('## Nota');
    parts.push('');
    parts.push('No hay análisis previo disponible para comparación.');
    parts.push('Completá `changesFromPrevious` con "Sin referencia previa" y `significantChanges` con false.');
    parts.push('');
  }

  // JSON schema
  parts.push('## Schema de respuesta requerido');
  parts.push('');
  parts.push(
    'Responde con exactamente este JSON. Completá los campos según el nivel del script.',
    'Los campos de otros niveles deben omitirse o ser null.',
  );
  parts.push('');
  parts.push('```json');
  parts.push(buildJsonSchemaSection(level));
  parts.push('```');
  parts.push('');

  // Scoring rubric (not for L5 since scores aren't re-computed)
  if (level !== 'L5_LONGITUDINAL') {
    parts.push(`## Rúbrica de scoring para ${vertical.name}`);
    parts.push('');
    parts.push(formatScoringRubric(vertical.scoringRubric));
    parts.push('');
    parts.push(
      'Asigna un score del 1 al 10 para cada dimensión basándote en evidencia concreta del transcript.',
      'Justifica cada score en el campo "justification" con una cita o parafraseo del transcript.',
    );
  }

  return { system, user: parts.join('\n') };
}
