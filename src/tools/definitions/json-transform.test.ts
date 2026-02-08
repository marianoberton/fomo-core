import { describe, it, expect } from 'vitest';
import { createJsonTransformTool } from './json-transform.js';
import { createTestContext } from '@/testing/fixtures/context.js';

const tool = createJsonTransformTool();
const context = createTestContext({ allowedTools: ['json-transform'] });

describe('json-transform', () => {
  describe('schema validation', () => {
    it('accepts a valid parse operation', () => {
      const result = tool.inputSchema.safeParse({ operation: 'parse', data: '{"a":1}' });
      expect(result.success).toBe(true);
    });

    it('accepts a valid stringify operation', () => {
      const result = tool.inputSchema.safeParse({ operation: 'stringify', data: { a: 1 } });
      expect(result.success).toBe(true);
    });

    it('accepts a valid get operation', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'get',
        data: { a: { b: 1 } },
        path: 'a.b',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a valid merge operation', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'merge',
        targets: [{ a: 1 }, { b: 2 }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing operation', () => {
      const result = tool.inputSchema.safeParse({ data: '{}' });
      expect(result.success).toBe(false);
    });

    it('rejects unknown operation', () => {
      const result = tool.inputSchema.safeParse({ operation: 'unknown', data: '{}' });
      expect(result.success).toBe(false);
    });

    it('rejects merge with less than 2 targets', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'merge',
        targets: [{ a: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects get with empty path', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'get',
        data: { a: 1 },
        path: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects pick with empty keys', () => {
      const result = tool.inputSchema.safeParse({
        operation: 'pick',
        data: { a: 1 },
        keys: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dry run', () => {
    it('returns result with dryRun flag', async () => {
      const result = await tool.dryRun(
        { operation: 'parse', data: '{"hello":"world"}' },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['result']).toEqual({ hello: 'world' });
      }
    });

    it('returns error for invalid JSON in dry run', async () => {
      const result = await tool.dryRun(
        { operation: 'parse', data: 'not-json' },
        context,
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('execution', () => {
    it('parses a JSON string', async () => {
      const result = await tool.execute(
        { operation: 'parse', data: '{"name":"test","value":42}' },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: unknown };
        expect(output.result).toEqual({ name: 'test', value: 42 });
      }
    });

    it('stringifies an object', async () => {
      const result = await tool.execute(
        { operation: 'stringify', data: { a: 1, b: 'hello' } },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: string };
        expect(output.result).toBe('{"a":1,"b":"hello"}');
      }
    });

    it('stringifies with pretty printing', async () => {
      const result = await tool.execute(
        { operation: 'stringify', data: { a: 1 }, pretty: true },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: string };
        expect(output.result).toContain('\n');
      }
    });

    it('gets a nested value by dot-path', async () => {
      const result = await tool.execute(
        { operation: 'get', data: { a: { b: { c: 42 } } }, path: 'a.b.c' },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: number };
        expect(output.result).toBe(42);
      }
    });

    it('returns undefined for non-existent path', async () => {
      const result = await tool.execute(
        { operation: 'get', data: { a: 1 }, path: 'b.c' },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: undefined };
        expect(output.result).toBeUndefined();
      }
    });

    it('gets array element by numeric index', async () => {
      const result = await tool.execute(
        { operation: 'get', data: { items: ['a', 'b', 'c'] }, path: 'items.1' },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: string };
        expect(output.result).toBe('b');
      }
    });

    it('sets a nested value', async () => {
      const result = await tool.execute(
        { operation: 'set', data: { a: { b: 1 } }, path: 'a.c', value: 99 },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: Record<string, unknown> };
        expect(output.result).toEqual({ a: { b: 1, c: 99 } });
      }
    });

    it('creates intermediate objects when setting deep path', async () => {
      const result = await tool.execute(
        { operation: 'set', data: {}, path: 'a.b.c', value: 'deep' },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: Record<string, unknown> };
        expect(output.result).toEqual({ a: { b: { c: 'deep' } } });
      }
    });

    it('deep merges objects', async () => {
      const result = await tool.execute(
        {
          operation: 'merge',
          targets: [
            { a: 1, nested: { x: 1 } },
            { b: 2, nested: { y: 2 } },
          ],
        },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: Record<string, unknown> };
        expect(output.result).toEqual({ a: 1, b: 2, nested: { x: 1, y: 2 } });
      }
    });

    it('picks specified keys', async () => {
      const result = await tool.execute(
        { operation: 'pick', data: { a: 1, b: 2, c: 3 }, keys: ['a', 'c'] },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: Record<string, unknown> };
        expect(output.result).toEqual({ a: 1, c: 3 });
      }
    });

    it('omits specified keys', async () => {
      const result = await tool.execute(
        { operation: 'omit', data: { a: 1, b: 2, c: 3 }, keys: ['b'] },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: Record<string, unknown> };
        expect(output.result).toEqual({ a: 1, c: 3 });
      }
    });

    it('flattens a nested object', async () => {
      const result = await tool.execute(
        {
          operation: 'flatten',
          data: { a: { b: { c: 1 } }, d: 2 },
        },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: Record<string, unknown> };
        expect(output.result).toEqual({ 'a.b.c': 1, d: 2 });
      }
    });

    it('flattens with custom delimiter', async () => {
      const result = await tool.execute(
        {
          operation: 'flatten',
          data: { a: { b: 1 } },
          delimiter: '/',
        },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { result: Record<string, unknown> };
        expect(output.result).toEqual({ 'a/b': 1 });
      }
    });

    it('returns error for invalid JSON string in parse', async () => {
      const result = await tool.execute(
        { operation: 'parse', data: '{invalid json}' },
        context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
      }
    });

    it('includes durationMs in result', async () => {
      const result = await tool.execute(
        { operation: 'parse', data: '{}' },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
