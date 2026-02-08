/**
 * Global Fastify error handler and response helpers.
 * Maps NexusError subclasses and ZodError to structured ApiResponse envelopes.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { NexusError } from '@/core/errors.js';
import { createLogger } from '@/observability/logger.js';
import type { ApiResponse } from './types.js';

const logger = createLogger({ name: 'error-handler' });

// ─── Response Helpers ───────────────────────────────────────────

/** Send a success response wrapped in the ApiResponse envelope. */
export async function sendSuccess(
  reply: FastifyReply,
  data: unknown,
  statusCode = 200,
): Promise<void> {
  const body: ApiResponse<unknown> = { success: true, data };
  await reply.status(statusCode).send(body);
}

/** Send an error response wrapped in the ApiResponse envelope. */
export async function sendError(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode = 500,
  details?: Record<string, unknown>,
): Promise<void> {
  const body: ApiResponse<never> = {
    success: false,
    error: { code, message, ...(details && { details }) },
  };
  await reply.status(statusCode).send(body);
}

/** Send a 404 not-found response. */
export async function sendNotFound(
  reply: FastifyReply,
  resource: string,
  id: string,
): Promise<void> {
  await sendError(reply, 'NOT_FOUND', `${resource} "${id}" not found`, 404);
}

// ─── Global Error Handler ───────────────────────────────────────

/** Register the global Fastify error handler. */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler(async (error, _request, reply) => {
    // Zod validation errors
    if (error instanceof ZodError) {
      const details: Record<string, unknown> = {
        issues: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
      await sendError(reply, 'VALIDATION_ERROR', 'Request validation failed', 400, details);
      return;
    }

    // NexusError hierarchy — use the error's own statusCode and code
    if (error instanceof NexusError) {
      logger.warn('Request failed with NexusError', {
        component: 'error-handler',
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      });
      await sendError(
        reply,
        error.code,
        error.message,
        error.statusCode,
        error.context,
      );
      return;
    }

    // Fastify built-in errors (e.g., JSON parse failures, validation)
    if (error instanceof Error && 'statusCode' in error) {
      const statusCode = (error as { statusCode: number }).statusCode;
      await sendError(reply, 'REQUEST_ERROR', error.message, statusCode);
      return;
    }

    // Unknown errors
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error('Unhandled error in request', {
      component: 'error-handler',
      error: message,
      stack,
    });
    await sendError(reply, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  });
}
