/**
 * google-calendar-event — Crea un evento en Google Calendar
 * Mia lo usa para agendar reuniones, recordatorios y compromisos de Mariano.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface GoogleCalendarEventOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  title: z.string().min(1).max(200).describe('Título del evento'),
  startDateTime: z.string().describe('Inicio en formato ISO 8601, ej: 2026-03-07T10:00:00'),
  endDateTime: z.string().describe('Fin en formato ISO 8601, ej: 2026-03-07T11:00:00'),
  description: z.string().optional().describe('Descripción o notas del evento'),
  attendees: z.array(z.string().email()).optional().describe('Emails de los asistentes'),
  location: z.string().optional().describe('Lugar del evento'),
  timeZone: z.string().default('America/Argentina/Buenos_Aires').describe('Timezone. Default: Buenos Aires'),
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

export function createGoogleCalendarEventTool(options: GoogleCalendarEventOptions): ExecutableTool {
  return {
    id: 'google-calendar-event',
    name: 'google-calendar-event',
    description: 'Crea un evento en Google Calendar de Mariano. Usar para reuniones, llamadas y compromisos con fecha y hora.',
    category: 'productivity',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,
    inputSchema,

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('google-calendar-event', parsed.error.message));
      return ok({ success: true, output: { dryRun: true, wouldCreate: parsed.data.title }, durationMs: 0 });
    },

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const start = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return err(new ToolExecutionError('google-calendar-event', parsed.error.message));

      const { title, startDateTime, endDateTime, description, attendees, location, timeZone } = parsed.data;
      const { projectId } = context;

      const clientId = await options.secretService.get(projectId, 'GOOGLE_CLIENT_ID');
      const clientSecret = await options.secretService.get(projectId, 'GOOGLE_CLIENT_SECRET');
      const refreshToken = await options.secretService.get(projectId, 'GOOGLE_REFRESH_TOKEN');

      if (!clientId || !clientSecret || !refreshToken) {
        return err(new ToolExecutionError('google-calendar-event', 'Faltan secrets de Google OAuth'));
      }

      try {
        const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

        const event: Record<string, unknown> = {
          summary: title,
          start: { dateTime: startDateTime, timeZone },
          end: { dateTime: endDateTime, timeZone },
        };
        if (description) event['description'] = description;
        if (location) event['location'] = location;
        if (attendees?.length) {
          event['attendees'] = attendees.map(email => ({ email }));
        }

        const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });

        const data = await res.json() as { id?: string; htmlLink?: string; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message ?? `Calendar error ${res.status}`);

        return ok({
          success: true,
          output: {
            eventId: data.id,
            link: data.htmlLink,
            title,
            start: startDateTime,
            end: endDateTime,
            message: `Evento creado: "${title}" el ${startDateTime}`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('google-calendar-event', `Calendar error: ${(error as Error).message}`));
      }
    },
  };
}
