/**
 * notion-create-task — Crea una tarea en una base de datos de Notion
 * Mia lo usa para registrar pendientes, seguimientos y recordatorios de Mariano.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface NotionCreateTaskOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  title: z.string().min(1).max(200).describe('Título de la tarea'),
  description: z.string().max(2000).optional().describe('Descripción o contexto adicional'),
  dueDate: z.string().optional().describe('Fecha límite en formato YYYY-MM-DD'),
  priority: z.enum(['Alta', 'Media', 'Baja']).default('Media').describe('Prioridad de la tarea'),
  category: z.string().optional().describe('Categoría o proyecto: ej. FOMO, Personal, Ventas, Admin'),
});

export function createNotionCreateTaskTool(options: NotionCreateTaskOptions): ExecutableTool {
  return {
    id: 'notion-create-task',
    name: 'notion-create-task',
    description: 'Crea una tarea en Notion. Mia lo usa para registrar pendientes y compromisos de Mariano.',
    category: 'productivity',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,
    inputSchema,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('notion-create-task', parsed.error.message));
      return ok({ success: true, output: { dryRun: true, wouldCreate: parsed.data.title }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('notion-create-task', parsed.error.message));

      const { title, description, dueDate, priority, category } = parsed.data;
      const { projectId } = context;

      const notionToken = await options.secretService.get(projectId, 'NOTION_TOKEN');
      const databaseId = await options.secretService.get(projectId, 'NOTION_TASKS_DB_ID');

      if (!notionToken || !databaseId) {
        return err(new ToolExecutionError('notion-create-task', 'Faltan secrets: NOTION_TOKEN y/o NOTION_TASKS_DB_ID'));
      }

      // Construir propiedades de la página en Notion
      const properties: Record<string, unknown> = {
        'Name': {
          title: [{ text: { content: title } }],
        },
        'Priority': {
          select: { name: priority },
        },
        'Status': {
          status: { name: 'To Do' },
        },
      };

      if (dueDate) {
        properties['Due Date'] = { date: { start: dueDate } };
      }

      if (category) {
        properties['Category'] = { select: { name: category } };
      }

      // Construir children (descripción como bloque de texto)
      const children: unknown[] = [];
      if (description) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: description } }],
          },
        });
      }

      try {
        const body: Record<string, unknown> = {
          parent: { database_id: databaseId },
          properties,
        };
        if (children.length > 0) body['children'] = children;

        const res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
          },
          body: JSON.stringify(body),
        });

        const data = await res.json() as { id?: string; url?: string; object?: string; message?: string };

        if (!res.ok || !data.id) {
          throw new Error(data.message ?? `Notion error ${res.status}`);
        }

        return ok({
          success: true,
          output: {
            pageId: data.id,
            url: data.url,
            title,
            priority,
            dueDate: dueDate ?? null,
            category: category ?? null,
            message: `Tarea creada: "${title}"${dueDate ? ` — vence ${dueDate}` : ''}`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('notion-create-task', `Notion error: ${(error as Error).message}`));
      }
    },
  };
}
