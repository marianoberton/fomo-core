/**
 * JSON transform tool — parse, query, and transform JSON data.
 *
 * Pure computation — no side effects. Supports parse, stringify, get (dot-path),
 * set, merge, pick, omit, and flatten operations.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'json-transform' });

const MAX_INPUT_SIZE = 1_048_576; // 1MB

const parseOp = z.object({
  operation: z.literal('parse'),
  data: z.string().max(MAX_INPUT_SIZE),
});

const stringifyOp = z.object({
  operation: z.literal('stringify'),
  data: z.unknown(),
  pretty: z.boolean().optional().default(false),
});

const getOp = z.object({
  operation: z.literal('get'),
  data: z.record(z.unknown()),
  path: z.string().min(1),
});

const setOp = z.object({
  operation: z.literal('set'),
  data: z.record(z.unknown()),
  path: z.string().min(1),
  value: z.unknown(),
});

const mergeOp = z.object({
  operation: z.literal('merge'),
  targets: z.array(z.record(z.unknown())).min(2),
});

const pickOp = z.object({
  operation: z.literal('pick'),
  data: z.record(z.unknown()),
  keys: z.array(z.string()).min(1),
});

const omitOp = z.object({
  operation: z.literal('omit'),
  data: z.record(z.unknown()),
  keys: z.array(z.string()).min(1),
});

const flattenOp = z.object({
  operation: z.literal('flatten'),
  data: z.record(z.unknown()),
  delimiter: z.string().optional().default('.'),
});

const inputSchema = z.discriminatedUnion('operation', [
  parseOp,
  stringifyOp,
  getOp,
  setOp,
  mergeOp,
  pickOp,
  omitOp,
  flattenOp,
]);

const outputSchema = z.object({
  result: z.unknown(),
});

// ─── Helpers ───────────────────────────────────────────────────

/** Get a nested value by dot-notation path (supports numeric array indices). */
function getByPath(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** Set a nested value by dot-notation path, returning a new object. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = path.split('.');
  const result = structuredClone(obj);
  let current: Record<string, unknown> = result;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (segment === undefined) throw new Error('Empty path segment');
    if (!(segment in current) || typeof current[segment] !== 'object' || current[segment] === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const lastSegment = segments[segments.length - 1];
  if (lastSegment === undefined) throw new Error('Empty path');
  current[lastSegment] = value;
  return result;
}

/** Deep merge multiple objects (later values win). */
function deepMerge(targets: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const target of targets) {
    for (const [key, value] of Object.entries(target)) {
      const existing = result[key];
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof existing === 'object' &&
        existing !== null &&
        !Array.isArray(existing)
      ) {
        result[key] = deepMerge([
          existing as Record<string, unknown>,
          value as Record<string, unknown>,
        ]);
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

/** Flatten a nested object to dot-notation keys. */
function flattenObject(
  obj: Record<string, unknown>,
  delimiter: string,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}${delimiter}${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, delimiter, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

// ─── Execution ─────────────────────────────────────────────────

type JsonTransformInput = z.infer<typeof inputSchema>;

function executeOperation(input: JsonTransformInput): unknown {
  switch (input.operation) {
    case 'parse':
      return JSON.parse(input.data) as unknown;
    case 'stringify':
      return input.pretty ? JSON.stringify(input.data, null, 2) : JSON.stringify(input.data);
    case 'get':
      return getByPath(input.data, input.path);
    case 'set':
      return setByPath(input.data, input.path, input.value);
    case 'merge':
      return deepMerge(input.targets);
    case 'pick': {
      const picked: Record<string, unknown> = {};
      for (const key of input.keys) {
        if (key in input.data) {
          picked[key] = input.data[key];
        }
      }
      return picked;
    }
    case 'omit':
      return Object.fromEntries(
        Object.entries(input.data).filter(([k]) => !input.keys.includes(k)),
      );
    case 'flatten':
      return flattenObject(input.data, input.delimiter);
  }
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a JSON transform tool for parsing, querying, and transforming JSON data. */
export function createJsonTransformTool(): ExecutableTool {
  return {
    id: 'json-transform',
    name: 'JSON Transform',
    description:
      'Parse, query, and transform JSON data. Operations: parse (JSON string to object), ' +
      'stringify (object to JSON string), get (dot-path access like "a.b.0.c"), ' +
      'set (set nested value), merge (deep merge objects), pick (select keys), ' +
      'omit (remove keys), flatten (nested to dot-notation).',
    category: 'utility',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const result = executeOperation(parsed);

        logger.debug('JSON transform completed', {
          component: 'json-transform',
          projectId: context.projectId,
          traceId: context.traceId,
          operation: parsed.operation,
        });

        return Promise.resolve(ok({
          success: true,
          output: { result },
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('json-transform', message)));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      // Pure computation — dry run is the same as execute
      try {
        const result = executeOperation(parsed);
        return Promise.resolve(ok({
          success: true,
          output: { result, dryRun: true },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('json-transform', message)));
      }
    },
  };
}
