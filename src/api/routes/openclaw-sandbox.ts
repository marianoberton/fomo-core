/**
 * OpenClaw Sandbox WebSocket Route — Bidirectional agent optimization.
 *
 * A stateful WebSocket session where OpenClaw Manager can:
 * 1. Talk to an agent and observe full tool/prompt/cost details
 * 2. Hot-swap prompts, model, tools for this session only
 * 3. Replay messages and compare before/after metrics
 * 4. Promote winning configs to production
 *
 * Endpoint: GET /api/v1/openclaw/sandbox (WebSocket upgrade)
 * Auth: X-OpenClaw-Key header on upgrade request.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { resolveOpenClawScope, assertProjectAccess } from '../openclaw-auth.js';
import type { OpenClawScope } from '../openclaw-auth.js';
import type { AgentId } from '@/agents/types.js';
import type { ProjectId, SessionId, PromptLayerId } from '@/core/types.js';
import type { AgentStreamEvent } from '@/core/stream-events.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import { resolveActiveLayers } from '@/prompts/index.js';
import { sandboxClientMessage } from '../sandbox/sandbox-schemas.js';
import type { SandboxStreamEvent } from '../sandbox/sandbox-events.js';
import {
  createSandboxState,
  prepareSandboxRun,
  getEffectiveLayers,
  getEffectiveConfig,
  createDryRunToolRegistry,
  extractRunMetrics,
  computeMetricsDiff,
} from '../sandbox/sandbox-session.js';
import type { SandboxState } from '../sandbox/sandbox-session.js';
import { extractAssistantResponse, extractToolCalls } from './chat-setup.js';
import { createLogger } from '@/observability/logger.js';

const log = createLogger({ name: 'openclaw-sandbox' });

// ─── Types ──────────────────────────────────────────────────────

/** Dependencies for the sandbox route. */
export interface OpenClawSandboxDeps extends RouteDependencies {
  /** Optional fallback key for backward compat (OPENCLAW_INTERNAL_KEY). */
  openclawInternalKey?: string;
}

/** Minimal WebSocket interface. */
interface SandboxSocket {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

// ─── Route Registration ─────────────────────────────────────────

/**
 * Register the OpenClaw sandbox WebSocket route.
 */
export function openclawSandboxRoutes(
  fastify: FastifyInstance,
  deps: OpenClawSandboxDeps,
): void {
  fastify.get(
    '/openclaw/sandbox',
    { websocket: true },
    (socket, request: FastifyRequest) => {
      // Auth: Bearer token (already validated by middleware) or X-OpenClaw-Key fallback
      const scope = resolveOpenClawScope(request, deps.openclawInternalKey);
      if (!scope) {
        log.warn('Sandbox: unauthorized WebSocket upgrade', { component: 'openclaw-sandbox', ip: request.ip });
        (socket as unknown as SandboxSocket).send(JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        }));
        return;
      }

      setupSandboxSocket(socket as unknown as SandboxSocket, deps, scope);
    },
  );
}

// ─── Socket Handler ─────────────────────────────────────────────

/**
 * Set up event handlers on a sandbox WebSocket connection.
 */
