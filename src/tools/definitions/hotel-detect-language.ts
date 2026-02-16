/**
 * Hotel Detect Language Tool
 *
 * Detects and stores customer's preferred language for consistent responses
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
  detectLanguage,
  buildLanguageMetadata,
  getLanguageInstructions,
  SupportedLanguageSchema,
} from '@/verticals/hotels/multi-language.js';

const logger = createLogger({ name: 'hotel-detect-language' });

// ─── Schemas ───────────────────────────────────────────────────

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

// ─── Tool Factory ──────────────────────────────────────────────

export function createHotelDetectLanguageTool(): ExecutableTool {
  return {
    id: 'hotel-detect-language',
    name: 'Detect Hotel Guest Language',
    description:
      'Auto-detect customer language from text or manually set it. Stores preference in contact metadata for consistent multi-language responses.',
    category: 'hotels',
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
        return err(new ToolExecutionError('hotel-detect-language', 'Invalid input', parsed.error));
      }
      const { contactId, text, forceLanguage, updateContact } = parsed.data;

      try {
        const contact = await getDatabase().client.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          return err(new ToolExecutionError('hotel-detect-language', `Contact ${contactId} not found`));
        }

        if (contact.projectId !== context.projectId) {
          return err(new ToolExecutionError(
            'hotel-detect-language',
            `Contact ${contactId} does not belong to project ${context.projectId}`
          ));
        }

        const detection = forceLanguage
          ? { language: forceLanguage, confidence: 'high' as const, fallback: false }
          : detectLanguage(text);

        if (updateContact) {
          const updatedMetadata = buildLanguageMetadata(
            contact.metadata,
            detection.language,
            detection.confidence
          );

          await getDatabase().client.contact.update({
            where: { id: contactId },
            data: {
              language: detection.language,
              metadata: updatedMetadata as Prisma.InputJsonValue,
            },
          });
        }

        const instructions = getLanguageInstructions(detection.language);

        logger.info('Language detected and set', {
          component: 'hotel-detect-language',
          contactId,
          language: detection.language,
          confidence: detection.confidence,
          forced: !!forceLanguage,
        });

        return ok({
          success: true,
          output: {
            success: true,
            contactId,
            language: detection.language,
            confidence: detection.confidence,
            fallback: detection.fallback,
            instructions,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Language detection failed', {
          component: 'hotel-detect-language',
          contactId,
          error,
        });
        return err(new ToolExecutionError(
          'hotel-detect-language',
          'Language detection failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('hotel-detect-language', 'Invalid input', parsed.error)));
      }

      const detection = parsed.data.forceLanguage
        ? { language: parsed.data.forceLanguage, confidence: 'high' as const, fallback: false }
        : detectLanguage(parsed.data.text);

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          contactId: parsed.data.contactId,
          language: detection.language,
          confidence: detection.confidence,
          fallback: detection.fallback,
          instructions: getLanguageInstructions(detection.language),
        },
        durationMs: 0,
      }));
    },
  };
}
