/**
 * Upsert Twenty CRM Lead Tool
 *
 * Update-or-create: busca el lead por email o empresa.
 * Si existe → actualiza stage y/o notas.
 * Si no existe → crea Company + Person + Opportunity.
 *
 * Un solo tool call reemplaza el patrón update → fallback create.
 *
 * Requiere secreto del proyecto: TWENTY_API_KEY
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'upsert-twenty-lead' });

export interface TwentyUpsertToolOptions {
  twentyBaseUrl: string;
  secretService: SecretService;
}

const VALID_STAGES = ['NEW', 'CONTACTED', 'MEETING', 'PROPOSAL', 'WON', 'LOST'] as const;

const inputSchema = z.object({
  firstName: z.string().min(1).max(100).describe('Nombre del contacto'),
  lastName: z.string().max(100).default('').describe('Apellido (opcional)'),
  email: z.string().email().optional().describe('Email del contacto'),
  phone: z.string().max(50).optional().describe('Teléfono/WhatsApp'),
  company: z.string().min(1).max(200).describe('Nombre de la empresa'),
  stage: z.enum(VALID_STAGES).default('NEW').describe('Estado del lead'),
  source: z
    .enum(['web', 'whatsapp', 'telegram', 'referral', 'email', 'cold_outreach', 'other'])
    .default('web')
    .describe('Canal de origen'),
  notes: z.string().max(2000).optional().describe('Notas de calificación'),
  opportunityName: z.string().max(200).optional().describe('Nombre de la oportunidad'),
});

type TwentyHeaders = Record<string, string>;

async function req(
  baseUrl: string,
  headers: TwentyHeaders,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}/rest${path}`, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

interface TwentyRecord {
  id: string;
  name?: unknown;
  [key: string]: unknown;
}

async function findByEmail(baseUrl: string, headers: TwentyHeaders, email: string): Promise<TwentyRecord | null> {
  const filter = encodeURIComponent(`emails.primaryEmail[eq]:${email}`);
  const res = await req(baseUrl, headers, 'GET', `/people?filter=${filter}&limit=1`);
  if (!res.ok) return null;
  const body = res.data as { data?: { people?: TwentyRecord[] | { edges?: { node: TwentyRecord }[] } } } | null;
  const people = body?.data?.people;
  return Array.isArray(people) ? people[0] ?? null : people?.edges?.[0]?.node ?? null;
}

async function findCompany(baseUrl: string, headers: TwentyHeaders, name: string): Promise<TwentyRecord | null> {
  const filter = encodeURIComponent(`name[like]:%${name}%`);
  const res = await req(baseUrl, headers, 'GET', `/companies?filter=${filter}&limit=1`);
  if (!res.ok) return null;
  const body = res.data as { data?: { companies?: TwentyRecord[] | { edges?: { node: TwentyRecord }[] } } } | null;
  const companies = body?.data?.companies;
  return Array.isArray(companies) ? companies[0] ?? null : companies?.edges?.[0]?.node ?? null;
}

async function findOpportunityByPerson(baseUrl: string, headers: TwentyHeaders, personId: string): Promise<TwentyRecord | null> {
  const filter = encodeURIComponent(`pointOfContactId[eq]:${personId}`);
  const res = await req(baseUrl, headers, 'GET', `/opportunities?filter=${filter}&orderBy=createdAt[desc]&limit=1`);
  if (!res.ok) return null;
  const body = res.data as { data?: { opportunities?: TwentyRecord[] | { edges?: { node: TwentyRecord }[] } } } | null;
  const opps = body?.data?.opportunities;
  return Array.isArray(opps) ? opps[0] ?? null : opps?.edges?.[0]?.node ?? null;
}

async function findOpportunityByCompany(baseUrl: string, headers: TwentyHeaders, companyId: string): Promise<TwentyRecord | null> {
  const filter = encodeURIComponent(`companyId[eq]:${companyId}`);
  const res = await req(baseUrl, headers, 'GET', `/opportunities?filter=${filter}&orderBy=createdAt[desc]&limit=1`);
  if (!res.ok) return null;
  const body = res.data as { data?: { opportunities?: TwentyRecord[] | { edges?: { node: TwentyRecord }[] } } } | null;
  const opps = body?.data?.opportunities;
  return Array.isArray(opps) ? opps[0] ?? null : opps?.edges?.[0]?.node ?? null;
}

export function createTwentyUpsertTool(options: TwentyUpsertToolOptions): ExecutableTool {
  const { twentyBaseUrl, secretService } = options;
  const baseUrl = twentyBaseUrl.replace(/\/$/, '');

  return {
    id: 'upsert-twenty-lead',
    name: 'Upsert CRM Lead',
    description:
      'Crea o actualiza un lead en Twenty CRM con un solo llamado. ' +
      'Si el contacto o empresa ya existe → actualiza stage y notas. ' +
      'Si no existe → crea Company + Person + Opportunity. ' +
      'Usar siempre en lugar de create-twenty-lead o update-twenty-lead por separado.',
    category: 'crm',
    inputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    // eslint-disable-next-line @typescript-eslint/require-await
    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('upsert-twenty-lead', `Invalid input: ${parsed.error.message}`));
      }
      return ok({ success: true, output: { dryRun: true, wouldUpsert: parsed.data }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('upsert-twenty-lead', `Invalid input: ${parsed.error.message}`));
      }
      const data = parsed.data;

      let apiKey: string;
      try {
        apiKey = await secretService.get(context.projectId, 'TWENTY_API_KEY');
      } catch {
        return err(new ToolExecutionError('upsert-twenty-lead', 'TWENTY_API_KEY not configured.'));
      }

      const headers: TwentyHeaders = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      try {
        // ─── 1. Buscar persona existente ────────────────────────
        let person = data.email ? await findByEmail(baseUrl, headers, data.email) : null;
        let company = await findCompany(baseUrl, headers, data.company);

        // ─── 2. Buscar oportunidad existente ────────────────────
        const opportunity = person
          ? await findOpportunityByPerson(baseUrl, headers, person.id)
          : company
            ? await findOpportunityByCompany(baseUrl, headers, company.id)
            : null;

        // ─── 3. UPDATE path ─────────────────────────────────────
        if (opportunity) {
          const updatePayload: Record<string, unknown> = { stage: data.stage };
          if (data.notes) {
            updatePayload['name'] = `${String(opportunity.name)} | ${data.notes}`;
          }
          const resUpdate = await req(baseUrl, headers, 'PATCH', `/opportunities/${opportunity.id}`, updatePayload);
          if (!resUpdate.ok) {
            throw new Error(`Update failed (${resUpdate.status}): ${JSON.stringify(resUpdate.data)}`);
          }

          logger.info('Twenty lead updated', {
            component: 'upsert-twenty-lead',
            opportunityId: opportunity.id,
            stage: data.stage,
            projectId: context.projectId,
          });

          return ok({
            success: true,
            output: {
              action: 'updated',
              opportunityId: opportunity.id,
              stage: data.stage,
              crmUrl: `${baseUrl}/crm/opportunities/${opportunity.id}`,
            },
            durationMs: Date.now() - start,
          });
        }

        // ─── 4. CREATE path ─────────────────────────────────────

        // Company
        if (!company) {
          const resC = await req(baseUrl, headers, 'POST', '/companies', { name: data.company });
          if (!resC.ok) throw new Error(`createCompany failed: ${JSON.stringify(resC.data)}`);
          const companyBody = resC.data as { data?: { createCompany?: TwentyRecord } } | null;
          company = companyBody?.data?.createCompany ?? null;
          if (!company) throw new Error('createCompany returned no data');
        }

        // Person
        if (!person) {
          const personPayload: Record<string, unknown> = {
            name: { firstName: data.firstName, lastName: data.lastName },
            companyId: company.id,
          };
          if (data.email) personPayload['emails'] = { primaryEmail: data.email };
          if (data.phone) personPayload['phones'] = { primaryPhoneNumber: data.phone };

          try {
            const resP = await req(baseUrl, headers, 'POST', '/people', personPayload);
            if (!resP.ok) throw new Error(`createPerson failed: ${JSON.stringify(resP.data)}`);
            const personBody = resP.data as { data?: { createPerson?: TwentyRecord } } | null;
            person = personBody?.data?.createPerson ?? null;
          } catch {
            // Duplicate email — find existing
            if (data.email) person = await findByEmail(baseUrl, headers, data.email);
            if (!person) throw new Error('createPerson failed and findByEmail returned null');
          }
        }

        // At this point person is guaranteed non-null (guarded by throw above)
        if (!person) throw new Error('person is unexpectedly null');

        // Opportunity
        const oppName = data.opportunityName ?? `${data.company} - ${new Date().toISOString().slice(0, 10)}`;
        const resO = await req(baseUrl, headers, 'POST', '/opportunities', {
          name: oppName,
          stage: data.stage,
          companyId: company.id,
          pointOfContactId: person.id,
        });
        if (!resO.ok) throw new Error(`createOpportunity failed: ${JSON.stringify(resO.data)}`);
        const oppBody = resO.data as { data?: { createOpportunity?: TwentyRecord } } | null;
        const newOpp = oppBody?.data?.createOpportunity;

        logger.info('Twenty lead created', {
          component: 'upsert-twenty-lead',
          opportunityId: newOpp?.id,
          stage: data.stage,
          projectId: context.projectId,
        });

        return ok({
          success: true,
          output: {
            action: 'created',
            opportunityId: newOpp?.id,
            companyId: company.id,
            personId: person.id,
            stage: data.stage,
            crmUrl: `${baseUrl}/crm/opportunities/${newOpp?.id}`,
          },
          durationMs: Date.now() - start,
        });

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Twenty upsert error', { component: 'upsert-twenty-lead', error: message });
        return err(new ToolExecutionError('upsert-twenty-lead', `Twenty CRM error: ${message}`));
      }
    },
  };
}
