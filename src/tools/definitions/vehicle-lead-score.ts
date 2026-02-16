/**
 * Vehicle Lead Score Tool
 *
 * Calculates and stores lead quality score for vehicle sales prospects
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
  LeadDataSchema,
  calculateLeadScore,
  buildLeadMetadata,
} from '@/verticals/vehicles/lead-scoring.js';

const logger = createLogger({ name: 'vehicle-lead-score' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to score'),
  budget: z.number().optional().describe('Budget in ARS'),
  budgetRange: z
    .enum(['low', 'medium', 'high', 'premium'])
    .optional()
    .describe('Budget range category'),
  urgency: z
    .enum(['browsing', 'considering', 'ready', 'urgent'])
    .describe('Purchase urgency level'),
  vehicleType: z
    .enum(['sedan', 'suv', 'truck', 'sports', 'electric', 'hybrid', 'other'])
    .optional()
    .describe('Preferred vehicle type'),
  hasTradeIn: z.boolean().optional().describe('Has vehicle to trade in'),
  financingNeeded: z.boolean().optional().describe('Needs financing'),
  preferredContact: z
    .enum(['phone', 'whatsapp', 'email', 'any'])
    .optional()
    .describe('Preferred contact method'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  score: z.number(),
  tier: z.enum(['cold', 'warm', 'hot', 'urgent']),
  reasoning: z.string(),
  suggestedActions: z.array(z.string()),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createVehicleLeadScoreTool(): ExecutableTool {
  return {
    id: 'vehicle-lead-score',
    name: 'Score Vehicle Lead',
    description:
      'Calculate and store lead quality score for vehicle sales. Scores are based on budget, urgency, and vehicle preferences.',
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
        return err(new ToolExecutionError('vehicle-lead-score', 'Invalid input', parsed.error));
      }
      const { contactId, ...leadData } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('vehicle-lead-score', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'vehicle-lead-score',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const validatedLeadData = LeadDataSchema.parse(leadData);
        const score = calculateLeadScore(validatedLeadData);
        const updatedMetadata = buildLeadMetadata(contact.metadata, validatedLeadData, score);

        await getDatabase().client.contact.update({
          where: { id: contactId },
          data: { metadata: updatedMetadata as Prisma.InputJsonValue },
        });

        logger.info('Lead score calculated and stored', {
          component: 'vehicle-lead-score',
          contactId,
          score: score.score,
          tier: score.tier,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            score: score.score,
            tier: score.tier,
            reasoning: score.reasoning,
            suggestedActions: score.suggestedActions,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Lead scoring failed', {
          component: 'vehicle-lead-score',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'vehicle-lead-score',
          'Lead scoring failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('vehicle-lead-score', 'Invalid input', parsed.error)));
      }
      const { contactId, ...leadData } = parsed.data;
      const validatedLeadData = LeadDataSchema.parse(leadData);
      const score = calculateLeadScore(validatedLeadData);

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId,
          score: score.score,
          tier: score.tier,
          reasoning: score.reasoning,
          suggestedActions: score.suggestedActions,
        },
        durationMs: 0,
      }));
    },
  };
}
