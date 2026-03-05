/**
 * gmail-send — Envía o crea borrador de email vía Gmail API
 * Mia lo usa para responder mails, confirmar reuniones, etc.
 * SIEMPRE requiere confirmación del usuario antes de enviar (draft=false).
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface GmailSendOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  to: z.string().describe('Destinatario, ej: pedro@empresa.com'),
  subject: z.string().describe('Asunto del email'),
  body: z.string().describe('Cuerpo del email en texto plano'),
  draft: z.boolean().default(true).describe('true = solo mostrar borrador (default). false = enviar realmente'),
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

function encodeSubject(subject: string): string {
  // RFC 2047 encoded-word for UTF-8 subjects
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

function buildRawEmail(from: string, to: string, subject: string, body: string): string {
  const email = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(body, 'utf-8').toString('base64'),
  ].join('\r\n');
  return Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createGmailSendTool(options: GmailSendOptions): ExecutableTool {
  return {
    id: 'gmail-send',
    name: 'gmail-send',
    description: 'Envía un email o crea un borrador vía Gmail. Por defecto crea borrador (draft=true). Solo envía cuando el usuario confirmó explícitamente.',
    category: 'communication',
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,
    inputSchema,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('gmail-send', parsed.error.message));
      return ok({ success: true, output: { dryRun: true, wouldSendTo: parsed.data.to }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('gmail-send', parsed.error.message));

      const { to, subject, body, draft } = parsed.data;
      const { projectId } = context;

      const clientId = await options.secretService.get(projectId, 'GOOGLE_CLIENT_ID');
      const clientSecret = await options.secretService.get(projectId, 'GOOGLE_CLIENT_SECRET');
      const refreshToken = await options.secretService.get(projectId, 'GOOGLE_REFRESH_TOKEN');
      const fromEmail = await options.secretService.get(projectId, 'GOOGLE_USER_EMAIL') ?? 'me';

      if (!clientId || !clientSecret || !refreshToken) {
        return err(new ToolExecutionError('gmail-send', 'Faltan secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'));
      }

      try {
        const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
        const raw = buildRawEmail(fromEmail, to, subject, body);

        if (draft) {
          // Crear borrador
          const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { raw } }),
          });
          const data = await res.json() as { id?: string; error?: { message?: string } };
          if (!res.ok) throw new Error(data.error?.message ?? `Gmail error ${res.status}`);
          return ok({
            success: true,
            output: { draftId: data.id, to, subject, mode: 'draft', message: `Borrador creado para ${to}` },
            durationMs: Date.now() - start,
          });
        } else {
          // Enviar
          const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw }),
          });
          const data = await res.json() as { id?: string; error?: { message?: string } };
          if (!res.ok) throw new Error(data.error?.message ?? `Gmail error ${res.status}`);
          return ok({
            success: true,
            output: { messageId: data.id, to, subject, mode: 'sent', message: `Email enviado a ${to}` },
            durationMs: Date.now() - start,
          });
        }
      } catch (error) {
        return err(new ToolExecutionError('gmail-send', `Gmail error: ${(error as Error).message}`));
      }
    },
  };
}
