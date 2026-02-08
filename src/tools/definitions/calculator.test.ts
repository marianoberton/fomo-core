import { describe, it, expect } from 'vitest';
import { createCalculatorTool } from './calculator.js';
import { createTestContext } from '@/testing/fixtures/context.js';

const tool = createCalculatorTool();
const context = createTestContext({ allowedTools: ['calculator'] });

describe('calculator', () => {
  describe('schema validation', () => {
    it('accepts a valid expression', () => {
      const result = tool.inputSchema.safeParse({ expression: '2 + 2' });
      expect(result.success).toBe(true);
    });

    it('rejects missing expression', () => {
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty expression', () => {
      const result = tool.inputSchema.safeParse({ expression: '' });
      expect(result.success).toBe(false);
    });

    it('rejects non-string expression', () => {
      const result = tool.inputSchema.safeParse({ expression: 42 });
      expect(result.success).toBe(false);
    });

    it('rejects expression exceeding max length', () => {
      const result = tool.inputSchema.safeParse({ expression: '1+'.repeat(501) });
      expect(result.success).toBe(false);
    });
  });

  describe('dry run', () => {
    it('validates a parseable expression', async () => {
      const result = await tool.dryRun({ expression: '2 + 3 * 4' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as Record<string, unknown>;
        expect(output['valid']).toBe(true);
        expect(output['dryRun']).toBe(true);
      }
    });

    it('returns error for invalid expression', async () => {
      const result = await tool.dryRun({ expression: '2 @ 3' }, context);
      expect(result.ok).toBe(false);
    });
  });

  describe('execution', () => {
    it('evaluates basic arithmetic', async () => {
      const result = await tool.execute({ expression: '2 + 3' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(5);
      }
    });

    it('respects operator precedence', async () => {
      const result = await tool.execute({ expression: '2 + 3 * 4' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(14);
      }
    });

    it('handles parentheses', async () => {
      const result = await tool.execute({ expression: '(2 + 3) * 4' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(20);
      }
    });

    it('handles exponentiation (right-associative)', async () => {
      const result = await tool.execute({ expression: '2 ** 3 ** 2' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(512); // 2^(3^2) = 2^9 = 512
      }
    });

    it('handles unary minus', async () => {
      const result = await tool.execute({ expression: '-5 + 3' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(-2);
      }
    });

    it('handles modulo', async () => {
      const result = await tool.execute({ expression: '10 % 3' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(1);
      }
    });

    it('handles decimal numbers', async () => {
      const result = await tool.execute({ expression: '0.1 + 0.2' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBeCloseTo(0.3);
      }
    });

    it('evaluates built-in functions', async () => {
      const result = await tool.execute({ expression: 'sqrt(16)' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(4);
      }
    });

    it('evaluates multi-argument functions', async () => {
      const result = await tool.execute({ expression: 'max(1, 5, 3)' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(5);
      }
    });

    it('evaluates constants', async () => {
      const result = await tool.execute({ expression: 'PI' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBeCloseTo(Math.PI);
      }
    });

    it('evaluates nested functions', async () => {
      const result = await tool.execute({ expression: 'abs(floor(-3.7))' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(4);
      }
    });

    it('returns error for division by zero', async () => {
      const result = await tool.execute({ expression: '1 / 0' }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
      }
    });

    it('returns error for unknown identifiers', async () => {
      const result = await tool.execute({ expression: 'foo + 1' }, context);
      expect(result.ok).toBe(false);
    });

    it('returns error for unbalanced parentheses', async () => {
      const result = await tool.execute({ expression: '(2 + 3' }, context);
      expect(result.ok).toBe(false);
    });

    it('includes durationMs in result', async () => {
      const result = await tool.execute({ expression: '1 + 1' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
