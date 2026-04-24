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
import type { MCPManager } from '@/mcp/mcp-manager.js';
import type { MCPToolResult } from '@/mcp/types.js';
import type {
  CampaignId,
  CampaignChannel,
  CampaignExecutionResult,
  AudienceFilter,
  AudienceSource,
  AudienceCache,
  ABTestConfig,
  CampaignTemplateConfig,
} from './types.js';
import { selectVariant } from './ab-test-engine.js';
import { markCampaignReply } from './campaign-tracker.js';
import type { ProjectEventBus } from '@/api/events/event-bus.js';
import { sha1 } from '@/utils/hash.js';

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
  /** Optional event bus for emitting `campaign.progress` events during execution. */
  eventBus?: ProjectEventBus;
  /**
   * Optional MCP manager — required when campaigns use `audienceSource.kind === 'mcp'`.
   * Omit for test/simple setups that only use local contact-table audiences.
   */
  mcpManager?: MCPManager;
}

// ─── Interface ──────────────────────────────────────────────────

/** Minimal Contact shape used by the runner (Prisma row, with nullable fields). */
type ContactRow = Awaited<ReturnType<PrismaClient['contact']['findFirst']>> & object;

/** Minimal Campaign shape used by the runner (Prisma row). */
type CampaignRow = NonNullable<
  Awaited<ReturnType<PrismaClient['campaign']['findFirst']>>
>;

/** Result of resolving the audience for a campaign. */
export interface AudienceResolution {
  contacts: ContactRow[];
  fromCache: boolean;
  cache: AudienceCache | null;
}

export interface ResolveAudienceOptions {
  /** Force re-resolution — ignore any existing cache. Only meaningful for MCP sources. */
  force?: boolean;
}

export interface CampaignRunner {
  /** Execute a campaign: filter audience, interpolate template, send messages. */
  executeCampaign(campaignId: string): Promise<Result<CampaignExecutionResult, NexusError>>;
  /**
   * Resolve the audience for a campaign — local filter or MCP tool call with TTL cache.
   * Used by `executeCampaign` internally and by the REST `refresh-audience` endpoint.
   */
  resolveAudience(
    campaignId: string,
    options?: ResolveAudienceOptions,
  ): Promise<Result<AudienceResolution, NexusError>>;
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

// ─── MCP helpers ───────────────────────────────────────────────

/**
 * Extract a field from a nested object using a dot-path (e.g. "properties.phone").
 * Returns undefined if any segment is missing.
 */
function pickField(row: unknown, path: string): string | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const segments = path.split('.');
  let cursor: unknown = row;
  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === undefined || cursor === null) return undefined;
  if (typeof cursor === 'string') return cursor;
  if (typeof cursor === 'number' || typeof cursor === 'boolean') return String(cursor);
  return undefined;
}

/**
 * Extract row objects from an MCP tool result. MCP servers typically return
 * `content: [{ type: 'text', text: '<JSON>' }]`. We try to parse the first
 * text item as either a JSON array of rows or a `{ results: [...] }` envelope.
 */
