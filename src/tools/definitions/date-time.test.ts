import { describe, it, expect } from 'vitest';
import { createDateTimeTool } from './date-time.js';
import { createTestContext } from '@/testing/fixtures/context.js';

const tool = createDateTimeTool();
const context = createTestContext({ allowedTools: ['date-time'] });

describe('date-time', () => {
  describe('schema validation', () => {
    it('accepts a valid now operation', () => {
      const result = tool.inputSchema.safeParse({ operation: 'now' });
      expect(result.success).toBe(true);
    });

    it('accepts now with timezone', () => {
      const result = tool.inputSchema.safeParse({ operation: 'now', timezone: 'America/New_York' });
      expect(result.success).toBe(true);
    });

    it('accepts a valid format operation', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'format',
        date: '2024-01-15T10:30:00Z',
        format: 'iso',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a valid diff operation', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'diff',
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
        unit: 'hours',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a valid add operation', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'add',
        date: '2024-01-01T00:00:00Z',
        amount: 7,
        unit: 'days',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing operation', () => {
      const result = tool.inputSchema.safeParse({ date: '2024-01-01' });
      expect(result.success).toBe(false);
    });

    it('rejects unknown operation', () => {
      const result = tool.inputSchema.safeParse({ operation: 'unknown', date: '2024-01-01' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid format value', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'format',
        date: '2024-01-01',
        format: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid diff unit', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'diff',
        from: '2024-01-01',
        to: '2024-01-02',
        unit: 'weeks',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dry run', () => {
    it('returns result with dryRun flag for now', async () => {
      const result = await tool.dryRun({ operation: 'now' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['iso']).toBeDefined();
      }
    });

    it('returns error for invalid date in dry run', async () => {
      const result = await tool.dryRun({
        operation: 'parse',
        date: 'not-a-date',
      }, context);
      expect(result.ok).toBe(false);
    });
  });

  describe('execution', () => {
    it('returns current time for now operation', async () => {
      const before = Date.now();
      const result = await tool.execute({ operation: 'now' }, context);
      const after = Date.now();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { iso: string; timestamp: number };
        expect(output.timestamp).toBeGreaterThanOrEqual(before);
        expect(output.timestamp).toBeLessThanOrEqual(after);
      }
    });

    it('parses a valid ISO date', async () => {
      const result = await tool.execute({
        operation: 'parse',
        date: '2024-06-15T12:00:00Z',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { iso: string; timestamp: number };
        expect(output.iso).toBe('2024-06-15T12:00:00.000Z');
      }
    });

    it('formats a date as ISO', async () => {
      const result = await tool.execute({
        operation: 'format',
        date: '2024-06-15T12:00:00Z',
        format: 'iso',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: string };
        expect(output.result).toBe('2024-06-15T12:00:00.000Z');
      }
    });

    it('calculates diff in hours', async () => {
      const result = await tool.execute({
        operation: 'diff',
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
        unit: 'hours',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { timestamp: number };
        expect(output.timestamp).toBe(24);
      }
    });

    it('calculates diff in days', async () => {
      const result = await tool.execute({
        operation: 'diff',
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-08T00:00:00Z',
        unit: 'days',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { timestamp: number };
        expect(output.timestamp).toBe(7);
      }
    });

    it('adds days to a date', async () => {
      const result = await tool.execute({
        operation: 'add',
        date: '2024-01-01T00:00:00Z',
        amount: 7,
        unit: 'days',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { iso: string };
        expect(output.iso).toBe('2024-01-08T00:00:00.000Z');
      }
    });

    it('adds months to a date', async () => {
      const result = await tool.execute({
        operation: 'add',
        date: '2024-01-15T00:00:00Z',
        amount: 2,
        unit: 'months',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { iso: string };
        expect(output.iso).toBe('2024-03-15T00:00:00.000Z');
      }
    });

    it('subtracts time with negative amount', async () => {
      const result = await tool.execute({
        operation: 'add',
        date: '2024-06-15T12:00:00Z',
        amount: -3,
        unit: 'hours',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { iso: string };
        expect(output.iso).toBe('2024-06-15T09:00:00.000Z');
      }
    });

    it('returns error for invalid date string', async () => {
      const result = await tool.execute({
        operation: 'parse',
        date: 'definitely-not-a-date',
      }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
      }
    });

    it('returns error for invalid timezone', async () => {
      const result = await tool.execute({
        operation: 'now',
        timezone: 'Not/A/Timezone',
      }, context);
      expect(result.ok).toBe(false);
    });

    it('includes durationMs in result', async () => {
      const result = await tool.execute({ operation: 'now' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
