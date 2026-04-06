/**
 * Sandbox Session — Holds ephemeral state for an OpenClaw optimization session.
 *
 * Manages prompt overrides, LLM config overrides, tool allowlist overrides,
 * and replay/comparison state. All overrides are session-local and never
 * affect production until explicit promotion.
 */
import type { AgentConfig as CoreAgentConfig, ProjectId, PromptLayerId, SessionId, TraceId } from '@/core/types.js';
import type { AgentConfig as AgentRecord } from '@/agents/types.js';
import type { Message, LLMProvider } from '@/providers/types.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { MemoryManager } from '@/memory/memory-manager.js';
import type { CostGuard } from '@/cost/cost-guard.js';
import type { PromptLayer, PromptLayerType, ResolvedPromptLayers } from '@/prompts/types.js';
import type { ExecutionTrace, PromptSnapshot } from '@/core/types.js';
import type { RunMetrics, MetricsDiff } from './sandbox-events.js';
import { createProvider } from '@/providers/factory.js';
import { createMemoryManager } from '@/memory/memory-manager.js';
import type { CompactionSummarizer } from '@/memory/memory-manager.js';
import { createCostGuard } from '@/cost/cost-guard.js';
import { createPrismaUsageStore } from '@/cost/prisma-usage-store.js';
import { buildPrompt, createPromptSnapshot, computeHash } from '@/prompts/index.js';
import { validateUserInput } from '@/security/input-sanitizer.js';
import { extractAssistantResponse, extractToolCalls } from '../routes/chat-setup.js';
import type { RouteDependencies } from '../types.js';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'sandbox-session' });

// ─── Config Change Log ──────────────────────────────────────────

/** A recorded config change within the sandbox session. */
export interface ConfigChangeEntry {
  readonly changeType: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: string;
}

// ─── Sandbox State ──────────────────────────────────────────────

/** The full mutable state of a sandbox session. */
export interface SandboxState {
  readonly sandboxId: string;
  readonly agentId: string;
  readonly projectId: string;
  readonly testMode: boolean;

  /** Production baseline agent record (loaded at sandbox_start). */
  baselineAgent: AgentRecord;
  /** Production baseline prompt layers. */
  baselineLayers: ResolvedPromptLayers;
  /** Production baseline core agent config (as built by chat-setup). */
  baselineCoreConfig: CoreAgentConfig;

