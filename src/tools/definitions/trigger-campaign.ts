/**
 * trigger-campaign — executes an outbound campaign.
 *
 * High-risk tool that requires human approval: sends bulk messages
 * to contacts matching the campaign audience filter.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { CampaignRunner } from '@/campaigns/campaign-runner.js';
import type { AudienceFilter } from '@/campaigns/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  campaignId: z.string().min(1).describe('Campaign ID to trigger'),
});

const outputSchema = z.object({
  campaignId: z.string(),
  totalContacts: z.number(),
  sent: z.number(),
  failed: z.number(),
  skipped: z.number(),
});

// ─── Options ────────────────────────────────────────────────────

export interface TriggerCampaignToolOptions {
  campaignRunner: CampaignRunner;
  prisma: PrismaClient;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a trigger-campaign tool for executing outbound campaigns. */
export function createTriggerCampaignTool(
  options: TriggerCampaignToolOptions,
): ExecutableTool {
  const { campaignRunner, prisma } = options;

  return {
    id: 'trigger-campaign',
    name: 'Trigger Campaign',
    description:
      'Executes an outbound campaign: filters contacts by audience criteria, ' +
      'interpolates the message template, and sends via the configured channel. ' +
      'High-risk tool — requires human approval before execution.',
    category: 'communication',
    inputSchema,
    outputSchema,
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      const result = await campaignRunner.executeCampaign(parsed.campaignId);

      if (!result.ok) {
        return err(
          new ToolExecutionError('trigger-campaign', result.error.message),
        );
      }

      return ok({
        success: true,
        output: result.value,
        durationMs: Date.now() - startTime,
        metadata: { campaignId: parsed.campaignId },
      });
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      // Load campaign without executing
      const campaign = await prisma.campaign.findUnique({
        where: { id: parsed.campaignId },
      });

      if (!campaign) {
        return err(
          new ToolExecutionError(
            'trigger-campaign',
            `Campaign "${parsed.campaignId}" not found`,
          ),
        );
      }

      // Count matching contacts
      const filter = campaign.audienceFilter as unknown as AudienceFilter;
      const where: Prisma.ContactWhereInput = {
        projectId: campaign.projectId,
      };

      if (filter.tags && filter.tags.length > 0) {
        where.tags = { hasEvery: filter.tags };
      }

      if (filter.role) {
        where.role = filter.role;
      }

      const contactCount = await prisma.contact.count({ where });

      return ok({
        success: true,
        output: {
          campaignId: campaign.id,
          name: campaign.name,
          status: campaign.status,
          channel: campaign.channel,
          template: campaign.template,
          audienceFilter: filter,
          matchingContacts: contactCount,
          preview: '[DRY RUN] No messages sent',
        },
        durationMs: Date.now() - startTime,
        metadata: { dryRun: true },
      });
    },
  };
}
