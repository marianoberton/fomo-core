/**
 * licitaciones-detail — Scrapea detalle completo de una licitación en tiempo real
 * Valentina lo usa para analizar una licitación específica y evaluar si aplica presentarse.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface LicitacionesDetailOptions {
  secretService: SecretService;
  licitacionesApiUrl?: string;
}

const inputSchema = z.object({
  process_id: z.string().describe('ID del proceso, ej: "1028-1806-LPU25" para CABA o "84/32-1179-LPU25" para Nación'),
  jurisdiccion: z.enum(['caba', 'nacion']).describe('Jurisdicción del proceso'),
});

export function createLicitacionesDetailTool(options: LicitacionesDetailOptions): ExecutableTool {
  return {
    id: 'licitaciones-detail',
    name: 'licitaciones-detail',
    description: 'Obtiene el detalle completo de una licitación scrapeando el portal en tiempo real (~15-30s). Incluye cronograma, montos, requisitos y lista de documentos disponibles.',
    category: 'research',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: false,
    inputSchema,

    // eslint-disable-next-line @typescript-eslint/require-await
    async dryRun(_input: unknown): Promise<Result<ToolResult, NexusError>> {
      void _input;
      return ok({ success: true, output: { dryRun: true }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('licitaciones-detail', parsed.error.message));

      const { process_id, jurisdiccion } = parsed.data;
      const { projectId } = context;

      const apiUrl = await options.secretService.get(projectId, 'LICITACIONES_API_URL');

      try {
        const encodedId = encodeURIComponent(process_id);
        const url = `${apiUrl}/${jurisdiccion}/${encodedId}?extract_pdf=false`;
        const res = await fetch(url, { signal: AbortSignal.timeout(45000) });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
        }

        const data = await res.json() as Record<string, unknown>;

        // Extraer campos clave para el agente
        const basicInfo = data['basic_info'] as Record<string, string> | undefined;
        const amountDuration = data['amount_duration'] as Record<string, string> | undefined;
        const cronograma = data['cronograma'] as Record<string, string> | undefined;
        const availableFiles = data['available_files'] as { file_id: string; titulo: string; tipo: string }[] | undefined;
        const products = data['products'] as Record<string, string>[] | undefined;
        const requirements = data['requirements'] as Record<string, unknown> | undefined;

        return ok({
          success: true,
          output: {
            process_id,
            jurisdiccion,
            stage: data['stage'],
            basicInfo,
            amountDuration,
            cronograma,
            requirements,
            products: products?.slice(0, 10),
            availableFiles: availableFiles?.map(f => ({ file_id: f.file_id, titulo: f.titulo, tipo: f.tipo })),
            message: `Detalle obtenido: ${basicInfo?.['nombre'] ?? process_id}`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('licitaciones-detail', `Error: ${(error as Error).message}`));
      }
    },
  };
}