function setupSandboxSocket(socket: SandboxSocket, deps: OpenClawSandboxDeps, scope: OpenClawScope): void {
  let state: SandboxState | null = null;
  let running = false;

  const send = (event: SandboxStreamEvent): void => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(event));
    }
  };

  const sendError = (code: string, message: string): void => {
    send({ type: 'error', code, message });
  };

  socket.on('message', (data: Buffer) => {
    let parsed: ReturnType<typeof sandboxClientMessage.safeParse>;
    try {
      const text = data.toString('utf-8');
      const json: unknown = JSON.parse(text);
      parsed = sandboxClientMessage.safeParse(json);
    } catch {
      sendError('PARSE_ERROR', 'Invalid JSON');
      return;
    }

    if (!parsed.success) {
      sendError('VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }

    const msg = parsed.data;

    // Dispatch by message type
    switch (msg.type) {
      case 'sandbox_start':
        // Enforce project access
        try {
          assertProjectAccess(scope, msg.projectId);
        } catch {
          sendError('FORBIDDEN', `API key cannot access project "${msg.projectId}"`);
          break;
        }
        void handleStart(msg, deps, send, sendError).then((s) => {
          if (s) state = s;
        });
        break;

      case 'send_message':
        if (!state) { sendError('NOT_INITIALIZED', 'Send sandbox_start first'); break; }
        if (running) { send({ type: 'message_queued', position: 1 }); break; }
        running = true;
        void handleSendMessage(state, msg.message, msg.mediaUrls, deps, send, sendError)
          .finally(() => { running = false; });
        break;

      case 'update_prompt':
        if (!state) { sendError('NOT_INITIALIZED', 'Send sandbox_start first'); break; }
        handleUpdatePrompt(state, msg.layerType, msg.content, send);
        break;

      case 'update_config':
        if (!state) { sendError('NOT_INITIALIZED', 'Send sandbox_start first'); break; }
        handleUpdateConfig(state, msg, send);
        break;

      case 'replay_message':
        if (!state) { sendError('NOT_INITIALIZED', 'Send sandbox_start first'); break; }
        if (!state.lastInput) { sendError('NO_PREVIOUS_MESSAGE', 'No message to replay'); break; }
        if (running) { send({ type: 'message_queued', position: 1 }); break; }
        running = true;
        void handleReplay(state, deps, send, sendError)
          .finally(() => { running = false; });
        break;

      case 'get_history':
        if (!state) { sendError('NOT_INITIALIZED', 'Send sandbox_start first'); break; }
        send({
          type: 'sandbox_history',
          messages: state.messages,
          configChanges: state.configChanges,
        });
        break;

      case 'promote_config':
        if (!state) { sendError('NOT_INITIALIZED', 'Send sandbox_start first'); break; }
        void handlePromote(state, msg.what, msg.changeReason, deps, send, sendError);
        break;

      case 'reset':
        if (!state) { sendError('NOT_INITIALIZED', 'Send sandbox_start first'); break; }
        void handleReset(state, deps, send, sendError).then((s) => {
          if (s) state = s;
        });
        break;
    }
  });

  socket.on('error', (err: Error) => {
    log.error('Sandbox WebSocket error', { component: 'openclaw-sandbox', error: err.message });
  });

  socket.on('close', () => {
    log.debug('Sandbox session closed', {
      component: 'openclaw-sandbox',
      sandboxId: state?.sandboxId,
    });
    state = null;
  });
}

// ─── Message Handlers ───────────────────────────────────────────

async function handleStart(
  msg: { agentId: string; projectId: string; testMode: boolean },
  deps: OpenClawSandboxDeps,
  send: (event: SandboxStreamEvent) => void,
  sendError: (code: string, message: string) => void,
): Promise<SandboxState | null> {
  // Load agent
  const agent = await deps.agentRegistry.get(msg.agentId as AgentId);
  if (!agent) {
    sendError('NOT_FOUND', `Agent "${msg.agentId}" not found`);
    return null;
  }

  // Load project
  const project = await deps.projectRepository.findById(msg.projectId as ProjectId);
  if (!project) {
    sendError('NOT_FOUND', `Project "${msg.projectId}" not found`);
    return null;
  }

  // Resolve prompt layers
  let layers: import('@/prompts/types.js').ResolvedPromptLayers;
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
      identity: { ...syntheticBase, id: `${msg.agentId}:identity` as PromptLayerId, layerType: 'identity' as const, content: agent.promptConfig.identity },
      instructions: { ...syntheticBase, id: `${msg.agentId}:instructions` as PromptLayerId, layerType: 'instructions' as const, content: agent.promptConfig.instructions },
      safety: { ...syntheticBase, id: `${msg.agentId}:safety` as PromptLayerId, layerType: 'safety' as const, content: agent.promptConfig.safety },
    };
  } else {
    const layersResult = await resolveActiveLayers(project.id, deps.promptLayerRepository);
    if (!layersResult.ok) {
      sendError('NO_ACTIVE_PROMPT', layersResult.error.message);
      return null;
    }
    layers = layersResult.value;
  }

  // Build baseline core config (simplified from chat-setup)
  const DEFAULT_CONFIG = {
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

  const coreConfig = { ...DEFAULT_CONFIG, ...project.config, projectId: project.id } as CoreAgentConfig;

  // Apply agent LLM overrides
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

  // Create session for sandbox
  const session = await deps.sessionRepository.create({
    projectId: project.id,
    metadata: { _sandbox: true },
  });

  const state = createSandboxState({
    agentId: msg.agentId,
    projectId: msg.projectId,
    testMode: msg.testMode,
    agent,
    layers,
    coreConfig,
    sessionId: session.id,
  });

  log.info('Sandbox session started', {
    component: 'openclaw-sandbox',
    sandboxId: state.sandboxId,
    agentId: msg.agentId,
    testMode: msg.testMode,
  });

  send({
    type: 'sandbox_ready',
    sandboxId: state.sandboxId,
    agentId: agent.id,
    agentName: agent.name,
    promptLayers: {
      identity: { content: layers.identity.content, version: layers.identity.version },
      instructions: { content: layers.instructions.content, version: layers.instructions.version },
      safety: { content: layers.safety.content, version: layers.safety.version },
    },
    llmConfig: {
      provider: coreConfig.provider?.provider,
      model: coreConfig.provider?.model,
      temperature: coreConfig.provider?.temperature,
    },
    availableTools: coreConfig.allowedTools,
    testMode: msg.testMode,
  });

  return state;
}

