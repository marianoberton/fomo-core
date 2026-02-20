/**
 * ToolRegistry — central registry for all tool definitions.
 * Resolves tools by ID, enforces RBAC via the project's allowedTools whitelist,
 * and routes high-risk tools through the approval gate.
 */
import {
  ToolNotAllowedError,
  ToolHallucinationError,
  ApprovalRequiredError,
} from '@/core/errors.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutionContext } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import type { ToolDefinitionForProvider } from '@/providers/types.js';
import type { ExecutableTool, ToolResult } from '../types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

const logger = createLogger({ name: 'tool-registry' });

/** Callback for approval gate integration. */
export type ApprovalGateCallback = (
  toolId: string,
  input: Record<string, unknown>,
  context: ExecutionContext,
) => Promise<{ approved: boolean; approvalId: string }>;

export interface ToolRegistryOptions {
  /** Optional approval gate callback. If not provided, high-risk tools are blocked. */
  approvalGate?: ApprovalGateCallback;
}

export interface ToolRegistry {
  /** Register a tool. Replaces existing registration for same ID. */
  register(tool: ExecutableTool): void;

  /** Unregister a tool by ID. Returns true if it was registered. */
  unregister(toolId: string): boolean;

  /** Get a tool by ID without any access checks. Returns undefined if not found. */
  get(toolId: string): ExecutableTool | undefined;

  /** Check if a tool exists in the registry. */
  has(toolId: string): boolean;

  /** List all registered tool IDs. */
  listAll(): string[];

  /**
   * List tools available to a given execution context.
   * Filters by the context's allowedTools whitelist.
   */
  listForContext(context: ExecutionContext): ExecutableTool[];

  /**
   * Format tools for an LLM provider.
   * Only includes tools the context has access to.
   */
  formatForProvider(context: ExecutionContext): ToolDefinitionForProvider[];

