/**
 * Hotel Detect Language Tool
 *
 * Detects and stores customer's preferred language for consistent responses
 */

import { z } from 'zod';
import type { ExecutableTool } from '../registry/types.js';
import type { ExecutionContext } from '../../core/types.js';
import { NexusError } from '../../core/errors.js';
import { prisma } from '../../infrastructure/database.js';
import {
  detectLanguage,
  buildLanguageMetadata,
  getLanguageInstructions,
  SupportedLanguageSchema,
} from '../../verticals/hotels/multi-language.js';

// ─── Tool Definition ────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().describe('Contact ID to set language for'),
  text: z.string().describe('Text sample to detect language from'),
  forceLanguage: SupportedLanguageSchema.optional().describe(
    'Force a specific language instead of auto-detection'
  ),
  updateContact: z.boolean().optional().default(true).describe('Update contact metadata'),
});

const outputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  language: SupportedLanguageSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  fallback: z.boolean(),
  instructions: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────────

async function execute(input: Input, context: ExecutionContext): Promise<Output> {
  const { contactId, text, forceLanguage, updateContact } = input;
  const { projectId } = context;

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

  // Detect or use forced language
  let detection;
  if (forceLanguage) {
    detection = {
      language: forceLanguage,
      confidence: 'high' as const,
      fallback: false,
    };
  } else {
    detection = detectLanguage(text);
  }

  // Update contact if requested
  if (updateContact) {
    const updatedMetadata = buildLanguageMetadata(
      contact.metadata,
      detection.language,
      detection.confidence
    );

    // Also update the language field in Contact
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        language: detection.language,
        metadata: updatedMetadata,
      },
    });
  }

  const instructions = getLanguageInstructions(detection.language);

  context.logger.info('Language detected and set', {
    contactId,
    language: detection.language,
    confidence: detection.confidence,
    forced: !!forceLanguage,
  });

  return {
    success: true,
    contactId,
    language: detection.language,
    confidence: detection.confidence,
    fallback: detection.fallback,
    instructions,
  };
}

async function dryRun(input: Input): Promise<Output> {
  const detection = input.forceLanguage
    ? { language: input.forceLanguage, confidence: 'high' as const, fallback: false }
    : detectLanguage(input.text);

  return {
    success: true,
    contactId: input.contactId,
    language: detection.language,
    confidence: detection.confidence,
    fallback: detection.fallback,
    instructions: getLanguageInstructions(detection.language),
  };
}

// ─── Tool Export ────────────────────────────────────────────────

export const hotelDetectLanguageTool: ExecutableTool = {
  id: 'hotel-detect-language',
  name: 'Detect Hotel Guest Language',
  description:
    'Auto-detect customer language from text or manually set it. Stores preference in contact metadata for consistent multi-language responses.',
  inputSchema,
  outputSchema,
  riskLevel: 'low',
  requiresApproval: false,
  tags: ['hotels', 'language', 'i18n'],
  execute,
  dryRun,
};
