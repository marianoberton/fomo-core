/**
 * Metrics routes — analytics aggregations for the dashboard.
 *
 * Endpoints (all scoped to `/projects/:projectId`):
 *   GET /metrics/conversations  → sessions per day (count + uniqueContacts)
 *   GET /metrics/channels       → session distribution by channel
 *   GET /metrics/usage          → token + cost aggregation by day or by agent
 *
 * Aggregations are pushed down to SQL via `$queryRaw` to avoid N+1.
 * Results are memoized in-process for 60 s per (projectId, endpoint, range, groupBy).
 *
 * Project-access enforcement is handled globally by the `requireProjectAccess`
 * onRequest hook (matches `request.params.projectId`).
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

// ─── Types ──────────────────────────────────────────────────────

type ConversationsResponse = z.infer<typeof conversationsResponseSchema>;
type ChannelsResponse = z.infer<typeof channelsResponseSchema>;
type UsageResponse = z.infer<typeof usageResponseSchema>;

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
}
