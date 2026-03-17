/**
 * OpenClaw Adapter — receives inbound calls from OpenClaw Manager instances.
 *
 * OpenClaw Manager containers call fomo-core when they need a specialized agent
 * to handle a task. This adapter:
 * 1. Validates the OPENCLAW_INTERNAL_KEY for service-to-service auth
 * 2. Parses the incoming request into an InboundMessage
 * 3. Routes through the InboundProcessor with sourceChannel=openclaw
 * 4. Returns the agent's response synchronously
 *
 * Endpoint: POST /api/v1/openclaw/inbound
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { InboundProcessor } from './inbound-processor.js';
import { sendSuccess, sendError } from '@/api/error-handler.js';

// ─── Types ───────────────────────────────────────────────────────

/** Dependencies for the OpenClaw adapter routes. */
export interface OpenClawAdapterDeps {
  /** The internal API key for authenticating OpenClaw → fomo-core calls. */
  openclawInternalKey: string;
  /** The inbound processor for routing messages. */
  inboundProcessor: InboundProcessor;
  /** Function to run the agent directly (for synchronous response). */
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    agentId?: string;
    sourceChannel?: string;
    contactRole?: string;
    userMessage: string;
    mediaUrls?: string[];
  }) => Promise<{ response: string }>;
  logger: Logger;
}

// ─── Request Schema ──────────────────────────────────────────────

const openclawInboundSchema = z.object({
  /** fomo-core project ID. */
  projectId: z.string().min(1),
  /** Optional: specific agent ID to invoke. */
  agentId: z.string().min(1).optional(),
  /** The message content. */
  message: z.string().min(1).max(100_000),
  /** Optional session ID to continue a conversation. */
  sessionId: z.string().min(1).optional(),
  /** Optional metadata from OpenClaw Manager. */
  metadata: z.record(z.unknown()).optional(),
});

// ─── Route Registration ──────────────────────────────────────────

/**
 * Register OpenClaw adapter routes on a Fastify instance.
 *
 * @param fastify - Fastify instance (already prefixed with /api/v1).
 * @param deps - Adapter dependencies.
 */
export function openclawAdapterRoutes(
  fastify: FastifyInstance,
  deps: OpenClawAdapterDeps,
): void {
  const { openclawInternalKey, runAgent, logger } = deps;

  /**
   * POST /api/v1/openclaw/inbound
   *
   * Called by OpenClaw Manager to invoke a fomo-core agent.
   * Auth: X-OpenClaw-Key header must match OPENCLAW_INTERNAL_KEY.
   */
  fastify.post(
    '/openclaw/inbound',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. Authenticate with internal key
      const providedKey = request.headers['x-openclaw-key'] as string | undefined;

      if (!providedKey || !safeEqual(providedKey, openclawInternalKey)) {
        logger.warn('OpenClaw adapter: invalid or missing internal key', {
          component: 'openclaw-adapter',
          ip: request.ip,
        });
        return sendError(reply, 'UNAUTHORIZED', 'Invalid or missing X-OpenClaw-Key header', 401);
      }

      // 2. Parse and validate request body
      const parsed = openclawInboundSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid request body', 400, {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const { projectId, agentId, message, sessionId, metadata } = parsed.data;

      logger.info('OpenClaw inbound request received', {
        component: 'openclaw-adapter',
        projectId,
        agentId,
        hasSessionId: !!sessionId,
      });

      // 3. Run the agent directly (synchronous response to OpenClaw)
      const result = await runAgent({
        projectId: projectId as ProjectId,
        sessionId: sessionId ?? randomUUID(),
        agentId,
        sourceChannel: 'openclaw',
        userMessage: message,
      });

      logger.info('OpenClaw inbound request completed', {
        component: 'openclaw-adapter',
        projectId,
        agentId,
        responseLength: result.response.length,
      });

      // 4. Return the agent's response
      return sendSuccess(reply, {
        response: result.response,
        sourceChannel: 'openclaw',
        metadata,
      });
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Constant-time string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  const aLen = a.length;
  const bLen = b.length;
  const maxLen = Math.max(aLen, bLen);

  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);

  const equal = timingSafeEqual(aBuf, bBuf);
  return equal && aLen === bLen;
}
