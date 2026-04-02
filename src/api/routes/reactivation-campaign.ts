/**
 * HubSpot Lead Reactivation Campaign Routes
 *
 * POST /api/v1/campaigns/reactivation/run
 *   - Query inactive leads from HubSpot
 *   - Generate personalized messages with Claude
 *   - Send via WAHA WhatsApp
 *   - Log to HubSpot
 *
 * POST /api/v1/campaigns/reactivation/schedule
 *   - Configure cron schedule for automatic reactivation
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';
import { createProvider } from '@/providers/factory.js';
import type { LLMProvider } from '@/providers/types.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const runReactivationSchema = z.object({
  days_inactive: z.number().int().positive().default(30),
  max_leads: z.number().int().positive().max(500).default(50),
  dry_run: z.boolean().default(false),
  project_id: z.string().min(1).optional(), // Optional project context
});

const scheduleReactivationSchema = z.object({
  cron: z.string().min(1), // e.g., "0 9 * * 1" (Mondays at 9am)
  enabled: z.boolean().default(true),
  config: z.object({
    days_inactive: z.number().int().positive().default(30),
    max_leads: z.number().int().positive().max(500).default(50),
  }).optional(),
});

// ─── Types ──────────────────────────────────────────────────────

interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

interface ReactivationLead {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  lastModifiedDate: string | null;
  lifecycleStage: string | null;
  deals: Array<{
    id: string;
    name: string | null;
    stage: string | null;
    amount: string | null;
  }>;
}

interface ReactivationResult {
  sent: number;
  skipped: number;
  errors: number;
  leads: Array<{
    contactId: string;
    name: string;
    phone: string | null;
    status: 'sent' | 'skipped' | 'error';
    message?: string;
    error?: string;
  }>;
}

// ─── HubSpot API Client ─────────────────────────────────────────

async function searchInactiveContacts(
  accessToken: string,
  daysInactive: number,
  maxLeads: number,
): Promise<HubSpotContact[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysInactive);
  const cutoffTimestamp = cutoffDate.getTime();

  const body = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'lastmodifieddate',
            operator: 'LT',
            value: cutoffTimestamp.toString(),
          },
          {
            propertyName: 'hs_lead_status',
            operator: 'NEQ',
            value: 'UNQUALIFIED',
          },
        ],
      },
    ],
    properties: [
      'firstname',
      'lastname',
      'email',
      'phone',
      'company',
      'lastmodifieddate',
      'lifecyclestage',
      'hs_lead_status',
    ],
    limit: Math.min(maxLeads, 100),
    sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
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
    throw new Error(`HubSpot search error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as { results: HubSpotContact[] };
  return data.results;
}

async function getContactDeals(
  accessToken: string,
  contactId: string,
): Promise<Array<{ id: string; properties: Record<string, string | null> }>> {
  // Get associated deal IDs
  const assocResponse = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/deals`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!assocResponse.ok) return [];

  const assocData = (await assocResponse.json()) as { results: Array<{ id: string }> };
  
  if (assocData.results.length === 0) return [];

  // Batch read deal details
  const dealIds = assocData.results.slice(0, 5).map((a) => ({ id: a.id }));
  
  const batchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: dealIds,
      properties: ['dealname', 'dealstage', 'amount', 'closedate', 'pipeline'],
    }),
  });

  if (!batchResponse.ok) return [];

  const batchData = (await batchResponse.json()) as { results: Array<{ id: string; properties: Record<string, string | null> }> };
  return batchData.results;
}

async function addContactNote(
  accessToken: string,
  contactId: string,
  body: string,
): Promise<void> {
  // Create note
  const noteResponse = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        hs_note_body: body,
        hs_timestamp: new Date().toISOString(),
      },
    }),
  });

  if (!noteResponse.ok) {
    throw new Error(`Failed to create note: ${noteResponse.status}`);
  }

  const noteData = (await noteResponse.json()) as { id: string };

  // Associate note with contact
  await fetch(
    `https://api.hubapi.com/crm/v3/objects/notes/${noteData.id}/associations/contacts/${contactId}/note_to_contact/202`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
}

// ─── WAHA WhatsApp Sender ───────────────────────────────────────

interface WahaSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function sendWhatsAppViaWaha(
  wahaBaseUrl: string,
  sessionName: string,
  phone: string,
  message: string,
  apiKey?: string,
): Promise<WahaSendResult> {
  try {
    const chatId = `${phone.replace(/\D/g, '')}@c.us`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    }

    const response = await fetch(`${wahaBaseUrl.replace(/\/$/, '')}/api/sendText`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chatId,
        text: message,
        session: sessionName,
      }),
    });

    const data = (await response.json()) as unknown as { id?: string; error?: string };

    if (response.ok && data.id) {
      return { success: true, messageId: data.id };
    }

    return {
      success: false,
      error: data.error ?? `WAHA error: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown WAHA error',
    };
  }
}

// ─── Message Generation ─────────────────────────────────────────

async function generateReactivationMessage(
  provider: LLMProvider,
  lead: ReactivationLead,
): Promise<string> {
  const prompt = `Eres un asistente de ventas amigable y profesional. Genera un mensaje corto y personalizado para reactivar a un lead inactivo.

Datos del lead:
- Nombre: ${lead.firstName ?? 'Cliente'}
- Empresa: ${lead.company ?? 'No especificada'}
- Última actividad: ${lead.lastModifiedDate ? new Date(lead.lastModifiedDate).toLocaleDateString('es-AR') : 'Hace tiempo'}
${lead.deals.length > 0 ? `- Oportunidad anterior: ${lead.deals[0]?.name ?? 'N/A'} (${lead.deals[0]?.stage ?? 'en proceso'})` : ''}

Instrucciones:
1. Sé breve (máximo 2-3 oraciones)
2. Sé personalizado y cálido
3. Menciona que notamos que hace tiempo no nos contactamos
4. Pregunta si hay algo en lo que podamos ayudar
5. No uses emojis excesivos
6. Firma como "Equipo Marketpaper"

Responde SOLO con el mensaje, sin explicaciones adicionales.`;

  // Collect the streaming response into a single string
  const stream = provider.chat({
    model: process.env['REACTIVATION_MODEL'] ?? 'claude-3-5-sonnet-20241022',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    maxTokens: 300,
  });

  let message = '';
  for await (const event of stream) {
    if (event.type === 'content_delta') {
      message += event.text;
    }
  }

  return message.trim();
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register reactivation campaign routes. */
export function reactivationCampaignRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { logger, prisma } = deps;

  // POST /campaigns/reactivation/run
  fastify.post('/campaigns/reactivation/run', async (request, reply) => {
    // 1. Validate API key (Bearer token)
    const authHeader = request.headers.authorization;
    const apiKey = process.env['REACTIVATION_API_KEY'];
    
    if (apiKey && (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== apiKey)) {
      return sendError(reply, 'UNAUTHORIZED', 'Invalid API key', 401);
    }

    // 2. Parse request
    const parseResult = runReactivationSchema.safeParse(request.body);
    if (!parseResult.success) {
      return sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
    }

    const { days_inactive, max_leads, dry_run } = parseResult.data;

    // 3. Check required env vars
    const hubspotAccessToken = process.env['HUBSPOT_ACCESS_TOKEN'];
    const wahaBaseUrl = process.env['REACTIVATION_CAMPAIGN_WAHA_INSTANCE'] ?? process.env['WAHA_DEFAULT_URL'];
    const wahaApiKey = process.env['WAHA_API_KEY'];
    const wahaSession = process.env['REACTIVATION_WAHA_SESSION'] ?? 'default';

    if (!hubspotAccessToken) {
      return sendError(reply, 'CONFIG_ERROR', 'HUBSPOT_ACCESS_TOKEN not configured', 500);
    }

    if (!wahaBaseUrl) {
      return sendError(reply, 'CONFIG_ERROR', 'WAHA instance not configured', 500);
    }

    // 4. Initialize LLM provider for message generation
    let provider: LLMProvider | null = null;
    try {
      provider = createProvider({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      });
    } catch (error) {
      logger.warn('Failed to create LLM provider, using fallback templates', {
        component: 'reactivation-campaign',
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }

    // 5. Fetch inactive leads from HubSpot
    let contacts: HubSpotContact[];
    try {
      contacts = await searchInactiveContacts(hubspotAccessToken, days_inactive, max_leads);
    } catch (error) {
      logger.error('Failed to fetch HubSpot contacts', {
        component: 'reactivation-campaign',
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return sendError(reply, 'HUBSPOT_ERROR', 'Failed to fetch contacts', 500);
    }

    logger.info('Found inactive leads', {
      component: 'reactivation-campaign',
      count: contacts.length,
      daysInactive: days_inactive,
    });

    // 6. Process each lead
    const result: ReactivationResult = {
      sent: 0,
      skipped: 0,
      errors: 0,
      leads: [],
    };

    for (const contact of contacts) {
      const props = contact.properties;
      const phone = props['phone'];
      
      if (!phone) {
        result.skipped++;
        result.leads.push({
          contactId: contact.id,
          name: `${props['firstname'] ?? ''} ${props['lastname'] ?? ''}`.trim() || 'Unknown',
          phone: null,
          status: 'skipped',
          error: 'No phone number',
        });
        continue;
      }

      // Get deals for context
      let deals: ReactivationLead['deals'] = [];
      try {
        const dealData = await getContactDeals(hubspotAccessToken, contact.id);
        deals = dealData
          .filter((d) => d.properties['dealstage'] !== 'closedwon')
          .map((d) => ({
            id: d.id,
            name: d.properties['dealname'] ?? null,
            stage: d.properties['dealstage'] ?? null,
            amount: d.properties['amount'] ?? null,
          }));
      } catch {
        // Continue without deal data
      }

      const lead: ReactivationLead = {
        contactId: contact.id,
        firstName: props['firstname'] ?? null,
        lastName: props['lastname'] ?? null,
        email: props['email'] ?? null,
        phone,
        company: props['company'] ?? null,
        lastModifiedDate: props['lastmodifieddate'] ?? null,
        lifecycleStage: props['lifecyclestage'] ?? null,
        deals,
      };

      // Generate or use template message
      let message: string;
      if (provider && !dry_run) {
        try {
          message = await generateReactivationMessage(provider, lead);
        } catch (error) {
          logger.warn('Failed to generate message, using template', {
            component: 'reactivation-campaign',
            contactId: contact.id,
            error: error instanceof Error ? error.message : 'Unknown',
          });
          message = `Hola ${lead.firstName ?? ''}, notamos que hace tiempo no nos contactamos. ¿Hay algo en lo que podamos ayudarte? - Equipo Marketpaper`;
        }
      } else {
        message = `Hola ${lead.firstName ?? ''}, notamos que hace tiempo no nos contactamos. ¿Hay algo en lo que podamos ayudarte? - Equipo Marketpaper`;
      }

      if (dry_run) {
        result.leads.push({
          contactId: contact.id,
          name: `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'Unknown',
          phone,
          status: 'skipped',
          message,
        });
        continue;
      }

      // Send WhatsApp message
      const sendResult = await sendWhatsAppViaWaha(
        wahaBaseUrl,
        wahaSession,
        phone,
        message,
        wahaApiKey,
      );

      if (sendResult.success) {
        result.sent++;
        result.leads.push({
          contactId: contact.id,
          name: `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'Unknown',
          phone,
          status: 'sent',
          message,
        });

        // Log to HubSpot
        try {
          await addContactNote(
            hubspotAccessToken,
            contact.id,
            `Mensaje de reactivación enviado por WhatsApp:\n\n${message}\n\n(Fomo Campaign)`,
          );
        } catch (error) {
          logger.warn('Failed to log note to HubSpot', {
            component: 'reactivation-campaign',
            contactId: contact.id,
            error: error instanceof Error ? error.message : 'Unknown',
          });
        }
      } else {
        result.errors++;
        result.leads.push({
          contactId: contact.id,
          name: `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'Unknown',
          phone,
          status: 'error',
          error: sendResult.error,
        });
      }
    }

    logger.info('Reactivation campaign completed', {
      component: 'reactivation-campaign',
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors,
    });

    return sendSuccess(reply, result);
  });

  // POST /campaigns/reactivation/schedule
  fastify.post('/campaigns/reactivation/schedule', async (request, reply) => {
    // Validate API key
    const authHeader = request.headers.authorization;
    const apiKey = process.env['REACTIVATION_API_KEY'];
    
    if (apiKey && (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== apiKey)) {
      return sendError(reply, 'UNAUTHORIZED', 'Invalid API key', 401);
    }

    const parseResult = scheduleReactivationSchema.safeParse(request.body);
    if (!parseResult.success) {
      return sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
    }

    const { cron, enabled, config } = parseResult.data;

    // Validate cron expression
    try {
      const { CronExpressionParser } = await import('cron-parser');
      CronExpressionParser.parse(cron);
    } catch {
      return sendError(reply, 'VALIDATION_ERROR', 'Invalid cron expression', 400);
    }

    // Store schedule in database (using ScheduledTask model)
    try {
      const scheduleRecord = await prisma.scheduledTask.create({
        data: {
          id: `reactivation-campaign-${Date.now()}`,
          name: 'reactivation-campaign',
          cronExpression: cron,
          status: enabled ? 'active' : 'paused',
          taskPayload: {
            type: 'reactivation-campaign',
            config: config ?? { days_inactive: 30, max_leads: 50 },
          } as unknown as import('@prisma/client').Prisma.InputJsonValue,
          // Use a system project or default
          projectId: process.env['REACTIVATION_PROJECT_ID'] ?? 'system',
          origin: 'static',
        },
      });

      logger.info('Reactivation campaign scheduled', {
        component: 'reactivation-campaign',
        scheduleId: scheduleRecord.id,
        cron,
        enabled,
      });

      return sendSuccess(reply, {
        scheduleId: scheduleRecord.id,
        cron,
        enabled,
        config,
      });
    } catch (error) {
      logger.error('Failed to schedule reactivation campaign', {
        component: 'reactivation-campaign',
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return sendError(reply, 'SCHEDULE_ERROR', 'Failed to create schedule', 500);
    }
  });

  // GET /campaigns/reactivation/schedule
  fastify.get('/campaigns/reactivation/schedule', async (request, reply) => {
    // Validate API key
    const authHeader = request.headers.authorization;
    const apiKey = process.env['REACTIVATION_API_KEY'];
    
    if (apiKey && (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== apiKey)) {
      return sendError(reply, 'UNAUTHORIZED', 'Invalid API key', 401);
    }

    try {
      const schedules = await prisma.scheduledTask.findMany({
        where: {
          name: 'reactivation-campaign',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return sendSuccess(reply, {
        schedules: schedules.map((s) => ({
          id: s.id,
          cron: s.cronExpression,
          status: s.status,
          config: s.taskPayload,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      });
    } catch (error) {
      logger.error('Failed to fetch reactivation schedules', {
        component: 'reactivation-campaign',
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return sendError(reply, 'DATABASE_ERROR', 'Failed to fetch schedules', 500);
    }
  });
}
