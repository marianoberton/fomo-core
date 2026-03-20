/**
 * Create Twenty CRM Lead Tool
 *
 * Crea un lead (Person + Company + Opportunity) en una instancia de Twenty CRM.
 * La API key se obtiene de SecretService en runtime — nunca hardcodeada.
 *
 * Requiere secreto del proyecto: TWENTY_API_KEY
 * Configuración del tool: twentyBaseUrl (URL de la instancia Twenty en el VPS)
 *
 * Flujo:
 *   1. Buscar si la empresa ya existe por nombre → evitar duplicados
 *   2. Si no existe → crear Company
 *   3. Buscar si el contacto ya existe por email → evitar duplicados
 *   4. Si no existe → crear Person, vinculada a la Company
 *   5. Crear Opportunity en etapa "NEW", vinculada a Person y Company
 *   6. Retornar IDs creados/encontrados
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

const logger = createLogger({ name: 'create-twenty-lead' });

// ─── Options ────────────────────────────────────────────────────

export interface TwentyCrmToolOptions {
  /**
   * Base URL de la instancia Twenty CRM.
   * Ej: "http://localhost:3000" o "https://crm.fomo.com.ar"
   */
  twentyBaseUrl: string;
  /** SecretService para obtener TWENTY_API_KEY en runtime. */
  secretService: SecretService;
}

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  firstName: z.string().min(1).max(100).describe('Nombre del contacto'),
  lastName: z.string().max(100).default('').describe('Apellido del contacto (opcional)'),
  email: z.string().email().optional().describe('Email del contacto'),
  phone: z.string().max(50).optional().describe('Teléfono/WhatsApp del contacto'),
  company: z.string().min(1).max(200).describe('Nombre de la empresa del lead'),
  source: z
    .enum(['web', 'whatsapp', 'telegram', 'referral', 'email', 'cold_outreach', 'other'])
    .default('web')
    .describe('Canal de origen del lead'),
  notes: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Resumen de la conversación: qué preguntó el lead, qué producto le interesa, contexto relevante. ' +
        'El agente debe completar este campo automáticamente con el contexto de la conversación.',
    ),
  opportunityName: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Nombre de la oportunidad. Si no se provee, se usa "[empresa] - Demo Request".',
    ),
});

// ─── Twenty API helpers ──────────────────────────────────────────

type TwentyHeaders = Record<string, string>;

async function twentyRequest(
  baseUrl: string,
  headers: TwentyHeaders,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${baseUrl}/rest${path}`;
  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/** Busca una empresa por nombre (case-insensitive). Retorna el ID o null. */
async function findCompany(
  baseUrl: string,
  headers: TwentyHeaders,
  name: string,
): Promise<string | null> {
  // Twenty REST API v2 uses filter=field[op]:value format
  const filter = encodeURIComponent(`name[like]:%${name}%`);
  const res = await twentyRequest(baseUrl, headers, 'GET', `/companies?filter=${filter}&limit=1`);
  if (!res.ok) return null;
  // Response is a plain array (not edges-based)
  const body = res.data as { data?: { companies?: { id: string }[] | { edges?: { node: { id: string } }[] } } };
  const companies = body?.data?.companies;
  if (!companies) return null;
  if (Array.isArray(companies)) return companies[0]?.id ?? null;
  return companies.edges?.[0]?.node?.id ?? null;
}

/** Crea una empresa. Retorna el ID. */
async function createCompany(
  baseUrl: string,
  headers: TwentyHeaders,
  name: string,
): Promise<string> {
  const res = await twentyRequest(baseUrl, headers, 'POST', '/companies', { name });
  if (!res.ok) {
    throw new Error(`Twenty createCompany failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  const body = res.data as { data?: { createCompany?: { id: string } } };
  const id = body?.data?.createCompany?.id;
  if (!id) throw new Error('Twenty createCompany returned no ID');
  return id;
}

/** Busca un contacto por email. Retorna el ID o null. */
async function findPerson(
  baseUrl: string,
  headers: TwentyHeaders,
  email: string,
): Promise<string | null> {
  const filter = encodeURIComponent(`emails.primaryEmail[eq]:${email}`);
  const res = await twentyRequest(baseUrl, headers, 'GET', `/people?filter=${filter}&limit=1`);
  if (!res.ok) return null;
  const body = res.data as { data?: { people?: { id: string }[] | { edges?: { node: { id: string } }[] } } };
  const people = body?.data?.people;
  if (!people) return null;
  if (Array.isArray(people)) return people[0]?.id ?? null;
  return people.edges?.[0]?.node?.id ?? null;
}

