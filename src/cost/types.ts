import type { ProjectId, SessionId, TraceId, UsageRecordId } from '@/core/types.js';

// ─── Usage Record ───────────────────────────────────────────────

export interface UsageRecord {
  id: UsageRecordId;
  projectId: ProjectId;
  sessionId: SessionId;
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
