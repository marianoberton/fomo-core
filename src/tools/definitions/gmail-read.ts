/**
 * gmail-read — Lee emails del inbox de Gmail
 * Mia lo usa para revisar mensajes, filtrar lo importante y resumir.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface GmailReadOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  maxResults: z.number().int().min(1).max(20).default(10).describe('Cantidad de emails a traer. Default: 10'),
  query: z.string().optional().describe('Filtro de búsqueda Gmail, ej: "is:unread", "from:pedro@empresa.com", "subject:factura"'),
  onlyUnread: z.boolean().default(true).describe('Solo traer no leídos. Default: true'),
});

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error ?? 'No access token');
  return data.access_token;
}

function decodeBase64(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload: Record<string, unknown>): string {
  // Intenta extraer el texto plano del mensaje
  const body = payload['body'] as { data?: string } | undefined;
  if (body?.data) return decodeBase64(body.data).slice(0, 500);

  const parts = payload['parts'] as Array<Record<string, unknown>> | undefined;
  if (parts) {
    for (const part of parts) {
      const mimeType = part['mimeType'] as string;
      const partBody = part['body'] as { data?: string } | undefined;
      if (mimeType === 'text/plain' && partBody?.data) {
        return decodeBase64(partBody.data).slice(0, 500);
      }
    }
  }
  return '(sin cuerpo de texto)';
}

export function createGmailReadTool(options: GmailReadOptions): ExecutableTool {
  return {
    id: 'gmail-read',
    name: 'gmail-read',
    description: 'Lee y resume emails del inbox de Gmail. Mia lo usa para revisar mensajes y filtrar lo importante.',
    category: 'communication',
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
      if (!parsed.success) return err(new ToolExecutionError('gmail-read', parsed.error.message));

      const { maxResults, query, onlyUnread } = parsed.data;
      const { projectId } = context;

      const clientId = await options.secretService.get(projectId, 'GOOGLE_CLIENT_ID');
      const clientSecret = await options.secretService.get(projectId, 'GOOGLE_CLIENT_SECRET');
      const refreshToken = await options.secretService.get(projectId, 'GOOGLE_REFRESH_TOKEN');

      if (!clientId || !clientSecret || !refreshToken) {
        return err(new ToolExecutionError('gmail-read', 'Faltan secrets de Google OAuth'));
      }

      try {
        const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

        // Construir query
        let q = query ?? '';
        if (onlyUnread && !q.includes('is:unread')) q = ('is:unread ' + q).trim();

        // Listar mensajes
        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`;
        const listRes = await fetch(listUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const listData = await listRes.json() as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };
        const messages = listData.messages ?? [];

        if (messages.length === 0) {
          return ok({ success: true, output: { emails: [], total: 0, message: 'No hay emails nuevos.' }, durationMs: Date.now() - start });
        }

        // Traer detalle de cada mensaje
        const emails = await Promise.all(messages.slice(0, maxResults).map(async ({ id }) => {
          const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });
          const msg = await msgRes.json() as {
            id: string;
            payload?: {
              headers?: Array<{ name: string; value: string }>;
              body?: { data?: string };
              parts?: Array<Record<string, unknown>>;
              mimeType?: string;
            };
            snippet?: string;
            internalDate?: string;
          };

          const headers = msg.payload?.headers ?? [];
          const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

          return {
            id: msg.id,
            from: getHeader('From'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            snippet: msg.snippet ?? '',
            body: extractBody((msg.payload ?? {}) as Record<string, unknown>),
          };
        }));

        return ok({
          success: true,
          output: { emails, total: emails.length, message: `${emails.length} email(s) encontrado(s).` },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('gmail-read', `Gmail error: ${(error as Error).message}`));
      }
    },
  };
}
