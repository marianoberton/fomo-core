/**
 * Workforce metrics routes — agent performance metrics for the Workforce view.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const workforceQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(30),
  agentId: z.string().optional(),
});

// ─── Types ──────────────────────────────────────────────────────

interface DailyBreakdownRow {
  date: string;
  sessions: bigint | number;
  escalations: bigint | number;
  cost_usd: number;
}

interface WorkforceMetrics {
  period: { from: string; to: string };
  totalSessions: number;
  totalMessages: number | null;
  resolutionRate: number | null;
  escalationCount: number;
  avgTurnsPerSession: number | null;
  avgResponseTimeMs: number | null;
  peakHour: number | null;
  totalCostUsd: number;
  costPerSession: number | null;
  trend: {
    sessions: number | null;
    resolutionRate: number | null;
    cost: number | null;
  };
  dailyBreakdown: {
    date: string;
    sessions: number;
    escalations: number;
    costUsd: number;
  }[];
}

// ─── Helpers ────────────────────────────────────────────────────

function pct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register workforce metrics routes. */
export function workforceMetricsRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma } = deps;

  // GET /projects/:projectId/workforce-metrics
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/workforce-metrics',
    async (request, reply) => {
      const { projectId } = request.params;
      const query = workforceQuerySchema.parse(request.query);
      const { days, agentId } = query;

      const now = new Date();
      const periodFrom = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      periodFrom.setHours(0, 0, 0, 0);

      // For trend: current 7 days vs previous 7 days
      const trendFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      trendFrom.setHours(0, 0, 0, 0);
      const prevTrendFrom = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      prevTrendFrom.setHours(0, 0, 0, 0);

      const pid = projectId as ProjectId;
      const agentFilter = agentId ? Prisma.sql`AND s.agent_id = ${agentId}` : Prisma.sql``;
      const agentFilterUsage = agentId
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = ur.session_id AND s.agent_id = ${agentId})`
        : Prisma.sql``;
      const agentFilterTrace = agentId
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = et.session_id AND s.agent_id = ${agentId})`
        : Prisma.sql``;

      // ── Main period queries ──────────────────────────────────

      // Sessions in period
      const sessionsRaw = await prisma.$queryRaw<{
        total: bigint;
        completed: bigint;
      }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE s.status IN ('closed') AND NOT EXISTS (
            SELECT 1 FROM execution_traces et
            WHERE et.session_id = s.id
              AND et.events::text ILIKE '%escalate-to-human%'
          )) AS completed
        FROM sessions s
        WHERE s.project_id = ${pid}
          AND s.created_at >= ${periodFrom}
          ${agentFilter}
      `;

      const totalSessions = Number(sessionsRaw[0]?.total ?? 0);
      const completedSessions = Number(sessionsRaw[0]?.completed ?? 0);
      const resolutionRate =
        totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 10000) / 10000 : null;

      // Escalation count
      const escalationRaw = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM execution_traces et
        WHERE et.project_id = ${pid}
          AND et.created_at >= ${periodFrom}
          AND et.events::text ILIKE '%escalate-to-human%'
          ${agentFilterTrace}
      `;
      const escalationCount = Number(escalationRaw[0]?.count ?? 0);

      // Total messages
      const messagesRaw = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE s.project_id = ${pid}
          AND m.created_at >= ${periodFrom}
          ${agentFilter}
      `;
      const totalMessages = Number(messagesRaw[0]?.count ?? 0);

      // Avg turns per session (from execution_traces)
      const turnsRaw = await prisma.$queryRaw<{ avg_turns: number | null }[]>`
        SELECT AVG(et.turn_count) AS avg_turns
        FROM execution_traces et
        WHERE et.project_id = ${pid}
          AND et.created_at >= ${periodFrom}
          ${agentFilterTrace}
      `;
      const avgTurnsPerSession =
        turnsRaw[0]?.avg_turns != null
          ? Math.round(turnsRaw[0].avg_turns * 100) / 100
          : null;

      // Avg response time (total_duration_ms per trace)
      const responseTimeRaw = await prisma.$queryRaw<{ avg_ms: number | null }[]>`
        SELECT AVG(et.total_duration_ms) AS avg_ms
        FROM execution_traces et
        WHERE et.project_id = ${pid}
          AND et.created_at >= ${periodFrom}
          ${agentFilterTrace}
      `;
      const avgResponseTimeMs =
        responseTimeRaw[0]?.avg_ms != null
          ? Math.round(responseTimeRaw[0].avg_ms)
          : null;

      // Peak hour
      const peakHourRaw = await prisma.$queryRaw<{ hour: number; count: bigint }[]>`
        SELECT EXTRACT(HOUR FROM s.created_at)::int AS hour, COUNT(*) AS count
        FROM sessions s
        WHERE s.project_id = ${pid}
          AND s.created_at >= ${periodFrom}
          ${agentFilter}
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 1
      `;
      const peakHour = peakHourRaw[0]?.hour ?? null;

      // Cost
      const costRaw = await prisma.$queryRaw<{ total_cost: number | null }[]>`
        SELECT SUM(ur.cost_usd) AS total_cost
        FROM usage_records ur
        WHERE ur.project_id = ${pid}
          AND ur.timestamp >= ${periodFrom}
          ${agentFilterUsage}
      `;
      const totalCostUsd = costRaw[0]?.total_cost ?? 0;
      const costPerSession =
        totalSessions > 0 ? Math.round((totalCostUsd / totalSessions) * 1000000) / 1000000 : null;

      // ── Trend queries (current 7d vs prev 7d) ────────────────

      const trendCurrentRaw = await prisma.$queryRaw<{
        sessions: bigint;
        completed: bigint;
        cost: number | null;
      }[]>`
        SELECT
          COUNT(DISTINCT s.id) AS sessions,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'closed' AND NOT EXISTS (
            SELECT 1 FROM execution_traces et2
            WHERE et2.session_id = s.id
              AND et2.events::text ILIKE '%escalate-to-human%'
          )) AS completed,
          (SELECT SUM(ur.cost_usd) FROM usage_records ur
           WHERE ur.project_id = ${pid}
             AND ur.timestamp >= ${trendFrom}
             ${agentFilterUsage}) AS cost
        FROM sessions s
        WHERE s.project_id = ${pid}
          AND s.created_at >= ${trendFrom}
          ${agentFilter}
      `;

      const trendPrevRaw = await prisma.$queryRaw<{
        sessions: bigint;
        completed: bigint;
        cost: number | null;
      }[]>`
        SELECT
          COUNT(DISTINCT s.id) AS sessions,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'closed' AND NOT EXISTS (
            SELECT 1 FROM execution_traces et2
            WHERE et2.session_id = s.id
              AND et2.events::text ILIKE '%escalate-to-human%'
          )) AS completed,
          (SELECT SUM(ur.cost_usd) FROM usage_records ur
           WHERE ur.project_id = ${pid}
             AND ur.timestamp >= ${prevTrendFrom}
             AND ur.timestamp < ${trendFrom}
             ${agentFilterUsage}) AS cost
        FROM sessions s
        WHERE s.project_id = ${pid}
          AND s.created_at >= ${prevTrendFrom}
          AND s.created_at < ${trendFrom}
          ${agentFilter}
      `;

      const curSessions = Number(trendCurrentRaw[0]?.sessions ?? 0);
      const prevSessions = Number(trendPrevRaw[0]?.sessions ?? 0);
      const curCompleted = Number(trendCurrentRaw[0]?.completed ?? 0);
      const prevCompleted = Number(trendPrevRaw[0]?.completed ?? 0);
      const curCost = trendCurrentRaw[0]?.cost ?? 0;
      const prevCost = trendPrevRaw[0]?.cost ?? 0;

      const curResRate = curSessions > 0 ? curCompleted / curSessions : 0;
      const prevResRate = prevSessions > 0 ? prevCompleted / prevSessions : 0;

      const trend = {
        sessions: pct(curSessions, prevSessions),
        resolutionRate: pct(curResRate, prevResRate),
        cost: pct(curCost, prevCost),
      };

      // ── Daily breakdown ──────────────────────────────────────

      const dailyRaw = await prisma.$queryRaw<DailyBreakdownRow[]>`
        SELECT
          TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
          COUNT(DISTINCT s.id) AS sessions,
          COUNT(DISTINCT et.id) FILTER (WHERE et.events::text ILIKE '%escalate-to-human%') AS escalations,
          COALESCE(SUM(ur.cost_usd), 0) AS cost_usd
        FROM sessions s
        LEFT JOIN execution_traces et ON et.session_id = s.id
        LEFT JOIN usage_records ur ON ur.session_id = s.id
        WHERE s.project_id = ${pid}
          AND s.created_at >= ${periodFrom}
          ${agentFilter}
        GROUP BY date
        ORDER BY date ASC
      `;

      const dailyBreakdown = dailyRaw.map((row) => ({
        date: row.date,
        sessions: Number(row.sessions),
        escalations: Number(row.escalations),
        costUsd: row.cost_usd,
      }));

      // ── Assemble response ────────────────────────────────────

      const metrics: WorkforceMetrics = {
        period: {
          from: periodFrom.toISOString(),
          to: now.toISOString(),
        },
        totalSessions,
        totalMessages,
        resolutionRate,
        escalationCount,
        avgTurnsPerSession,
        avgResponseTimeMs,
        peakHour: typeof peakHour === 'number' ? peakHour : null,
        totalCostUsd,
        costPerSession,
        trend,
        dailyBreakdown,
      };

      return sendSuccess(reply, metrics);
    },
  );
}
