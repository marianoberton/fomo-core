/**
 * Prisma-backed UsageStore for persistent cost tracking.
 * Rate limiting (RPM/RPH) stays in-memory - ephemeral and latency-sensitive.
 * Spend aggregation (daily/monthly) uses Prisma aggregate queries.
 */
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import type { UsageStore } from './cost-guard.js';
import type { AgentSpend, ClientSpend, ProjectSpend, CostSummary } from './types.js';

const logger = createLogger({ name: 'prisma-usage-store' });

/**
 * Create a UsageStore backed by Prisma for spend tracking,
 * with in-memory rate limiting for low-latency RPM/RPH checks.
 */
export function createPrismaUsageStore(prisma: PrismaClient): UsageStore {
  // In-memory rate limiting (ephemeral - acceptable to lose on restart)
  const requestTimestamps: { projectId: string; timestamp: Date }[] = [];

  /** Prune timestamps older than 2 hours to prevent unbounded growth. */
  function pruneTimestamps(): void {
    const cutoff = new Date(Date.now() - 7_200_000);
    const idx = requestTimestamps.findIndex((r) => r.timestamp >= cutoff);
    if (idx > 0) {
      requestTimestamps.splice(0, idx);
    }
  }

  return {
    async getDailySpend(projectId: ProjectId): Promise<number> {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await prisma.usageRecord.aggregate({
        where: {
          projectId,
          timestamp: { gte: today },
        },
        _sum: { costUsd: true },
      });

      return result._sum.costUsd ?? 0;
    },

    async getMonthlySpend(projectId: ProjectId): Promise<number> {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const result = await prisma.usageRecord.aggregate({
        where: {
          projectId,
          timestamp: { gte: monthStart },
        },
        _sum: { costUsd: true },
      });

      return result._sum.costUsd ?? 0;
    },

    async recordUsage(entry: {
      projectId: ProjectId;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
    }): Promise<void> {
      await prisma.usageRecord.create({
        data: {
          id: nanoid(),
          projectId: entry.projectId,
          sessionId: 'system',
          traceId: 'system',
          provider: entry.provider,
          model: entry.model,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          costUsd: entry.costUSD,
        },
      });

      logger.debug('Recorded usage', {
        component: 'prisma-usage-store',
        projectId: entry.projectId,
        costUSD: entry.costUSD,
      });
    },

    getRequestsLastMinute(projectId: ProjectId): Promise<number> {
      const oneMinuteAgo = new Date(Date.now() - 60_000);
      return Promise.resolve(
        requestTimestamps.filter(
          (r) => r.projectId === projectId && r.timestamp >= oneMinuteAgo,
        ).length,
      );
    },

    getRequestsLastHour(projectId: ProjectId): Promise<number> {
      const oneHourAgo = new Date(Date.now() - 3_600_000);
      return Promise.resolve(
        requestTimestamps.filter(
          (r) => r.projectId === projectId && r.timestamp >= oneHourAgo,
        ).length,
      );
    },

    recordRequest(projectId: ProjectId): Promise<void> {
      requestTimestamps.push({ projectId, timestamp: new Date() });
      pruneTimestamps();
      return Promise.resolve();
    },

    async getCostSummary(
      period: 'today' | 'week' | 'month',
      projectId?: ProjectId,
    ): Promise<CostSummary> {
      const startDate = getStartDate(period);

      const whereClause: any = {
        timestamp: { gte: startDate },
      };
      if (projectId) {
        whereClause.projectId = projectId;
      }

      // Get all records in the period
      const records = await prisma.usageRecord.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
      });

      // Calculate total cost
      const totalCostUSD = records.reduce((sum, r) => sum + r.costUsd, 0);

      // Aggregate by agent
      const agentMap = new Map<string, AgentSpend>();
      // Aggregate by client
      const clientMap = new Map<string, ClientSpend>();
      // Aggregate by project
      const projectMap = new Map<string, ProjectSpend>();
      // Aggregate by model
      const modelMap = new Map<string, { costUSD: number; requests: number }>(); 

      for (const record of records) {
        // By model
        const modelData = modelMap.get(record.model) || { costUSD: 0, requests: 0 };
        modelMap.set(record.model, {
          costUSD: modelData.costUSD + record.costUsd,
          requests: modelData.requests + 1,
        });

        // By project (always present)
        {
          const existing = projectMap.get(record.projectId) || {
            projectId: record.projectId,
            projectName: `Project ${record.projectId.slice(0, 8)}`,
            totalCostUSD: 0,
            requestCount: 0,
            agents: [],
            clients: [],
          };
          existing.totalCostUSD += record.costUsd;
          existing.requestCount += 1;
          projectMap.set(record.projectId, existing);
        }

        // By agent (if agentId exists)
        if (record.agentId) {
          const existing = agentMap.get(record.agentId) || {
            agentId: record.agentId,
            agentName: `Agent ${record.agentId.slice(0, 8)}`,
            totalCostUSD: 0,
            inputTokens: 0,
            outputTokens: 0,
            requestCount: 0,
            avgCostPerRequest: 0,
            topModel: record.model,
          };

          existing.totalCostUSD += record.costUsd;
          existing.inputTokens += record.inputTokens;
          existing.outputTokens += record.outputTokens;
          existing.requestCount += 1;
          // Update top model if this one has more cost
          if (record.costUsd > 0) {
            existing.topModel = record.model;
          }
          existing.avgCostPerRequest = existing.totalCostUSD / existing.requestCount;
          agentMap.set(record.agentId, existing);

          // By client (if clientId exists)
          if (record.clientId) {
            const clientData = clientMap.get(record.clientId) || {
              clientId: record.clientId,
              clientName: `Client ${record.clientId.slice(0, 8)}`,
              totalCostUSD: 0,
              requestCount: 0,
              agents: [],
              budgetUSD: undefined,
              budgetUsedPercent: undefined,
            };

            clientData.totalCostUSD += record.costUsd;
            clientData.requestCount += 1;

            // Add agent to client's agent list
            const existingAgentIdx = clientData.agents.findIndex(
              (a) => a.agentId === record.agentId,
            );
            if (existingAgentIdx >= 0 && clientData.agents[existingAgentIdx]) {
              clientData.agents[existingAgentIdx].totalCostUSD += record.costUsd;
              clientData.agents[existingAgentIdx].requestCount += 1;
            } else {
              clientData.agents.push({
                agentId: record.agentId,
                agentName: existing.agentName,
                totalCostUSD: record.costUsd,
                inputTokens: record.inputTokens,
                outputTokens: record.outputTokens,
                requestCount: 1,
                avgCostPerRequest: record.costUsd,
                topModel: record.model,
              });
            }

            clientMap.set(record.clientId, clientData);
          }
        }
      }

      // Fetch project names
      const projectIds = Array.from(projectMap.keys());
      if (projectIds.length > 0) {
        const projects = await prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        });
        for (const proj of projects) {
          const pd = projectMap.get(proj.id);
          if (pd) {
            pd.projectName = proj.name;
          }
        }
        // Attach agents and clients to each project
        for (const [projId, pd] of projectMap.entries()) {
          pd.agents = Array.from(agentMap.values()).filter(
            (a) => records.some((r) => r.projectId === projId && r.agentId === a.agentId),
          );
          pd.clients = Array.from(clientMap.values()).filter(
            (c) => records.some((r) => r.projectId === projId && r.clientId === c.clientId),
          );
        }
      }

      // Fetch client budgets
      const clientIds = Array.from(clientMap.keys());
      if (clientIds.length > 0) {
        const clients = await prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, monthlyBudgetUSD: true, name: true },
        });

        for (const client of clients) {
          const clientData = clientMap.get(client.id);
          if (clientData && client.monthlyBudgetUSD) {
            clientData.budgetUSD = client.monthlyBudgetUSD;
            clientData.budgetUsedPercent =
              (clientData.totalCostUSD / client.monthlyBudgetUSD) * 100;
            clientData.clientName = client.name;
          }
        }
      }

      // Fetch agent names
      const agentIds = Array.from(agentMap.keys());
      if (agentIds.length > 0) {
        const agents = await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        });

        for (const agent of agents) {
          const agentData = agentMap.get(agent.id);
          if (agentData) {
            agentData.agentName = agent.name;
          }
        }
      }

      const byAgent = Array.from(agentMap.values()).sort(
        (a, b) => b.totalCostUSD - a.totalCostUSD,
      );
      const byClient = Array.from(clientMap.values()).sort(
        (a, b) => b.totalCostUSD - a.totalCostUSD,
      );
      const byProject = Array.from(projectMap.values()).sort(
        (a, b) => b.totalCostUSD - a.totalCostUSD,
      );
      const byModel = Array.from(modelMap.entries())
        .map(([model, data]) => ({ model, ...data }))
        .sort((a, b) => b.costUSD - a.costUSD);

      return {
        totalCostUSD,
        period,
        byProject,
        byClient,
        byAgent,
        byModel,
        topExpensive: byAgent.slice(0, 5),
      };
    },

    async getAgentSpend(
      agentId: string,
      period: 'today' | 'week' | 'month',
      projectId?: ProjectId,
    ): Promise<AgentSpend> {
      const summary = await this.getCostSummary(period, projectId);
      const agent = summary.byAgent.find((a) => a.agentId === agentId);

      if (!agent) {
        // Fetch agent name
        const agentRecord = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { name: true },
        });

        return {
          agentId,
          agentName: agentRecord?.name || `Agent ${agentId.slice(0, 8)}`,
          totalCostUSD: 0,
          inputTokens: 0,
          outputTokens: 0,
          requestCount: 0,
          avgCostPerRequest: 0,
          topModel: '',
        };
      }

      return agent;
    },

    async getClientSpend(
      clientId: string,
      period: 'today' | 'week' | 'month',
      projectId?: ProjectId,
    ): Promise<ClientSpend> {
      const summary = await this.getCostSummary(period, projectId);
      const client = summary.byClient.find((c) => c.clientId === clientId);

      if (!client) {
        // Fetch client name and budget
        const clientRecord = await prisma.client.findUnique({
          where: { id: clientId },
          select: { name: true, monthlyBudgetUSD: true },
        });

        return {
          clientId,
          clientName: clientRecord?.name || `Client ${clientId.slice(0, 8)}`,
          totalCostUSD: 0,
          requestCount: 0,
          agents: [],
          budgetUSD: clientRecord?.monthlyBudgetUSD ?? undefined,
          budgetUsedPercent: clientRecord?.monthlyBudgetUSD
            ? 0
            : undefined,
        };
      }

      return client;
    },
  };
}

/** Helper to get start date based on period */
function getStartDate(period: 'today' | 'week' | 'month'): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  switch (period) {
    case 'today':
      return now;
    case 'week':
      now.setDate(now.getDate() - 7);
      return now;
    case 'month':
      now.setDate(now.getDate() - 30);
      return now;
  }
}
