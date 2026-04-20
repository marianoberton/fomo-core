/**
 * Admin sandbox tools.
 *
 * - admin-sandbox-run: run a one-shot sandbox test
 * - admin-sandbox-compare: compare two sandbox runs
 * - admin-sandbox-promote: promote sandbox results to production (high risk)
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-sandbox' });

/** DI for sandbox tools. */
export interface AdminSandboxToolOptions {
  prisma: PrismaClient;
  /** The createSandboxRunner function from sandbox-runner.ts */
  sandboxRunner?: {
    run(params: {
      agentId: string;
      projectId: string;
      message: string;
      overrides?: Record<string, unknown>;
    }): Promise<{ traceId: string; metrics: Record<string, unknown>; response: string; sandboxId: string }>;
  };
}

// ─── admin-sandbox-run ─────────────────────────────────────────────

const sandboxRunInput = z.object({
  agentId: z.string(),
  projectId: z.string(),
  message: z.string().min(1),
  overrides: z.record(z.unknown()).optional(),
});

const sandboxRunOutput = z.object({
  traceId: z.string(),
  sandboxId: z.string(),
  response: z.string(),
  metrics: z.record(z.unknown()),
});

/**
 * Create the admin-sandbox-run tool.
 *
 * Runs a one-shot sandbox test with an agent configuration.
 */
