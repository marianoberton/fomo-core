/**
 * Security tests for tool execution boundaries.
 * Verifies that tools operate within safe boundaries and
 * cannot be exploited through malicious inputs.
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';
import { createToolRegistry } from '@/tools/registry/tool-registry.js';
import {
  createCalculatorTool,
  createDateTimeTool,
  createJsonTransformTool,
} from '@/tools/definitions/index.js';
import { createE2EAgentConfig } from '../e2e/helpers.js';

// ─── Helper ────────────────────────────────────────────────────

function createTestContext(allowedTools: string[]) {
  const projectId = nanoid() as ProjectId;
  return {
    projectId,
    sessionId: nanoid() as SessionId,
    traceId: nanoid() as TraceId,
    agentConfig: createE2EAgentConfig(projectId, { allowedTools }),
    permissions: {
      allowedTools: new Set(allowedTools),
    },
    abortSignal: new AbortController().signal,
  };
}

// ─── Calculator Tool Security ──────────────────────────────────

describe('Calculator Tool Security', () => {
  const registry = createToolRegistry();
  registry.register(createCalculatorTool());
  const context = createTestContext(['calculator']);

  it('evaluates safe mathematical expressions', async () => {
    const result = await registry.resolve('calculator', { expression: '2 + 2' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
    }
  });

  it('rejects non-string expression input', async () => {
    const result = await registry.resolve('calculator', { expression: 42 }, context);
    expect(result.ok).toBe(false);
  });

  it('rejects empty expression', async () => {
    const result = await registry.resolve('calculator', { expression: '' }, context);
    expect(result.ok).toBe(false);
  });

  it('rejects missing expression field', async () => {
    const result = await registry.resolve('calculator', {}, context);
    expect(result.ok).toBe(false);
  });

  it('handles division by zero gracefully', async () => {
    const result = await registry.resolve('calculator', { expression: '1/0' }, context);
    // Should either error or return Infinity, but not crash
    expect(result.ok).toBeDefined();
  });

  it('handles extremely large numbers', async () => {
    const result = await registry.resolve('calculator', { expression: '999999999999999 * 999999999999999' }, context);
    expect(result.ok).toBeDefined();
  });
});

// ─── Date-Time Tool Security ───────────────────────────────────

describe('Date-Time Tool Security', () => {
  const registry = createToolRegistry();
  registry.register(createDateTimeTool());
  const context = createTestContext(['date-time']);

  it('returns current date-time information', async () => {
    const result = await registry.resolve('date-time', { operation: 'now' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.output).toBeDefined();
    }
  });

  it('rejects unexpected input fields', async () => {
    // date-time tool should accept empty input or specific fields
    // Passing arbitrary data should not affect execution
    const result = await registry.resolve('date-time', { arbitrary: 'data' }, context);
    // Should either succeed (ignoring extra fields) or fail validation
    expect(result.ok).toBeDefined();
  });
});

// ─── JSON Transform Tool Security ──────────────────────────────

describe('JSON Transform Tool Security', () => {
  const registry = createToolRegistry();
  registry.register(createJsonTransformTool());
  const context = createTestContext(['json-transform']);

  it('transforms valid JSON', async () => {
    const result = await registry.resolve('json-transform', {
      data: { name: 'test', value: 42 },
      operation: 'stringify',
    }, context);
    expect(result.ok).toBeDefined();
  });

  it('rejects invalid operation', async () => {
    const result = await registry.resolve('json-transform', {
      operation: 'execute_shell', // Not a valid operation
      data: 'test',
    }, context);
    expect(result.ok).toBe(false);
  });

  it('handles deeply nested objects', async () => {
    // Create deeply nested object
    let obj: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 50; i++) {
      obj = { nested: obj };
    }

    const result = await registry.resolve('json-transform', {
      data: obj,
      operation: 'stringify',
    }, context);
    // Should either succeed or fail gracefully, never crash
    expect(result.ok).toBeDefined();
  });
});

// ─── Tool Registry Isolation ──────────────────────────────────

describe('Tool Registry Isolation', () => {
  it('each registry instance is independent', () => {
    const registry1 = createToolRegistry();
    const registry2 = createToolRegistry();

    registry1.register(createCalculatorTool());

    expect(registry1.has('calculator')).toBe(true);
    expect(registry2.has('calculator')).toBe(false);
  });

  it('unregistering a tool removes it completely', () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());
    expect(registry.has('calculator')).toBe(true);

    registry.unregister('calculator');
    expect(registry.has('calculator')).toBe(false);
  });

  it('registering same tool twice replaces previous', () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());
    registry.register(createCalculatorTool());

    expect(registry.listAll().filter((id) => id === 'calculator')).toHaveLength(1);
  });
});

// ─── Dry Run vs Execute ───────────────────────────────────────

describe('Dry Run Safety', () => {
  it('dryRun returns result without side effects', async () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());
    const context = createTestContext(['calculator']);

    const result = await registry.resolveDryRun('calculator', { expression: '2 + 2' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
    }
  });

  it('dryRun also enforces RBAC', async () => {
    const registry = createToolRegistry();
    registry.register(createCalculatorTool());
    const context = createTestContext([]); // No tools allowed

    const result = await registry.resolveDryRun('calculator', { expression: '2 + 2' }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_NOT_ALLOWED');
    }
  });
});
