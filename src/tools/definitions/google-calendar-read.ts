/**
 * google-calendar-read — Lee eventos próximos de Google Calendar
 * Mia lo usa para briefings pre-reunión y recordatorios.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';

export interface GoogleCalendarReadOptions {
  secretService: SecretService;
}

const inputSchema = z.object({
  maxResults: z.number().int().min(1).max(20).default(5).describe('Cantidad de eventos a traer. Default: 5'),
  hoursAhead: z.number().min(0).max(168).default(24).describe('Cuántas horas hacia adelante buscar. Default: 24'),
  minutesAhead: z.number().min(0).max(120).optional().describe('Si se especifica, busca eventos en los próximos N minutos'),
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

export function createGoogleCalendarReadTool(options: GoogleCalendarReadOptions): ExecutableTool {
  return {
    id: 'google-calendar-read',
    name: 'google-calendar-read',
    description: 'Lee eventos próximos de Google Calendar. Mia lo usa para preparar briefings pre-reunión y recordatorios.',
    category: 'productivity',
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
      if (!parsed.success) return err(new ToolExecutionError('google-calendar-read', parsed.error.message));

      const { maxResults, hoursAhead, minutesAhead } = parsed.data;
      const { projectId } = context;

      const clientId = await options.secretService.get(projectId, 'GOOGLE_CLIENT_ID');
      const clientSecret = await options.secretService.get(projectId, 'GOOGLE_CLIENT_SECRET');
      const refreshToken = await options.secretService.get(projectId, 'GOOGLE_REFRESH_TOKEN');

      if (!clientId || !clientSecret || !refreshToken) {
        return err(new ToolExecutionError('google-calendar-read', 'Faltan secrets de Google OAuth'));
      }

      try {
        const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

        const now = new Date();
        const timeMin = now.toISOString();
        const timeMaxDate = new Date(now);
        if (minutesAhead !== undefined) {
          timeMaxDate.setMinutes(timeMaxDate.getMinutes() + minutesAhead);
        } else {
          timeMaxDate.setHours(timeMaxDate.getHours() + hoursAhead);
        }
        const timeMax = timeMaxDate.toISOString();

        const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
        url.searchParams.set('maxResults', String(maxResults));
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('timeMin', timeMin);
        url.searchParams.set('timeMax', timeMax);

        const res = await fetch(url.toString(), {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        const data = await res.json() as {
          items?: Array<{
            id: string;
            summary?: string;
            description?: string;
            location?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
            attendees?: Array<{ email: string; displayName?: string }>;
          }>;
          error?: { message?: string };
        };

        if (!res.ok) throw new Error(data.error?.message ?? `Calendar error ${res.status}`);

        const events = (data.items ?? []).map(e => ({
          id: e.id,
          title: e.summary ?? '(sin título)',
          start: e.start?.dateTime ?? e.start?.date ?? '',
          end: e.end?.dateTime ?? e.end?.date ?? '',
          description: e.description ?? '',
          location: e.location ?? '',
          attendees: (e.attendees ?? []).map(a => a.displayName ?? a.email),
        }));

        return ok({
          success: true,
          output: {
            events,
            total: events.length,
            message: events.length === 0
              ? 'No hay eventos próximos.'
              : `${events.length} evento(s) próximo(s).`,
          },
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return err(new ToolExecutionError('google-calendar-read', `Calendar error: ${(error as Error).message}`));
      }
    },
  };
}
