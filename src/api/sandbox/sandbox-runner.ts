/**
 * Sandbox Runner — stateless, one-shot execution of an agent with optional overrides.
 *
 * Reuses the pure helpers in sandbox-session.ts (createSandboxState, prepareSandboxRun,
 * extractRunMetrics). The OpenClaw WS route uses it via buildSandboxBaseline() and
 * then maintains its own stateful SandboxState across messages. The fomo-admin agent
 * uses createSandboxRunner().run() for one-shot A/B tests without holding WS state.
 *
 * This file contains NO WebSocket code — it can be called from any route, tool, or
 * scheduled task that has access to RouteDependencies.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AgentConfig as AgentRecord, AgentId, AgentRegistry, AgentRepository } from '@/agents/types.js';
import type { AgentConfig as CoreAgentConfig, ProjectId, SessionId, PromptLayerId } from '@/core/types.js';
import type { PromptLayerType, ResolvedPromptLayers } from '@/prompts/types.js';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import type { PromptLayerRepository } from '@/infrastructure/repositories/prompt-layer-repository.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { ExecutionTraceRepository } from '@/infrastructure/repositories/execution-trace-repository.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { MCPManager } from '@/mcp/mcp-manager.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { Logger } from '@/observability/logger.js';
import type { PrismaClient } from '@prisma/client';
import type { AgentStreamEvent } from '@/core/stream-events.js';
import { resolveActiveLayers } from '@/prompts/index.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import {
  createSandboxState,
  prepareSandboxRun,
  createDryRunToolRegistry,
  extractRunMetrics,
} from './sandbox-session.js';
import type { SandboxState } from './sandbox-session.js';
import type { RunMetrics } from './sandbox-events.js';
import { createLogger } from '@/observability/logger.js';

const log = createLogger({ name: 'sandbox-runner' });

// ─── Types ──────────────────────────────────────────────────────

/** Dependencies required to build a sandbox baseline or run an agent. */
export interface SandboxRunnerDeps {
  agentRegistry: AgentRegistry;
  agentRepository: AgentRepository;
  projectRepository: ProjectRepository;
  promptLayerRepository: PromptLayerRepository;
  sessionRepository: SessionRepository;
  executionTraceRepository: ExecutionTraceRepository;
  toolRegistry: ToolRegistry;
  mcpManager: MCPManager;
  longTermMemoryStore: LongTermMemoryStore | null;
  prisma: PrismaClient;
  logger: Logger | FastifyBaseLogger;
}

/** The baseline artifacts for a sandbox session, loaded from production state. */
export interface SandboxBaseline {
  readonly agent: AgentRecord;
  readonly layers: ResolvedPromptLayers;
  readonly coreConfig: CoreAgentConfig;
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
}

