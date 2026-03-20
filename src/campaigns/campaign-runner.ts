/**
 * Campaign Runner — executes outbound campaigns by filtering contacts,
 * interpolating templates, and sending via ProactiveMessenger.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { NexusError } from '@/core/errors.js';
import type { ProjectId } from '@/core/types.js';
import type { ContactId } from '@/contacts/types.js';
import type { ProactiveMessenger } from '@/channels/proactive.js';
import type { ChannelType } from '@/channels/types.js';
import type { Logger } from '@/observability/logger.js';
import type {
  CampaignId,
  CampaignChannel,
  CampaignExecutionResult,
  AudienceFilter,
  ABTestConfig,
  CampaignTemplateConfig,
} from './types.js';
import { selectVariant } from './ab-test-engine.js';
import { markCampaignReply } from './campaign-tracker.js';

// ─── Error ──────────────────────────────────────────────────────

export class CampaignExecutionError extends NexusError {
  constructor(campaignId: string, message: string, cause?: Error) {
    super({
      message: `Campaign "${campaignId}" execution failed: ${message}`,
      code: 'CAMPAIGN_EXECUTION_ERROR',
      statusCode: 500,
      cause,
      context: { campaignId },
    });
    this.name = 'CampaignExecutionError';
  }
}

// ─── Dependencies ───────────────────────────────────────────────

export interface CampaignRunnerDeps {
  prisma: PrismaClient;
  proactiveMessenger: ProactiveMessenger;
  logger: Logger;
}

// ─── Interface ──────────────────────────────────────────────────

export interface CampaignRunner {
  /** Execute a campaign: filter audience, interpolate template, send messages. */
  executeCampaign(campaignId: string): Promise<Result<CampaignExecutionResult, NexusError>>;
  /**
   * Check whether a contact has a recent 'sent' CampaignSend (within 7 days)
   * for any campaign in the project, and mark it as 'replied' if so.
   *
   * Intended to be called by the InboundProcessor when a contact sends a message.
   * Returns the updated send ID, or null if no eligible send was found.
   */
  checkAndMarkReply(
    projectId: ProjectId,
    contactId: ContactId,
    sessionId: string,
  ): Promise<string | null>;
}

// ─── Template Interpolation ─────────────────────────────────────

interface ContactFields {
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
}

/** Replace {{field}} placeholders with contact data. */
export function interpolateTemplate(template: string, contact: ContactFields): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, field: string) => {
    switch (field) {
      case 'name':
        return contact.name;
      case 'displayName':
        return contact.displayName ?? contact.name;
      case 'phone':
        return contact.phone ?? '';
      case 'email':
        return contact.email ?? '';
      default:
        return `{{${field}}}`;
    }
  });
}

// ─── Recipient Resolution ───────────────────────────────────────

