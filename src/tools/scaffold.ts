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