  /** Prompt content overrides (session-local). */
  promptOverrides: Partial<Record<PromptLayerType, string>>;
  /** LLM config overrides (session-local). */
  llmConfigOverrides: {
    provider?: 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter';
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
  /** Tool allowlist override (null = use baseline). */
  toolAllowlistOverride: string[] | null;

  /** Conversation messages in this sandbox session. */
  messages: Array<{ role: string; content: string; traceId?: string; timestamp: string }>;
  /** Last input for replay. */
  lastInput: { message: string; mediaUrls?: string[] } | null;
  /** Last run metrics for comparison. */
  lastMetrics: RunMetrics | null;

  /** Audit log of config changes. */
  configChanges: ConfigChangeEntry[];

  /** Session ID for the sandbox conversation. */
  sessionId: SessionId;
}

// ─── Sandbox Run Result ─────────────────────────────────────────

/** Everything needed to run the agent loop in the sandbox. */
export interface SandboxRunSetup {
  readonly sanitizedMessage: string;
  readonly agentConfig: CoreAgentConfig;
  readonly sessionId: SessionId;
  readonly systemPrompt: string;
  readonly promptSnapshot: PromptSnapshot;
  readonly conversationHistory: Message[];
  readonly provider: LLMProvider;
  readonly fallbackProvider?: LLMProvider;
  readonly memoryManager: MemoryManager;
  readonly costGuard: CostGuard;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build effective prompt layers by merging baseline with sandbox overrides.
 */
export function getEffectiveLayers(state: SandboxState): ResolvedPromptLayers {
  const makeOverride = (type: PromptLayerType, baseline: PromptLayer): PromptLayer => {
    const override = state.promptOverrides[type];
    if (!override) return baseline;
    return {
      ...baseline,
      content: override,
      id: `sandbox:${state.sandboxId}:${type}` as PromptLayerId,
      version: baseline.version + 1000, // clearly sandbox version
    };
  };

  return {
    identity: makeOverride('identity', state.baselineLayers.identity),
    instructions: makeOverride('instructions', state.baselineLayers.instructions),
    safety: makeOverride('safety', state.baselineLayers.safety),
  };
}

/**
 * Build effective agent config by merging baseline with sandbox overrides.
 */
export function getEffectiveConfig(state: SandboxState): CoreAgentConfig {
  const config = { ...state.baselineCoreConfig };

  if (state.llmConfigOverrides.provider) {
    config.provider = { ...config.provider, provider: state.llmConfigOverrides.provider };
  }
  if (state.llmConfigOverrides.model) {
    config.provider = { ...config.provider, model: state.llmConfigOverrides.model };
  }
  if (state.llmConfigOverrides.temperature !== undefined) {
    config.provider = { ...config.provider, temperature: state.llmConfigOverrides.temperature };
  }
  if (state.llmConfigOverrides.maxOutputTokens !== undefined) {
    config.provider = { ...config.provider, maxOutputTokens: state.llmConfigOverrides.maxOutputTokens };
  }

  if (state.toolAllowlistOverride) {
    config.allowedTools = state.toolAllowlistOverride;
  }

  return config;
}

/**
 * Create a dry-run proxy ToolRegistry that redirects resolve() to resolveDryRun().
 */
export function createDryRunToolRegistry(base: ToolRegistry): ToolRegistry {
  return {
    register: base.register.bind(base),
    unregister: base.unregister.bind(base),
    get: base.get.bind(base),
    has: base.has.bind(base),
    listAll: base.listAll.bind(base),
    listForContext: base.listForContext.bind(base),
    formatForProvider: base.formatForProvider.bind(base),
    resolve: (toolId, input, context) => base.resolveDryRun(toolId, input, context),
    resolveDryRun: base.resolveDryRun.bind(base),
  };
}

/**
 * Prepare all dependencies for a sandbox agent run.
 *
 * Similar to prepareChatRun() but uses sandbox overrides instead of DB lookups.
 */
export async function prepareSandboxRun(
  state: SandboxState,
  message: string,
  deps: Pick<RouteDependencies, 'toolRegistry' | 'mcpManager' | 'longTermMemoryStore' | 'prisma' | 'logger'>,
): Promise<SandboxRunSetup> {
  // 1. Sanitize message
  const sanitized = validateUserInput(message);

  // 2. Build effective config and layers
  const agentConfig = getEffectiveConfig(state);
  const layers = getEffectiveLayers(state);

  // 3. Build conversation history from sandbox messages
  const conversationHistory: Message[] = state.messages.map((m) => ({
    role: m.role as Message['role'],
    content: m.content,
  }));

  // 4. Create provider
  const provider = createProvider(agentConfig.provider);
  const fallbackProvider = agentConfig.fallbackProvider
    ? createProvider(agentConfig.fallbackProvider)
    : undefined;

  // 5. Create memory manager
  const longTermStore = agentConfig.memoryConfig.longTerm.enabled
    ? deps.longTermMemoryStore ?? undefined
    : undefined;

  const compactionSummarizer: CompactionSummarizer = async (messages) => {
    const summaryMessages: Message[] = [
      ...messages,
      {
        role: 'user' as const,
        content: 'Summarize this conversation concisely. Preserve key facts, decisions, action items, and context needed for continuity. Return only the summary.',
      },
    ];
    let text = '';
    for await (const event of provider.chat({
      messages: summaryMessages,
      maxTokens: 2000,
      temperature: 0.3,
    })) {
      if (event.type === 'content_delta') text += event.text;
    }
    return text;
  };

  const memoryManager = createMemoryManager({
    memoryConfig: agentConfig.memoryConfig,
    contextWindowSize: 200_000,
    tokenCounter: (msgs) => {
      let total = 0;
      for (const msg of msgs) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
        total += Math.ceil(content.length / 4);
      }
      return Promise.resolve(total);
    },
    compactionSummarizer,
    longTermStore,
  });