function extractRows(result: MCPToolResult): unknown[] {
  const textItem = result.content.find((c) => c.type === 'text' && typeof c.text === 'string');
  if (!textItem?.text) return [];
  try {
    const parsed: unknown = JSON.parse(textItem.text);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      const envelope = parsed as Record<string, unknown>;
      if (Array.isArray(envelope['results'])) return envelope['results'];
      if (Array.isArray(envelope['items'])) return envelope['items'];
      if (Array.isArray(envelope['contacts'])) return envelope['contacts'];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Upsert contacts returned from an MCP tool call. Uses `(projectId, phone)`
 * as the primary natural key, falling back to `(projectId, email)`. Rows
 * without either identifier are skipped.
 */
export async function upsertContactsFromMcp(
  prisma: PrismaClient,
  projectId: string,
  rows: unknown[],
  mapping: (AudienceSource & { kind: 'mcp' })['mapping'],
): Promise<ContactRow[]> {
  const resolved: ContactRow[] = [];
  for (const row of rows) {
    const phone = mapping.phoneField ? pickField(row, mapping.phoneField) : undefined;
    const email = mapping.emailField ? pickField(row, mapping.emailField) : undefined;
    const name = mapping.nameField ? pickField(row, mapping.nameField) : undefined;
    const externalId = pickField(row, mapping.contactIdField);

    if (!phone && !email) continue; // cannot uniquely identify

    const displayName = name ?? externalId ?? phone ?? email ?? 'Contact';

    const upserted = phone
      ? await prisma.contact.upsert({
          where: { projectId_phone: { projectId, phone } },
          create: {
            projectId,
            name: displayName,
            phone,
            ...(email !== undefined && { email }),
          },
          update: {
            ...(email !== undefined && { email }),
          },
        })
      : await prisma.contact.upsert({
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          where: { projectId_email: { projectId, email: email! } },
          create: {
            projectId,
            name: displayName,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            email: email!,
          },
          update: {},
        });

    resolved.push(upserted);
  }
  return resolved;
}

/**
 * Resolve a campaign's audience. Legacy `audienceFilter` path is preserved;
 * MCP path uses a TTL cache invalidated by a sha1 of the `AudienceSource`.
 *
 * Exported so the REST `POST /:id/refresh-audience` endpoint can force a refresh.
 */
export async function resolveAudience(
  deps: Pick<CampaignRunnerDeps, 'prisma' | 'mcpManager' | 'logger'>,
  campaign: CampaignRow,
  options: ResolveAudienceOptions = {},
): Promise<AudienceResolution> {
  const { prisma, mcpManager, logger } = deps;
  const source = campaign.audienceSource as AudienceSource | null;

  // Legacy path — filter local Contact table
  if (!source || source.kind === 'contacts') {
    const filter = (source?.kind === 'contacts'
      ? source.filter
      : (campaign.audienceFilter as unknown as AudienceFilter)) ?? {};
    const where: Prisma.ContactWhereInput = { projectId: campaign.projectId };
    if (filter.tags && filter.tags.length > 0) where.tags = { hasEvery: filter.tags };
    if (filter.role) where.role = filter.role;
    const contacts = await prisma.contact.findMany({ where });
    return { contacts, fromCache: false, cache: null };
  }

  // MCP path — TTL cache
  if (!mcpManager) {
    throw new CampaignExecutionError(
      campaign.id,
      'MCP-based audience resolution requires mcpManager in CampaignRunnerDeps',
    );
  }

  const cache = campaign.audienceCache as AudienceCache | null;
  const sourceHash = sha1(JSON.stringify(source));
  const nowMs = Date.now();

  if (
    !options.force &&
    cache &&
    cache.sourceHash === sourceHash &&
    new Date(cache.expiresAt).getTime() > nowMs
  ) {
    const contacts = await prisma.contact.findMany({
      where: { id: { in: cache.contactIds }, projectId: campaign.projectId },
    });
    return { contacts, fromCache: true, cache };
  }

  // Cache miss (or forced) — call MCP
  const conn = mcpManager.getConnection(source.serverName);
  if (!conn || conn.status !== 'connected') {
    throw new CampaignExecutionError(
      campaign.id,
      `MCP server "${source.serverName}" is not connected`,
    );
  }

  let result: MCPToolResult;
  try {
    result = await conn.callTool(source.toolName, source.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CampaignExecutionError(
      campaign.id,
      `MCP tool "${source.serverName}.${source.toolName}" failed: ${message}`,
      error instanceof Error ? error : undefined,
    );
  }

  if (result.isError) {
    const detail = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(' ')
      .trim();
    throw new CampaignExecutionError(
      campaign.id,
      `MCP tool "${source.serverName}.${source.toolName}" returned error: ${detail || 'no details'}`,
    );
  }

  const rows = extractRows(result);
  const contacts = await upsertContactsFromMcp(
    prisma,
    campaign.projectId,
    rows,
    source.mapping,
  );

  const expiresAtMs = nowMs + source.ttlHours * 3_600_000;
  const newCache: AudienceCache = {
    contactIds: contacts.map((c) => c.id),
    resolvedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    sourceHash,
    count: contacts.length,
  };

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { audienceCache: newCache as unknown as Prisma.InputJsonValue },
  });

  logger.info('Audience resolved via MCP', {
    component: 'campaign-runner',
    campaignId: campaign.id,
    serverName: source.serverName,
    toolName: source.toolName,
    rowsReceived: rows.length,
    contactsResolved: contacts.length,
    ttlHours: source.ttlHours,
    forced: options.force === true,
  });

  return { contacts, fromCache: false, cache: newCache };
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a CampaignRunner for executing outbound campaigns. */
export function createCampaignRunner(deps: CampaignRunnerDeps): CampaignRunner {
  const { prisma, proactiveMessenger, logger, eventBus } = deps;

  // Emit `campaign.progress` every PROGRESS_BATCH sends so the dashboard can
  // show a live counter without flooding the bus on large audiences.
  const PROGRESS_BATCH = 10;

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
        agentId: campaign.agentId,
        name: campaign.name,
        channel: campaign.channel,
      });

      // 2-3. Resolve audience (local filter or MCP with TTL cache)
      let resolution: AudienceResolution;
      try {
        resolution = await resolveAudience(deps, campaign);
      } catch (error) {
        if (error instanceof NexusError) return err(error);
        const message = error instanceof Error ? error.message : String(error);
        return err(new CampaignExecutionError(campaignId, message));
      }
      const contacts = resolution.contacts;

      logger.info('Audience resolved', {
        component: 'campaign-runner',
        campaignId,
        agentId: campaign.agentId,
        matchingContacts: contacts.length,
        fromCache: resolution.fromCache,
      });

      // 4. Send to each contact
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      let lifecycleBreak: 'paused' | 'cancelled' | null = null;
      const channel = campaign.channel as CampaignChannel;

      // Extract optional template + provider overrides from metadata
      const meta = campaign.metadata as Record<string, unknown> | null;
      const templateConfig = meta?.['templateConfig'] as CampaignTemplateConfig | undefined;
      const channelProvider = (meta?.['channelProvider'] as 'whatsapp' | 'whatsapp-waha' | undefined) ?? channel as ChannelType;

      let processed = 0;
      for (const contact of contacts) {
        // Re-check lifecycle every PROGRESS_BATCH contacts so an operator can
        // pause/cancel a long run mid-way. Break cleanly on paused/cancelled
        // so partial stats still get written and the runner exits normally.
        if (processed > 0 && processed % PROGRESS_BATCH === 0) {
          const current = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { status: true },
          });
          if (current?.status === 'paused' || current?.status === 'cancelled') {
            lifecycleBreak = current.status;
            logger.info(`Campaign ${current.status} mid-run`, {
              component: 'campaign-runner',
              campaignId,
              action: current.status,
              processed,
              sent,
              failed,
              skipped,
              totalContacts: contacts.length,
            });
            break;
          }
        }
        processed++;

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

        // Create send record (agentId inherited from parent campaign)
        const sendRecord = await prisma.campaignSend.create({
          data: {
            campaignId,
            agentId: campaign.agentId,
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

        // Emit progress every PROGRESS_BATCH sends (live dashboard counter)
        if (eventBus && (sent + failed) % PROGRESS_BATCH === 0) {
          eventBus.emit({
            kind: 'campaign.progress',
            projectId: campaign.projectId as ProjectId,
            campaignId,
            sent,
            failed,
            replied: 0,
            ts: Date.now(),
          });
        }
      }

      // Final progress emit after the run completes
      if (eventBus) {
        eventBus.emit({
          kind: 'campaign.progress',
          projectId: campaign.projectId as ProjectId,
          campaignId,
          sent,
          failed,
          replied: 0,
          ts: Date.now(),
        });
      }

      // 5. Update campaign status — leave paused/cancelled untouched so the
      // operator keeps control; only mark completed when the run finished
      // naturally (no mid-run lifecycle break).
      if (!lifecycleBreak) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'completed', completedAt: new Date() },
        });
      }

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

    async resolveAudience(
      campaignId: string,
      options: ResolveAudienceOptions = {},
    ): Promise<Result<AudienceResolution, NexusError>> {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) {
        return err(new CampaignExecutionError(campaignId, 'Campaign not found'));
      }
      try {
        const resolution = await resolveAudience(deps, campaign, options);
        return ok(resolution);
      } catch (error) {
        if (error instanceof NexusError) return err(error);
        const message = error instanceof Error ? error.message : String(error);
        return err(new CampaignExecutionError(campaignId, message));
      }
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