/** Overrides applied to a single sandbox run. */
export interface SandboxRunOverrides {
  readonly promptOverrides?: Partial<Record<PromptLayerType, string>>;
  readonly llmConfigOverrides?: {
    provider?: 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter';
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
  readonly toolAllowlistOverride?: string[] | null;
}

/** A one-shot sandbox run request. */
export interface SandboxRunRequest {
  readonly agentId: AgentId;
  readonly projectId: ProjectId;
  readonly message: string;
  readonly mediaUrls?: string[];
  readonly overrides?: SandboxRunOverrides;
  /** When true, tool calls are executed via resolveDryRun() (no side effects). */
  readonly dryRunTools?: boolean;
  /** Optional per-event callback (streaming). */
  readonly onEvent?: (event: AgentStreamEvent) => void;
}

/** Result of a one-shot sandbox run. */
export interface SandboxRunResult {
  readonly traceId: string;
  readonly metrics: RunMetrics;
  readonly response: string;
  readonly sandboxId: string;
}

/** A sandbox runner — builds baselines and executes one-shot runs. */
export interface SandboxRunner {
  buildBaseline(args: { agentId: AgentId; projectId: ProjectId }): Promise<SandboxBaseline>;
  run(req: SandboxRunRequest): Promise<SandboxRunResult>;
}

// ─── Baseline Builder ───────────────────────────────────────────

/**
 * Load all production-state artifacts needed to seed a sandbox session.
 *
 * Extracted from the WS route's handleStart so admin tools and other callers
 * can reuse the same resolution (agent → project → layers → coreConfig → session).
 */
export async function buildSandboxBaseline(
  deps: SandboxRunnerDeps,
  args: { agentId: AgentId; projectId: ProjectId },
): Promise<SandboxBaseline> {
  const agent = await deps.agentRegistry.get(args.agentId);
  if (!agent) {
    throw new SandboxBaselineError('AGENT_NOT_FOUND', `Agent "${args.agentId}" not found`);
  }

  const project = await deps.projectRepository.findById(args.projectId);
  if (!project) {
    throw new SandboxBaselineError('PROJECT_NOT_FOUND', `Project "${args.projectId}" not found`);
  }

  // Resolve prompt layers: prefer agent-embedded prompts, fall back to project-level active layers
  let layers: ResolvedPromptLayers;
  if (agent.promptConfig.identity && agent.promptConfig.instructions && agent.promptConfig.safety) {
    const syntheticBase = {
      projectId: project.id,
      version: 1,
      isActive: true as const,
      createdAt: new Date(),
      createdBy: 'agent',
      changeReason: 'agent-prompt',
    };
    layers = {
      identity: { ...syntheticBase, id: `${args.agentId}:identity` as PromptLayerId, layerType: 'identity' as const, content: agent.promptConfig.identity },
      instructions: { ...syntheticBase, id: `${args.agentId}:instructions` as PromptLayerId, layerType: 'instructions' as const, content: agent.promptConfig.instructions },
      safety: { ...syntheticBase, id: `${args.agentId}:safety` as PromptLayerId, layerType: 'safety' as const, content: agent.promptConfig.safety },
    };
  } else {
    const layersResult = await resolveActiveLayers(project.id, deps.promptLayerRepository);
    if (!layersResult.ok) {
      throw new SandboxBaselineError('NO_ACTIVE_PROMPT', layersResult.error.message);
    }
    layers = layersResult.value;
  }

  // Build baseline core config (mirror of sandbox WS route — kept in sync intentionally)
  const DEFAULT_CORE_CONFIG = {
    allowedTools: [] as string[],
    mcpServers: [] as CoreAgentConfig['mcpServers'],
    maxTurnsPerSession: 10,
    maxConcurrentSessions: 5,
    failover: { maxRetries: 2, onTimeout: true, onRateLimit: true, onServerError: true, timeoutMs: 30_000 },
    memoryConfig: {
      longTerm: { enabled: false, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'openai', decayEnabled: false, decayHalfLifeDays: 30 },
      contextWindow: { reserveTokens: 2000, pruningStrategy: 'turn-based' as const, maxTurnsInContext: 20, compaction: { enabled: false, memoryFlushBeforeCompaction: false } },
    },
    costConfig: {
      dailyBudgetUSD: 10, monthlyBudgetUSD: 100, maxTokensPerTurn: 4096,
      maxTurnsPerSession: 50, maxToolCallsPerTurn: 10, alertThresholdPercent: 80,
      hardLimitPercent: 100, maxRequestsPerMinute: 60, maxRequestsPerHour: 1000,
    },
  };

  const coreConfig = { ...DEFAULT_CORE_CONFIG, ...project.config, projectId: project.id } as CoreAgentConfig;

  // Apply agent LLM overrides (agent-level config wins over project default)
  if (agent.llmConfig) {
    if (agent.llmConfig.provider) {
      coreConfig.provider = { ...coreConfig.provider, provider: agent.llmConfig.provider };
    }
    if (agent.llmConfig.model) {
      coreConfig.provider = { ...coreConfig.provider, model: agent.llmConfig.model };
    }
    if (agent.llmConfig.temperature !== undefined) {
      coreConfig.provider = { ...coreConfig.provider, temperature: agent.llmConfig.temperature };
    }
    if (agent.llmConfig.maxOutputTokens !== undefined) {
      coreConfig.provider = { ...coreConfig.provider, maxOutputTokens: agent.llmConfig.maxOutputTokens };
    }
  }

  if (agent.toolAllowlist.length > 0) {
    coreConfig.allowedTools = [...new Set([...coreConfig.allowedTools, ...agent.toolAllowlist])];
  }

  // Create a throwaway session tagged with _sandbox so it can be filtered out of analytics
  const session = await deps.sessionRepository.create({
    projectId: project.id,
    metadata: { _sandbox: true },
  });

  return {
    agent,
    layers,
    coreConfig,
    sessionId: session.id,
    projectId: project.id,
  };
}

// ─── One-Shot Runner ────────────────────────────────────────────

/**
 * Create a sandbox runner bound to a set of dependencies.
 *
 * Returns two methods:
 *   - buildBaseline: load production state for an agent/project pair
 *   - run: execute a single message against an agent with optional overrides
 *
 * Each run() call is independent: it creates a fresh SandboxState, runs once,
 * and returns metrics. Use it for stateless A/B comparisons from admin tools.
 */
export function createSandboxRunner(deps: SandboxRunnerDeps): SandboxRunner {
  async function run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    const baseline = await buildSandboxBaseline(deps, { agentId: req.agentId, projectId: req.projectId });

    const state = applyOverrides(
      createSandboxState({
        agentId: req.agentId,
        projectId: req.projectId,
        testMode: req.dryRunTools ?? false,
        agent: baseline.agent,
        layers: baseline.layers,
        coreConfig: baseline.coreConfig,
        sessionId: baseline.sessionId,
      }),
      req.overrides,
    );

    const setup = await prepareSandboxRun(state, req.message, deps);

    const effectiveRegistry = state.testMode
      ? createDryRunToolRegistry(deps.toolRegistry)
      : deps.toolRegistry;

    const agentRunner = createAgentRunner({
      provider: setup.provider,
      fallbackProvider: setup.fallbackProvider,
      toolRegistry: effectiveRegistry,
      memoryManager: setup.memoryManager,
      costGuard: setup.costGuard,
      logger: deps.logger,
    });

    const abortController = new AbortController();

    const result = await agentRunner.run({
      message: setup.sanitizedMessage,
      agentConfig: setup.agentConfig,
      sessionId: setup.sessionId,
      systemPrompt: setup.systemPrompt,
      promptSnapshot: setup.promptSnapshot,
      conversationHistory: setup.conversationHistory,
      abortSignal: abortController.signal,
      mediaUrls: req.mediaUrls,
      onEvent: req.onEvent,
    });

    if (!result.ok) {
      throw new SandboxRunnerError('EXECUTION_FAILED', result.error.message);
    }

    const trace = result.value;
    await deps.executionTraceRepository.save(trace);

    const metrics = extractRunMetrics(trace);

    log.info('Sandbox run completed', {
      component: 'sandbox-runner',
      agentId: req.agentId,
      projectId: req.projectId,
      sandboxId: state.sandboxId,
      traceId: trace.id,
      tokens: metrics.totalTokens,
      costUSD: metrics.costUSD,
      dryRunTools: req.dryRunTools ?? false,
    });

    return {
      traceId: trace.id,
      metrics,
      response: metrics.response,
      sandboxId: state.sandboxId,
    };
  }

