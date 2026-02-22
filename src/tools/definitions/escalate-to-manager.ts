import { z } from 'zod';
import type { ExecutionContext, ProjectId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import type { AgentComms, AgentId } from '@/agents/types.js';

const logger = createLogger({ name: 'escalate-to-manager' });

const inputSchema = z.object({
    query: z.string().min(1).describe('The specific question or request to escalate to the manager.'),
    context: z.string().optional().describe('Optional background information or conversation history relevant to the query.'),
});

const outputSchema = z.object({
    reply: z.string(),
    managerId: z.string(),
});

export interface EscalateToManagerToolOptions {
    comms: AgentComms;
    getManagerId: (projectId: ProjectId) => Promise<AgentId | null>;
    timeoutMs?: number;
}

/**
 * Create a tool to escalate queries to the Manager agent internally.
 * This wraps the inter-agent messaging system.
 */
export function createEscalateToManagerTool(options: EscalateToManagerToolOptions): ExecutableTool {
    const timeoutMs = options.timeoutMs ?? 30000;

    return {
        id: 'escalate-to-manager',
        name: 'Escalate to Manager',
        description:
            'Consult the Manager agent for approval, pricing decisions, or complex queries. ' +
            'This tool sends a message to the Manager and waits for a response.',
        category: 'communication',
        inputSchema,
        outputSchema,
        riskLevel: 'medium',
        requiresApproval: false, // The Manager handles its own approvals
        sideEffects: true,
        supportsDryRun: true,

        async execute(
            input: unknown,
            context: ExecutionContext,
        ): Promise<Result<ToolResult, NexusError>> {
            const startTime = Date.now();

            try {
                const parsed = inputSchema.parse(input);
                const managerId = await options.getManagerId(context.projectId);

                if (!managerId) {
                    logger.warn('No manager agent found for project', {
                        component: 'escalate-to-manager',
                        projectId: context.projectId,
                        traceId: context.traceId,
                    });

                    return ok({
                        success: false,
                        output: null,
                        error: 'No Manager agent assigned or available for this project.',
                        durationMs: Date.now() - startTime,
                    });
                }

                // Use the sessionId as a transient agent ID so we can receive the reply
                const fromAgentId = context.sessionId as unknown as AgentId;

                logger.info('Escalating to manager', {
                    component: 'escalate-to-manager',
                    projectId: context.projectId,
                    traceId: context.traceId,
                    managerId,
                    query: parsed.query,
                });

                const replyContent = await options.comms.sendAndWait({
                    fromAgentId,
                    toAgentId: managerId,
                    content: parsed.query,
                    context: parsed.context ? { originalContext: parsed.context } : undefined,
                }, timeoutMs);

                return ok({
                    success: true,
                    output: {
                        reply: replyContent,
                        managerId,
                    },
                    durationMs: Date.now() - startTime,
                });
            } catch (error) {
                // If it's a validation error, it will be caught here
                const message = error instanceof Error ? error.message : String(error);

                logger.error('Manager escalation failed', {
                    component: 'escalate-to-manager',
                    projectId: context.projectId,
                    traceId: context.traceId,
                    error: message,
                });

                // We return success: false for expected failures like timeouts
                if (message.includes('timeout')) {
                    return ok({
                        success: false,
                        output: null,
                        error: `Manager is currently unavailable or took too long to respond: ${message}`,
                        durationMs: Date.now() - startTime,
                    });
                }

                // Return a ToolExecutionError for unexpected errors
                return err(new ToolExecutionError('escalate-to-manager', message));
            }
        },

        dryRun(
            input: unknown,
            context: ExecutionContext,
        ): Promise<Result<ToolResult, NexusError>> {
            void context;

            try {
                const parsed = inputSchema.parse(input);

                return Promise.resolve(ok({
                    success: true,
                    output: {
                        reply: 'This is a simulated response from the Manager.',
                        managerId: 'mock-manager-id',
                        querySent: parsed.query,
                        dryRun: true,
                    },
                    durationMs: 0,
                }));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return Promise.resolve(err(new ToolExecutionError('escalate-to-manager', message)));
            }
        },
    };
}