/** Resolve the recipient identifier for a channel from contact data. */
function resolveRecipient(
  contact: { phone: string | null; telegramId: string | null; slackId: string | null },
  channel: CampaignChannel,
): string | null {
  switch (channel) {
    case 'whatsapp':
      return contact.phone;
    case 'telegram':
      return contact.telegramId;
    case 'slack':
      return contact.slackId;
  }
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a CampaignRunner for executing outbound campaigns. */
export function createCampaignRunner(deps: CampaignRunnerDeps): CampaignRunner {
  const { prisma, proactiveMessenger, logger } = deps;

  return {
    async executeCampaign(
      campaignId: string,
    ): Promise<Result<CampaignExecutionResult, NexusError>> {
      // 1. Load campaign
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });

      if (!campaign) {
        return err(
          new CampaignExecutionError(campaignId, 'Campaign not found'),
        );
      }

      if (campaign.status !== 'active') {
        return err(
          new CampaignExecutionError(
            campaignId,
            `Campaign status is "${campaign.status}", expected "active"`,
          ),
        );
      }

      logger.info('Starting campaign execution', {
        component: 'campaign-runner',
        campaignId,
        name: campaign.name,
        channel: campaign.channel,
      });

      // 2. Parse audience filter
      const filter = campaign.audienceFilter as unknown as AudienceFilter;

      // 3. Query matching contacts
      const where: Prisma.ContactWhereInput = {
        projectId: campaign.projectId,
      };

      if (filter.tags && filter.tags.length > 0) {
        where.tags = { hasEvery: filter.tags };
      }

      if (filter.role) {
        where.role = filter.role;
      }

      const contacts = await prisma.contact.findMany({ where });

      logger.info('Audience resolved', {
        component: 'campaign-runner',
        campaignId,
        matchingContacts: contacts.length,
      });

      // 4. Send to each contact
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      const channel = campaign.channel as CampaignChannel;

      // Extract optional template + provider overrides from metadata
      const meta = campaign.metadata as Record<string, unknown> | null;
      const templateConfig = meta?.['templateConfig'] as CampaignTemplateConfig | undefined;
      const channelProvider = (meta?.['channelProvider'] as 'whatsapp' | 'whatsapp-waha' | undefined) ?? channel as ChannelType;

      for (const contact of contacts) {
        const recipient = resolveRecipient(contact, channel);

        if (!recipient) {
          skipped++;
          logger.debug('Skipping contact — no identifier for channel', {
            component: 'campaign-runner',
            contactId: contact.id,
            channel,
          });
          continue;
        }

        // Determine template (A/B test or default)
        const abConfig = (campaign.metadata as Record<string, unknown> | null)?.['abTest'] as ABTestConfig | undefined;
        const abEnabled = abConfig?.enabled && abConfig.variants.length > 0;
        let templateToUse = campaign.template;
        let chosenVariantId: string | null = null;

        if (abEnabled) {
          const variant = selectVariant(abConfig.variants, contact.id);
          templateToUse = variant.template;
          chosenVariantId = variant.id;
        }

        // Create send record
        const sendRecord = await prisma.campaignSend.create({
          data: {
            campaignId,
            contactId: contact.id,
            status: 'queued',
            ...(chosenVariantId !== null && { variantId: chosenVariantId }),
          },
        });

        // Interpolate and send
        const message = interpolateTemplate(templateToUse, {
          name: contact.name,
          displayName: contact.displayName ?? undefined,
          phone: contact.phone ?? undefined,
          email: contact.email ?? undefined,
        });

        try {
          const result = await proactiveMessenger.send({
            projectId: campaign.projectId as ProjectId,
            contactId: contact.id,
            channel: channelProvider,
            recipientIdentifier: recipient,
            content: message,
            ...(templateConfig && { template: templateConfig }),
            metadata: {
              campaignId,
              campaignName: campaign.name,
              ...(chosenVariantId !== null && { variantId: chosenVariantId }),
            },
          });

          if (result.success) {
            sent++;
            await prisma.campaignSend.update({
              where: { id: sendRecord.id },
              data: { status: 'sent', sentAt: new Date() },
            });
          } else {
            failed++;
            await prisma.campaignSend.update({
              where: { id: sendRecord.id },
              data: { status: 'failed', error: result.error ?? 'Unknown error' },
            });
          }
        } catch (error) {
          failed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await prisma.campaignSend.update({
            where: { id: sendRecord.id },
            data: { status: 'failed', error: errorMessage },
          });
          logger.error('Failed to send campaign message', {
            component: 'campaign-runner',
            campaignId,
            contactId: contact.id,
            error: errorMessage,
          });
        }
      }

      // 5. Update campaign status
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date() },
      });

      const result: CampaignExecutionResult = {
        campaignId: campaignId as CampaignId,
        totalContacts: contacts.length,
        sent,
        failed,
        skipped,
      };

      logger.info('Campaign execution completed', {
        component: 'campaign-runner',
        ...result,
      });

      return ok(result);
    },

    async checkAndMarkReply(
      projectId: ProjectId,
      contactId: ContactId,
      sessionId: string,
    ): Promise<string | null> {
      // Find any campaign send in 'sent' status for this contact within the
      // last 7 days, across all campaigns that belong to the project.
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const send = await prisma.campaignSend.findFirst({
        where: {
          contactId,
          status: 'sent',
          sentAt: { gte: sevenDaysAgo },
          campaign: { projectId },
        },
        orderBy: { sentAt: 'desc' },
      });

      if (!send) return null;

      const result = await markCampaignReply(
        prisma,
        send.campaignId as CampaignId,
        contactId,
        sessionId,
      );

      if (!result) return null;

      logger.info('Campaign reply auto-marked', {
        component: 'campaign-runner',
        campaignSendId: result.campaignSend.id,
        contactId,
        sessionId,
        projectId,
      });

      return result.campaignSend.id;
    },
  };
}
