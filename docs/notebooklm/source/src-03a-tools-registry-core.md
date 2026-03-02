# Nexus Core — Source: Tools (Part 1 — Registry + Utility/Knowledge/Communication)

Complete source code for the tool system.

---
## src/tools/registry/tool-registry.ts
```typescript
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
```

---
## src/tools/registry/index.ts
```typescript
// Tool registry + RBAC enforcement
export { createToolRegistry } from './tool-registry.js';
export type { ToolRegistry, ToolRegistryOptions, ApprovalGateCallback } from './tool-registry.js';
```

---
## src/tools/scaffold.ts
```typescript
/**
 * Tool scaffolding utility — generates TypeScript source strings for new tool
 * implementations and test files following the project's established patterns.
 *
 * Pure function. Does not write files — returns source strings for the caller
 * to persist however they choose (CLI, API, etc.).
 */
import type { RiskLevel } from './types.js';

// ─── Input / Output ─────────────────────────────────────────────

export interface ToolScaffoldInput {
  /** Tool ID (kebab-case, e.g. 'send-email'). */
  id: string;
  /** Human-readable tool name (e.g. 'Send Email'). */
  name: string;
  /** One-line description of what the tool does. */
  description: string;
  /** Tool category (e.g. 'utility', 'communication', 'data'). */
  category: string;
  /** Risk level. */
  riskLevel: RiskLevel;
  /** Whether this tool requires human approval before execution. */
  requiresApproval: boolean;
  /** Whether execution has side effects. */
  sideEffects: boolean;
}

export interface ToolScaffoldOutput {
  /** Generated implementation file content. */
  implementationContent: string;
  /** Generated test file content. */
  testContent: string;
  /** The line to add to src/tools/definitions/index.ts. */
  registrationLine: string;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Convert kebab-case to PascalCase. */
function toPascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// ─── Scaffold ───────────────────────────────────────────────────

/** Generate implementation and test source for a new tool. */
export function scaffoldTool(input: ToolScaffoldInput): ToolScaffoldOutput {
  const {
    id,
    name,
    description,
    category,
    riskLevel,
    requiresApproval,
    sideEffects,
  } = input;

  const pascalName = toPascalCase(id);
  const factoryName = `create${pascalName}Tool`;
  const optionsName = `${pascalName}ToolOptions`;

  // ─── Implementation ─────────────────────────────────────────

  const implementationContent = `/**
 * ${name} tool — ${description}
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: '${id}' });

const inputSchema = z.object({
  // TODO: Define input fields
  input: z.string().min(1).describe('Tool input'),
});

const outputSchema = z.object({
  // TODO: Define output fields
  result: z.string(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ${optionsName} {
  // TODO: Add dependency injection options
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a ${name} tool. */
export function ${factoryName}(options: ${optionsName}): ExecutableTool {
  void options;

  return {
    id: '${id}',
    name: '${name}',
    description: '${description}',
    category: '${category}',
    inputSchema,
    outputSchema,
    riskLevel: '${riskLevel}',
    requiresApproval: ${String(requiresApproval)},
    sideEffects: ${String(sideEffects)},
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        logger.debug('${name} executing', {
          component: '${id}',
          projectId: context.projectId,
          traceId: context.traceId,
        });

        // TODO: Implement tool logic
        const result = parsed.input;

        return Promise.resolve(ok({
          success: true,
          output: { result },
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('${id}', message)));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      return Promise.resolve(ok({
        success: true,
        output: {
          input: parsed.input,
          valid: true,
          dryRun: true,
        },
        durationMs: 0,
      }));
    },
  };
}
`;

  // ─── Test ───────────────────────────────────────────────────

  const testContent = `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ${factoryName} } from './${id}.js';
import type { ExecutableTool } from '@/tools/types.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { ExecutionContext } from '@/core/types.js';

let tool: ExecutableTool;
let context: ExecutionContext;

beforeEach(() => {
  tool = ${factoryName}({});
  context = createTestContext();
});

// ─── Schema Validation ──────────────────────────────────────────

describe('schema validation', () => {
  it('rejects empty input', () => {
    const result = tool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid input', () => {
    const result = tool.inputSchema.safeParse({ input: 'test' });
    expect(result.success).toBe(true);
  });
});

// ─── Dry Run ────────────────────────────────────────────────────

describe('dryRun', () => {
  it('returns valid result without side effects', async () => {
    const result = await tool.dryRun({ input: 'test' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      const output = result.value.output as Record<string, unknown>;
      expect(output['dryRun']).toBe(true);
      expect(output['valid']).toBe(true);
    }
  });
});

// ─── Execute ────────────────────────────────────────────────────

describe('execute', () => {
  it('executes successfully with valid input', async () => {
    const result = await tool.execute({ input: 'test' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects invalid input via Zod', async () => {
    await expect(tool.execute({}, context)).rejects.toThrow();
  });
});
`;

  // ─── Registration Line ──────────────────────────────────────

  const registrationLine = `export { ${factoryName} } from './${id}.js';\nexport type { ${optionsName} } from './${id}.js';`;

  return {
    implementationContent,
    testContent,
    registrationLine,
  };
}
```

---
## src/tools/definitions/index.ts
```typescript
// Individual tool implementations
export { createEscalateToHumanTool } from './escalate-to-human.js';

export { createCalculatorTool } from './calculator.js';
export { createDateTimeTool } from './date-time.js';
export { createJsonTransformTool } from './json-transform.js';
export { createHttpRequestTool } from './http-request.js';
export type { HttpRequestToolOptions } from './http-request.js';
export { createKnowledgeSearchTool } from './knowledge-search.js';
export type { KnowledgeSearchToolOptions } from './knowledge-search.js';
export { createSendNotificationTool } from './send-notification.js';
export type { SendNotificationToolOptions, NotificationSender } from './send-notification.js';
export { createProposeScheduledTaskTool } from './propose-scheduled-task.js';
export type { ProposeScheduledTaskToolOptions } from './propose-scheduled-task.js';
export { createCatalogSearchTool } from './catalog-search.js';
export type { CatalogSearchToolOptions } from './catalog-search.js';
export { createCatalogOrderTool } from './catalog-order.js';
export type { CatalogOrderToolOptions } from './catalog-order.js';

// Phase 5 tools
export { createWebSearchTool } from './web-search.js';
export type { WebSearchToolOptions } from './web-search.js';
export { createSendEmailTool } from './send-email.js';
export type { SendEmailToolOptions } from './send-email.js';
export { createSendChannelMessageTool } from './send-channel-message.js';
export type { SendChannelMessageToolOptions } from './send-channel-message.js';
export { createReadFileTool } from './read-file.js';
export type { ReadFileToolOptions } from './read-file.js';
export { createScrapeWebpageTool } from './scrape-webpage.js';

// Manager / orchestration tools
export { createDelegateToAgentTool } from './delegate-to-agent.js';
export type { DelegateToAgentToolOptions, RunSubAgentFn } from './delegate-to-agent.js';
export { createListProjectAgentsTool } from './list-project-agents.js';
export type { ListProjectAgentsToolOptions } from './list-project-agents.js';
export { createGetOperationsSummaryTool } from './get-operations-summary.js';
export type { GetOperationsSummaryToolOptions } from './get-operations-summary.js';
export { createGetAgentPerformanceTool } from './get-agent-performance.js';
export type { GetAgentPerformanceToolOptions } from './get-agent-performance.js';
export { createReviewAgentActivityTool } from './review-agent-activity.js';
export type { ReviewAgentActivityToolOptions } from './review-agent-activity.js';

// Memory tools
export { createStoreMemoryTool } from './store-memory.js';
export type { StoreMemoryToolOptions } from './store-memory.js';

// Shared memory / session tools (internal mode)
export { createQuerySessionsTool } from './query-sessions.js';
export type { QuerySessionsToolOptions } from './query-sessions.js';
export { createReadSessionHistoryTool } from './read-session-history.js';
export type { ReadSessionHistoryToolOptions } from './read-session-history.js';

// Vertical-specific tools
export { createVehicleLeadScoreTool } from './vehicle-lead-score.js';
export { createVehicleCheckFollowupTool } from './vehicle-check-followup.js';
export { createWholesaleUpdateStockTool } from './wholesale-update-stock.js';
export { createWholesaleOrderHistoryTool } from './wholesale-order-history.js';
export { createHotelDetectLanguageTool } from './hotel-detect-language.js';
export { createHotelSeasonalPricingTool } from './hotel-seasonal-pricing.js';
```

---
## src/tools/definitions/calculator.ts
```typescript
/**
 * Calculator tool — safe mathematical expression evaluation.
 *
 * Uses a recursive-descent parser (NO eval) to evaluate math expressions.
 * Supports arithmetic, exponents, parentheses, unary minus, and built-in
 * functions (sqrt, abs, ceil, floor, round, min, max, sin, cos, tan, log, log2, log10).
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'calculator' });

const MAX_EXPRESSION_LENGTH = 1000;

const inputSchema = z.object({
  expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH),
});

const outputSchema = z.object({
  result: z.number(),
  expression: z.string(),
});

// ─── Tokenizer ─────────────────────────────────────────────────

type TokenType = 'number' | 'operator' | 'lparen' | 'rparen' | 'comma' | 'identifier';

interface Token {
  type: TokenType;
  value: string;
}

const CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  E: Math.E,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: (x) => Math.sqrt(x),
  abs: (x) => Math.abs(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  round: (x) => Math.round(x),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  log: (x) => Math.log(x),
  log2: (x) => Math.log2(x),
  log10: (x) => Math.log10(x),
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expression.length;

  while (i < len) {
    const ch = expression.charAt(i);

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Numbers (integers and decimals)
    if (/[0-9.]/.test(ch)) {
      let num = '';
      let hasDot = false;
      while (i < len && /[0-9.]/.test(expression.charAt(i))) {
        if (expression.charAt(i) === '.') {
          if (hasDot) break;
          hasDot = true;
        }
        num += expression.charAt(i);
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifiers (function names or constants)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_]/.test(expression.charAt(i))) {
        ident += expression.charAt(i);
        i++;
      }
      tokens.push({ type: 'identifier', value: ident });
      continue;
    }

    // Two-character operators
    if (ch === '*' && expression[i + 1] === '*') {
      tokens.push({ type: 'operator', value: '**' });
      i += 2;
      continue;
    }

    // Single-character operators
    if ('+-*/%'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${String(i)}`);
  }

  return tokens;
}

