/**
 * Update Twenty CRM Lead Tool
 *
 * Actualiza el stage y/o notas de una oportunidad existente en Twenty CRM.
 * Busca la oportunidad por email del contacto o por nombre de empresa.
 *
 * Requiere secreto del proyecto: TWENTY_API_KEY
 * Configuración: twentyBaseUrl
 *
 * Casos de uso:
 *   - Diego actualiza el estado después de contactar un prospecto
 *   - Mover lead de NEW → CONTACTED → MEETING → WON/LOST
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

const logger = createLogger({ name: 'update-twenty-lead' });

export interface TwentyUpdateToolOptions {
  twentyBaseUrl: string;
  secretService: SecretService;
}

// Stages disponibles en Twenty
const VALID_STAGES = ['NEW', 'CONTACTED', 'MEETING', 'PROPOSAL', 'WON', 'LOST'] as const;

const inputSchema = z.object({
  email: z.string().email().optional().describe('Email del contacto para buscar la oportunidad'),
  company: z.string().optional().describe('Nombre de la empresa (alternativa al email)'),
  stage: z.enum(VALID_STAGES).optional().describe(
    'Nuevo estado: NEW | CONTACTED | MEETING | PROPOSAL | WON | LOST'
  ),
  notes: z.string().max(2000).optional().describe('Notas adicionales a agregar al nombre de la oportunidad'),
}).refine(d => d.email || d.company, {
  message: 'Se requiere email o company para identificar el lead',
});

type TwentyHeaders = Record<string, string>;

async function twentyRequest(
  baseUrl: string,
  headers: TwentyHeaders,
  method: 'GET' | 'PATCH',
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

/** Busca oportunidad por email del contacto */
async function findOpportunityByEmail(
  baseUrl: string,
  headers: TwentyHeaders,
  email: string,
): Promise<{ id: string; name: string; stage: string } | null> {
  // Primero buscar la persona
  const filter = encodeURIComponent(`emails.primaryEmail[eq]:${email}`);
  const res = await twentyRequest(baseUrl, headers, 'GET', `/people?filter=${filter}&limit=1`);
  if (!res.ok) return null;

  const body = res.data as { data?: { people?: { id: string }[] } };
  const personId = body?.data?.people?.[0]?.id;
  if (!personId) return null;

  // Luego buscar oportunidad por pointOfContactId
  const filterOpp = encodeURIComponent(`pointOfContactId[eq]:${personId}`);
  const resOpp = await twentyRequest(baseUrl, headers, 'GET', `/opportunities?filter=${filterOpp}&orderBy=createdAt[desc]&limit=1`);
  if (!resOpp.ok) return null;

  const bodyOpp = resOpp.data as { data?: { opportunities?: { id: string; name: string; stage: string }[] } };
  return bodyOpp?.data?.opportunities?.[0] ?? null;
}

/** Busca oportunidad por nombre de empresa */
async function findOpportunityByCompany(
  baseUrl: string,
  headers: TwentyHeaders,
  company: string,
): Promise<{ id: string; name: string; stage: string } | null> {
  const filter = encodeURIComponent(`name[like]:%${company}%`);
  const res = await twentyRequest(baseUrl, headers, 'GET', `/companies?filter=${filter}&limit=1`);
  if (!res.ok) return null;

  const body = res.data as { data?: { companies?: { id: string }[] } };
  const companyId = body?.data?.companies?.[0]?.id;
  if (!companyId) return null;

  const filterOpp = encodeURIComponent(`companyId[eq]:${companyId}`);
  const resOpp = await twentyRequest(baseUrl, headers, 'GET', `/opportunities?filter=${filterOpp}&orderBy=createdAt[desc]&limit=1`);
  if (!resOpp.ok) return null;

  const bodyOpp = resOpp.data as { data?: { opportunities?: { id: string; name: string; stage: string }[] } };
  return bodyOpp?.data?.opportunities?.[0] ?? null;
}

export function createTwentyUpdateTool(options: TwentyUpdateToolOptions): ExecutableTool {
  const { twentyBaseUrl, secretService } = options;
  const baseUrl = twentyBaseUrl.replace(/\/$/, '');

  return {
    id: 'update-twenty-lead',
    name: 'Update CRM Lead',
    description:
      'Actualiza el estado (stage) de un lead existente en Twenty CRM. ' +
      'Usá cuando el prospecto respondió, agendó una demo, o cambió de estado. ' +
      'Buscá por email o nombre de empresa.',
    category: 'crm',
    inputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('update-twenty-lead', `Invalid input: ${parsed.error.message}`));
      }
      return ok({
        success: true,
        output: { dryRun: true, wouldUpdate: parsed.data },
        durationMs: 0,
      });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('update-twenty-lead', `Invalid input: ${parsed.error.message}`));
      }
      const data = parsed.data;

      let apiKey: string;
      try {
        apiKey = await secretService.get(context.projectId, 'TWENTY_API_KEY');
      } catch {
        return err(new ToolExecutionError('update-twenty-lead', 'TWENTY_API_KEY not configured for this project.'));
      }

      const headers: TwentyHeaders = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      try {
        // Buscar oportunidad
        let opportunity: { id: string; name: string; stage: string } | null = null;

        if (data.email) {
          opportunity = await findOpportunityByEmail(baseUrl, headers, data.email);
        }
        if (!opportunity && data.company) {
          opportunity = await findOpportunityByCompany(baseUrl, headers, data.company);
        }

        if (!opportunity) {
          return err(new ToolExecutionError(
            'update-twenty-lead',
            `No se encontró oportunidad para ${data.email ?? data.company}. Usá create-twenty-lead primero.`
          ));
        }

        // Construir payload de update
        const updatePayload: Record<string, unknown> = {};
        if (data.stage) updatePayload['stage'] = data.stage;

        // Si hay notas, las agregamos al nombre de la oportunidad
        if (data.notes) {
          updatePayload['name'] = `${opportunity.name} | ${data.notes}`;
        }

        if (Object.keys(updatePayload).length === 0) {
          return ok({
            success: true,
            output: { message: 'Nada que actualizar', opportunity },
            durationMs: Date.now() - start,
          });
        }

        const res = await twentyRequest(baseUrl, headers, 'PATCH', `/opportunities/${opportunity.id}`, updatePayload);
        if (!res.ok) {
          throw new Error(`Twenty updateOpportunity failed (${res.status}): ${JSON.stringify(res.data)}`);
        }

        logger.info('Twenty opportunity updated', {
          component: 'update-twenty-lead',
          opportunityId: opportunity.id,
          oldStage: opportunity.stage,
          newStage: data.stage,
          projectId: context.projectId,
        });

        return ok({
          success: true,
          output: {
            opportunityId: opportunity.id,
            previousStage: opportunity.stage,
            newStage: data.stage ?? opportunity.stage,
            crmUrl: `${baseUrl}/crm/opportunities/${opportunity.id}`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('update-twenty-lead', `Twenty CRM error: ${message}`));
      }
    },
  };
}
