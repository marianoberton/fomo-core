/**
 * Date/time tool — get current time, format, parse, diff, and add operations.
 *
 * Uses built-in Date + Intl.DateTimeFormat APIs (no external libs).
 * All operations are pure — no side effects.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'date-time' });

const timeUnitSchema = z.enum(['ms', 'seconds', 'minutes', 'hours', 'days']);
const addUnitSchema = z.enum(['ms', 'seconds', 'minutes', 'hours', 'days', 'months', 'years']);

const nowSchema = z.object({
  operation: z.literal('now'),
  timezone: z.string().optional(),
});

const formatSchema = z.object({
  operation: z.literal('format'),
  date: z.string(),
  format: z.enum(['iso', 'date', 'time', 'datetime', 'relative']),
  timezone: z.string().optional(),
});

const parseSchema = z.object({
  operation: z.literal('parse'),
  date: z.string(),
  timezone: z.string().optional(),
});

const diffSchema = z.object({
  operation: z.literal('diff'),
  from: z.string(),
  to: z.string(),
  unit: timeUnitSchema.optional().default('ms'),
});

const addSchema = z.object({
  operation: z.literal('add'),
  date: z.string(),
  amount: z.number(),
  unit: addUnitSchema,
});

const inputSchema = z.discriminatedUnion('operation', [
  nowSchema,
  formatSchema,
  parseSchema,
  diffSchema,
  addSchema,
]);

const outputSchema = z.object({
  result: z.string(),
  iso: z.string(),
  timestamp: z.number(),
});

// ─── Helpers ───────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: "${dateStr}"`);
  }
  return d;
}

function validateTimezone(tz: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    throw new Error(`Invalid timezone: "${tz}"`);
  }
}

function formatInTimezone(date: Date, timezone?: string): string {
  if (!timezone) return date.toISOString();
  validateTimezone(timezone);
  return date.toLocaleString('en-US', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' });
}

function formatDate(
  date: Date,
  format: 'iso' | 'date' | 'time' | 'datetime' | 'relative',
  timezone?: string,
): string {
  const tz = timezone ? { timeZone: timezone } : {};
  if (timezone) validateTimezone(timezone);

  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'date':
      return date.toLocaleDateString('en-US', { ...tz, dateStyle: 'full' });
    case 'time':
      return date.toLocaleTimeString('en-US', { ...tz, timeStyle: 'long' });
    case 'datetime':
      return date.toLocaleString('en-US', { ...tz, dateStyle: 'full', timeStyle: 'long' });
    case 'relative': {
      const diffMs = Date.now() - date.getTime();
      const absDiff = Math.abs(diffMs);
      const future = diffMs < 0;
      if (absDiff < 60_000) return future ? 'in a few seconds' : 'a few seconds ago';
      if (absDiff < 3_600_000) {
        const mins = Math.round(absDiff / 60_000);
        return future ? `in ${String(mins)} minute(s)` : `${String(mins)} minute(s) ago`;
      }
      if (absDiff < 86_400_000) {
        const hours = Math.round(absDiff / 3_600_000);
        return future ? `in ${String(hours)} hour(s)` : `${String(hours)} hour(s) ago`;
      }
      const days = Math.round(absDiff / 86_400_000);
      return future ? `in ${String(days)} day(s)` : `${String(days)} day(s) ago`;
    }
  }
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

function diffInUnit(from: Date, to: Date, unit: string): number {
  const ms = to.getTime() - from.getTime();
  const divisor = UNIT_MS[unit];
  if (!divisor) throw new Error(`Invalid unit: "${unit}"`);
  return ms / divisor;
}

function addToDate(date: Date, amount: number, unit: string): Date {
  const result = new Date(date.getTime());

  if (unit === 'months') {
    result.setMonth(result.getMonth() + amount);
    return result;
  }

  if (unit === 'years') {
    result.setFullYear(result.getFullYear() + amount);
    return result;
  }

  const msPerUnit = UNIT_MS[unit];
  if (!msPerUnit) throw new Error(`Invalid unit: "${unit}"`);
  return new Date(result.getTime() + amount * msPerUnit);
}

// ─── Execution ─────────────────────────────────────────────────

type DateTimeInput = z.infer<typeof inputSchema>;

function executeOperation(input: DateTimeInput): { result: string; iso: string; timestamp: number } {
  switch (input.operation) {
    case 'now': {
      const now = new Date();
      return {
        result: formatInTimezone(now, input.timezone),
        iso: now.toISOString(),
        timestamp: now.getTime(),
      };
    }
    case 'format': {
      const date = parseDate(input.date);
      return {
        result: formatDate(date, input.format, input.timezone),
        iso: date.toISOString(),
        timestamp: date.getTime(),
      };
    }
    case 'parse': {
      const date = parseDate(input.date);
      return {
        result: formatInTimezone(date, input.timezone),
        iso: date.toISOString(),
        timestamp: date.getTime(),
      };
    }
    case 'diff': {
      const from = parseDate(input.from);
      const to = parseDate(input.to);
      const diff = diffInUnit(from, to, input.unit);
      return {
        result: `${String(diff)} ${input.unit}`,
        iso: new Date().toISOString(),
        timestamp: diff,
      };
    }
    case 'add': {
      const date = parseDate(input.date);
      const result = addToDate(date, input.amount, input.unit);
      return {
        result: result.toISOString(),
        iso: result.toISOString(),
        timestamp: result.getTime(),
      };
    }
  }
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a date/time tool for time operations, formatting, and arithmetic. */
export function createDateTimeTool(): ExecutableTool {
  return {
    id: 'date-time',
    name: 'Date Time',
    description:
      'Perform date/time operations: get current time (now), format dates, parse date strings, ' +
      'calculate differences between dates, and add/subtract time from dates. ' +
      'Supports timezones via IANA timezone names (e.g. "America/New_York").',
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
        const output = executeOperation(parsed);

        logger.debug('Date-time operation completed', {
          component: 'date-time',
          projectId: context.projectId,
          traceId: context.traceId,
          operation: parsed.operation,
        });

        return Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('date-time', message)));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      // Pure function — dry run is the same as execute
      try {
        const output = executeOperation(parsed);
        return Promise.resolve(ok({
          success: true,
          output: { ...output, dryRun: true },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('date-time', message)));
      }
    },
  };
}
