import type { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';

// ─── Risk Levels ────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ─── Tool Definition ────────────────────────────────────────────

export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema?: z.ZodType;
  readonly riskLevel: RiskLevel;
  readonly requiresApproval: boolean;
  readonly sideEffects: boolean;
  readonly supportsDryRun: boolean;
}

// ─── Tool Result ────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

// ─── Executable Tool ────────────────────────────────────────────

export interface ExecutableTool extends ToolDefinition {
  /** Execute the tool with real side effects. */
  execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>;

  /** Execute without side effects — returns what would happen. */
  dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>;

  /** Check if the tool's external dependencies are healthy. */
  healthCheck?(): Promise<boolean>;
}

// ─── Tool Call Event ────────────────────────────────────────────

export interface ToolCallEvent {
  toolCallId: string;
  toolId: string;
  input: Record<string, unknown>;
  result?: ToolResult;
  approvalRequired: boolean;
  approvalId?: string;
}
