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
          return err(new ToolExecutionError(
            'send-email',
            `Resend API returned ${response.status}: ${errorText}`,
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
