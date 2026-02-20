/**
 * Read Session History Tool — retrieves message history for a session.
 * Intended for "internal" mode so the agent can review a specific conversation.
 */
import { z } from 'zod';
import type { SessionId } from '@/core/types.js';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  sessionId: z.string().min(1)
    .describe('The session ID to read messages from'),
  limit: z.number().int().min(1).max(100).optional()
    .describe('Maximum number of messages to return (default: 50, from most recent)'),
});

const outputSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  contactId: z.string().optional(),
  channel: z.string().optional(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
    createdAt: z.string(),
  })),
  totalMessages: z.number(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ReadSessionHistoryToolOptions {
  sessionRepository: SessionRepository;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a read-session-history tool for reading conversation messages. */
export function createReadSessionHistoryTool(
  options: ReadSessionHistoryToolOptions,
): ExecutableTool {
  const { sessionRepository } = options;

  return {
    id: 'read-session-history',
    name: 'Read Session History',
    description: 'Reads the message history of a specific conversation session. Returns messages with role (user/assistant), content, and timestamps. Use query-sessions first to find the session ID.',
    category: 'memory',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);
      const limit = parsed.limit ?? 50;

      try {
        // Verify session exists and belongs to this project
        const session = await sessionRepository.findById(parsed.sessionId as SessionId);
        if (!session) {
          return err(new ToolExecutionError(
            'read-session-history',
            `Session "${parsed.sessionId}" not found`,
          ));
        }

        if (session.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'read-session-history',
            'Session does not belong to this project',
          ));
        }

        // Get all messages, then slice to limit (from the end for most recent)
        const allMessages = await sessionRepository.getMessages(parsed.sessionId as SessionId);
        const messages = allMessages.slice(-limit);

        const metadata = session.metadata as Record<string, unknown> | undefined;

        const output = {
          sessionId: session.id,
          status: session.status,
          contactId: metadata?.['contactId'] as string | undefined,
          channel: metadata?.['channel'] as string | undefined,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          })),
          totalMessages: allMessages.length,
        };

        return ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        return err(new ToolExecutionError(
          'read-session-history',
          error instanceof Error ? error.message : 'Unknown error reading session history',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      return ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would read up to ${parsed.limit ?? 50} messages from session "${parsed.sessionId}"`,
        },
        durationMs: Date.now() - startTime,
      });
    },
  };
}