// ─── Recursive Descent Parser ──────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      const unexpected = this.tokens[this.pos];
      throw new Error(`Unexpected token '${unexpected ? unexpected.value : '???'}' at position ${String(this.pos)}`);
    }
    return result;
  }

  // expression = term (('+' | '-') term)*
  private parseExpression(): number {
    let left = this.parseTerm();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token?.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      this.pos++;
      const right = this.parseTerm();
      left = token.value === '+' ? left + right : left - right;
    }

    return left;
  }

  // term = exponent (('*' | '/' | '%') exponent)*
  private parseTerm(): number {
    let left = this.parseExponent();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token?.type !== 'operator' || (token.value !== '*' && token.value !== '/' && token.value !== '%')) break;
      this.pos++;
      const right = this.parseExponent();
      if (token.value === '*') {
        left = left * right;
      } else if (token.value === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else {
        if (right === 0) throw new Error('Division by zero');
        left = left % right;
      }
    }

    return left;
  }

  // exponent = unary ('**' exponent)?   (right-associative)
  private parseExponent(): number {
    const base = this.parseUnary();

    const token = this.tokens[this.pos];
    if (token?.type === 'operator' && token.value === '**') {
      this.pos++;
      const exp = this.parseExponent(); // right-associative recursion
      return Math.pow(base, exp);
    }

    return base;
  }

  // unary = ('+' | '-') unary | primary
  private parseUnary(): number {
    const token = this.tokens[this.pos];
    if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      this.pos++;
      const operand = this.parseUnary();
      return token.value === '-' ? -operand : operand;
    }
    return this.parsePrimary();
  }

  // primary = number | constant | function '(' args ')' | '(' expression ')'
  private parsePrimary(): number {
    const token = this.tokens[this.pos];

    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    // Number literal
    if (token.type === 'number') {
      this.pos++;
      const num = Number(token.value);
      if (!Number.isFinite(num)) throw new Error(`Invalid number: ${token.value}`);
      return num;
    }

    // Identifier (constant or function)
    if (token.type === 'identifier') {
      this.pos++;

      // Check for constant
      if (token.value in CONSTANTS) {
        const constVal = CONSTANTS[token.value];
        if (constVal !== undefined) return constVal;
      }

      // Check for function call
      if (token.value in FUNCTIONS) {
        const next = this.tokens[this.pos];
        if (next?.type !== 'lparen') {
          throw new Error(`Expected '(' after function '${token.value}'`);
        }
        this.pos++; // skip '('

        const args: number[] = [];
        if (this.tokens[this.pos]?.type !== 'rparen') {
          args.push(this.parseExpression());
          while (this.tokens[this.pos]?.type === 'comma') {
            this.pos++; // skip ','
            args.push(this.parseExpression());
          }
        }

        const rparen = this.tokens[this.pos];
        if (rparen?.type !== 'rparen') {
          throw new Error(`Expected ')' after arguments of '${token.value}'`);
        }
        this.pos++; // skip ')'

        const fn = FUNCTIONS[token.value] as (...args: number[]) => number;
        return fn(...args);
      }

      throw new Error(`Unknown identifier '${token.value}'`);
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.pos++; // skip '('
      const result = this.parseExpression();
      const rparen = this.tokens[this.pos];
      if (rparen?.type !== 'rparen') {
        throw new Error("Expected ')'");
      }
      this.pos++; // skip ')'
      return result;
    }

    throw new Error(`Unexpected token '${token.value}'`);
  }
}

