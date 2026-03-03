/**
 * Contact Score Tool
 *
 * Generic, configurable contact scoring for any vertical.
 * Replaces/complements vehicle-lead-score with a preset-based approach.
 */

import { z } from 'zod';
import type { ExecutionContext, ProjectId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { getDatabase } from '@/infrastructure/database.js';
import { createLogger } from '@/observability/logger.js';
import { scoreContact, SCORING_PRESETS } from '@/contacts/contact-scorer.js';
import type { ContactScoringContext, ScoringConfig } from '@/contacts/types.js';

const logger = createLogger({ name: 'contact-score' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().min(1).describe('Contact ID to score'),
  configPreset: z
    .string()
    .optional()
    .describe(
      'Scoring preset: general, retail, hospitality, automotive, services. ' +
        'Defaults to "general".',
    ),
});

// ─── Helpers ───────────────────────────────────────────────────

function makeToolResult(
  output: Record<string, unknown>,
  durationMs: number,
): ToolResult {
  return {
    success: true,
    output,
    durationMs,
  };
}

// ─── Tool Factory ──────────────────────────────────────────────

export function createContactScoreTool(): ExecutableTool {
  async function runScore(
    input: unknown,
    context: ExecutionContext,
    persist: boolean,
  ): Promise<Result<ToolResult, NexusError>> {
    const startTime = Date.now();
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return err(new ToolExecutionError('contact-score', 'Invalid input', parsed.error));
    }

    const { contactId, configPreset } = parsed.data;
    const db = getDatabase().client;

    try {
      // 1. Load contact
      const contact = await db.contact.findUnique({ where: { id: contactId } });
      if (!contact) {
        return err(new ToolExecutionError('contact-score', `Contact ${contactId} not found`));
      }
      if (contact.projectId !== context.projectId) {
        return err(
          new ToolExecutionError(
            'contact-score',
            `Contact ${contactId} does not belong to project ${context.projectId}`,
          ),
        );
      }

      // 2. Gather sessions
      const sessions = await db.session.findMany({
        where: { contactId },
        select: {
          id: true,
          updatedAt: true,
          metadata: true,
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      const sessionCount = sessions.length;
      const messageCount = sessions.reduce(
        (sum: number, s: { _count: { messages: number } }) => sum + s._count.messages,
        0,
      );
      const lastSessionAt: Date | null = sessions[0]?.updatedAt ?? null;

      const now = Date.now();
      const daysSinceLastSession: number | null =
        lastSessionAt !== null
          ? Math.floor((now - lastSessionAt.getTime()) / (1000 * 60 * 60 * 24))
          : null;

      // Escalated: any approval request for this contact's sessions
      const approvalCount = await db.approvalRequest.count({
        where: { session: { contactId } },
      });
      const wasEscalated =
        approvalCount > 0 ||
        sessions.some((s: { metadata: unknown }) => {
          const meta = s.metadata as Record<string, unknown> | null;
          return meta?.['escalated'] === true;
        });

      // 3. Build scoring context
      const scoringCtx: ContactScoringContext = {
        contact: {
          id: contact.id,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          projectId: contact.projectId as ProjectId,
          name: contact.name,
          displayName: contact.displayName ?? undefined,
          phone: contact.phone ?? undefined,
          email: contact.email ?? undefined,
          telegramId: contact.telegramId ?? undefined,
          slackId: contact.slackId ?? undefined,
          timezone: contact.timezone ?? undefined,
          language: contact.language,
          role: contact.role ?? undefined,
          tags: contact.tags as string[],
          metadata: (contact.metadata as Record<string, unknown>) ?? undefined,
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
        },
        sessionCount,
        messageCount,
        lastSessionAt,
        wasEscalated,
        daysSinceLastSession,
      };

      // 4. Pick config
      const presetKey = configPreset ?? 'general';
      const config: ScoringConfig =
        SCORING_PRESETS[presetKey] ?? (SCORING_PRESETS['general'] as ScoringConfig);

      // 5. Score
      const result = scoreContact(scoringCtx, config);

      logger.info(
        `contact-score: contactId=${contactId} score=${result.score} tier=${result.tier} preset=${presetKey}`,
      );

      // 6. Persist (skip on dry-run)
      if (persist) {
        const existingMeta = (contact.metadata as Record<string, unknown> | null) ?? {};
        await db.contact.update({
          where: { id: contactId },
          data: {
            metadata: {
              ...existingMeta,
              score: result.score,
              tier: result.tier,
              scoredAt: result.lastScoredAt.toISOString(),
              scoringPreset: presetKey,
            },
          },
        });
      }

      const durationMs = Date.now() - startTime;
      const output: Record<string, unknown> = {
        success: true,
        contactId: result.contactId,
        score: result.score,
        tier: result.tier,
        signals: result.signals,
        lastScoredAt: result.lastScoredAt.toISOString(),
        nextFollowUpAt: result.nextFollowUpAt?.toISOString(),
        preset: presetKey,
      };

      return ok(makeToolResult(output, durationMs));
    } catch (error) {
      logger.error(
        `contact-score error for ${contactId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return err(
        new ToolExecutionError(
          'contact-score',
          `Scoring failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  return {
    id: 'contact-score',
    name: 'Score Contact',
    description:
      'Calculate and store a lead/engagement quality score for any contact. ' +
      'Works with presets for different verticals: general, retail, hospitality, automotive, services. ' +
      'Updates contact metadata with score and tier.',
    category: 'contacts',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    inputSchema,
    outputSchema: z.object({
      success: z.boolean(),
      contactId: z.string(),
      score: z.number(),
      tier: z.enum(['hot', 'warm', 'cold', 'inactive']),
      signals: z.array(
        z.object({
          name: z.string(),
          weight: z.number(),
          detail: z.string().optional(),
        }),
      ),
      lastScoredAt: z.string(),
      nextFollowUpAt: z.string().optional(),
      preset: z.string(),
    }),

    execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      return runScore(input, context, true);
    },

    dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      return runScore(input, context, false);
    },
  };
}
