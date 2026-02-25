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