export function createAdminSandboxRunTool(
  options: AdminSandboxToolOptions,
): ExecutableTool {
  return {
    id: 'admin-sandbox-run',
    name: 'Admin Sandbox Run',
    description:
      'Run a one-shot sandbox test: send a message to an agent in an isolated sandbox. ' +
      'Returns the response, metrics, and trace ID for analysis.',
    category: 'admin',
    inputSchema: sandboxRunInput,
    outputSchema: sandboxRunOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = sandboxRunInput.parse(input);

      if (!options.sandboxRunner) {
        return err(
          new ToolExecutionError('admin-sandbox-run', 'Sandbox runner not configured'),
        );
      }

      logger.info('Running sandbox test', {
        component: 'admin-sandbox-run',
        agentId: parsed.agentId,
        projectId: parsed.projectId,
      });

      try {
        const result = await options.sandboxRunner.run({
          agentId: parsed.agentId,
          projectId: parsed.projectId,
          message: parsed.message,
          overrides: parsed.overrides,
        });

        return ok({
          success: true,
          output: {
            traceId: result.traceId,
            sandboxId: result.sandboxId,
            response: result.response,
            metrics: result.metrics,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-sandbox-run',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = sandboxRunInput.parse(input);
      return ok({
        success: true,
        output: {
          traceId: '[dry-run]',
          sandboxId: '[dry-run]',
          response: '[dry-run]',
          wouldRun: true,
          agentId: parsed.agentId,
          message: parsed.message.slice(0, 50),
        },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-sandbox-compare ─────────────────────────────────────────

const compareInput = z.object({
  traceIdA: z.string().describe('Trace ID of first run (baseline).'),
  traceIdB: z.string().describe('Trace ID of second run (candidate).'),
});

/**
 * Create the admin-sandbox-compare tool.
 *
 * Compares metrics between two sandbox traces.
 */
export function createAdminSandboxCompareTool(
  options: AdminSandboxToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-sandbox-compare',
    name: 'Admin Sandbox Compare',
    description:
      'Compare two sandbox run traces side-by-side. Returns duration, token usage, ' +
      'cost, and turn count differences.',
    category: 'admin',
    inputSchema: compareInput,
    outputSchema: z.object({
      traceA: z.record(z.unknown()),
      traceB: z.record(z.unknown()),
      diff: z.record(z.unknown()),
    }),
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = compareInput.parse(input);

      try {
        const [traceA, traceB] = await Promise.all([
          prisma.executionTrace.findUnique({ where: { id: parsed.traceIdA } }),
          prisma.executionTrace.findUnique({ where: { id: parsed.traceIdB } }),
        ]);

        if (!traceA) return err(new ToolExecutionError('admin-sandbox-compare', `Trace A not found: ${parsed.traceIdA}`));
        if (!traceB) return err(new ToolExecutionError('admin-sandbox-compare', `Trace B not found: ${parsed.traceIdB}`));

        const metricA = { duration: traceA.totalDurationMs, tokens: traceA.totalTokensUsed, cost: traceA.totalCostUsd, turns: traceA.turnCount };
        const metricB = { duration: traceB.totalDurationMs, tokens: traceB.totalTokensUsed, cost: traceB.totalCostUsd, turns: traceB.turnCount };

        return ok({
          success: true,
          output: {
            traceA: { id: traceA.id, ...metricA, status: traceA.status },
            traceB: { id: traceB.id, ...metricB, status: traceB.status },
            diff: {
              durationDelta: metricB.duration - metricA.duration,
              tokensDelta: metricB.tokens - metricA.tokens,
              costDelta: Math.round((metricB.cost - metricA.cost) * 10000) / 10000,
              turnsDelta: metricB.turns - metricA.turns,
              improved: metricB.cost <= metricA.cost && metricB.duration <= metricA.duration,
            },
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof ToolExecutionError) return err(e);
        return err(
          new ToolExecutionError(
            'admin-sandbox-compare',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}

// ─── admin-sandbox-promote ─────────────────────────────────────────

const promoteInput = z.object({
  agentId: z.string(),
  layerIds: z.array(z.string()).describe('Prompt layer IDs to activate.'),
  model: z.string().optional().describe('New model to set (if changed).'),
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
  reason: z.string().min(1).describe('Why this promotion is happening.'),
});

/**
 * Create the admin-sandbox-promote tool.
 *
 * Promotes sandbox-tested changes to production. High risk — requires approval.
 */
export function createAdminSandboxPromoteTool(
  options: AdminSandboxToolOptions & {
    agentRepository: import('@/agents/types.js').AgentRepository;
  },
): ExecutableTool {
  const { prisma, agentRepository } = options;

  return {
    id: 'admin-sandbox-promote',
    name: 'Admin Sandbox Promote',
    description:
      'Promote sandbox-validated changes to production: activate prompt layers ' +
      'and optionally update the model. Requires approval.',
    category: 'admin',
    inputSchema: promoteInput,
    outputSchema: z.object({ promoted: z.boolean(), activatedLayers: z.number() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = promoteInput.parse(input);

      logger.info('Promoting sandbox results', {
        component: 'admin-sandbox-promote',
        agentId: parsed.agentId,
        reason: parsed.reason,
      });

      try {
        // Activate each layer
        let activatedCount = 0;
        for (const layerId of parsed.layerIds) {
          const layer = await prisma.promptLayer.findUnique({ where: { id: layerId } });
          if (!layer) continue;

          // Deactivate current active
          await prisma.promptLayer.updateMany({
            where: {
              projectId: layer.projectId,
              layerType: layer.layerType,
              isActive: true,
            },
            data: { isActive: false },
          });

          // Activate target
          await prisma.promptLayer.update({
            where: { id: layerId },
            data: { isActive: true },
          });
          activatedCount++;
        }

        // Update model if specified
        if (parsed.model && parsed.provider) {
          await agentRepository.update(
            parsed.agentId as import('@/agents/types.js').AgentId,
            {
              llmConfig: {
                provider: parsed.provider,
                model: parsed.model,
              },
            },
          );
        }

        return ok({
          success: true,
          output: { promoted: true, activatedLayers: activatedCount },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-sandbox-promote',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = promoteInput.parse(input);
      return ok({
        success: true,
        output: {
          promoted: false,
          wouldActivateLayers: parsed.layerIds.length,
          wouldSetModel: parsed.model ?? null,
          reason: parsed.reason,
        },
        durationMs: 0,
      });
    },
  };
}
