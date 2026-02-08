/**
 * CostGuard — middleware that wraps every LLM call with budget enforcement.
 * Checks daily/monthly budgets, rate limits, and per-turn token limits.
 * Creates UsageRecord entries for cost tracking and normalization.
 */
import { BudgetExceededError, RateLimitError } from '@/core/errors.js';
import type { CostConfig, ProjectId } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import type { TokenUsage } from '@/providers/types.js';
import { calculateCost } from '@/providers/models.js';
import type { BudgetStatus, CostAlert } from './types.js';

const logger = createLogger({ name: 'cost-guard' });

/** In-memory store for usage tracking. Will be backed by DB in production. */
export interface UsageStore {
  /** Get total spend for a project today. */
  getDailySpend(projectId: ProjectId): Promise<number>;
  /** Get total spend for a project this month. */
  getMonthlySpend(projectId: ProjectId): Promise<number>;
  /** Record a usage entry. */
  recordUsage(entry: {
    projectId: ProjectId;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  }): Promise<void>;
  /** Get request count in the last minute. */
  getRequestsLastMinute(projectId: ProjectId): Promise<number>;
  /** Get request count in the last hour. */
  getRequestsLastHour(projectId: ProjectId): Promise<number>;
  /** Record a request timestamp. */
  recordRequest(projectId: ProjectId): Promise<void>;
}

/** Callback for cost alert notifications. */
export type CostAlertCallback = (alert: CostAlert) => void;

export interface CostGuardOptions {
  costConfig: CostConfig;
  usageStore: UsageStore;
  onAlert?: CostAlertCallback;
}

export interface CostGuard {
  /**
   * Check if a request is allowed before making an LLM call.
   * Throws BudgetExceededError or RateLimitError if limits are exceeded.
   */
  preCheck(projectId: ProjectId): Promise<void>;

  /**
   * Record usage after an LLM call completes.
   * Emits alerts if thresholds are crossed.
   */
  recordUsage(
    projectId: ProjectId,
    provider: string,
    model: string,
    usage: TokenUsage,
  ): Promise<void>;

  /** Get current budget status for a project. */
  getBudgetStatus(projectId: ProjectId): Promise<BudgetStatus>;

  /** Check if a turn would exceed per-turn token limits. */
  checkTurnTokens(tokens: number): boolean;
}

/**
 * Create a CostGuard instance.
 */
