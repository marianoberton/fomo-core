/**
 * licitaciones-document — Descarga y extrae texto de un documento de licitación
 * Valentina lo usa para analizar pliegos y resumir requisitos clave.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface LicitacionesDocumentOptions {
  secretService: SecretService;
  licitacionesApiUrl?: string;
}

const inputSchema = z.object({
  process_id: z.string().describe('ID del proceso'),
  jurisdiccion: z.enum(['caba', 'nacion']).describe('Jurisdicción'),
  file_id: z.string().describe('ID del documento: pliego_particular, pliego_tecnico, anexo-0, etc.'),
});

export function createLicitacionesDocumentTool(options: LicitacionesDocumentOptions): ExecutableTool {
  return {
    id: 'licitaciones-document',
    name: 'licitaciones-document',
    description: 'Descarga y extrae el texto de un documento de licitación (pliego, anexo, etc.). Valentina lo usa para analizar requisitos y armar resúmenes ejecutivos.',
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
      if (!parsed.success) return err(new ToolExecutionError('licitaciones-document', parsed.error.message));

      const { process_id, jurisdiccion, file_id } = parsed.data;
      const { projectId } = context;

      const apiUrl = await options.secretService.get(projectId, 'LICITACIONES_API_URL');

      try {
        const encodedId = encodeURIComponent(process_id);
        const url = `${apiUrl}/${jurisdiccion}/${encodedId}/documents/${file_id}?format=text`;
        const res = await fetch(url, { signal: AbortSignal.timeout(60000) });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
        }

        const data = await res.json() as { file_id: string; format: string; content: string; pages: number };

        return ok({
          success: true,
          output: {
            file_id: data.file_id,
            pages: data.pages,
            content: data.content.slice(0, 8000), // primeras 8k chars
            message: `Documento "${file_id}" extraído (${data.pages} páginas)`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('licitaciones-document', `Error: ${(error as Error).message}`));
      }
    },
  };
}
