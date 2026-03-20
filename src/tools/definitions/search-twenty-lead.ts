/**
 * Search Twenty CRM Lead Tool
 *
 * Busca un lead existente por email o nombre de empresa.
 * Retorna datos del contacto y estado de la oportunidad.
 *
 * Usar cuando: alguien dice "ya me registré", "ya hablé con alguien",
 * o da un email antes de que el agente lo calificara.
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

const logger = createLogger({ name: 'search-twenty-lead' });

export interface TwentySearchToolOptions {
  twentyBaseUrl: string;
  secretService: SecretService;
}

const inputSchema = z.object({
  email: z.string().email().optional().describe('Email del contacto'),
  company: z.string().optional().describe('Nombre de la empresa'),
}).refine(d => d.email ?? d.company, {
  message: 'Se requiere email o company para buscar',
});

type TwentyHeaders = Record<string, string>;

async function req(
  baseUrl: string,
  headers: TwentyHeaders,
  path: string,
): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${baseUrl}/rest${path}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const data: unknown = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function createTwentySearchTool(options: TwentySearchToolOptions): ExecutableTool {
  const { twentyBaseUrl, secretService } = options;
  const baseUrl = twentyBaseUrl.replace(/\/$/, '');

  return {
    id: 'search-twenty-lead',
    name: 'Search CRM Lead',
    description:
      'Busca un lead existente en Twenty CRM por email o empresa. ' +
      'Usar cuando el contacto dice que ya se registró o ya habló con alguien de FOMO. ' +
      'Retorna nombre, empresa, email y stage actual de la oportunidad.',
    category: 'crm',
    inputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: false,

    // eslint-disable-next-line @typescript-eslint/require-await
    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('search-twenty-lead', `Invalid input: ${parsed.error.message}`));
      }
      return ok({ success: true, output: { dryRun: true, wouldSearch: parsed.data }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('search-twenty-lead', `Invalid input: ${parsed.error.message}`));
      }
      const data = parsed.data;

      let apiKey: string;
      try {
        apiKey = await secretService.get(context.projectId, 'TWENTY_API_KEY');
      } catch {
        return err(new ToolExecutionError('search-twenty-lead', 'TWENTY_API_KEY not configured.'));
      }

      const headers: TwentyHeaders = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      try {
        let person: Record<string, unknown> | null = null;
        let company: Record<string, unknown> | null = null;

        // Buscar por email
        if (data.email) {
          const filter = encodeURIComponent(`emails.primaryEmail[eq]:${data.email}`);
          const res = await req(baseUrl, headers, `/people?filter=${filter}&limit=1`);
          if (res.ok) {
            const body = res.data as { data?: { people?: Record<string, unknown>[] | { edges?: { node: Record<string, unknown> }[] } } } | null;
            const people = body?.data?.people;
            person = Array.isArray(people) ? people[0] ?? null : people?.edges?.[0]?.node ?? null;
          }
        }

        // Buscar por empresa si no encontró persona
        if (!person && data.company) {
          const filter = encodeURIComponent(`name[like]:%${data.company}%`);
          const res = await req(baseUrl, headers, `/companies?filter=${filter}&limit=1`);
          if (res.ok) {
            const body = res.data as { data?: { companies?: Record<string, unknown>[] | { edges?: { node: Record<string, unknown> }[] } } } | null;
            const companies = body?.data?.companies;
            company = Array.isArray(companies) ? companies[0] ?? null : companies?.edges?.[0]?.node ?? null;
          }
        } else if (person) {
          // Obtener empresa del contacto
          const companyId = person['companyId'] as string | undefined;
          if (companyId) {
            const res = await req(baseUrl, headers, `/companies/${companyId}`);
            if (res.ok) {
              const body = res.data as { data?: { company?: Record<string, unknown> } } | null;
              company = body?.data?.company ?? null;
            }
          }
        }

        if (!person && !company) {
          return ok({
            success: true,
            output: { found: false, message: 'No se encontró ningún lead con esos datos.' },
            durationMs: Date.now() - start,
          });
        }

        // Buscar oportunidad
        let opportunity: Record<string, unknown> | null = null;
        const personId = person?.['id'] as string | undefined;
        if (personId) {
          const filter = encodeURIComponent(`pointOfContactId[eq]:${personId}`);
          const res = await req(baseUrl, headers, `/opportunities?filter=${filter}&orderBy=createdAt[desc]&limit=1`);
          if (res.ok) {
            const body = res.data as { data?: { opportunities?: Record<string, unknown>[] | { edges?: { node: Record<string, unknown> }[] } } } | null;
            const opps = body?.data?.opportunities;
            opportunity = Array.isArray(opps) ? opps[0] ?? null : opps?.edges?.[0]?.node ?? null;
          }
        }
        const companySearchId = company?.['id'] as string | undefined;
        if (!opportunity && companySearchId) {
          const filter = encodeURIComponent(`companyId[eq]:${companySearchId}`);
          const res = await req(baseUrl, headers, `/opportunities?filter=${filter}&orderBy=createdAt[desc]&limit=1`);
          if (res.ok) {
            const body = res.data as { data?: { opportunities?: Record<string, unknown>[] | { edges?: { node: Record<string, unknown> }[] } } } | null;
            const opps = body?.data?.opportunities;
            opportunity = Array.isArray(opps) ? opps[0] ?? null : opps?.edges?.[0]?.node ?? null;
          }
        }

        logger.info('Twenty lead searched', {
          component: 'search-twenty-lead',
          found: true,
          projectId: context.projectId,
        });

        return ok({
          success: true,
          output: {
            found: true,
            person: person ? {
              id: person['id'],
              name: (() => {
                const nameObj = person['name'] as Record<string, string> | undefined;
                return `${nameObj?.['firstName'] ?? ''} ${nameObj?.['lastName'] ?? ''}`.trim();
              })(),
              email: (person['emails'] as Record<string, string> | undefined)?.['primaryEmail'],
            } : null,
            company: company ? { id: company['id'], name: company['name'] } : null,
            opportunity: opportunity ? {
              id: opportunity['id'],
              name: opportunity['name'],
              stage: opportunity['stage'],
              crmUrl: `${baseUrl}/crm/opportunities/${String(opportunity['id'])}`,
            } : null,
          },
          durationMs: Date.now() - start,
        });

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('search-twenty-lead', `Twenty CRM error: ${message}`));
      }
    },
  };
}
