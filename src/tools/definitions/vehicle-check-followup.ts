/**
 * Vehicle Check Follow-up Tool
 *
 * Determines if a vehicle lead needs follow-up based on tier and last interaction
 */

import { z } from 'zod';
import type { ExecutableTool } from '../registry/types.js';
import type { ExecutionContext } from '../../core/types.js';
import { NexusError } from '../../core/errors.js';
import { prisma } from '../../infrastructure/database.js';
import {
  FollowUpConfigSchema,
  calculateFollowUp,
  buildFollowUpMetadata,
} from '../../verticals/vehicles/follow-up.js';

// ─── Tool Definition ────────────────────────────────────────────

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

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────────

async function execute(input: Input, context: ExecutionContext): Promise<Output> {
  const { projectId } = context;
  const { contactId, updateMetadata } = input;

  // Get contact
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    throw new NexusError('TOOL_EXECUTION_ERROR', `Contact ${contactId} not found`);
  }

  if (contact.projectId !== projectId) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      `Contact ${contactId} does not belong to project ${projectId}`
    );
  }

  // Extract lead score metadata
  const metadata = (contact.metadata as Record<string, unknown>) || {};
  const leadScore = (metadata.leadScore as Record<string, unknown>) || {};

  if (!leadScore.tier) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      `Contact ${contactId} has no lead score. Run vehicle-lead-score first.`
    );
  }

  // Build follow-up config
  const followUpConfig = FollowUpConfigSchema.parse({
    tier: leadScore.tier,
    lastInteractionAt: metadata.lastInteraction || contact.updatedAt.toISOString(),
    lastFollowUpAt: (leadScore.lastFollowUpAt as string) || undefined,
    followUpCount: (leadScore.followUpCount as number) || 0,
  });

  // Calculate follow-up schedule
  const schedule = calculateFollowUp(followUpConfig);

  // Update metadata if requested
  if (updateMetadata) {
    const updatedMetadata = buildFollowUpMetadata(metadata, schedule);
    await prisma.contact.update({
      where: { id: contactId },
      data: { metadata: updatedMetadata },
    });
  }

  context.logger.info('Follow-up check completed', {
    contactId,
    shouldFollowUp: schedule.shouldFollowUp,
    priority: schedule.priority,
  });

  return {
    success: true,
    contactId,
    shouldFollowUp: schedule.shouldFollowUp,
    reason: schedule.reason,
    priority: schedule.priority,
    suggestedMessage: schedule.suggestedMessage,
    nextCheckHours: schedule.delayHours,
  };
}

async function dryRun(input: Input): Promise<Output> {
  return {
    success: true,
    contactId: input.contactId,
    shouldFollowUp: true,
    reason: 'Dry run - simulated follow-up needed',
    priority: 'medium',
    suggestedMessage: 'Hola! ¿Cómo va todo con la búsqueda del vehículo?',
    nextCheckHours: 24,
  };
}

// ─── Tool Export ────────────────────────────────────────────────

export const vehicleCheckFollowupTool: ExecutableTool = {
  id: 'vehicle-check-followup',
  name: 'Check Vehicle Follow-up',
  description:
    'Determine if a vehicle lead needs follow-up based on lead tier, last interaction time, and previous follow-ups. Returns suggested message and timing.',
  inputSchema,
  outputSchema,
  riskLevel: 'low',
  requiresApproval: false,
  tags: ['vehicles', 'crm', 'follow-up'],
  execute,
  dryRun,
};