async function handleSendMessage(
  state: SandboxState,
  message: string,
  mediaUrls: string[] | undefined,
  deps: OpenClawSandboxDeps,
  send: (event: SandboxStreamEvent) => void,
  sendError: (code: string, message: string) => void,
): Promise<void> {
  try {
    const setup = await prepareSandboxRun(state, message, deps);

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
      mediaUrls,
      onEvent: (event: AgentStreamEvent) => { send(event); },
    });

    if (!result.ok) {
      sendError('EXECUTION_FAILED', result.error.message);
      return;
    }

    const trace = result.value;

    // Persist trace
    await deps.executionTraceRepository.save(trace);

    // Record in sandbox state
    const assistantText = extractAssistantResponse(trace.events);
    const now = new Date().toISOString();

    state.messages.push({ role: 'user', content: message, traceId: trace.id, timestamp: now });
    state.messages.push({ role: 'assistant', content: assistantText, traceId: trace.id, timestamp: now });

    const metrics = extractRunMetrics(trace);
    state.lastInput = { message, mediaUrls };
    state.lastMetrics = metrics;

    log.info('Sandbox message processed', {
      component: 'openclaw-sandbox',
      sandboxId: state.sandboxId,
      traceId: trace.id,
      tokens: metrics.totalTokens,
      costUSD: metrics.costUSD,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    sendError('INTERNAL_ERROR', msg);
  }
}

function handleUpdatePrompt(
  state: SandboxState,
  layerType: 'identity' | 'instructions' | 'safety',
  content: string,
  send: (event: SandboxStreamEvent) => void,
): void {
  state.promptOverrides[layerType] = content;
  state.configChanges.push({
    changeType: 'prompt_override',
    details: { layerType, contentLength: content.length },
    timestamp: new Date().toISOString(),
  });

  send({ type: 'prompt_updated', layerType, contentLength: content.length });

  log.info('Sandbox prompt updated', {
    component: 'openclaw-sandbox',
    sandboxId: state.sandboxId,
    layerType,
  });
}

