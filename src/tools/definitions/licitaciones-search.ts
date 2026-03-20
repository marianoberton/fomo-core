/**
 * licitaciones-search — Busca licitaciones públicas argentinas en el catálogo
 * Catálogo: 47k+ registros de CABA y Nación (2020-2026).
 * Por defecto filtra solo activos (soloActivos=true).
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface LicitacionesSearchOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  q: z.string().describe('Búsqueda por texto en el título, ej: "mantenimiento edificios", "equipamiento médico", "software"'),
  jurisdiccion: z.enum(['caba', 'nacion', 'todas']).default('todas').describe('Jurisdicción a filtrar'),
  estado: z.string().optional().describe('Estado del proceso: Publicado, En Evaluacion, Preadjudicado, Adjudicado, etc.'),
  tipo_proceso: z.string().optional().describe('Tipo: Licitacion Publica, Contratacion Directa, etc.'),
  organismo: z.string().optional().describe('Filtrar por organismo/repartición'),
  soloActivos: z.boolean().default(true).describe('Solo traer procesos activos (Publicado, En Apertura, En Evaluacion). Default: true'),
  limit: z.number().int().min(1).max(50).default(10).describe('Cantidad de resultados. Default: 10'),
});

export function createLicitacionesSearchTool(options: LicitacionesSearchOptions): ExecutableTool {
  return {
    id: 'licitaciones-search',
    name: 'licitaciones-search',
    description: 'Busca licitaciones públicas argentinas en catálogo de 47k registros (CABA + Nación). Por defecto solo trae procesos activos (Publicado, En Apertura, En Evaluacion).',
    category: 'research',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: false,
    inputSchema,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      return ok({ success: true, output: { dryRun: true }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('licitaciones-search', parsed.error.message));

      const { q, jurisdiccion, estado, tipo_proceso, organismo, soloActivos, limit } = parsed.data;
      const { projectId } = context;

      const supabaseUrl = await options.secretService.get(projectId, 'SUPABASE_LICI_URL')
        ?? process.env['SUPABASE_LICI_URL']
        ?? 'http://inted-pre0225supabase-4b1638-72-61-44-62.traefik.me';
      const supabaseKey = await options.secretService.get(projectId, 'SUPABASE_LICI_KEY')
        ?? process.env['SUPABASE_LICI_KEY']
        ?? '';

      if (!supabaseKey) {
        return err(new ToolExecutionError('licitaciones-search', 'Falta secret SUPABASE_LICI_KEY'));
      }

      try {
        const params = new URLSearchParams();
        params.set('select', 'process_id,title,organismo,estado_proceso,tipo_proceso,opening_date,amount_text,currency,jurisdiccion,rubro');
        params.set('limit', String(limit));
        params.set('order', 'opening_date.desc');

        // Búsqueda por texto en título
        if (q) params.set('title', `ilike.*${q}*`);

        // Filtro jurisdicción
        if (jurisdiccion !== 'todas') {
          params.set('jurisdiccion', `ilike.*${jurisdiccion}*`);
        }

        // Estado / soloActivos
        if (estado) {
          params.set('estado_proceso', `ilike.*${estado}*`);
        } else if (soloActivos) {
          // Filtrar solo procesos activos: Publicado, En Apertura, En Evaluacion
          params.set('estado_proceso', 'in.(Publicado,En Apertura,En Evaluacion,Abierto)')
        }

        if (tipo_proceso) params.set('tipo_proceso', `ilike.*${tipo_proceso}*`);
        if (organismo) params.set('organismo', `ilike.*${organismo}*`);

        const url = `${supabaseUrl}/rest/v1/tenders?${params.toString()}`;
        const res = await fetch(url, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'count=exact',
          },
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Supabase error ${res.status}: ${text}`);
        }

        const items = await res.json() as {
          process_id: string;
          title: string;
          organismo: string;
          estado_proceso: string;
          tipo_proceso: string;
          opening_date: string;
          amount_text: string;
          currency: string;
          jurisdiccion: string;
          rubro: string;
        }[];

        const totalHeader = res.headers.get('content-range');
        const total = totalHeader ? totalHeader.split('/')[1] : '?';

        return ok({
          success: true,
          output: {
            items,
            total: parseInt(total ?? '0') || items.length,
            message: `${items.length} licitación(es) encontrada(s)${total !== '?' ? ` de ${total} totales` : ''}.`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('licitaciones-search', `Error: ${(error as Error).message}`));
      }
    },
  };
}