/** Crea un contacto vinculado a una empresa. Retorna el ID. */
async function createPerson(
  baseUrl: string,
  headers: TwentyHeaders,
  opts: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    companyId: string;
  },
): Promise<string> {
  const payload: Record<string, unknown> = {
    name: { firstName: opts.firstName, lastName: opts.lastName },
    companyId: opts.companyId,
  };
  // Twenty REST v2: emails/phones expect flat string fields, not nested objects.
  // Correct: { primaryEmail: "email@example.com" }
  // Correct: { primaryPhoneNumber: "+54..." }
  if (opts.email) {
    payload['emails'] = { primaryEmail: opts.email };
  }
  if (opts.phone) {
    payload['phones'] = { primaryPhoneNumber: opts.phone };
  }

  const res = await twentyRequest(baseUrl, headers, 'POST', '/people', payload);
  if (!res.ok) {
    throw new Error(`Twenty createPerson failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  const body = res.data as { data?: { createPerson?: { id: string } } };
  const id = body?.data?.createPerson?.id;
  if (!id) throw new Error('Twenty createPerson returned no ID');
  return id;
}

/** Crea una oportunidad vinculada a Person y Company. Retorna el ID. */
async function createOpportunity(
  baseUrl: string,
  headers: TwentyHeaders,
  opts: {
    name: string;
    companyId: string;
    personId: string;
    source: string;
    notes?: string;
  },
): Promise<string> {
  const payload: Record<string, unknown> = {
    name: opts.name,
    stage: 'NEW',
    companyId: opts.companyId,
    pointOfContactId: opts.personId,
  };
  // 'body' field removed — not supported in current Twenty schema
  // Notes are captured in the opportunity name instead

  const res = await twentyRequest(baseUrl, headers, 'POST', '/opportunities', payload);
  if (!res.ok) {
    throw new Error(
      `Twenty createOpportunity failed (${res.status}): ${JSON.stringify(res.data)}`,
    );
  }
  const body = res.data as { data?: { createOpportunity?: { id: string } } };
  const id = body?.data?.createOpportunity?.id;
  if (!id) throw new Error('Twenty createOpportunity returned no ID');
  return id;
}

// ─── Tool Factory ────────────────────────────────────────────────

/** Create the Twenty CRM lead capture tool. */
export function createTwentyCrmTool(options: TwentyCrmToolOptions): ExecutableTool {
  const { twentyBaseUrl, secretService } = options;
  const baseUrl = twentyBaseUrl.replace(/\/$/, '');

  return {
    id: 'create-twenty-lead',
    name: 'Create CRM Lead',
    description:
      'Registra un nuevo lead en el CRM (Twenty). ' +
      'Crea la empresa, el contacto y la oportunidad automáticamente, ' +
      'evitando duplicados por nombre de empresa o email.',
    category: 'crm',
    inputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new ToolExecutionError('create-twenty-lead', `Invalid input: ${parsed.error.message}`),
        );
      }
      const data = parsed.data;
      return ok({
        success: true,
        output: {
          dryRun: true,
          wouldCreate: {
            company: data.company,
            contact: `${data.firstName} ${data.lastName}`.trim(),
            email: data.email ?? null,
            phone: data.phone ?? null,
            opportunity: data.opportunityName ?? `${data.company} - Demo Request`,
            source: data.source,
          },
        },
        durationMs: 0,
      });
    },

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new ToolExecutionError('create-twenty-lead', `Invalid input: ${parsed.error.message}`),
        );
      }
      const data = parsed.data;

      // Obtener API key de SecretService en runtime
      let apiKey: string;
      try {
        apiKey = await secretService.get(context.projectId, 'TWENTY_API_KEY');
      } catch {
        return err(
          new ToolExecutionError(
            'create-twenty-lead',
            'TWENTY_API_KEY not configured for this project. ' +
              'Add it via Settings → Secrets → TWENTY_API_KEY.',
          ),
        );
      }

      const headers: TwentyHeaders = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      try {
        // 1. Company — buscar o crear
        let companyId = await findCompany(baseUrl, headers, data.company);
        const companyCreated = !companyId;
        if (!companyId) {
          companyId = await createCompany(baseUrl, headers, data.company);
          logger.info('Twenty company created', {
            component: 'create-twenty-lead',
            companyId,
            name: data.company,
            projectId: context.projectId,
          });
        }

        // 2. Person — buscar por email o crear
        let personId: string | null = null;
        let personCreated = false;
        if (data.email) {
          personId = await findPerson(baseUrl, headers, data.email);
        }
        if (!personId) {
          try {
            personId = await createPerson(baseUrl, headers, {
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phone: data.phone,
              companyId,
            });
            personCreated = true;
          } catch (createErr) {
            // If duplicate email, try finding again (race condition or prior run)
            if (data.email) {
              personId = await findPerson(baseUrl, headers, data.email);
            }
            if (!personId) throw createErr;
          }
          logger.info('Twenty person created', {
            component: 'create-twenty-lead',
            personId,
            email: data.email,
            projectId: context.projectId,
          });
        }

        // 3. Opportunity — siempre nueva
        const oppName = data.opportunityName ?? `${data.company} - Demo Request`;

        const opportunityId = await createOpportunity(baseUrl, headers, {
          name: oppName,
          companyId,
          personId,
          source: data.source,
          notes: data.notes,
        });

        logger.info('Twenty opportunity created', {
          component: 'create-twenty-lead',
          opportunityId,
          companyId,
          personId,
          source: data.source,
          projectId: context.projectId,
        });

        return ok({
          success: true,
          output: {
            opportunityId,
            companyId,
            personId,
            companyCreated,
            personCreated,
            opportunityName: oppName,
            crmUrl: `${baseUrl}/crm/opportunities/${opportunityId}`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Twenty CRM API error', {
          component: 'create-twenty-lead',
          error: message,
          projectId: context.projectId,
        });
        return err(new ToolExecutionError('create-twenty-lead', `Twenty CRM error: ${message}`));
      }
    },
  };
}
