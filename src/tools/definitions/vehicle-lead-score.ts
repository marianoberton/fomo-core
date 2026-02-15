/**
 * Vehicle Lead Score Tool
 *
 * Calculates and stores lead quality score for vehicle sales prospects
 */

import { z } from 'zod';
import type { ExecutableTool } from '../registry/types.js';
import type { ExecutionContext } from '../../core/types.js';
import { NexusError } from '../../core/errors.js';
import { prisma } from '../../infrastructure/database.js';
import {
  LeadDataSchema,
  calculateLeadScore,
  buildLeadMetadata,
} from '../../verticals/vehicles/lead-scoring.js';

// ─── Tool Definition ────────────────────────────────────────────

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

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────────

async function execute(input: Input, context: ExecutionContext): Promise<Output> {
  const { projectId } = context;
  const { contactId, ...leadData } = input;

  // Validate contact exists and belongs to project
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

  // Calculate lead score
  const validatedLeadData = LeadDataSchema.parse(leadData);
  const score = calculateLeadScore(validatedLeadData);

  // Update contact metadata
  const updatedMetadata = buildLeadMetadata(contact.metadata, validatedLeadData, score);

  await prisma.contact.update({
    where: { id: contactId },
    data: { metadata: updatedMetadata },
  });

  context.logger.info('Lead score calculated and stored', {
    contactId,
    score: score.score,
    tier: score.tier,
  });

  return {
    success: true,
    contactId,
    score: score.score,
    tier: score.tier,
    reasoning: score.reasoning,
    suggestedActions: score.suggestedActions,
  };
}

async function dryRun(input: Input): Promise<Output> {
  const { contactId, ...leadData } = input;
  const validatedLeadData = LeadDataSchema.parse(leadData);
  const score = calculateLeadScore(validatedLeadData);

  return {
    success: true,
    contactId,
    score: score.score,
    tier: score.tier,
    reasoning: score.reasoning,
    suggestedActions: score.suggestedActions,
  };
}

// ─── Tool Export ────────────────────────────────────────────────

export const vehicleLeadScoreTool: ExecutableTool = {
  id: 'vehicle-lead-score',
  name: 'Score Vehicle Lead',
  description:
    'Calculate and store lead quality score for vehicle sales. Scores are based on budget, urgency, and vehicle preferences.',
  inputSchema,
  outputSchema,
  riskLevel: 'low',
  requiresApproval: false,
  tags: ['vehicles', 'crm', 'scoring'],
  execute,
  dryRun,
};
