/**
 * Vehicle Check Follow-up Tool
 *
 * Determines if a vehicle lead needs follow-up based on tier and last interaction
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { Prisma } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  FollowUpConfigSchema,
  calculateFollowUp,
  buildFollowUpMetadata,
} from '@/verticals/vehicles/follow-up.js';

const logger = createLogger({ name: 'vehicle-check-followup' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to check'),
  updateMetadata: z
    .boolean()
    .optional()
    .default(true)
    .describe('Update contact metadata with follow-up schedule'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  shouldFollowUp: z.boolean(),
  reason: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  suggestedMessage: z.string(),
  nextCheckHours: z.number(),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createVehicleCheckFollowupTool(): ExecutableTool {
  return {
    id: 'vehicle-check-followup',
    name: 'Check Vehicle Follow-up',
    description:
      'Determine if a vehicle lead needs follow-up based on lead tier, last interaction time, and previous follow-ups. Returns suggested message and timing.',
    category: 'vehicles',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('vehicle-check-followup', 'Invalid input', parsed.error));
      }
      const { contactId, updateMetadata } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('vehicle-check-followup', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'vehicle-check-followup',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const metadata = (contact.metadata ?? {}) as Record<string, unknown>;
        const leadScore = (metadata['leadScore'] ?? {}) as Record<string, unknown>;

        if (!leadScore['tier']) {
          return err(new ToolExecutionError(
            'vehicle-check-followup',
            `Contact ${contactId} has no lead score. Run vehicle-lead-score first.`
          ));
        }

        const followUpConfig = FollowUpConfigSchema.parse({
          tier: leadScore['tier'],
          lastInteractionAt: (metadata['lastInteraction'] ?? contact.updatedAt.toISOString()) as string,
          lastFollowUpAt: (leadScore['lastFollowUpAt'] ?? undefined) as string | undefined,
          followUpCount: (leadScore['followUpCount'] ?? 0) as number,
        });

        const schedule = calculateFollowUp(followUpConfig);

        if (updateMetadata) {
          const updatedMetadata = buildFollowUpMetadata(metadata, schedule);
          await getDatabase().client.contact.update({
            where: { id: contactId },
            data: { metadata: updatedMetadata as Prisma.InputJsonValue },
          });
        }

        logger.info('Follow-up check completed', {
          component: 'vehicle-check-followup',
          contactId,
          shouldFollowUp: schedule.shouldFollowUp,
          priority: schedule.priority,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            shouldFollowUp: schedule.shouldFollowUp,
            reason: schedule.reason,
            priority: schedule.priority,
            suggestedMessage: schedule.suggestedMessage,
            nextCheckHours: schedule.delayHours,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Follow-up check failed', {
          component: 'vehicle-check-followup',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'vehicle-check-followup',
          'Follow-up check failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('vehicle-check-followup', 'Invalid input', parsed.error)));
      }

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId: parsed.data.contactId,
          shouldFollowUp: true,
          reason: 'Dry run - simulated follow-up needed',
          priority: 'medium',
          suggestedMessage: 'Hola! ¿Cómo va todo con la búsqueda del vehículo?',
          nextCheckHours: 24,
        },
        durationMs: 0,
      }));
    },
  };
}
