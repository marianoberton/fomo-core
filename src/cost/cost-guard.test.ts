import { describe, it, expect, vi } from 'vitest';
import type { ProjectId, CostConfig } from '@/core/types.js';
import { BudgetExceededError, RateLimitError } from '@/core/errors.js';
import { createCostGuard, createInMemoryUsageStore } from './cost-guard.js';

const PROJECT_ID = 'test-project' as ProjectId;

function makeConfig(overrides?: Partial<CostConfig>): CostConfig {
  return {
    dailyBudgetUSD: 10,
    monthlyBudgetUSD: 100,
    maxTokensPerTurn: 4096,
    maxTurnsPerSession: 50,
    maxToolCallsPerTurn: 10,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 60,
    maxRequestsPerHour: 1000,
    ...overrides,
  };
}

describe('CostGuard', () => {
  describe('preCheck', () => {
    it('passes when under all limits', async () => {
      const guard = createCostGuard({
        costConfig: makeConfig(),
        usageStore: createInMemoryUsageStore(),
      });

      // Should not throw
      await guard.preCheck(PROJECT_ID);
    });

    it('throws BudgetExceededError when daily budget exceeded', async () => {
      const store = createInMemoryUsageStore();
      // Pre-fill with usage that exceeds daily budget
      await store.recordUsage({
        projectId: PROJECT_ID,
        provider: 'test',
        model: 'test',
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 15, // exceeds $10 daily budget
      });

      const guard = createCostGuard({
        costConfig: makeConfig({ dailyBudgetUSD: 10 }),
        usageStore: store,
      });

      await expect(guard.preCheck(PROJECT_ID)).rejects.toThrow(BudgetExceededError);
    });

    it('throws BudgetExceededError when monthly budget exceeded', async () => {
      const store = createInMemoryUsageStore();
      await store.recordUsage({
        projectId: PROJECT_ID,
        provider: 'test',
        model: 'test',
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 150,
      });

      const guard = createCostGuard({
        costConfig: makeConfig({ monthlyBudgetUSD: 100 }),
        usageStore: store,
      });

      await expect(guard.preCheck(PROJECT_ID)).rejects.toThrow(BudgetExceededError);
    });

    it('throws RateLimitError when RPM exceeded', async () => {
      const store = createInMemoryUsageStore();
      // Fill up rate limit
      for (let i = 0; i < 5; i++) {
        await store.recordRequest(PROJECT_ID);
      }

      const guard = createCostGuard({
        costConfig: makeConfig({ maxRequestsPerMinute: 5 }),
        usageStore: store,
      });

      await expect(guard.preCheck(PROJECT_ID)).rejects.toThrow(RateLimitError);
    });

    it('throws RateLimitError when RPH exceeded', async () => {
      const store = createInMemoryUsageStore();
      for (let i = 0; i < 3; i++) {
        await store.recordRequest(PROJECT_ID);
      }

      const guard = createCostGuard({
        costConfig: makeConfig({ maxRequestsPerHour: 3, maxRequestsPerMinute: 100 }),
        usageStore: store,
      });

      await expect(guard.preCheck(PROJECT_ID)).rejects.toThrow(RateLimitError);
    });
  });

  describe('recordUsage', () => {
    it('records usage and calculates cost', async () => {
      const store = createInMemoryUsageStore();
      const guard = createCostGuard({
        costConfig: makeConfig(),
        usageStore: store,
      });

      await guard.recordUsage(PROJECT_ID, 'openai', 'gpt-4o', {
        inputTokens: 1000,
        outputTokens: 500,
      });

      const status = await guard.getBudgetStatus(PROJECT_ID);
      expect(status.dailySpentUSD).toBeGreaterThan(0);
    });

    it('fires alert callback when threshold reached', async () => {
      const store = createInMemoryUsageStore();
      const onAlert = vi.fn();

      // Pre-fill to be just under threshold
      await store.recordUsage({
        projectId: PROJECT_ID,
        provider: 'test',
        model: 'test',
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 8.5, // 85% of $10
      });

      const guard = createCostGuard({
        costConfig: makeConfig({ dailyBudgetUSD: 10, alertThresholdPercent: 80 }),
        usageStore: store,
        onAlert,
      });

      await guard.recordUsage(PROJECT_ID, 'openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(onAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'threshold',
          budgetType: 'daily',
        }),
      );
    });
  });

  describe('getBudgetStatus', () => {
    it('returns correct budget status', async () => {
      const store = createInMemoryUsageStore();
      await store.recordUsage({
        projectId: PROJECT_ID,
        provider: 'test',
        model: 'test',
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 5,
      });

      const guard = createCostGuard({
        costConfig: makeConfig({ dailyBudgetUSD: 10, monthlyBudgetUSD: 100 }),
        usageStore: store,
      });

      const status = await guard.getBudgetStatus(PROJECT_ID);
      expect(status.dailySpentUSD).toBe(5);
      expect(status.dailyBudgetUSD).toBe(10);
      expect(status.dailyPercentUsed).toBe(50);
      expect(status.isOverDailyBudget).toBe(false);
      expect(status.monthlySpentUSD).toBe(5);
    });
  });

  describe('checkTurnTokens', () => {
    it('returns true when within limit', () => {
      const guard = createCostGuard({
        costConfig: makeConfig({ maxTokensPerTurn: 4096 }),
        usageStore: createInMemoryUsageStore(),
      });

      expect(guard.checkTurnTokens(2000)).toBe(true);
    });

    it('returns false when exceeding limit', () => {
      const guard = createCostGuard({
        costConfig: makeConfig({ maxTokensPerTurn: 4096 }),
        usageStore: createInMemoryUsageStore(),
      });

      expect(guard.checkTurnTokens(5000)).toBe(false);
    });
  });
});