function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error('Empty expression');
  const parser = new Parser(tokens);
  const result = parser.parse();
  if (!Number.isFinite(result)) throw new Error('Result is not finite');
  return result;
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a calculator tool that safely evaluates math expressions. */
export function createCalculatorTool(): ExecutableTool {
  return {
    id: 'calculator',
    name: 'Calculator',
    description:
      'Evaluates mathematical expressions safely. Supports arithmetic (+, -, *, /, %, **), ' +
      'parentheses, and functions (sqrt, abs, ceil, floor, round, min, max, sin, cos, tan, log, log2, log10). ' +
      'Constants: PI, E.',
    category: 'utility',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const result = evaluate(parsed.expression);

        logger.debug('Calculator evaluated expression', {
          component: 'calculator',
          projectId: context.projectId,
          traceId: context.traceId,
          expression: parsed.expression,
          result,
        });

        return Promise.resolve(ok({
          success: true,
          output: { result, expression: parsed.expression },
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('calculator', message)));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      try {
        // Validate the expression parses (tokenize + check structure)
        const tokens = tokenize(parsed.expression);
        if (tokens.length === 0) throw new Error('Empty expression');

        return Promise.resolve(ok({
          success: true,
          output: {
            expression: parsed.expression,
            valid: true,
            tokenCount: tokens.length,
            dryRun: true,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('calculator', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/date-time.ts
```typescript
/**
 * Date/time tool — get current time, format, parse, diff, and add operations.
 *
 * Uses built-in Date + Intl.DateTimeFormat APIs (no external libs).
 * All operations are pure — no side effects.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'date-time' });

const timeUnitSchema = z.enum(['ms', 'seconds', 'minutes', 'hours', 'days']);
const addUnitSchema = z.enum(['ms', 'seconds', 'minutes', 'hours', 'days', 'months', 'years']);

const nowSchema = z.object({
  operation: z.literal('now'),
  timezone: z.string().optional(),
});

const formatSchema = z.object({
  operation: z.literal('format'),
  date: z.string(),
  format: z.enum(['iso', 'date', 'time', 'datetime', 'relative']),
  timezone: z.string().optional(),
});

const parseSchema = z.object({
  operation: z.literal('parse'),
  date: z.string(),
  timezone: z.string().optional(),
});

const diffSchema = z.object({
  operation: z.literal('diff'),
  from: z.string(),
  to: z.string(),
  unit: timeUnitSchema.optional().default('ms'),
});

const addSchema = z.object({
  operation: z.literal('add'),
  date: z.string().optional().describe('ISO date string. Defaults to current time if omitted.'),
  amount: z.number(),
  unit: addUnitSchema,
});

const inputSchema = z.discriminatedUnion('operation', [
  nowSchema,
  formatSchema,
  parseSchema,
  diffSchema,
  addSchema,
]);

const outputSchema = z.object({
  result: z.string(),
  iso: z.string(),
  timestamp: z.number(),
});

// ─── Helpers ───────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: "${dateStr}"`);
  }
  return d;
}

function validateTimezone(tz: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    throw new Error(`Invalid timezone: "${tz}"`);
  }
}

function formatInTimezone(date: Date, timezone?: string): string {
  if (!timezone) return date.toISOString();
  validateTimezone(timezone);
  return date.toLocaleString('en-US', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' });
}

function formatDate(
  date: Date,
  format: 'iso' | 'date' | 'time' | 'datetime' | 'relative',
  timezone?: string,
): string {
  const tz = timezone ? { timeZone: timezone } : {};
  if (timezone) validateTimezone(timezone);

  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'date':
      return date.toLocaleDateString('en-US', { ...tz, dateStyle: 'full' });
    case 'time':
      return date.toLocaleTimeString('en-US', { ...tz, timeStyle: 'long' });
    case 'datetime':
      return date.toLocaleString('en-US', { ...tz, dateStyle: 'full', timeStyle: 'long' });
    case 'relative': {
      const diffMs = Date.now() - date.getTime();
      const absDiff = Math.abs(diffMs);
      const future = diffMs < 0;
      if (absDiff < 60_000) return future ? 'in a few seconds' : 'a few seconds ago';
      if (absDiff < 3_600_000) {
        const mins = Math.round(absDiff / 60_000);
        return future ? `in ${String(mins)} minute(s)` : `${String(mins)} minute(s) ago`;
      }
      if (absDiff < 86_400_000) {
        const hours = Math.round(absDiff / 3_600_000);
        return future ? `in ${String(hours)} hour(s)` : `${String(hours)} hour(s) ago`;
      }
      const days = Math.round(absDiff / 86_400_000);
      return future ? `in ${String(days)} day(s)` : `${String(days)} day(s) ago`;
    }
  }
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

function diffInUnit(from: Date, to: Date, unit: string): number {
  const ms = to.getTime() - from.getTime();
  const divisor = UNIT_MS[unit];
  if (!divisor) throw new Error(`Invalid unit: "${unit}"`);
  return ms / divisor;
}

function addToDate(date: Date, amount: number, unit: string): Date {
  const result = new Date(date.getTime());

  if (unit === 'months') {
    result.setMonth(result.getMonth() + amount);
    return result;
  }

  if (unit === 'years') {
    result.setFullYear(result.getFullYear() + amount);
    return result;
  }

  const msPerUnit = UNIT_MS[unit];
  if (!msPerUnit) throw new Error(`Invalid unit: "${unit}"`);
  return new Date(result.getTime() + amount * msPerUnit);
}

// ─── Execution ─────────────────────────────────────────────────

type DateTimeInput = z.infer<typeof inputSchema>;

function executeOperation(input: DateTimeInput): { result: string; iso: string; timestamp: number } {
  switch (input.operation) {
    case 'now': {
      const now = new Date();
      return {
        result: formatInTimezone(now, input.timezone),
        iso: now.toISOString(),
        timestamp: now.getTime(),
      };
    }
    case 'format': {
      const date = parseDate(input.date);
      return {
        result: formatDate(date, input.format, input.timezone),
        iso: date.toISOString(),
        timestamp: date.getTime(),
      };
    }
    case 'parse': {
      const date = parseDate(input.date);
      return {
        result: formatInTimezone(date, input.timezone),
        iso: date.toISOString(),
        timestamp: date.getTime(),
      };
    }
    case 'diff': {
      const from = parseDate(input.from);
      const to = parseDate(input.to);
      const diff = diffInUnit(from, to, input.unit);
      return {
        result: `${String(diff)} ${input.unit}`,
        iso: new Date().toISOString(),
        timestamp: diff,
      };
    }
    case 'add': {
      const date = input.date ? parseDate(input.date) : new Date();
      const result = addToDate(date, input.amount, input.unit);
      return {
        result: result.toISOString(),
        iso: result.toISOString(),
        timestamp: result.getTime(),
      };
    }
  }
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a date/time tool for time operations, formatting, and arithmetic. */
export function createDateTimeTool(): ExecutableTool {
  return {
    id: 'date-time',
    name: 'Date Time',
    description:
      'Perform date/time operations: get current time (now), format dates, parse date strings, ' +
      'calculate differences between dates, and add/subtract time from dates. ' +
      'Supports timezones via IANA timezone names (e.g. "America/New_York").',
    category: 'utility',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const output = executeOperation(parsed);

        logger.debug('Date-time operation completed', {
          component: 'date-time',
          projectId: context.projectId,
          traceId: context.traceId,
          operation: parsed.operation,
        });

        return Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('date-time', message)));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      // Pure function — dry run is the same as execute
      try {
        const output = executeOperation(parsed);
        return Promise.resolve(ok({
          success: true,
          output: { ...output, dryRun: true },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('date-time', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/json-transform.ts
```typescript
/**
 * JSON transform tool — parse, query, and transform JSON data.
 *
 * Pure computation — no side effects. Supports parse, stringify, get (dot-path),
 * set, merge, pick, omit, and flatten operations.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'json-transform' });

const MAX_INPUT_SIZE = 1_048_576; // 1MB

const parseOp = z.object({
  operation: z.literal('parse'),
  data: z.string().max(MAX_INPUT_SIZE),
});

const stringifyOp = z.object({
  operation: z.literal('stringify'),
  data: z.unknown(),
  pretty: z.boolean().optional().default(false),
});

const getOp = z.object({
  operation: z.literal('get'),
  data: z.record(z.unknown()),
  path: z.string().min(1),
});

const setOp = z.object({
  operation: z.literal('set'),
  data: z.record(z.unknown()),
  path: z.string().min(1),
  value: z.unknown(),
});

const mergeOp = z.object({
  operation: z.literal('merge'),
  targets: z.array(z.record(z.unknown())).min(2),
});

const pickOp = z.object({
  operation: z.literal('pick'),
  data: z.record(z.unknown()),
  keys: z.array(z.string()).min(1),
});

const omitOp = z.object({
  operation: z.literal('omit'),
  data: z.record(z.unknown()),
  keys: z.array(z.string()).min(1),
});

const flattenOp = z.object({
  operation: z.literal('flatten'),
  data: z.record(z.unknown()),
  delimiter: z.string().optional().default('.'),
});

const inputSchema = z.discriminatedUnion('operation', [
  parseOp,
  stringifyOp,
  getOp,
  setOp,
  mergeOp,
  pickOp,
  omitOp,
  flattenOp,
]);

const outputSchema = z.object({
  result: z.unknown(),
});

// ─── Helpers ───────────────────────────────────────────────────

/** Get a nested value by dot-notation path (supports numeric array indices). */
function getByPath(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** Set a nested value by dot-notation path, returning a new object. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = path.split('.');
  const result = structuredClone(obj);
  let current: Record<string, unknown> = result;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (segment === undefined) throw new Error('Empty path segment');
    if (!(segment in current) || typeof current[segment] !== 'object' || current[segment] === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const lastSegment = segments[segments.length - 1];
  if (lastSegment === undefined) throw new Error('Empty path');
  current[lastSegment] = value;
  return result;
}

/** Deep merge multiple objects (later values win). */
function deepMerge(targets: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const target of targets) {
    for (const [key, value] of Object.entries(target)) {
      const existing = result[key];
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof existing === 'object' &&
        existing !== null &&
        !Array.isArray(existing)
      ) {
        result[key] = deepMerge([
          existing as Record<string, unknown>,
          value as Record<string, unknown>,
        ]);
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

/** Flatten a nested object to dot-notation keys. */
function flattenObject(
  obj: Record<string, unknown>,
  delimiter: string,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}${delimiter}${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, delimiter, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

// ─── Execution ─────────────────────────────────────────────────

type JsonTransformInput = z.infer<typeof inputSchema>;

function executeOperation(input: JsonTransformInput): unknown {
  switch (input.operation) {
    case 'parse':
      return JSON.parse(input.data) as unknown;
    case 'stringify':
      return input.pretty ? JSON.stringify(input.data, null, 2) : JSON.stringify(input.data);
    case 'get':
      return getByPath(input.data, input.path);
    case 'set':
      return setByPath(input.data, input.path, input.value);
    case 'merge':
      return deepMerge(input.targets);
    case 'pick': {
      const picked: Record<string, unknown> = {};
      for (const key of input.keys) {
        if (key in input.data) {
          picked[key] = input.data[key];
        }
      }
      return picked;
    }
    case 'omit':
      return Object.fromEntries(
        Object.entries(input.data).filter(([k]) => !input.keys.includes(k)),
      );
    case 'flatten':
      return flattenObject(input.data, input.delimiter);
  }
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a JSON transform tool for parsing, querying, and transforming JSON data. */
export function createJsonTransformTool(): ExecutableTool {
  return {
    id: 'json-transform',
    name: 'JSON Transform',
    description:
      'Parse, query, and transform JSON data. Operations: parse (JSON string to object), ' +
      'stringify (object to JSON string), get (dot-path access like "a.b.0.c"), ' +
      'set (set nested value), merge (deep merge objects), pick (select keys), ' +
      'omit (remove keys), flatten (nested to dot-notation).',
    category: 'utility',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const result = executeOperation(parsed);

        logger.debug('JSON transform completed', {
          component: 'json-transform',
          projectId: context.projectId,
          traceId: context.traceId,
          operation: parsed.operation,
        });

        return Promise.resolve(ok({
          success: true,
          output: { result },
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('json-transform', message)));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      // Pure computation — dry run is the same as execute
      try {
        const result = executeOperation(parsed);
        return Promise.resolve(ok({
          success: true,
          output: { result, dryRun: true },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('json-transform', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/knowledge-search.ts
```typescript
/**
 * Knowledge search tool — semantic search over the long-term memory store.
 *
 * Wraps the existing LongTermMemoryStore interface to expose vector search
 * as a tool the agent can invoke during execution.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { MemoryCategory } from '@/memory/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'knowledge-search' });

export interface KnowledgeSearchToolOptions {
  /** The long-term memory store to search against. */
  store: LongTermMemoryStore;
}

const categorySchema = z.enum(['fact', 'decision', 'preference', 'task_context', 'learning']);

const inputSchema = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).optional().default(5),
  minImportance: z.number().min(0).max(1).optional(),
  categories: z.array(categorySchema).optional(),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      content: z.string(),
      category: z.string(),
      importance: z.number(),
      similarity: z.number(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  totalFound: z.number(),
});

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a knowledge search tool backed by the long-term memory store. */
export function createKnowledgeSearchTool(options: KnowledgeSearchToolOptions): ExecutableTool {
  const { store } = options;

  return {
    id: 'knowledge-search',
    name: 'Knowledge Search',
    description:
      'Search the knowledge base for relevant information using semantic similarity. ' +
      'Returns matching entries ranked by relevance. Filter by importance score (0-1) ' +
      'and categories (fact, decision, preference, task_context, learning).',
    category: 'memory',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const retrieved = await store.retrieve({
          query: parsed.query,
          topK: parsed.topK,
          minImportance: parsed.minImportance,
          categories: parsed.categories as MemoryCategory[] | undefined,
        });

        const results = retrieved.map((entry) => ({
          content: entry.content,
          category: entry.category,
          importance: entry.importance,
          similarity: entry.similarityScore,
          metadata: entry.metadata,
        }));

        logger.debug('Knowledge search completed', {
          component: 'knowledge-search',
          projectId: context.projectId,
          traceId: context.traceId,
          query: parsed.query,
          topK: parsed.topK,
          resultsCount: results.length,
        });

        return ok({
          success: true,
          output: { results, totalFound: results.length },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Knowledge search failed', {
          component: 'knowledge-search',
          projectId: context.projectId,
          traceId: context.traceId,
          error: message,
        });
        return err(new ToolExecutionError('knowledge-search', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      return Promise.resolve(ok({
        success: true,
        output: {
          query: parsed.query,
          topK: parsed.topK,
          minImportance: parsed.minImportance,
          categories: parsed.categories,
          dryRun: true,
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/store-memory.ts
```typescript
/**
 * Store Memory tool — lets the agent explicitly persist facts to long-term memory.
 *
 * Use cases:
 * - "Remember that this client prefers installment payments"
 * - "Note that the customer is allergic to shellfish"
 * - "Record that vehicle inquiry was for a pickup truck, black"
 *
 * The embedding is auto-generated by the memory store from the content.
 * Risk level is low — storing memories is always reversible.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'store-memory' });

// ─── Options ───────────────────────────────────────────────────

export interface StoreMemoryToolOptions {
  /** The long-term memory store to persist to. */
  store: LongTermMemoryStore;
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(2000)
    .describe('The fact, preference, or decision to remember. Be concise and specific.'),
  category: z
    .enum(['fact', 'decision', 'preference', 'task_context', 'learning'])
    .describe(
      'Memory category: "fact" for objective facts, "preference" for client preferences, ' +
      '"decision" for choices made, "task_context" for task details, "learning" for lessons.',
    ),
  importance: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .describe('Importance score from 0.0 (trivial) to 1.0 (critical). Default: 0.7.'),
  sessionScoped: z
    .boolean()
    .default(false)
    .describe(
      'If true, memory is scoped to the current session only. ' +
      'If false (default), it persists across all sessions for this project.',
    ),
});

const outputSchema = z.object({
  stored: z.boolean(),
  memoryId: z.string().optional(),
  category: z.string(),
  importance: z.number(),
  sessionScoped: z.boolean(),
});

// ─── Tool Factory ──────────────────────────────────────────────

/**
 * Create a store-memory tool for persisting facts to long-term semantic memory.
 * The agent calls this when it learns something worth remembering about the client.
 */
export function createStoreMemoryTool(options: StoreMemoryToolOptions): ExecutableTool {
  const { store } = options;

  return {
    id: 'store-memory',
    name: 'Store Memory',
    description:
      'Persist a fact, preference, or decision to long-term memory so it can be recalled in future conversations. ' +
      'Use for important client preferences ("prefers installment payments"), key facts ("VIP customer"), ' +
      'decisions made ("quoted $5,000 for truck"), or follow-up reminders. ' +
      'The memory will be automatically retrieved in relevant future conversations.',
    category: 'memory',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const stored = await store.store({
          projectId: context.projectId,
          sessionId: parsed.sessionScoped ? context.sessionId : undefined,
          category: parsed.category,
          content: parsed.content,
          embedding: [], // auto-generated by prisma-memory-store from content
          importance: parsed.importance,
        });

        logger.info('Stored memory via store-memory tool', {
          component: 'store-memory',
          projectId: context.projectId,
          memoryId: stored.id,
          category: stored.category,
          importance: stored.importance,
        });

        return ok({
          success: true,
          output: {
            stored: true,
            memoryId: stored.id,
            category: stored.category as string,
            importance: stored.importance,
            sessionScoped: parsed.sessionScoped,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to store memory', {
          component: 'store-memory',
          projectId: context.projectId,
          error: message,
        });
        return err(new ToolExecutionError('store-memory', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);
      return Promise.resolve(ok({
        success: true,
        output: {
          stored: false,
          category: parsed.category,
          importance: parsed.importance,
          sessionScoped: parsed.sessionScoped,
          dryRun: true,
          previewContent: parsed.content.substring(0, 100),
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/web-search.ts
```typescript
/**
 * Web Search Tool — searches the web via Tavily API.
 * API key is resolved from project secrets (key: TAVILY_API_KEY).
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'web-search' });

// ─── Constants ──────────────────────────────────────────────────

const TAVILY_API_URL = 'https://api.tavily.com/search';
const SECRET_KEY = 'TAVILY_API_KEY';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS_LIMIT = 10;

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  query: z.string().min(1).max(2000).describe('Search query'),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).default(5)
    .describe('Maximum number of results to return (1-10)'),
});

const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number(),
});

const outputSchema = z.object({
  results: z.array(searchResultSchema),
  query: z.string(),
});

// ─── Tavily API Response Shape ──────────────────────────────────

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
}

// ─── Options ────────────────────────────────────────────────────

export interface WebSearchToolOptions {
  secretService: SecretService;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a web-search tool that queries the Tavily API. */
export function createWebSearchTool(options: WebSearchToolOptions): ExecutableTool {
  const { secretService } = options;

  return {
    id: 'web-search',
    name: 'Web Search',
    description: 'Searches the web using the Tavily API. Returns titles, URLs, content snippets, and relevance scores. Requires TAVILY_API_KEY in project secrets.',
    category: 'search',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // Resolve API key from project secrets
        const apiKey = await secretService.get(context.projectId, SECRET_KEY);

        const response = await fetch(TAVILY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query: parsed.query,
            max_results: parsed.maxResults,
            include_answer: false,
          }),
          signal: AbortSignal.any([
            context.abortSignal,
            AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ]),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return err(new ToolExecutionError(
            'web-search',
            `Tavily API returned ${response.status}: ${errorText}`,
          ));
        }

        const data = await response.json() as TavilyResponse;

        const results = data.results.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          score: r.score,
        }));

        logger.info('Web search completed', {
          component: 'web-search',
          projectId: context.projectId,
          traceId: context.traceId,
          query: parsed.query,
          resultsCount: results.length,
        });

        return ok({
          success: true,
          output: { results, query: parsed.query },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('web-search', message));
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);

      try {
        // Verify the API key exists (without revealing it)
        const exists = await secretService.exists(context.projectId, SECRET_KEY);

        return await Promise.resolve(ok({
          success: true,
          output: {
            dryRun: true,
            query: parsed.query,
            maxResults: parsed.maxResults,
            apiKeyConfigured: exists,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return await Promise.resolve(err(new ToolExecutionError('web-search', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/scrape-webpage.ts
```typescript
/**
 * Scrape Webpage Tool — loads a URL in a headless browser and extracts content.
 * Uses Puppeteer for full JS rendering. Handles SPAs, dynamic pages, screenshots.
 * Includes SSRF protection. Designed for the manager agent.
 */
import { z } from 'zod';
import puppeteer from 'puppeteer';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'scrape-webpage' });

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONTENT_LENGTH = 15_000; // chars of extracted text to return

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  url: z.string().url()
    .describe('The URL of the webpage to scrape.'),
  selector: z.string().optional()
    .describe('Optional CSS selector to extract a specific section (e.g. ".product-list", "#prices"). If omitted, extracts the full page content.'),
  waitForSelector: z.string().optional()
    .describe('Optional CSS selector to wait for before extracting content. Useful for SPAs that load data dynamically.'),
  extractLinks: z.boolean().default(false)
    .describe('Whether to include links found on the page. Default: false.'),
  screenshot: z.boolean().default(false)
    .describe('Whether to take a screenshot of the page. Returns base64 encoded PNG. Default: false.'),
});

const outputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  metaDescription: z.string().optional(),
  content: z.string(),
  contentLength: z.number(),
  truncated: z.boolean(),
  links: z.array(z.object({
    text: z.string(),
    href: z.string(),
  })).optional(),
  screenshotBase64: z.string().optional(),
});

// ─── SSRF Protection ────────────────────────────────────────────

const BLOCKED_IPV4_PREFIXES = [
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.', '127.', '169.254.', '0.',
];

const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', '[::1]', '[::0]'];

/** Block requests to private/loopback addresses. */
function validateUrl(urlStr: string): URL {
  const parsed = new URL(urlStr);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  const lower = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(lower)) {
    throw new Error('Blocked host: requests to private/reserved IPs are not allowed');
  }
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (lower.startsWith(prefix)) {
      throw new Error('Blocked host: requests to private/reserved IPs are not allowed');
    }
  }
  if (lower.startsWith('[fc') || lower.startsWith('[fd') ||
      lower.startsWith('[fe8') || lower.startsWith('[fe9')) {
    throw new Error('Blocked host: requests to private/reserved IPs are not allowed');
  }

  return parsed;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a scrape-webpage tool powered by Puppeteer (headless Chrome). */
export function createScrapeWebpageTool(): ExecutableTool {
  return {
    id: 'scrape-webpage',
    name: 'Scrape Webpage',
    description:
      'Load a URL in a headless browser and extract its content. Renders JavaScript (works with SPAs). ' +
      'Returns page title, meta description, cleaned text, and optionally links or a screenshot. ' +
      'Use a CSS selector to target specific sections. Can wait for dynamic content to load.',
    category: 'integration',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        url: string;
        selector?: string;
        waitForSelector?: string;
        extractLinks: boolean;
        screenshot: boolean;
      };

      let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

      try {
        // Validate URL (SSRF protection)
        const parsedUrl = validateUrl(data.url);

        logger.info('Scraping webpage with Puppeteer', {
          component: 'scrape-webpage',
          url: parsedUrl.origin + parsedUrl.pathname,
        });

        // Launch browser
        browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        });

        const page = await browser.newPage();

        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 900 });
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        );

        // Navigate to URL
        await page.goto(data.url, {
          waitUntil: 'networkidle2',
          timeout: DEFAULT_TIMEOUT_MS,
        });

        // Wait for specific selector if requested
        if (data.waitForSelector) {
          await page.waitForSelector(data.waitForSelector, { timeout: 10_000 }).catch(() => {
            logger.info('waitForSelector timed out, continuing with available content', {
              component: 'scrape-webpage',
              selector: data.waitForSelector,
            });
          });
        }

        // Extract content using page.evaluate (runs in browser context)
        const extracted = await page.evaluate((opts: { selector?: string; extractLinks: boolean; maxLen: number }) => {
          // Remove noise
          const noise = document.querySelectorAll('script, style, noscript, iframe, svg');
          noise.forEach((el) => el.remove());

          const title = document.title || undefined;
          const metaEl = document.querySelector('meta[name="description"]');
          const metaDescription = metaEl?.getAttribute('content')?.trim() || undefined;

          // Find content root
          let root: Element | null = null;
          if (opts.selector) {
            root = document.querySelector(opts.selector);
          }
          if (!root) {
            root = document.querySelector('main, article, [role="main"]');
          }
          if (!root) {
            root = document.body;
          }

          // Extract text
          const rawText = (root as HTMLElement).innerText || root.textContent || '';
          const content = rawText
            .replace(/[\t ]+/g, ' ')
            .replace(/\n\s*\n+/g, '\n\n')
            .trim();

          const truncated = content.length > opts.maxLen;
          const finalContent = truncated ? content.slice(0, opts.maxLen) + '...' : content;

          // Extract links if requested
          let links: Array<{ text: string; href: string }> | undefined;
          if (opts.extractLinks) {
            const linkEls = (opts.selector ? root : document.body).querySelectorAll('a[href]');
            const seen = new Set<string>();
            links = [];
            linkEls.forEach((a) => {
              const href = (a as HTMLAnchorElement).href;
              const text = (a as HTMLAnchorElement).innerText?.trim();
              if (!href || !text || !href.startsWith('http') || seen.has(href)) return;
              seen.add(href);
              links!.push({ text: text.slice(0, 100), href });
            });
            links = links.slice(0, 50);
          }

          return { title, metaDescription, content: finalContent, contentLength: finalContent.length, truncated, links };
        }, { selector: data.selector, extractLinks: data.extractLinks, maxLen: MAX_CONTENT_LENGTH });

        // Screenshot if requested
        let screenshotBase64: string | undefined;
        if (data.screenshot) {
          const buffer = await page.screenshot({ type: 'png', fullPage: false });
          screenshotBase64 = Buffer.from(buffer).toString('base64');
        }

        await browser.close();
        browser = null;

        const output = {
          url: data.url,
          title: extracted.title,
          metaDescription: extracted.metaDescription,
          content: extracted.content,
          contentLength: extracted.contentLength,
          truncated: extracted.truncated,
          links: extracted.links,
          screenshotBase64,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'scrape-webpage',
          error instanceof Error ? error.message : 'Unknown error scraping webpage',
        ));
      } finally {
        if (browser) {
          await browser.close().catch(() => { /* ignore */ });
        }
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        url: string;
        selector?: string;
        waitForSelector?: string;
        extractLinks: boolean;
        screenshot: boolean;
      };

      try {
        validateUrl(data.url);
      } catch (error) {
        return err(new ToolExecutionError(
          'scrape-webpage',
          error instanceof Error ? error.message : 'Invalid URL',
        ));
      }

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would open ${data.url} in headless Chrome`,
          selector: data.selector ?? '(full page)',
          waitForSelector: data.waitForSelector,
          extractLinks: data.extractLinks,
          screenshot: data.screenshot,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
```

---
## src/tools/definitions/read-file.ts
```typescript
/**
 * Read File Tool — parses uploaded files (CSV, JSON, plain text, PDF).
 * Retrieves files via the FileService and extracts text or structured data.
 */
import { z } from 'zod';
import type { ExecutionContext, ProjectId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { FileService } from '@/files/file-service.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'read-file' });

// ─── Constants ──────────────────────────────────────────────────

/** Maximum file size for processing (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Supported MIME types. */
const SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'application/json',
  'application/pdf',
] as const;

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  fileId: z.string().min(1).optional()
    .describe('ID of the uploaded file (use this when you know the file ID)'),
  filename: z.string().min(1).optional()
    .describe('Original filename to look up by name, e.g. "lista-precios.txt" (use when fileId is not known)'),
  extractionMode: z.enum(['text', 'structured']).default('text')
    .describe('Extraction mode: "text" returns raw text, "structured" returns parsed data (JSON objects, CSV rows)'),
}).refine(
  (data) => data.fileId !== undefined || data.filename !== undefined,
  { message: 'Either fileId or filename must be provided' },
);

const outputSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  content: z.unknown(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ReadFileToolOptions {
  fileService: FileService;
}

// ─── Parsers ────────────────────────────────────────────────────

/** Parse CSV content into rows of objects. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  // Parse header
  const headers = splitCsvLine(lines[0] ?? '');
  if (headers.length === 0) return [];

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i] ?? '');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j] ?? `column_${j}`;
      row[header] = values[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

/** Split a CSV line respecting quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line.charAt(i + 1) === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a read-file tool that parses uploaded files. */
export function createReadFileTool(options: ReadFileToolOptions): ExecutableTool {
  const { fileService } = options;

  async function extractContent(
    buffer: Buffer,
    mimeType: string,
    mode: 'text' | 'structured',
  ): Promise<unknown> {
    const text = buffer.toString('utf-8');

    switch (mimeType) {
      case 'text/plain':
        return text;

      case 'text/csv':
        if (mode === 'structured') {
          return parseCsv(text);
        }
        return text;

      case 'application/json': {
        if (mode === 'structured') {
          return JSON.parse(text) as unknown;
        }
        return text;
      }

      case 'application/pdf': {
        const { PDFParse } = await import('pdf-parse');
        const pdf = new PDFParse({ data: new Uint8Array(buffer) });
        const textResult = await pdf.getText();
        await pdf.destroy();
        if (mode === 'structured') {
          return { text: textResult.text, pages: textResult.total };
        }
        return textResult.text;
      }

      default:
        // Attempt to read as plain text
        return text;
    }
  }

  return {
    id: 'read-file',
    name: 'Read File',
    description: 'Reads and parses an uploaded file. Supports CSV, JSON, plain text, and PDF formats. Returns extracted text or structured data (JSON objects, CSV rows). You can identify the file by fileId or by its original filename (e.g. "lista-precios.txt").',
    category: 'data',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // Resolve fileId — either directly provided or looked up by filename
        let resolvedFileId = parsed.fileId;

        if (!resolvedFileId && parsed.filename) {
          const files = await fileService.listByProject(context.projectId as ProjectId);
          const match = files.find(
            (f) => f.originalFilename.toLowerCase() === parsed.filename!.toLowerCase(),
          );
          if (!match) {
            const available = files.map((f) => f.originalFilename).join(', ');
            return err(new ToolExecutionError(
              'read-file',
              `File "${parsed.filename}" not found in project.${available ? ` Available files: ${available}` : ''}`,
            ));
          }
          resolvedFileId = match.id;
        }

        // Download file via FileService
        const { file, content } = await fileService.download(resolvedFileId!);

        // Validate file size
        if (file.sizeBytes > MAX_FILE_SIZE) {
          return err(new ToolExecutionError(
            'read-file',
            `File too large: ${file.sizeBytes} bytes (max ${MAX_FILE_SIZE} bytes)`,
          ));
        }

        // Validate MIME type
        const supportedTypes: readonly string[] = SUPPORTED_MIME_TYPES;
        if (!supportedTypes.includes(file.mimeType)) {
          return err(new ToolExecutionError(
            'read-file',
            `Unsupported file type: ${file.mimeType}. Supported: ${SUPPORTED_MIME_TYPES.join(', ')}`,
          ));
        }

        // Extract content
        const extracted = await extractContent(content, file.mimeType, parsed.extractionMode);

        logger.info('File read completed', {
          component: 'read-file',
          projectId: context.projectId,
          traceId: context.traceId,
          fileId: parsed.fileId,
          filename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          extractionMode: parsed.extractionMode,
        });

        return ok({
          success: true,
          output: {
            filename: file.originalFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            content: extracted,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('read-file', message));
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);

      try {
        // Resolve file — by fileId or by filename lookup
        let file = parsed.fileId ? await fileService.getById(parsed.fileId) : null;

        if (!file && parsed.filename) {
          const files = await fileService.listByProject(context.projectId as ProjectId);
          file = files.find(
            (f) => f.originalFilename.toLowerCase() === parsed.filename!.toLowerCase(),
          ) ?? null;
        }

        if (!file) {
          return await Promise.resolve(err(new ToolExecutionError(
            'read-file',
            `File not found: ${parsed.fileId}`,
          )));
        }

        const supportedTypes: readonly string[] = SUPPORTED_MIME_TYPES;

        return await Promise.resolve(ok({
          success: true,
          output: {
            dryRun: true,
            fileId: parsed.fileId,
            filename: file.originalFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            extractionMode: parsed.extractionMode,
            supported: supportedTypes.includes(file.mimeType),
            withinSizeLimit: file.sizeBytes <= MAX_FILE_SIZE,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return await Promise.resolve(err(new ToolExecutionError('read-file', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/send-email.ts
```typescript
/**
 * Send Email Tool — sends emails via the Resend API.
 * API key is resolved from project secrets (key: RESEND_API_KEY).
 * From address is resolved from project secrets (key: RESEND_FROM_EMAIL).
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'send-email' });

// ─── Constants ──────────────────────────────────────────────────

const RESEND_API_URL = 'https://api.resend.com/emails';
const SECRET_KEY_API = 'RESEND_API_KEY';
const SECRET_KEY_FROM = 'RESEND_FROM_EMAIL';
const DEFAULT_FROM = 'onboarding@resend.dev';
const REQUEST_TIMEOUT_MS = 15_000;

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  to: z.string().email().describe('Recipient email address'),
  subject: z.string().min(1).max(500).describe('Email subject'),
  body: z.string().min(1).max(50_000).describe('Email body (plain text or HTML)'),
  replyTo: z.string().email().optional().describe('Reply-to email address'),
});

const outputSchema = z.object({
  sent: z.boolean(),
  messageId: z.string(),
});

// ─── Resend API Response ────────────────────────────────────────

interface ResendResponse {
  id: string;
}

// ─── Options ────────────────────────────────────────────────────

export interface SendEmailToolOptions {
  secretService: SecretService;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a send-email tool that uses the Resend API. */
export function createSendEmailTool(options: SendEmailToolOptions): ExecutableTool {
  const { secretService } = options;

  return {
    id: 'send-email',
    name: 'Send Email',
    description: 'Sends an email via the Resend API. Requires RESEND_API_KEY and optionally RESEND_FROM_EMAIL in project secrets. High-risk tool that requires human approval.',
    category: 'communication',
    inputSchema,
    outputSchema,
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // Resolve API key and from address from project secrets
        const apiKey = await secretService.get(context.projectId, SECRET_KEY_API);

        let fromAddress = DEFAULT_FROM;
        try {
          fromAddress = await secretService.get(context.projectId, SECRET_KEY_FROM);
        } catch {
          // RESEND_FROM_EMAIL is optional, use default
        }

        const requestBody: Record<string, string> = {
          from: fromAddress,
          to: parsed.to,
          subject: parsed.subject,
          html: parsed.body,
        };

        if (parsed.replyTo) {
          requestBody['reply_to'] = parsed.replyTo;
        }

        const response = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.any([
            context.abortSignal,
            AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ]),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `Resend API returned ${response.status}: ${errorText}`;

          if (errorText.includes('your own email address') || response.status === 403) {
            errorMessage = `Error de Resend: El usuario tiene un plan gratuito y no ha verificado un dominio. Sólo puede enviarse correos a SÍ MISMO (la misma dirección de email exacta usada para registrar su cuenta en Resend). Explícale esto claramente y pregúntale cuál es su email de registro en resend.`;
          }

          return err(new ToolExecutionError(
            'send-email',
            errorMessage,
          ));
        }

        const data = await response.json() as ResendResponse;

        logger.info('Email sent', {
          component: 'send-email',
          projectId: context.projectId,
          traceId: context.traceId,
          to: parsed.to,
          subject: parsed.subject,
          messageId: data.id,
        });

        return ok({
          success: true,
          output: { sent: true, messageId: data.id },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('send-email', message));
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);

      try {
        const apiKeyExists = await secretService.exists(context.projectId, SECRET_KEY_API);
        const fromExists = await secretService.exists(context.projectId, SECRET_KEY_FROM);

        return await Promise.resolve(ok({
          success: true,
          output: {
            dryRun: true,
            to: parsed.to,
            subject: parsed.subject,
            bodyLength: parsed.body.length,
            replyTo: parsed.replyTo,
            apiKeyConfigured: apiKeyExists,
            fromAddressConfigured: fromExists,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return await Promise.resolve(err(new ToolExecutionError('send-email', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/send-channel-message.ts
```typescript
/**
 * Send Channel Message Tool — sends messages via per-project channel adapters.
 * Routes through the ChannelResolver to resolve project-specific adapters.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { IntegrationProvider } from '@/channels/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'send-channel-message' });

// ─── Schemas ────────────────────────────────────────────────────

const ChannelTypeSchema = z.enum([
  'whatsapp',
  'telegram',
  'slack',
  'chatwoot',
]);

const inputSchema = z.object({
  channel: ChannelTypeSchema.describe('Channel to send the message through'),
  recipientIdentifier: z.string().min(1).max(500)
    .describe('Recipient identifier (phone number, chat ID, channel ID, etc.)'),
  message: z.string().min(1).max(10_000).describe('Message content'),
});

const outputSchema = z.object({
  success: z.boolean(),
  channelMessageId: z.string().optional(),
  error: z.string().optional(),
});

// ─── Options ────────────────────────────────────────────────────

export interface SendChannelMessageToolOptions {
  channelResolver: ChannelResolver;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a send-channel-message tool that routes through per-project channel adapters. */
export function createSendChannelMessageTool(
  options: SendChannelMessageToolOptions,
): ExecutableTool {
  const { channelResolver } = options;

  return {
    id: 'send-channel-message',
    name: 'Send Channel Message',
    description: 'Sends a message through a per-project channel adapter (WhatsApp, Telegram, Slack, Chatwoot). Requires the target channel to be configured as an integration for the project. Medium-risk tool that requires human approval.',
    category: 'communication',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const channel = parsed.channel as IntegrationProvider;

        const adapter = await channelResolver.resolveAdapter(context.projectId, channel);
        if (!adapter) {
          return err(new ToolExecutionError(
            'send-channel-message',
            `No ${channel} integration configured for this project. Set up a ${channel} integration first.`,
          ));
        }

        const result = await channelResolver.send(context.projectId, channel, {
          channel,
          recipientIdentifier: parsed.recipientIdentifier,
          content: parsed.message,
        });

        if (!result.success) {
          return err(new ToolExecutionError(
            'send-channel-message',
            result.error ?? `Failed to send message via ${channel}`,
          ));
        }

        logger.info('Channel message sent', {
          component: 'send-channel-message',
          projectId: context.projectId,
          traceId: context.traceId,
          channel,
          channelMessageId: result.channelMessageId,
        });

        return ok({
          success: true,
          output: {
            success: true,
            channelMessageId: result.channelMessageId,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('send-channel-message', message));
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);

      const channel = parsed.channel as IntegrationProvider;
      const adapter = await channelResolver.resolveAdapter(context.projectId, channel);

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          channel,
          recipientIdentifier: parsed.recipientIdentifier,
          messageLength: parsed.message.length,
          adapterConfigured: adapter !== null,
        },
        durationMs: 0,
      }));
    },
  };
}
```

---
## src/tools/definitions/send-notification.ts
```typescript
/**
 * Send notification tool — send notifications via configured channels.
 *
 * High-risk tool that requires human approval before execution.
 * Currently supports webhook channel (HTTP POST to target URL).
 * Includes SSRF protection on target URLs.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'send-notification' });

// ─── Notification Sender Interface ─────────────────────────────

export interface NotificationSender {
  send(params: {
    channel: string;
    target: string;
    subject: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; response?: unknown }>;
}

export interface SendNotificationToolOptions {
  /** Custom notification sender. If not provided, uses default webhook sender. */
  sender?: NotificationSender;
}

// ─── SSRF Protection (shared logic) ────────────────────────────

const BLOCKED_IPV4_PREFIXES = [
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.', '127.', '169.254.', '0.',
];

const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', '[::1]', '[::0]'];

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(lower)) return true;
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  if (lower.startsWith('[fc') || lower.startsWith('[fd')) return true;
  if (lower.startsWith('[fe8') || lower.startsWith('[fe9') || lower.startsWith('[fea') || lower.startsWith('[feb')) return true;
  return false;
}

function validateTargetUrl(urlStr: string): void {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error('Blocked host: notifications to private/reserved IPs are not allowed');
  }
}

// ─── Default Webhook Sender ────────────────────────────────────

function createDefaultWebhookSender(): NotificationSender {
  return {
    async send(params) {
      const response = await fetch(params.target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: params.subject,
          message: params.message,
          metadata: params.metadata,
          channel: params.channel,
          sentAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(30_000),
      });

      return {
        success: response.ok,
        response: {
          status: response.status,
          statusText: response.statusText,
        },
      };
    },
  };
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  channel: z.enum(['webhook']),
  target: z.string().url(),
  subject: z.string().min(1).max(500),
  message: z.string().min(1).max(10_000),
  metadata: z.record(z.unknown()).optional(),
});

const outputSchema = z.object({
  sent: z.boolean(),
  channel: z.string(),
  timestamp: z.string(),
  response: z.unknown().optional(),
});

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a send-notification tool for delivering messages via configured channels. */
export function createSendNotificationTool(options?: SendNotificationToolOptions): ExecutableTool {
  const sender = options?.sender ?? createDefaultWebhookSender();

  return {
    id: 'send-notification',
    name: 'Send Notification',
    description:
      'Send a notification via a configured channel. Currently supports webhook (HTTP POST). ' +
      'This is a high-risk tool that requires human approval before execution. ' +
      'Provide a target URL, subject, and message body.',
    category: 'communication',
    inputSchema,
    outputSchema,
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // SSRF check on target URL
        validateTargetUrl(parsed.target);

        logger.info('Sending notification', {
          component: 'send-notification',
          projectId: context.projectId,
          traceId: context.traceId,
          channel: parsed.channel,
          target: parsed.target,
          subject: parsed.subject,
        });

        const result = await sender.send({
          channel: parsed.channel,
          target: parsed.target,
          subject: parsed.subject,
          message: parsed.message,
          metadata: parsed.metadata,
        });

        const timestamp = new Date().toISOString();

        logger.info('Notification sent', {
          component: 'send-notification',
          projectId: context.projectId,
          traceId: context.traceId,
          channel: parsed.channel,
          success: result.success,
        });

        return ok({
          success: true,
          output: {
            sent: result.success,
            channel: parsed.channel,
            timestamp,
            response: result.response,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Notification failed', {
          component: 'send-notification',
          projectId: context.projectId,
          traceId: context.traceId,
          channel: parsed.channel,
          error: message,
        });
        return err(new ToolExecutionError('send-notification', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      try {
        // Validate target URL (SSRF check) without sending
        validateTargetUrl(parsed.target);

        return Promise.resolve(ok({
          success: true,
          output: {
            channel: parsed.channel,
            target: parsed.target,
            subject: parsed.subject,
            messageLength: parsed.message.length,
            hasMetadata: parsed.metadata !== undefined,
            dryRun: true,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('send-notification', message)));
      }
    },
  };
}
```

---
## src/tools/definitions/escalate-to-human.ts
```typescript
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'escalate-to-human' });

const inputSchema = z.object({
    query: z.string().min(1).describe('The specific question or request to escalate to a human manager.'),
    context: z.string().optional().describe('Optional background information or conversation history relevant to the query.'),
});

const outputSchema = z.object({
    reply: z.string(),
    approved: z.boolean(),
});

/**
 * Create a tool to escalate queries to a Human manager.
 * This tool is inherently trapped by the Approval Gate and its execute method
 * is never actually called during normal operation.
 */
export function createEscalateToHumanTool(): ExecutableTool {
    return {
        id: 'escalate-to-human',
        name: 'Escalate to Human',
        description:
            'Consult a human manager for approval, pricing decisions, or complex queries. ' +
            'This tool halts execution and waits for a human to review the request and provide a response.',
        category: 'communication',
        inputSchema,
        outputSchema,
        riskLevel: 'critical',
        requiresApproval: true, // This setting causes the ToolRegistry to intercept execution
        sideEffects: true,
        supportsDryRun: false,

        async execute(
            input: unknown,
            context: ExecutionContext,
        ): Promise<Result<ToolResult, NexusError>> {
            logger.warn('escalate-to-human execute() called directly, which bypasses the Approval Gate!', {
                component: 'escalate-to-human',
                projectId: context.projectId,
            });

            // In the HITL flow, the `agent-runner` or the API resume endpoint injects the
            // `tool_result` manually into the LLM context after the human resolves the approval.
            // Therefore, this method should only be reached in testing scenarios.
            return ok({
                success: true,
                output: {
                    reply: 'Human approval bypassed in testing mode.',
                    approved: true,
                },
                durationMs: 0,
            });
        },

        dryRun(): Promise<Result<ToolResult, NexusError>> {
            return Promise.resolve(ok({
                success: true,
                output: {
                    reply: 'Dry run - Human would have approved this.',
                    approved: true,
                },
                durationMs: 0,
            }));
        },
    };
}
```

