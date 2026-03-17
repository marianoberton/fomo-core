import type { ProjectId, SessionId, TraceId, UsageRecordId } from '@/core/types.js';

// ─── Usage Record ───────────────────────────────────────────────

export interface UsageRecord {
  id: UsageRecordId;
  projectId: ProjectId;
  sessionId: SessionId;
  agentId?: string;
  clientId?: string;
  traceId: TraceId;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
  timestamp: Date;
}

// ─── Budget Status ──────────────────────────────────────────────

export interface BudgetStatus {
  projectId: ProjectId;
  dailySpentUSD: number;
  dailyBudgetUSD: number;
  monthlySpentUSD: number;
  monthlyBudgetUSD: number;
  dailyPercentUsed: number;
  monthlyPercentUsed: number;
  isOverDailyBudget: boolean;
  isOverMonthlyBudget: boolean;
}

// ─── Cost Alert ─────────────────────────────────────────────────

export interface CostAlert {
  projectId: ProjectId;
  alertType: 'threshold' | 'exceeded';
  budgetType: 'daily' | 'monthly';
  currentSpendUSD: number;
  budgetUSD: number;
  percentUsed: number;
  timestamp: Date;
}

// ─── Cost Summary Types ─────────────────────────────────────────

export interface AgentSpend {
  agentId: string;
  agentName: string;
  totalCostUSD: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  avgCostPerRequest: number;
  topModel: string;
}

export interface ClientSpend {
  clientId: string;
  clientName: string;
  totalCostUSD: number;
  requestCount: number;
  agents: AgentSpend[];
  budgetUSD?: number;
  budgetUsedPercent?: number;
}

export interface CostSummary {
  totalCostUSD: number;
  period: 'today' | 'week' | 'month';
  byClient: ClientSpend[];
  byAgent: AgentSpend[];
  byModel: { model: string; costUSD: number; requests: number }[];
  topExpensive: AgentSpend[];
}
