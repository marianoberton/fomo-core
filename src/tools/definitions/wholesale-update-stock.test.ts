/**
 * Wholesale Update Stock Tool Tests
 */
import { describe, it, expect } from 'vitest';
import { createWholesaleUpdateStockTool } from './wholesale-update-stock.js';
import type { ExecutionContext } from '@/core/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';

describe('wholesale-update-stock tool', () => {
  const mockContext: ExecutionContext = {
    projectId: 'test-project' as ProjectId,
    sessionId: 'test-session' as SessionId,
    traceId: 'test-trace' as TraceId,
    agentConfig: {} as ExecutionContext['agentConfig'],
    permissions: { allowedTools: new Set(['wholesale-update-stock']) },
    abortSignal: new AbortController().signal,
  };

  describe('schema validation', () => {
    it('validates valid input', () => {
      const tool = createWholesaleUpdateStockTool();
      const result = tool.inputSchema.safeParse({
        csvContent: 'SKU,STOCK\nPROD-001,100',
        projectId: 'test-project',
      });
      expect(result.success).toBe(true);
    });

    it('requires csvContent', () => {
      const tool = createWholesaleUpdateStockTool();
      const result = tool.inputSchema.safeParse({
        projectId: 'test-project',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dryRun', () => {
    it('parses CSV in dry run', async () => {
      const tool = createWholesaleUpdateStockTool();
      const result = await tool.dryRun({
        csvContent: `SKU,STOCK,PRICE
PROD-001,100,5000
PROD-002,50,3000`,
        projectId: 'test-project',
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['success']).toBe(true);
        expect(output['updatedCount']).toBe(2);
      }
    });

    it('rejects invalid input', async () => {
      const tool = createWholesaleUpdateStockTool();
      const result = await tool.dryRun({}, mockContext);

      expect(result.ok).toBe(false);
    });
  });

  describe('tool properties', () => {
    it('has correct metadata', () => {
      const tool = createWholesaleUpdateStockTool();
      expect(tool.id).toBe('wholesale-update-stock');
      expect(tool.riskLevel).toBe('medium');
      expect(tool.category).toBe('wholesale');
    });
  });
});
