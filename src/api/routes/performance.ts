/**
 * Agent performance routes — aggregate KPIs and time-series for a single agent.
 *
 * GET /agents/:agentId/performance?range=7d|30d|90d
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

const rangeSchema = z.object({
  range: z.enum(['7d', '30d', '90d']).default('30d'),
});

/** Convert a range string into a Date window start. */
function rangeToSince(range: '7d' | '30d' | '90d'): Date {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

interface TraceEvent {
  type?: string;
  toolId?: string;
}

/** Register agent performance routes. */
export function performanceRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma } = deps;

  fastify.get(
    '/agents/:agentId/performance',
    async (
      request: FastifyRequest<{
        Params: { agentId: string };
        Querystring: { range?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const parsed = rangeSchema.safeParse(request.query);
      if (!parsed.success) {
        return sendNotFound(reply, 'AgentPerformance', request.params.agentId);
      }
      const range = parsed.data.range;
      const since = rangeToSince(range);

      const agent = await prisma.agent.findUnique({
        where: { id: request.params.agentId },
        select: { id: true, projectId: true, name: true },
      });
      if (!agent) {
        return sendNotFound(reply, 'Agent', request.params.agentId);
      }

      const [sessions, usage, traces] = await Promise.all([
        prisma.session.findMany({
          where: {
            agentId: agent.id,
            createdAt: { gte: since },
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
            metadata: true,
          },
        }),
        prisma.usageRecord.findMany({
          where: {
            agentId: agent.id,
            projectId: agent.projectId,
            timestamp: { gte: since },
          },
          select: { costUsd: true, timestamp: true, sessionId: true },
        }),
        prisma.executionTrace.findMany({
          where: {
            projectId: agent.projectId,
            createdAt: { gte: since },
            session: { agentId: agent.id },
          },
          select: {
            totalDurationMs: true,
            turnCount: true,
            events: true,
            status: true,
          },
        }),
      ]);

      // sessionsPerDay: bucket by YYYY-MM-DD
      const perDay = new Map<string, number>();
      for (const s of sessions) {
        const day = s.createdAt.toISOString().slice(0, 10);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }
      const sessionsPerDay = [...perDay.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day));

      const totalSessions = sessions.length;
      const totalCost = usage.reduce((sum, u) => sum + u.costUsd, 0);
      const costPerSession = totalSessions > 0 ? totalCost / totalSessions : 0;

      // avgResponseMs: mean of (totalDurationMs / max(turnCount,1)) across traces
      let avgResponseMs = 0;
      if (traces.length > 0) {
        const total = traces.reduce(
          (sum, t) => sum + t.totalDurationMs / Math.max(t.turnCount, 1),
          0,
        );
        avgResponseMs = Math.round(total / traces.length);
      }

      // Resolution rate: sessions ended and not escalated.
      const escalatedSessionCount = sessions.filter((s) => {
        const meta = s.metadata as Record<string, unknown> | null;
        return meta?.['escalated'] === true || s.status === 'escalated';
      }).length;
      const closedCount = sessions.filter(
        (s) => s.status === 'completed' || s.status === 'closed',
      ).length;
      const resolutionRate =
        totalSessions > 0
          ? Math.max(0, closedCount - escalatedSessionCount) / totalSessions
          : 0;

      // Top tools: parse ExecutionTrace.events JSON
      const toolCounts = new Map<string, number>();
      for (const t of traces) {
        const events = Array.isArray(t.events) ? (t.events as TraceEvent[]) : [];
        for (const ev of events) {
          if (ev?.type === 'tool_call' && typeof ev.toolId === 'string') {
            toolCounts.set(ev.toolId, (toolCounts.get(ev.toolId) ?? 0) + 1);
          }
        }
      }
      const totalToolCalls = [...toolCounts.values()].reduce((a, b) => a + b, 0);
      const topTools = [...toolCounts.entries()]
        .map(([toolId, count]) => ({
          toolId,
          count,
          pct: totalToolCalls > 0 ? count / totalToolCalls : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // byChannel: read session.metadata.channel if present
      const channelCounts = new Map<string, number>();
      for (const s of sessions) {
        const meta = s.metadata as Record<string, unknown> | null;
        const channel = typeof meta?.['channel'] === 'string' ? (meta['channel'] as string) : 'unknown';
        channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
      }
      const byChannel = [...channelCounts.entries()]
        .map(([channel, count]) => ({
          channel,
          count,
          pct: totalSessions > 0 ? count / totalSessions : 0,
        }))
        .sort((a, b) => b.count - a.count);

      await sendSuccess(reply, {
        agentId: agent.id,
        agentName: agent.name,
        range,
        totals: {
          sessions: totalSessions,
          costUsd: totalCost,
        },
        avgResponseMs,
        resolutionRate,
        sessionsPerDay,
        costPerSession,
        topTools,
        byChannel,
      });
    },
  );
}