export function createCostGuard(options: CostGuardOptions): CostGuard {
  const { costConfig, usageStore, onAlert } = options;

  function emitAlertIfNeeded(
    projectId: ProjectId,
    budgetType: 'daily' | 'monthly',
    spent: number,
    budget: number,
  ): void {
    const percentUsed = (spent / budget) * 100;

    if (percentUsed >= costConfig.hardLimitPercent) {
      const alert: CostAlert = {
        projectId,
        alertType: 'exceeded',
        budgetType,
        currentSpendUSD: spent,
        budgetUSD: budget,
        percentUsed,
        timestamp: new Date(),
      };
      logger.warn('Budget exceeded', {
        component: 'cost-guard',
        projectId,
        budgetType,
        percentUsed,
      });
      onAlert?.(alert);
    } else if (percentUsed >= costConfig.alertThresholdPercent) {
      const alert: CostAlert = {
        projectId,
        alertType: 'threshold',
        budgetType,
        currentSpendUSD: spent,
        budgetUSD: budget,
        percentUsed,
        timestamp: new Date(),
      };
      logger.info('Budget threshold reached', {
        component: 'cost-guard',
        projectId,
        budgetType,
        percentUsed,
      });
      onAlert?.(alert);
    }
  }

  return {
    async preCheck(projectId: ProjectId): Promise<void> {
      // Check rate limits
      const [rpm, rph] = await Promise.all([
        usageStore.getRequestsLastMinute(projectId),
        usageStore.getRequestsLastHour(projectId),
      ]);

      if (rpm >= costConfig.maxRequestsPerMinute) {
        throw new RateLimitError(projectId, 'rpm', rpm, costConfig.maxRequestsPerMinute);
      }

      if (rph >= costConfig.maxRequestsPerHour) {
        throw new RateLimitError(projectId, 'rph', rph, costConfig.maxRequestsPerHour);
      }

      // Check budgets
      const [dailySpend, monthlySpend] = await Promise.all([
        usageStore.getDailySpend(projectId),
        usageStore.getMonthlySpend(projectId),
      ]);

      if (dailySpend >= costConfig.dailyBudgetUSD) {
        throw new BudgetExceededError(projectId, 'daily', dailySpend, costConfig.dailyBudgetUSD);
      }

      if (monthlySpend >= costConfig.monthlyBudgetUSD) {
        throw new BudgetExceededError(
          projectId,
          'monthly',
          monthlySpend,
          costConfig.monthlyBudgetUSD,
        );
      }

      // Record request for rate limiting
      await usageStore.recordRequest(projectId);
    },

    async recordUsage(
      projectId: ProjectId,
      provider: string,
      model: string,
      usage: TokenUsage,
    ): Promise<void> {
      const costUSD = calculateCost(model, usage.inputTokens, usage.outputTokens);

      await usageStore.recordUsage({
        projectId,
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUSD,
      });

      logger.debug('Recorded usage', {
        component: 'cost-guard',
        projectId,
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUSD,
      });

      // Check if we need to emit alerts
      const [dailySpend, monthlySpend] = await Promise.all([
        usageStore.getDailySpend(projectId),
        usageStore.getMonthlySpend(projectId),
      ]);

      emitAlertIfNeeded(projectId, 'daily', dailySpend, costConfig.dailyBudgetUSD);
      emitAlertIfNeeded(projectId, 'monthly', monthlySpend, costConfig.monthlyBudgetUSD);
    },

    async getBudgetStatus(projectId: ProjectId): Promise<BudgetStatus> {
      const [dailySpend, monthlySpend] = await Promise.all([
        usageStore.getDailySpend(projectId),
        usageStore.getMonthlySpend(projectId),
      ]);

      return {
        projectId,
        dailySpentUSD: dailySpend,
        dailyBudgetUSD: costConfig.dailyBudgetUSD,
        monthlySpentUSD: monthlySpend,
        monthlyBudgetUSD: costConfig.monthlyBudgetUSD,
        dailyPercentUsed: (dailySpend / costConfig.dailyBudgetUSD) * 100,
        monthlyPercentUsed: (monthlySpend / costConfig.monthlyBudgetUSD) * 100,
        isOverDailyBudget: dailySpend >= costConfig.dailyBudgetUSD,
        isOverMonthlyBudget: monthlySpend >= costConfig.monthlyBudgetUSD,
      };
    },

    checkTurnTokens(tokens: number): boolean {
      return tokens <= costConfig.maxTokensPerTurn;
    },
  };
}

/**
 * Create an in-memory UsageStore for testing and development.
 */
export function createInMemoryUsageStore(): UsageStore {
  const usageEntries: {
    projectId: ProjectId;
    costUSD: number;
    timestamp: Date;
  }[] = [];
  const requestTimestamps: { projectId: ProjectId; timestamp: Date }[] = [];

  return {
    getDailySpend(projectId: ProjectId): Promise<number> {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return Promise.resolve(
        usageEntries
          .filter((e) => e.projectId === projectId && e.timestamp >= today)
          .reduce((sum, e) => sum + e.costUSD, 0),
      );
    },

    getMonthlySpend(projectId: ProjectId): Promise<number> {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      return Promise.resolve(
        usageEntries
          .filter((e) => e.projectId === projectId && e.timestamp >= monthStart)
          .reduce((sum, e) => sum + e.costUSD, 0),
      );
    },

    recordUsage(entry: {
      projectId: ProjectId;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
    }): Promise<void> {
      usageEntries.push({
        projectId: entry.projectId,
        costUSD: entry.costUSD,
        timestamp: new Date(),
      });
      return Promise.resolve();
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
      return Promise.resolve();
    },
  };
}
