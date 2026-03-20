/**
 * Shared chat setup module.
 * Extracts the common request validation and dependency resolution logic
 * used before running the agent loop. Both the REST chat route and the
 * WebSocket streaming endpoint share this preparation step.
 */
import { z } from 'zod';
import type { ProjectId, SessionId, TraceId, AgentConfig, PromptSnapshot } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { Message, LLMProvider } from '@/providers/types.js';
import type { MemoryManager } from '@/memory/memory-manager.js';
import type { CostGuard } from '@/cost/cost-guard.js';
import { createProvider } from '@/providers/factory.js';
import { createMemoryManager } from '@/memory/memory-manager.js';
import type { CompactionSummarizer } from '@/memory/memory-manager.js';
import { createCostGuard } from '@/cost/cost-guard.js';
import { createPrismaUsageStore } from '@/cost/prisma-usage-store.js';
import { validateUserInput } from '@/security/input-sanitizer.js';
import {
  buildPrompt,
  resolveActiveLayers,
  createPromptSnapshot,
  computeHash,
} from '@/prompts/index.js';
import { resolveAgentMode } from '@/agents/mode-resolver.js';
import type { AgentPromptConfig } from '@/agents/types.js';
import type { RouteDependencies } from '../types.js';

// ─── Defaults ───────────────────────────────────────────────────

/**
 * Sensible defaults for projects created with a simplified config (config: {}).
 * These mirror the seed.ts defaults and ensure the agent loop never crashes
 * due to missing fields, regardless of how the project was created.
 * Agent-level llmConfig overrides are applied on top of these after loading.
 */
