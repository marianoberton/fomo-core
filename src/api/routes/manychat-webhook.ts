/**
 * ManyChat Webhook Handler — Customer service agent endpoint.
 *
 * POST /api/v1/webhooks/manychat
 * Auth: header X-ManyChat-Secret (env var MANYCHAT_WEBHOOK_SECRET)
 *
 * Body: { subscriber_id, first_name, last_name, message, channel, email? }
 *
 * Flow:
 * 1. Validate ManyChat secret
 * 2. Find contact in HubSpot by subscriber_id or email
 * 3. Call configured agent for Marketpaper (MARKETPAPER_AGENT_ID env var)
 * 4. Return ManyChat v2 format response
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import type { AgentId } from '@/agents/types.js';
import type { ProjectId } from '@/core/types.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import {
  prepareChatRun,
  extractAssistantResponse,
} from './chat-setup.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const manychatWebhookSchema = z.object({
  subscriber_id: z.string().min(1),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  message: z.string().min(1),
  channel: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ManyChat v2 response format
interface ManyChatResponse {
  version: 'v2';
  content: {
    messages: Array<{
      type: 'text';
      text: string;
    }>;
  };
}

// HubSpot contact type
interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

// ─── HubSpot Client ─────────────────────────────────────────────

interface HubSpotSearchResult {
  total: number;
  results: HubSpotContact[];
}

async function searchHubSpotContact(
  accessToken: string,
  params: { email?: string; phone?: string; query?: string },
): Promise<HubSpotContact | null> {
  const filterGroups: { filters: { propertyName: string; operator: string; value: string }[] }[] = [];

  if (params.email) {
    filterGroups.push({
      filters: [{ propertyName: 'email', operator: 'EQ', value: params.email }],
    });
  }

  if (params.phone) {
    const normalized = params.phone.replace(/\D/g, '');
    filterGroups.push({
      filters: [{ propertyName: 'phone', operator: 'CONTAINS_TOKEN', value: `*${normalized}` }],
    });
  }

  if (params.query) {
    filterGroups.push({
      filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
    });
    filterGroups.push({
      filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
    });
  }

  if (filterGroups.length === 0) return null;

  const body = {
    filterGroups,
    properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'lifecyclestage'],
    limit: 10,
  };

  const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as HubSpotSearchResult;
  return data.results[0] ?? null;
}

async function getContactRecentActivity(
  accessToken: string,
  contactId: string,
): Promise<string> {
  try {
    // Get recent engagements (notes, emails, calls)
    const response = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/notes?limit=3`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) return '';

    const data = (await response.json()) as { results: Array<{ id: string }> };
    
    if (data.results.length === 0) return '';

    // Get note details for the most recent note
    const noteId = data.results[0]?.id;
    if (!noteId) return '';

    const noteResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/notes/${noteId}?properties=hs_note_body,hs_timestamp`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!noteResponse.ok) return '';

    const noteData = (await noteResponse.json()) as { properties?: { hs_note_body?: string } };
    return noteData.properties?.hs_note_body ?? '';
  } catch {
    return '';
  }
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register ManyChat webhook route. */
export function manychatWebhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { logger } = deps;

  fastify.post('/webhooks/manychat', async (request, reply) => {
    // 1. Validate ManyChat secret
    const manychatSecret = process.env['MANYCHAT_WEBHOOK_SECRET'];
    const providedSecret = request.headers['x-manychat-secret'];

    if (manychatSecret && providedSecret !== manychatSecret) {
      return sendError(reply, 'UNAUTHORIZED', 'Invalid ManyChat secret', 401);
    }

    // 2. Parse and validate body
    const parseResult = manychatWebhookSchema.safeParse(request.body);
    if (!parseResult.success) {
      return sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
    }

    const body = parseResult.data;

    // 3. Get Marketpaper agent ID from env
    const marketpaperAgentId = process.env['MARKETPAPER_AGENT_ID'];
    if (!marketpaperAgentId) {
      logger.error('MARKETPAPER_AGENT_ID not configured', { component: 'manychat-webhook' });
      return sendError(reply, 'CONFIG_ERROR', 'Agent not configured', 500);
    }

    // 4. Get HubSpot access token from env
    const hubspotAccessToken = process.env['HUBSPOT_ACCESS_TOKEN'];
    let hubspotContact: HubSpotContact | null = null;
    let recentActivity = '';

    if (hubspotAccessToken) {
      try {
        // Search by email or phone
        hubspotContact = await searchHubSpotContact(hubspotAccessToken, {
          email: body.email,
          phone: body.phone,
          query: `${body.first_name ?? ''} ${body.last_name ?? ''}`.trim(),
        });

        if (hubspotContact) {
          recentActivity = await getContactRecentActivity(hubspotAccessToken, hubspotContact.id);
          logger.info('HubSpot contact found', {
            component: 'manychat-webhook',
            contactId: hubspotContact.id,
            subscriberId: body.subscriber_id,
          });
        }
      } catch (error) {
        logger.warn('Failed to fetch HubSpot contact', {
          component: 'manychat-webhook',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue without HubSpot data
      }
    } else {
      logger.warn('HUBSPOT_ACCESS_TOKEN not configured', { component: 'manychat-webhook' });
    }

    // 5. Build context for the agent
    const contactContext = hubspotContact
      ? {
          id: hubspotContact.id,
          firstName: hubspotContact.properties['firstname'],
          lastName: hubspotContact.properties['lastname'],
          email: hubspotContact.properties['email'],
          phone: hubspotContact.properties['phone'],
          company: hubspotContact.properties['company'],
          lifecycleStage: hubspotContact.properties['lifecyclestage'],
          recentActivity: recentActivity.slice(0, 500), // Limit context size
        }
      : null;

    const enrichedMessage = `
Customer Message:
"""${body.message}"""

Customer Context:
- Subscriber ID: ${body.subscriber_id}
- Name: ${body.first_name ?? ''} ${body.last_name ?? ''}
- Channel: ${body.channel}
${contactContext ? `
HubSpot Contact:
- ID: ${contactContext.id}
- Name: ${contactContext.firstName ?? ''} ${contactContext.lastName ?? ''}
- Email: ${contactContext.email ?? 'N/A'}
- Phone: ${contactContext.phone ?? 'N/A'}
- Company: ${contactContext.company ?? 'N/A'}
- Lifecycle Stage: ${contactContext.lifecycleStage ?? 'N/A'}
${contactContext.recentActivity ? `\nRecent Activity:\n${contactContext.recentActivity}` : ''}
` : '\nNo HubSpot contact found.'}
`.trim();

    // 6. Prepare chat run
    const agentId = marketpaperAgentId as unknown as AgentId;
    
    // Get agent to find projectId
    const agent = await deps.agentRegistry.get(agentId);
    if (!agent) {
      return sendError(reply, 'AGENT_NOT_FOUND', 'Marketpaper agent not found', 500);
    }

    const projectId = agent.projectId;
    const sessionId = `manychat-${body.subscriber_id}-${Date.now()}`;

    const setupResult = await prepareChatRun(
      {
        projectId,
        sessionId,
        agentId: marketpaperAgentId,
        sourceChannel: 'manychat',
        message: enrichedMessage,
        metadata: {
          manychat_subscriber_id: body.subscriber_id,
          manychat_channel: body.channel,
          hubspot_contact_id: contactContext?.id,
        },
      },
      deps,
    );

    if (!setupResult.ok) {
      return sendError(
        reply,
        setupResult.error.code,
        setupResult.error.message,
        setupResult.error.statusCode,
      );
    }

    const {
      sanitizedMessage,
      agentConfig,
      sessionId: finalSessionId,
      systemPrompt,
      promptSnapshot,
      conversationHistory,
      provider,
      fallbackProvider,
      memoryManager,
      costGuard,
    } = setupResult.value;

    // 7. Create agent runner and execute
    const agentRunner = createAgentRunner({
      provider,
      fallbackProvider,
      toolRegistry: deps.toolRegistry,
      memoryManager,
      costGuard,
      logger,
    });

    const result = await agentRunner.run({
      message: sanitizedMessage,
      agentConfig,
      sessionId: finalSessionId as import('@/core/types.js').SessionId,
      systemPrompt,
      promptSnapshot,
      conversationHistory,
    });

    if (!result.ok) {
      logger.error('Agent run failed', {
        component: 'manychat-webhook',
        error: result.error.message,
      });
      return sendError(reply, 'AGENT_ERROR', 'Failed to process message', 500);
    }

    const trace = result.value;

    // 8. Persist execution trace
    await deps.executionTraceRepository.save(trace);

    // 9. Persist messages
    await deps.sessionRepository.addMessage(
      finalSessionId as import('@/core/types.js').SessionId,
      { role: 'user', content: sanitizedMessage },
      trace.id,
    );

    const assistantText = extractAssistantResponse(trace.events);

    await deps.sessionRepository.addMessage(
      finalSessionId as import('@/core/types.js').SessionId,
      { role: 'assistant', content: assistantText },
      trace.id,
    );

    logger.info('ManyChat webhook processed', {
      component: 'manychat-webhook',
      subscriberId: body.subscriber_id,
      sessionId: finalSessionId,
      traceId: trace.id,
    });

    // 10. Return ManyChat v2 format
    const manychatResponse: ManyChatResponse = {
      version: 'v2',
      content: {
        messages: [
          {
            type: 'text',
            text: assistantText,
          },
        ],
      },
    };

    return sendSuccess(reply, manychatResponse);
  });
}