  // 6. Create cost guard
  const costGuard = createCostGuard({
    costConfig: agentConfig.costConfig,
    usageStore: createPrismaUsageStore(deps.prisma),
  });

  // 7. Build tool descriptions
  const executionContext = {
    projectId: agentConfig.projectId,
    sessionId: state.sessionId,
    traceId: 'sandbox' as TraceId,
    agentConfig,
    permissions: { allowedTools: new Set(agentConfig.allowedTools) },
    abortSignal: new AbortController().signal,
  };
  const toolDescriptions = deps.toolRegistry
    .formatForProvider(executionContext)
    .map((t) => ({ name: t.name, description: t.description }));

  // 8. Retrieve long-term memories
  const retrievedMemories = await memoryManager.retrieveMemories({
    query: sanitized.sanitized,
    topK: agentConfig.memoryConfig.longTerm.retrievalTopK,
    projectId: agentConfig.projectId,
  });

  // 9. Build system prompt
  const systemPrompt = buildPrompt({
    identity: layers.identity,
    instructions: layers.instructions,
    safety: layers.safety,
    toolDescriptions,
    retrievedMemories: retrievedMemories.map((m) => ({
      content: m.content,
      category: m.category,
    })),
  });

  // 10. Create prompt snapshot
  const toolDocsSection = toolDescriptions
    .map((t) => `${t.name}: ${t.description}`)
    .join('\n');
  const memorySection = retrievedMemories.map((m) => m.content).join('\n');
  const promptSnapshot = createPromptSnapshot(
    layers,
    computeHash(toolDocsSection),
    computeHash(memorySection),
  );

  return {
    sanitizedMessage: sanitized.sanitized,
    agentConfig,
    sessionId: state.sessionId,
    systemPrompt,
    promptSnapshot,
    conversationHistory,
    provider,
    fallbackProvider,
    memoryManager,
    costGuard,
  };
}

/**
 * Extract RunMetrics from an ExecutionTrace.
 */
export function extractRunMetrics(trace: ExecutionTrace): RunMetrics {
  const response = extractAssistantResponse(trace.events);
  const toolCalls = extractToolCalls(trace.events);

  return {
    traceId: trace.id,
    totalTokens: trace.totalTokensUsed,
    costUSD: trace.totalCostUSD,
    responseLength: response.length,
    toolCallCount: toolCalls.length,
    durationMs: trace.totalDurationMs,
    response,
  };
}

/**
 * Compute the diff between two run metrics.
 */
export function computeMetricsDiff(before: RunMetrics, after: RunMetrics): MetricsDiff {
  const pctChange = (a: number, b: number): number =>
    a === 0 ? (b === 0 ? 0 : 100) : ((b - a) / a) * 100;

  return {
    tokensDelta: after.totalTokens - before.totalTokens,
    costDelta: after.costUSD - before.costUSD,
    responseLengthDelta: after.responseLength - before.responseLength,
    toolCallCountDelta: after.toolCallCount - before.toolCallCount,
    durationDelta: after.durationMs - before.durationMs,
    costPctChange: Math.round(pctChange(before.costUSD, after.costUSD) * 100) / 100,
    tokensPctChange: Math.round(pctChange(before.totalTokens, after.totalTokens) * 100) / 100,
  };
}

/**
 * Create a new SandboxState from an agent record and resolved layers.
 */
export function createSandboxState(opts: {
  agentId: string;
  projectId: string;
  testMode: boolean;
  agent: AgentRecord;
  layers: ResolvedPromptLayers;
  coreConfig: CoreAgentConfig;
  sessionId: SessionId;
}): SandboxState {
  return {
    sandboxId: randomUUID(),
    agentId: opts.agentId,
    projectId: opts.projectId,
    testMode: opts.testMode,
    baselineAgent: opts.agent,
    baselineLayers: opts.layers,
    baselineCoreConfig: opts.coreConfig,
    promptOverrides: {},
    llmConfigOverrides: {},
    toolAllowlistOverride: null,
    messages: [],
    lastInput: null,
    lastMetrics: null,
    configChanges: [],
    sessionId: opts.sessionId,
  };
}