function handleUpdateConfig(
  state: SandboxState,
  msg: { llmConfig?: { provider?: 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter'; model?: string; temperature?: number; maxOutputTokens?: number }; toolAllowlist?: string[] },
  send: (event: SandboxStreamEvent) => void,
): void {
  const changes: Record<string, unknown> = {};

  if (msg.llmConfig) {
    Object.assign(state.llmConfigOverrides, msg.llmConfig);
    changes['llmConfig'] = msg.llmConfig;
  }

  if (msg.toolAllowlist) {
    state.toolAllowlistOverride = msg.toolAllowlist;
    changes['toolAllowlist'] = msg.toolAllowlist;
  }

  state.configChanges.push({
    changeType: 'config_override',
    details: changes,
    timestamp: new Date().toISOString(),
  });

  send({ type: 'config_updated', changes });

  log.info('Sandbox config updated', {
    component: 'openclaw-sandbox',
    sandboxId: state.sandboxId,
    changes: Object.keys(changes),
  });
}

async function handleReplay(
  state: SandboxState,
  deps: OpenClawSandboxDeps,
  send: (event: SandboxStreamEvent) => void,
  sendError: (code: string, message: string) => void,
): Promise<void> {
  if (!state.lastInput || !state.lastMetrics) {
    sendError('NO_PREVIOUS_MESSAGE', 'No message to replay');
    return;
  }

  const beforeMetrics = state.lastMetrics;

  // Re-run with current config
  await handleSendMessage(state, state.lastInput.message, state.lastInput.mediaUrls, deps, send, sendError);

  // Compare
  if (state.lastMetrics && state.lastMetrics.traceId !== beforeMetrics.traceId) {
    const diff = computeMetricsDiff(beforeMetrics, state.lastMetrics);
    send({
      type: 'comparison',
      before: beforeMetrics,
      after: state.lastMetrics,
      diff,
    });
  }
}

async function handlePromote(
  state: SandboxState,
  what: string,
  changeReason: string | undefined,
  deps: OpenClawSandboxDeps,
  send: (event: SandboxStreamEvent) => void,
  sendError: (code: string, message: string) => void,
): Promise<void> {
  const changes: {
    promptLayersCreated?: string[];
    agentConfigUpdated?: boolean;
    toolAllowlistUpdated?: boolean;
  } = {};

  try {
    // Promote prompts
    if (what === 'prompts' || what === 'all') {
      const created: string[] = [];
      for (const layerType of ['identity', 'instructions', 'safety'] as const) {
        const override = state.promptOverrides[layerType];
        if (override) {
          const layer = await deps.promptLayerRepository.create({
            projectId: state.projectId as ProjectId,
            layerType,
            content: override,
            createdBy: 'openclaw-sandbox',
            changeReason: changeReason ?? `Promoted from sandbox ${state.sandboxId}`,
          });
          await deps.promptLayerRepository.activate(layer.id);
          created.push(`${layerType}:v${layer.version}`);
        }
      }
      if (created.length > 0) changes.promptLayersCreated = created;
    }

    // Promote LLM config
    if (what === 'llmConfig' || what === 'all') {
      const hasOverrides = Object.values(state.llmConfigOverrides).some((v) => v !== undefined);
      if (hasOverrides) {
        await deps.agentRepository.update(state.agentId as AgentId, {
          llmConfig: state.llmConfigOverrides,
        });
        deps.agentRegistry.invalidate(state.agentId as AgentId);
        changes.agentConfigUpdated = true;
      }
    }

    // Promote tools
    if (what === 'tools' || what === 'all') {
      if (state.toolAllowlistOverride) {
        await deps.agentRepository.update(state.agentId as AgentId, {
          toolAllowlist: state.toolAllowlistOverride,
        });
        deps.agentRegistry.invalidate(state.agentId as AgentId);
        changes.toolAllowlistUpdated = true;
      }
    }

    send({ type: 'promoted', what, changes });

    log.info('Sandbox config promoted', {
      component: 'openclaw-sandbox',
      sandboxId: state.sandboxId,
      what,
      changes,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    sendError('PROMOTION_FAILED', msg);
  }
}

async function handleReset(
  state: SandboxState,
  deps: OpenClawSandboxDeps,
  send: (event: SandboxStreamEvent) => void,
  sendError: (code: string, message: string) => void,
): Promise<SandboxState | null> {
  // Re-initialize with fresh production state
  const newState = await handleStart(
    { agentId: state.agentId, projectId: state.projectId, testMode: state.testMode },
    deps,
    send,
    sendError,
  );

  if (newState) {
    send({ type: 'sandbox_reset' });
  }

  return newState;
}

/** Import CoreAgentConfig type. */
type CoreAgentConfig = import('@/core/types.js').AgentConfig;
