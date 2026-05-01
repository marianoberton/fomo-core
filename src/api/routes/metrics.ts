/**
 * Metrics routes — analytics aggregations for the dashboard.
 *
 * Endpoints (all scoped to `/projects/:projectId`):
 *   GET /metrics/conversations  → sessions per day (count + uniqueContacts)
 *   GET /metrics/channels       → session distribution by channel
 *   GET /metrics/usage          → token + cost aggregation by day or by agent
 *   GET /metrics/overview       → KPI snapshot (conversationsToday, activeClients, …)
 *   GET /metrics/top-clients    → top contacts by conversation count
 *
 * Aggregations are pushed down to SQL via `$queryRaw` to avoid N+1.
 * Results are memoized in-process for 60 s per (projectId, endpoint, range, …).
 *
 * Project-access enforcement is handled globally by the `requireProjectAccess`
 * onRequest hook (matches `request.params.projectId`).
 *
 * Notes:
 *  - "activeClients" is computed from distinct `Contact` ids in the range —
 *    there is no Client ↔ Session link in the schema, only `UsageRecord.clientId`.
 *  - top-clients groups by `Contact` for the same reason; the Zod field names
 *    (`clientId`, `clientName`) are kept to match the dashboard contract.
 *  - `avgResponseTimeMs` uses a LAG window over `messages` measuring the gap
 *    between consecutive `user` → `assistant` messages within a session.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const rangeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const usageQuerySchema = rangeQuerySchema.extend({
  groupBy: z.enum(['day', 'agent']).default('day'),
});

const topClientsQuerySchema = rangeQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(100).default(10),
});

const conversationPointSchema = z.object({
  date: z.string(),
  count: z.number(),
  uniqueContacts: z.number(),
});

const conversationsResponseSchema = z.object({
  points: z.array(conversationPointSchema),
});

const channelDistributionSchema = z.object({
  channel: z.string(),
  count: z.number(),
  percentage: z.number(),
});

const channelsResponseSchema = z.object({
  distribution: z.array(channelDistributionSchema),
});

const usagePointSchema = z.object({
  date: z.string().optional(),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  totalTokens: z.number(),
  totalCostUsd: z.number(),
});

const usageResponseSchema = z.object({
  points: z.array(usagePointSchema),
});

const overviewResponseSchema = z.object({
  conversationsToday: z.number(),
  activeClients: z.number(),
  messagesProcessed: z.number(),
  avgResponseTimeMs: z.number().nullable(),
});

const topClientSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  conversations: z.number(),
  messages: z.number(),
});

const topClientsResponseSchema = z.object({
  clients: z.array(topClientSchema),
});

// ─── Types ──────────────────────────────────────────────────────

type ConversationsResponse = z.infer<typeof conversationsResponseSchema>;
type ChannelsResponse = z.infer<typeof channelsResponseSchema>;
type UsageResponse = z.infer<typeof usageResponseSchema>;
type OverviewResponse = z.infer<typeof overviewResponseSchema>;
type TopClientsResponse = z.infer<typeof topClientsResponseSchema>;

interface ResolvedRange {
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
}

// ─── Helpers ────────────────────────────────────────────────────

const DEFAULT_RANGE_DAYS = 30;
const CACHE_TTL_MS = 60_000;

/** Resolve from/to query params into Date objects (defaults to last 30 days). */
function resolveRange(from: string | undefined, to: string | undefined): ResolvedRange {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from
    ? new Date(from)
    : new Date(toDate.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return {
    from: fromDate,
    to: toDate,
    fromIso: fromDate.toISOString(),
    toIso: toDate.toISOString(),
  };
}

/** Tiny in-memory TTL cache keyed by string. */
function createMetricsCache(ttlMs: number) {
  const store = new Map<string, { value: unknown; expiresAt: number }>();

  return {
    get<T>(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value as T;
    },
    set<T>(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register dashboard analytics metrics routes. */
export function metricsRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma } = deps;
  const cache = createMetricsCache(CACHE_TTL_MS);

  // ── GET /projects/:projectId/metrics/conversations ──────────────
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/metrics/conversations',
    async (request, reply) => {
      const parsed = rangeQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'INVALID_QUERY', parsed.error.message, 400);
      }
      const { projectId } = request.params;
      const range = resolveRange(parsed.data.from, parsed.data.to);
      const cacheKey = `conv|${projectId}|${range.fromIso}|${range.toIso}`;

      const cached = cache.get<ConversationsResponse>(cacheKey);
      if (cached) return sendSuccess(reply, cached);

      const rows = await prisma.$queryRaw<
        { date: string; count: bigint; unique_contacts: bigint }[]
      >`
        SELECT
          TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
          COUNT(*)::bigint AS count,
          COUNT(DISTINCT s.contact_id)::bigint AS unique_contacts
        FROM sessions s
        WHERE s.project_id = ${projectId as ProjectId}
          AND s.created_at >= ${range.from}
          AND s.created_at <= ${range.to}
        GROUP BY date
        ORDER BY date ASC
      `;

      const response: ConversationsResponse = {
        points: rows.map((r) => ({
          date: r.date,
          count: Number(r.count),
          uniqueContacts: Number(r.unique_contacts),
        })),
      };

      cache.set(cacheKey, response);
      return sendSuccess(reply, response);
    },
  );

  // ── GET /projects/:projectId/metrics/channels ───────────────────
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/metrics/channels',
    async (request, reply) => {
      const parsed = rangeQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'INVALID_QUERY', parsed.error.message, 400);
      }
      const { projectId } = request.params;
      const range = resolveRange(parsed.data.from, parsed.data.to);
      const cacheKey = `chan|${projectId}|${range.fromIso}|${range.toIso}`;

      const cached = cache.get<ChannelsResponse>(cacheKey);
      if (cached) return sendSuccess(reply, cached);

      // `channel` lives in session.metadata->>'channel' (JSONB). Sessions
      // created from the dashboard chat may have NULL — bucket as 'unknown'.
      const rows = await prisma.$queryRaw<{ channel: string; count: bigint }[]>`
        SELECT
          COALESCE(NULLIF(s.metadata->>'channel', ''), 'unknown') AS channel,
          COUNT(*)::bigint AS count
        FROM sessions s
        WHERE s.project_id = ${projectId as ProjectId}
          AND s.created_at >= ${range.from}
          AND s.created_at <= ${range.to}
        GROUP BY channel
        ORDER BY count DESC
      `;

      const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
      const response: ChannelsResponse = {
        distribution: rows.map((r) => {
          const count = Number(r.count);
          return {
            channel: r.channel,
            count,
            percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
          };
        }),
      };

      cache.set(cacheKey, response);
      return sendSuccess(reply, response);
    },
  );

  // ── GET /projects/:projectId/metrics/usage ──────────────────────
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/metrics/usage',
    async (request, reply) => {
      const parsed = usageQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'INVALID_QUERY', parsed.error.message, 400);
      }
      const { projectId } = request.params;
      const { groupBy } = parsed.data;
      const range = resolveRange(parsed.data.from, parsed.data.to);
      const cacheKey = `usage|${projectId}|${range.fromIso}|${range.toIso}|${groupBy}`;

      const cached = cache.get<UsageResponse>(cacheKey);
      if (cached) return sendSuccess(reply, cached);

      let response: UsageResponse;

      if (groupBy === 'day') {
        const rows = await prisma.$queryRaw<
          { date: string; total_tokens: bigint; total_cost_usd: number }[]
        >`
          SELECT
            TO_CHAR(ur.timestamp, 'YYYY-MM-DD') AS date,
            COALESCE(SUM(ur.input_tokens + ur.output_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(ur.cost_usd), 0)::float8 AS total_cost_usd
          FROM usage_records ur
          WHERE ur.project_id = ${projectId as ProjectId}
            AND ur.timestamp >= ${range.from}
            AND ur.timestamp <= ${range.to}
          GROUP BY date
          ORDER BY date ASC
        `;
        response = {
          points: rows.map((r) => ({
            date: r.date,
            totalTokens: Number(r.total_tokens),
            totalCostUsd: Number(r.total_cost_usd),
          })),
        };
      } else {
        const rows = await prisma.$queryRaw<
          {
            agent_id: string | null;
            agent_name: string | null;
            total_tokens: bigint;
            total_cost_usd: number;
          }[]
        >`
          SELECT
            ur.agent_id AS agent_id,
            a.name AS agent_name,
            COALESCE(SUM(ur.input_tokens + ur.output_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(ur.cost_usd), 0)::float8 AS total_cost_usd
          FROM usage_records ur
          LEFT JOIN agents a ON a.id = ur.agent_id
          WHERE ur.project_id = ${projectId as ProjectId}
            AND ur.timestamp >= ${range.from}
            AND ur.timestamp <= ${range.to}
          GROUP BY ur.agent_id, a.name
          ORDER BY total_cost_usd DESC
        `;
        response = {
          points: rows.map((r) => ({
            agentId: r.agent_id ?? 'unassigned',
            agentName: r.agent_name ?? 'Unassigned',
            totalTokens: Number(r.total_tokens),
            totalCostUsd: Number(r.total_cost_usd),
          })),
        };
      }

      cache.set(cacheKey, response);
      return sendSuccess(reply, response);
    },
  );

  // ── GET /projects/:projectId/metrics/overview ───────────────────
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/metrics/overview',
    async (request, reply) => {
      const parsed = rangeQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'INVALID_QUERY', parsed.error.message, 400);
      }
      const { projectId } = request.params;
      const range = resolveRange(parsed.data.from, parsed.data.to);
      const cacheKey = `overview|${projectId}|${range.fromIso}|${range.toIso}`;

      const cached = cache.get<OverviewResponse>(cacheKey);
      if (cached) return sendSuccess(reply, cached);

      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);

      // Parallel queries — independent. Pushdown to SQL.
      const [conversationsTodayRaw, activeClientsRaw, messagesRaw, avgRespRaw] =
        await Promise.all([
          prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM sessions s
            WHERE s.project_id = ${projectId as ProjectId}
              AND s.created_at >= ${startOfToday}
          `,
          prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(DISTINCT s.contact_id)::bigint AS count
            FROM sessions s
            WHERE s.project_id = ${projectId as ProjectId}
              AND s.contact_id IS NOT NULL
              AND s.created_at >= ${range.from}
              AND s.created_at <= ${range.to}
          `,
          prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM messages m
            JOIN sessions s ON s.id = m.session_id
            WHERE s.project_id = ${projectId as ProjectId}
              AND m.created_at >= ${range.from}
              AND m.created_at <= ${range.to}
          `,
          // LAG window over messages: avg gap between consecutive user → assistant
          // messages within the same session, measured in ms. Filtered to the range
          // on the *assistant* row's createdAt. NULL when no qualifying pairs exist.
          prisma.$queryRaw<{ avg_ms: number | null }[]>`
            WITH paired AS (
              SELECT
                m.session_id,
                m.role,
                m.created_at,
                LAG(m.role) OVER w AS prev_role,
                LAG(m.created_at) OVER w AS prev_at
              FROM messages m
              JOIN sessions s ON s.id = m.session_id
              WHERE s.project_id = ${projectId as ProjectId}
                AND m.created_at >= ${range.from}
                AND m.created_at <= ${range.to}
              WINDOW w AS (PARTITION BY m.session_id ORDER BY m.created_at ASC)
            )
            SELECT AVG(EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000)::float8 AS avg_ms
            FROM paired
            WHERE prev_role = 'user' AND role = 'assistant'
          `,
        ]);

      const avgMsRaw = avgRespRaw[0]?.avg_ms;
      const response: OverviewResponse = {
        conversationsToday: Number(conversationsTodayRaw[0]?.count ?? 0n),
        activeClients: Number(activeClientsRaw[0]?.count ?? 0n),
        messagesProcessed: Number(messagesRaw[0]?.count ?? 0n),
        avgResponseTimeMs:
          typeof avgMsRaw === 'number' && Number.isFinite(avgMsRaw)
            ? Math.round(avgMsRaw)
            : null,
      };

      cache.set(cacheKey, response);
      return sendSuccess(reply, response);
    },
  );

  // ── GET /projects/:projectId/metrics/top-clients ────────────────
  // Groups by Contact (no Client ↔ Session link in schema); the response
  // field names are kept as `clientId`/`clientName` to match the dashboard
  // contract — they hold contactId / contact.name.
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/metrics/top-clients',
    async (request, reply) => {
      const parsed = topClientsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'INVALID_QUERY', parsed.error.message, 400);
      }
      const { projectId } = request.params;
      const { limit } = parsed.data;
      const range = resolveRange(parsed.data.from, parsed.data.to);
      const cacheKey = `topclients|${projectId}|${range.fromIso}|${range.toIso}|${limit}`;

      const cached = cache.get<TopClientsResponse>(cacheKey);
      if (cached) return sendSuccess(reply, cached);

      const rows = await prisma.$queryRaw<
        {
          contact_id: string;
          contact_name: string | null;
          conversations: bigint;
          messages: bigint;
        }[]
      >`
        SELECT
          s.contact_id AS contact_id,
          c.name AS contact_name,
          COUNT(DISTINCT s.id)::bigint AS conversations,
          COUNT(m.id)::bigint AS messages
        FROM sessions s
        LEFT JOIN contacts c ON c.id = s.contact_id
        LEFT JOIN messages m ON m.session_id = s.id
          AND m.created_at >= ${range.from}
          AND m.created_at <= ${range.to}
        WHERE s.project_id = ${projectId as ProjectId}
          AND s.contact_id IS NOT NULL
          AND s.created_at >= ${range.from}
          AND s.created_at <= ${range.to}
        GROUP BY s.contact_id, c.name
        ORDER BY conversations DESC, messages DESC
        LIMIT ${limit}
      `;

      const response: TopClientsResponse = {
        clients: rows.map((r) => ({
          clientId: r.contact_id,
          clientName: r.contact_name ?? 'Unknown',
          conversations: Number(r.conversations),
          messages: Number(r.messages),
        })),
      };

      cache.set(cacheKey, response);
      return sendSuccess(reply, response);
    },
  );
}
