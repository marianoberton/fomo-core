export type { ExecutionTrace, TraceEvent, TraceEventType, ExecutionStatus } from '@/core/types.js';

// ─── Logging ────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  projectId?: string;
  sessionId?: string;
  traceId?: string;
  component: string;
  [key: string]: unknown;
}