const DEFAULT_AGENT_CONFIG = {
  allowedTools: [] as string[],
  mcpServers: [] as AgentConfig['mcpServers'],
  maxTurnsPerSession: 10,
  maxConcurrentSessions: 5,
  failover: {
    maxRetries: 2,
    onTimeout: true,
    onRateLimit: true,
    onServerError: true,
    timeoutMs: 30_000,
  },
  memoryConfig: {
    longTerm: {
      enabled: false,
      maxEntries: 100,
      retrievalTopK: 5,
      embeddingProvider: 'openai',
      decayEnabled: false,
      decayHalfLifeDays: 30,
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based' as const,
      maxTurnsInContext: 20,
      compaction: {
        enabled: false,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 10,
    monthlyBudgetUSD: 100,
    maxTokensPerTurn: 4096,
    maxTurnsPerSession: 50,
    maxToolCallsPerTurn: 10,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 60,
    maxRequestsPerHour: 1000,
  },
} satisfies Partial<AgentConfig>;

// ─── Zod Schema ─────────────────────────────────────────────────

/** Zod schema for chat request body validation. */
export const chatRequestSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  sourceChannel: z.string().min(1).optional(),
  contactRole: z.string().min(1).optional(),
  message: z.string().max(100_000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Inferred type from the chat request schema. */
export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

// ─── Result Types ───────────────────────────────────────────────

/** All resolved objects needed to run the agent loop. */
export interface ChatSetupResult {
  /** The sanitized user message, safe for the agent context. */
  sanitizedMessage: string;
  /** The project's agent configuration. */
  agentConfig: AgentConfig;
  /** The session ID (existing or newly created). */
  sessionId: SessionId;
  /** The pre-built system prompt assembled from prompt layers. */
  systemPrompt: string;
  /** Snapshot of which prompt layer versions were used. */
  promptSnapshot: PromptSnapshot;
  /** Prior messages in this session. */
  conversationHistory: Message[];
  /** The resolved LLM provider instance. */
  provider: LLMProvider;
  /** Fallback LLM provider for failover (optional). */
  fallbackProvider?: LLMProvider;
  /** Per-request memory manager. */
  memoryManager: MemoryManager;
  /** Per-request cost guard. */
  costGuard: CostGuard;
  /** If set, the welcome message was just injected — return this directly without running LLM. */
  welcomeMessageResponse?: string;
}

/** Structured error returned when chat setup fails. */
export interface ChatSetupError {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** HTTP status code to return to the client. */
  statusCode: number;
}

// ─── Dependencies ───────────────────────────────────────────────

/** Subset of RouteDependencies required by prepareChatRun. */
type ChatSetupDeps = Pick<
  RouteDependencies,
  'projectRepository' | 'sessionRepository' | 'promptLayerRepository' | 'toolRegistry' | 'mcpManager' | 'longTermMemoryStore' | 'prisma' | 'logger' | 'skillService'
> & {
  agentRegistry?: RouteDependencies['agentRegistry'];
  secretService?: RouteDependencies['secretService'];
};

// ─── Setup Function ─────────────────────────────────────────────

/**
 * Prepare all dependencies and resolved objects required to run the agent loop.
 *
 * Validates and sanitizes the request, loads the project / session / prompt layers,
 * builds the system prompt, and constructs per-request services (provider, memory
 * manager, cost guard). Returns a Result so callers can handle errors without
 * exceptions.
 *
 * @param body - The parsed (but not yet sanitized) chat request body.
 * @param deps - The subset of route dependencies needed for setup.
 * @returns A Result containing either a ChatSetupResult or a ChatSetupError.
 */
export async function prepareChatRun(
  body: ChatRequestBody,
  deps: ChatSetupDeps,
): Promise<Result<ChatSetupResult, ChatSetupError>> {
  const { projectRepository, sessionRepository, promptLayerRepository } = deps;

  // 1. Sanitize user message if provided
  const sanitized = body.message
    ? validateUserInput(body.message)
    : { sanitized: '', flags: [], original: '', isSafe: true, reason: null };

  // 2. Load project
  const project = await projectRepository.findById(body.projectId as ProjectId);
  if (!project) {
    return err({
      code: 'NOT_FOUND',
      message: `Project "${body.projectId}" not found`,
      statusCode: 404,
    });
  }

  // Merge defaults first so any field absent from project.config (e.g. config: {})
  // is always initialised. Project config then overrides the defaults, and agent
  // llmConfig overrides are applied on top in step 2b below.
  const agentConfig = { ...DEFAULT_AGENT_CONFIG, ...project.config, projectId: project.id };

  // 2b. If agentId provided, load agent and apply LLM config override
  let agentPromptConfig: AgentPromptConfig | undefined;
  let agentRecord: import('@/agents/types.js').AgentConfig | null = null;
  if (body.agentId && deps.agentRegistry) {
    const agent = await deps.agentRegistry.get(body.agentId as unknown as import('@/agents/types.js').AgentId);
    agentRecord = agent;
    if (!agent) {
      return err({
        code: 'NOT_FOUND',
        message: `Agent "${body.agentId}" not found`,
        statusCode: 404,
      });
    }

    // Override project LLM config with agent-level overrides
    if (agent.llmConfig) {
      if (agent.llmConfig.provider) {
        agentConfig.provider = {
          ...agentConfig.provider,
          provider: agent.llmConfig.provider,
        };
      }
      if (agent.llmConfig.model) {
        agentConfig.provider = {
          ...agentConfig.provider,
          model: agent.llmConfig.model,
        };
      }
      if (agent.llmConfig.temperature !== undefined) {
        agentConfig.provider = {
          ...agentConfig.provider,
          temperature: agent.llmConfig.temperature,
        };
      }
      if (agent.llmConfig.maxOutputTokens !== undefined) {
        agentConfig.provider = {
          ...agentConfig.provider,
          maxOutputTokens: agent.llmConfig.maxOutputTokens,
        };
      }
    }

    // 2c. Resolve operating mode based on source channel
    const resolvedMode = body.sourceChannel
      ? resolveAgentMode(agent, body.sourceChannel, body.contactRole)
      : undefined;

    // Apply mode-specific tool allowlist, or fall back to agent's base list
    const effectiveToolAllowlist = resolvedMode
      ? resolvedMode.toolAllowlist
      : agent.toolAllowlist;

    if (effectiveToolAllowlist.length > 0) {
      agentConfig.allowedTools = [
        ...new Set([...agentConfig.allowedTools, ...effectiveToolAllowlist]),
      ];
    }

    // 2d. Sub-Agent Magic: Autowire the escalation tool and instructions
    // We keep this behavior for backward compatibility or if the user explicitly configures a manager,
    // though the escalation now goes to a human.
    if (agent.managerAgentId) {
      // Automatically add the escalation tool if not present
      if (!agentConfig.allowedTools.includes('escalate-to-human')) {
        agentConfig.allowedTools.push('escalate-to-human');
      }

      // Automatically add the context to the instructions
      const escalationPrompt = `
## Escalation Path & Manager
You have a human "Manager" available via the \`escalate-to-human\` tool. 
If a user asks for something outside your permissions (like a large discount), or if you encounter a complex situation you cannot resolve, you MUST use the \`escalate-to-human\` tool to consult them before taking final action. 
Do not decline a request if your Manager might be able to approve it.
`;
      // We will append this during step 11, we pass it via metadata
      if (!body.metadata) body.metadata = {};
      body.metadata['_managerPrompt'] = escalationPrompt;
    }

    // Use agent MCP servers, filtered by mode if applicable
    if (agent.mcpServers.length > 0) {
      const mcpServers = resolvedMode && resolvedMode.mcpServerNames.length > 0
        ? agent.mcpServers.filter((s) => resolvedMode.mcpServerNames.includes(s.name))
        : agent.mcpServers;
      agentConfig.mcpServers = mcpServers as unknown as typeof agentConfig.mcpServers;
    }

    // Store mode prompt overrides for later prompt building
    if (resolvedMode?.promptOverrides) {
      // Stash on metadata so prompt builder can access it (step 11)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!body.metadata) {
        body.metadata = {};
      }
      body.metadata['_modePromptOverrides'] = resolvedMode.promptOverrides;
      body.metadata['_modeName'] = resolvedMode.modeName;
    }

    // 2e. Capture agent-level prompt config for use in step 4
    if (agent.promptConfig.identity && agent.promptConfig.instructions && agent.promptConfig.safety) {
      agentPromptConfig = agent.promptConfig;
    }

    // 2f. Compose assigned skills (merge instructions + tools + MCP)
    if (agent.skillIds.length > 0) {
      const composition = await deps.skillService.composeForAgent(agent.skillIds);

      if (composition.mergedInstructions) {
        if (!body.metadata) body.metadata = {};
        body.metadata['_skillInstructions'] = composition.mergedInstructions;
      }

      if (composition.mergedTools.length > 0) {
        agentConfig.allowedTools = [
          ...new Set([...agentConfig.allowedTools, ...composition.mergedTools]),
        ];
      }

      if (composition.mergedMcpServers.length > 0) {
        // Add skill-required MCP servers that aren't already configured
        const existingNames = new Set(
          (agentConfig.mcpServers as Array<{ name: string }>).map((s) => s.name),
        );
        for (const mcpName of composition.mergedMcpServers) {
          if (!existingNames.has(mcpName)) {
            (agentConfig.mcpServers as Array<{ name: string }>).push({ name: mcpName } as never);
          }
        }
      }
    }
  }

  // 3. Load or create session
  let sessionId: SessionId;
  if (body.sessionId) {
    const existing = await sessionRepository.findById(body.sessionId as SessionId);
    if (!existing) {
      return err({
        code: 'NOT_FOUND',
        message: `Session "${body.sessionId}" not found`,
        statusCode: 404,
      });
    }
    if (existing.status === 'paused') {
      return err({
        code: 'SESSION_PAUSED',
        message: 'Session is paused — a human operator has taken over this conversation',
        statusCode: 409,
      });
    }
    sessionId = existing.id;
  } else {
    const newSession = await sessionRepository.create({
      projectId: project.id,
      metadata: body.metadata,
    });
    sessionId = newSession.id;
  }

  // 4. Resolve active prompt layers
  // If the agent has its own prompts, use them directly without requiring DB layers.
  let layers: import('@/prompts/types.js').ResolvedPromptLayers;
  if (agentPromptConfig) {
    const syntheticBase = {
      projectId: project.id,
      version: 1,
      isActive: true,
      createdAt: new Date(),
      createdBy: 'agent',
      changeReason: 'agent-prompt',
    };
    layers = {
      identity: {
        ...syntheticBase,
        id: `${body.agentId}:identity` as import('@/core/types.js').PromptLayerId,
        layerType: 'identity' as const,
        content: agentPromptConfig.identity,
      },
      instructions: {
        ...syntheticBase,
        id: `${body.agentId}:instructions` as import('@/core/types.js').PromptLayerId,
        layerType: 'instructions' as const,
        content: agentPromptConfig.instructions,
      },
      safety: {
        ...syntheticBase,
        id: `${body.agentId}:safety` as import('@/core/types.js').PromptLayerId,
        layerType: 'safety' as const,
        content: agentPromptConfig.safety,
      },
    };
  } else {
    const layersResult = await resolveActiveLayers(project.id, promptLayerRepository);
    if (!layersResult.ok) {
      return err({
        code: 'NO_ACTIVE_PROMPT',
        message: layersResult.error.message,
        statusCode: 400,
      });
    }
    layers = layersResult.value;
  }

  // 5. Load conversation history
  const storedMessages = await sessionRepository.getMessages(sessionId);
  const conversationHistory: Message[] = storedMessages.map((m) => ({
    role: m.role as Message['role'],
    content: m.content,
  }));

  // 5b. Welcome message — if session is new (no prior messages) and agent has a welcomeMessage in metadata,
  // return it directly without running the LLM. Persist it as the first assistant message.
  const welcomeMessage = agentRecord?.metadata?.['welcomeMessage'] as string | undefined;
  let welcomeMessageResponse: string | undefined;
  if (welcomeMessage && conversationHistory.length === 0) {
    // Persist the user message first
    await sessionRepository.addMessage(sessionId, { role: 'user', content: body.message ?? '' });
    // Persist the welcome as assistant message
    await sessionRepository.addMessage(sessionId, { role: 'assistant', content: welcomeMessage });
    welcomeMessageResponse = welcomeMessage;
  }

  // 6. Resolve LLM providers (primary + optional fallback)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!agentConfig.provider) {
    return err({
      code: 'MISCONFIGURATION',
      message: 'No LLM provider configured. Set "provider" in the project config or agent llmConfig.',
      statusCode: 400,
    });
  }

  // 6a. Resolve apiKeySecretName → set the API key as an env var for the provider factory.
  // This allows per-project secret-based API keys without hardcoding env vars.
  if (agentConfig.provider.apiKeySecretName && deps.secretService) {
    try {
      const secretValue = await deps.secretService.get(project.id, agentConfig.provider.apiKeySecretName);
      // Temporarily set the env var so the provider factory can pick it up.
      // Use apiKeyEnvVar if set, otherwise derive from the secret name itself.
      const envVarName = agentConfig.provider.apiKeyEnvVar ?? `_RUNTIME_${agentConfig.provider.apiKeySecretName}`;
      process.env[envVarName] = secretValue;
      agentConfig.provider.apiKeyEnvVar = envVarName;
    } catch (secretErr) {
      deps.logger.warn('Failed to resolve apiKeySecretName', {
        component: 'chat-setup',
        secretName: agentConfig.provider.apiKeySecretName,
        error: secretErr instanceof Error ? secretErr.message : String(secretErr),
      });
      // Fall through — the factory will try the default env var
    }
  }

  if (agentConfig.fallbackProvider?.apiKeySecretName && deps.secretService) {
    try {
      const secretValue = await deps.secretService.get(project.id, agentConfig.fallbackProvider.apiKeySecretName);
      const envVarName = agentConfig.fallbackProvider.apiKeyEnvVar ?? `_RUNTIME_${agentConfig.fallbackProvider.apiKeySecretName}`;
      process.env[envVarName] = secretValue;
      agentConfig.fallbackProvider.apiKeyEnvVar = envVarName;
    } catch {
      // Fall through
    }
  }

  const provider = createProvider(agentConfig.provider);
  const fallbackProvider = agentConfig.fallbackProvider
    ? createProvider(agentConfig.fallbackProvider)
    : undefined;

  // 7. Create per-request services (with optional long-term memory)
  const longTermStore = agentConfig.memoryConfig.longTerm.enabled
    ? deps.longTermMemoryStore ?? undefined
    : undefined;

  // Compaction summarizer — uses the LLM to summarize pruned conversations
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
    tokenCounter: (messages) => {
      // Approximate token count: ~4 chars per token
      let total = 0;
      for (const msg of messages) {
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

  const costGuard = createCostGuard({
    costConfig: agentConfig.costConfig,
    usageStore: createPrismaUsageStore(deps.prisma),
  });

  // 8. Prepare MCP tools (lazy — uses cache for known servers; connects only for first-time servers)
  // Reconnection for dropped connections happens at tool execute() time, not here.
  const mcpToolIds: string[] = [];
  if (agentConfig.mcpServers && agentConfig.mcpServers.length > 0) {
    const { mcpManager, toolRegistry } = deps;

    const preparedIds = await mcpManager.prepareTools(agentConfig.mcpServers);

    // Register prepared MCP tools in the shared tool registry
    for (const tool of mcpManager.getTools()) {
      if (preparedIds.includes(tool.id)) {
        if (!toolRegistry.has(tool.id)) {
          toolRegistry.register(tool);
        }
        mcpToolIds.push(tool.id);
      }
    }
  }

  // 9. Build tool descriptions for the prompt
  const allAllowedTools = [...agentConfig.allowedTools, ...mcpToolIds];
  const executionContext = {
    projectId: agentConfig.projectId,
    sessionId,
    traceId: 'setup' as TraceId,
    agentConfig,
    permissions: { allowedTools: new Set(allAllowedTools) },
    abortSignal: new AbortController().signal,
  };
  const toolDescriptions = deps.toolRegistry
    .formatForProvider(executionContext)
    .map((t) => ({ name: t.name, description: t.description }));

  // 10. Retrieve relevant long-term memories for context injection
  const retrievedMemories = await memoryManager.retrieveMemories({
    query: sanitized.sanitized,
    topK: agentConfig.memoryConfig.longTerm.retrievalTopK,
    projectId: agentConfig.projectId,
  });

  // 11. Build the system prompt from layers + runtime content
  //     Apply mode-specific prompt overrides if present
  const modeOverrides = body.metadata?.['_modePromptOverrides'] as
    { identity?: string; instructions?: string; safety?: string } | undefined;

  const managerPrompt = body.metadata?.['_managerPrompt'] as string | undefined;

  const effectiveLayers = {
    identity: modeOverrides?.identity
      ? { ...layers.identity, content: `${layers.identity.content}\n\n## Mode Override\n${modeOverrides.identity}` }
      : layers.identity,
    instructions: modeOverrides?.instructions
      ? { ...layers.instructions, content: `${layers.instructions.content}\n\n## Mode Instructions\n${modeOverrides.instructions}` }
      : layers.instructions,
    safety: modeOverrides?.safety
      ? { ...layers.safety, content: `${layers.safety.content}\n\n## Mode Safety\n${modeOverrides.safety}` }
      : layers.safety,
  };

  if (managerPrompt) {
    effectiveLayers.instructions.content = `${effectiveLayers.instructions.content}\n\n${managerPrompt}`;
  }

  // Append skill instructions (from step 2f)
  const skillInstructions = body.metadata?.['_skillInstructions'] as string | undefined;
  if (skillInstructions) {
    effectiveLayers.instructions.content = `${effectiveLayers.instructions.content}\n\n# Skills\n\n${skillInstructions}`;
  }

  const systemPrompt = buildPrompt({
    identity: effectiveLayers.identity,
    instructions: effectiveLayers.instructions,
    safety: effectiveLayers.safety,
    toolDescriptions,
    retrievedMemories: retrievedMemories.map((m) => ({
      content: m.content,
      category: m.category,
    })),
  });

  // 12. Create snapshot for audit trail
  const toolDocsSection = toolDescriptions
    .map((t) => `${t.name}: ${t.description}`)
    .join('\n');
  const memorySection = retrievedMemories.map((m) => m.content).join('\n');
  const promptSnapshot = createPromptSnapshot(
    layers,
    computeHash(toolDocsSection),
    computeHash(memorySection),
  );

  return ok({
    sanitizedMessage: sanitized.sanitized,
    agentConfig,
    sessionId,
    systemPrompt,
    promptSnapshot,
    conversationHistory,
    provider,
    fallbackProvider,
    memoryManager,
    costGuard,
    welcomeMessageResponse,
  });
}

// ─── Response Extraction Helpers ────────────────────────────────

/** Extract the final assistant text from trace events. */
export function extractAssistantResponse(
  events: { type: string; data: Record<string, unknown> }[],
): string {
  const llmResponses = events.filter((e) => e.type === 'llm_response');
  if (llmResponses.length === 0) return '';

  const lastResponse = llmResponses[llmResponses.length - 1];
  if (!lastResponse) return '';

  const text = lastResponse.data['text'];
  return typeof text === 'string' ? text : '';
}

/** Extract tool calls from trace events. */
export function extractToolCalls(
  events: { type: string; data: Record<string, unknown> }[],
): { toolId: string; input: Record<string, unknown>; result: unknown }[] {
  const calls: { toolId: string; input: Record<string, unknown>; result: unknown }[] = [];
  const toolCallEvents = events.filter((e) => e.type === 'tool_call');
  const toolResultEvents = events.filter((e) => e.type === 'tool_result');

  for (const callEvent of toolCallEvents) {
    const toolCallId = callEvent.data['toolCallId'] as string | undefined;
    const matchingResult = toolResultEvents.find(
      (r) => r.data['toolCallId'] === toolCallId,
    );

    calls.push({
      toolId: (callEvent.data['toolId'] as string | undefined) ?? '',
      input: (callEvent.data['input'] as Record<string, unknown> | undefined) ?? {},
      result: matchingResult?.data['output'],
    });
  }

  return calls;
}