  return {
    buildBaseline: (args) => buildSandboxBaseline(deps, args),
    run,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function applyOverrides(state: SandboxState, overrides: SandboxRunOverrides | undefined): SandboxState {
  if (!overrides) return state;

  if (overrides.promptOverrides) {
    for (const [k, v] of Object.entries(overrides.promptOverrides)) {
      if (v !== undefined) {
        state.promptOverrides[k as PromptLayerType] = v;
      }
    }
  }

  if (overrides.llmConfigOverrides) {
    Object.assign(state.llmConfigOverrides, overrides.llmConfigOverrides);
  }

  if (overrides.toolAllowlistOverride !== undefined) {
    state.toolAllowlistOverride = overrides.toolAllowlistOverride;
  }

  return state;
}

// ─── Errors ─────────────────────────────────────────────────────

/** Thrown when sandbox baseline cannot be built (missing agent/project/layers). */
export class SandboxBaselineError extends Error {
  constructor(public readonly code: 'AGENT_NOT_FOUND' | 'PROJECT_NOT_FOUND' | 'NO_ACTIVE_PROMPT', message: string) {
    super(message);
    this.name = 'SandboxBaselineError';
  }
}

/** Thrown when the agent run itself fails inside the sandbox. */
export class SandboxRunnerError extends Error {
  constructor(public readonly code: 'EXECUTION_FAILED', message: string) {
    super(message);
    this.name = 'SandboxRunnerError';
  }
}