  /**
   * Resolve and execute a tool call.
   * Enforces RBAC, validates input via Zod, handles approval gates.
   */
  resolve(
    toolId: string,
    input: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<Result<ToolResult, NexusError>>;

  /**
   * Resolve and dry-run a tool call.
   * Same checks as resolve() but calls dryRun() instead of execute().
   */
  resolveDryRun(
    toolId: string,
    input: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<Result<ToolResult, NexusError>>;
}

/**
 * Create a new ToolRegistry instance.
 */
export function createToolRegistry(options?: ToolRegistryOptions): ToolRegistry {
  const tools = new Map<string, ExecutableTool>();

  function validateAccess(
    toolId: string,
    context: ExecutionContext,
  ): Result<ExecutableTool, NexusError> {
    const tool = tools.get(toolId);

    if (!tool) {
      const available = [...tools.keys()];
      logger.warn('Tool hallucination detected', {
        component: 'tool-registry',
        toolId,
        availableTools: available,
        projectId: context.projectId,
        traceId: context.traceId,
      });
      return err(new ToolHallucinationError(toolId, available));
    }

    if (!context.permissions.allowedTools.has(toolId)) {
      logger.warn('Tool access denied by RBAC', {
        component: 'tool-registry',
        toolId,
        projectId: context.projectId,
        traceId: context.traceId,
      });
      return err(new ToolNotAllowedError(toolId, context.projectId));
    }

    return ok(tool);
  }

  function validateInput(
    tool: ExecutableTool,
    input: Record<string, unknown>,
  ): Result<unknown, NexusError> {
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      logger.warn('Tool input validation failed', {
        component: 'tool-registry',
        toolId: tool.id,
        errors: parsed.error.issues,
      });
      return err(
        new ToolHallucinationError(
          tool.id,
          [...tools.keys()],
        ),
      );
    }
    return ok(parsed.data);
  }

  async function checkApproval(
    tool: ExecutableTool,
    input: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<Result<void, NexusError>> {
    if (!tool.requiresApproval) {
      return ok(undefined);
    }

    if (!options?.approvalGate) {
      logger.warn('Tool requires approval but no approval gate configured', {
        component: 'tool-registry',
        toolId: tool.id,
        projectId: context.projectId,
      });
      return err(new ApprovalRequiredError(tool.id, 'no-gate-configured'));
    }

    const result = await options.approvalGate(tool.id, input, context);
    if (!result.approved) {
      return err(new ApprovalRequiredError(tool.id, result.approvalId));
    }

    return ok(undefined);
  }

  return {
    register(tool: ExecutableTool): void {
      logger.info('Registering tool', {
        component: 'tool-registry',
        toolId: tool.id,
        riskLevel: tool.riskLevel,
        requiresApproval: tool.requiresApproval,
      });
      tools.set(tool.id, tool);
    },

    unregister(toolId: string): boolean {
      const existed = tools.delete(toolId);
      if (existed) {
        logger.info('Unregistered tool', {
          component: 'tool-registry',
          toolId,
        });
      }
      return existed;
    },

    get(toolId: string): ExecutableTool | undefined {
      return tools.get(toolId);
    },

    has(toolId: string): boolean {
      return tools.has(toolId);
    },

    listAll(): string[] {
      return [...tools.keys()];
    },

    listForContext(context: ExecutionContext): ExecutableTool[] {
      return [...tools.values()].filter((tool) =>
        context.permissions.allowedTools.has(tool.id),
      );
    },

    formatForProvider(context: ExecutionContext): ToolDefinitionForProvider[] {
      return this.listForContext(context).map((tool) => ({
        name: tool.id,
        description: tool.description,
        inputSchema: toOpenAICompatibleSchema(tool.inputSchema),
      }));
    },

    async resolve(
      toolId: string,
      input: Record<string, unknown>,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const accessResult = validateAccess(toolId, context);
      if (!accessResult.ok) return accessResult;
      const tool = accessResult.value;

      const inputResult = validateInput(tool, input);
      if (!inputResult.ok) return inputResult;

      const approvalResult = await checkApproval(tool, input, context);
      if (!approvalResult.ok) return approvalResult;

      logger.info('Executing tool', {
        component: 'tool-registry',
        toolId: tool.id,
        projectId: context.projectId,
        traceId: context.traceId,
      });

      return tool.execute(inputResult.value, context);
    },

    async resolveDryRun(
      toolId: string,
      input: Record<string, unknown>,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const accessResult = validateAccess(toolId, context);
      if (!accessResult.ok) return accessResult;
      const tool = accessResult.value;

      const inputResult = validateInput(tool, input);
      if (!inputResult.ok) return inputResult;

      logger.info('Dry-running tool', {
        component: 'tool-registry',
        toolId: tool.id,
        projectId: context.projectId,
        traceId: context.traceId,
      });

      return tool.dryRun(inputResult.value, context);
    },
  };
}

/**
 * Convert a Zod schema to an OpenAI-compatible JSON Schema.
 * OpenAI requires `type: "object"` at the top level for function parameters.
 * Discriminated unions (which produce `anyOf`) are flattened into a single
 * object with all possible properties, making variant-specific ones optional.
 *
 * Uses `jsonSchema7` target because OpenAI follows JSON Schema draft 7+ where
 * `exclusiveMinimum` is a number. The `openApi3` target generates draft 4/5
 * style `exclusiveMinimum: true` (boolean) which OpenAI rejects.
 */
function toOpenAICompatibleSchema(zodSchema: import('zod').ZodType): Record<string, unknown> {
  const raw = zodToJsonSchema(zodSchema, { target: 'jsonSchema7' }) as Record<string, unknown>;

  // Remove $schema — OpenAI rejects it in function parameters
  delete raw['$schema'];

  // Already a plain object — return as-is
  if (raw['type'] === 'object') {
    return raw;
  }

  // Discriminated union: flatten anyOf variants into one object
  const variants = raw['anyOf'] as Record<string, unknown>[] | undefined;
  if (!variants) {
    return raw;
  }

  const allProperties: Record<string, unknown> = {};
  const requiredSets: Set<string>[] = [];

  for (const variant of variants) {
    const props = variant['properties'] as Record<string, unknown> | undefined;
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        // Merge enum arrays for discriminator fields
        const existing = allProperties[key] as Record<string, unknown> | undefined;
        if (existing?.['enum'] && (value as Record<string, unknown>)['enum']) {
          const merged = new Set([
            ...(existing['enum'] as string[]),
            ...((value as Record<string, unknown>)['enum'] as string[]),
          ]);
          allProperties[key] = { ...existing, enum: [...merged] };
        } else {
          allProperties[key] ??= value;
        }
      }
    }
    const req = variant['required'] as string[] | undefined;
    if (req) {
      requiredSets.push(new Set(req));
    }
  }

  // Only fields required in ALL variants are truly required
  const firstSet = requiredSets[0];
  const commonRequired = firstSet
    ? [...firstSet].filter((key) => requiredSets.every((s) => s.has(key)))
    : [];

  return {
    type: 'object',
    properties: allProperties,
    required: commonRequired,
    additionalProperties: false,
  };
}
