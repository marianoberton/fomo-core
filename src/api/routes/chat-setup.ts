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
import { createCostGuard, createInMemoryUsageStore } from '@/cost/cost-guard.js';
import { validateUserInput } from '@/security/input-sanitizer.js';
import {
  buildPrompt,
  resolveActiveLayers,
  createPromptSnapshot,
  computeHash,
} from '@/prompts/index.js';
import type { RouteDependencies } from '../types.js';

// ─── Zod Schema ─────────────────────────────────────────────────

/** Zod schema for chat request body validation. */
export const chatRequestSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  message: z.string().min(1).max(100_000),
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
  /** Per-request memory manager. */
  memoryManager: MemoryManager;
  /** Per-request cost guard. */
  costGuard: CostGuard;
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
  'projectRepository' | 'sessionRepository' | 'promptLayerRepository' | 'toolRegistry' | 'logger'
>;

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

  // 1. Sanitize user message
  const sanitized = validateUserInput(body.message);

  // 2. Load project
  const project = await projectRepository.findById(body.projectId as ProjectId);
  if (!project) {
    return err({
      code: 'NOT_FOUND',
      message: `Project "${body.projectId}" not found`,
      statusCode: 404,
    });
  }

  const agentConfig = project.config;

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
    sessionId = existing.id;
  } else {
    const newSession = await sessionRepository.create({
      projectId: project.id,
      metadata: body.metadata,
    });
    sessionId = newSession.id;
  }

  // 4. Resolve active prompt layers
  const layersResult = await resolveActiveLayers(project.id, promptLayerRepository);
  if (!layersResult.ok) {
    return err({
      code: 'NO_ACTIVE_PROMPT',
      message: layersResult.error.message,
      statusCode: 400,
    });
  }
  const layers = layersResult.value;

  // 5. Load conversation history
  const storedMessages = await sessionRepository.getMessages(sessionId);
  const conversationHistory: Message[] = storedMessages.map((m) => ({
    role: m.role as Message['role'],
    content: m.content,
  }));

  // 6. Resolve LLM provider
  const provider = createProvider(agentConfig.provider);

  // 7. Create per-request services
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
  });

  const costGuard = createCostGuard({
    costConfig: agentConfig.costConfig,
    usageStore: createInMemoryUsageStore(),
  });

  // 8. Build tool descriptions for the prompt
  const executionContext = {
    projectId: agentConfig.projectId,
    sessionId,
    traceId: 'setup' as TraceId,
    agentConfig,
    permissions: { allowedTools: new Set(agentConfig.allowedTools) },
    abortSignal: new AbortController().signal,
  };
  const toolDescriptions = deps.toolRegistry
    .formatForProvider(executionContext)
    .map((t) => ({ name: t.name, description: t.description }));

  // 9. Build the system prompt from layers + runtime content
  const systemPrompt = buildPrompt({
    identity: layers.identity,
    instructions: layers.instructions,
    safety: layers.safety,
    toolDescriptions,
    retrievedMemories: [],
  });

  // 10. Create snapshot for audit trail
  const toolDocsSection = toolDescriptions
    .map((t) => `${t.name}: ${t.description}`)
    .join('\n');
  const promptSnapshot = createPromptSnapshot(
    layers,
    computeHash(toolDocsSection),
    computeHash(''),
  );

  return ok({
    sanitizedMessage: sanitized.sanitized,
    agentConfig,
    sessionId,
    systemPrompt,
    promptSnapshot,
    conversationHistory,
    provider,
    memoryManager,
    costGuard,
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
