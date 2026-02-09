/**
 * Fake tool implementations for testing.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';

/** A minimal echo tool for testing. Low risk, no approval required. */
export function createEchoTool(): ExecutableTool {
  return {
    id: 'echo',
    name: 'Echo',
    description: 'Echoes the input message back.',
    category: 'utility',
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ echo: z.string() }),
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = z.object({ message: z.string() }).parse(input);
      return Promise.resolve(ok({
        success: true,
        output: { echo: parsed.message },
        durationMs: 1,
      }));
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = z.object({ message: z.string() }).parse(input);
      return Promise.resolve(ok({
        success: true,
        output: { echo: parsed.message, dryRun: true },
        durationMs: 0,
      }));
    },
  };
}

/** A high-risk tool that requires approval. For testing approval gates. */
export function createDangerousTool(): ExecutableTool {
  return {
    id: 'dangerous-action',
    name: 'Dangerous Action',
    description: 'A high-risk tool that requires human approval.',
    category: 'admin',
    inputSchema: z.object({ target: z.string() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = z.object({ target: z.string() }).parse(input);
      return Promise.resolve(ok({
        success: true,
        output: { executed: parsed.target },
        durationMs: 5,
      }));
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = z.object({ target: z.string() }).parse(input);
      return Promise.resolve(ok({
        success: true,
        output: { wouldExecute: parsed.target, dryRun: true },
        durationMs: 0,
      }));
    },
  };
}
