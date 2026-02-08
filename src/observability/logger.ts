import pino from 'pino';
import type { LogContext } from './types.js';

/** Structured logger interface for Nexus Core. */
export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  fatal(msg: string, context?: LogContext): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Create a structured pino logger instance. */
export function createLogger(options?: { level?: string; name?: string }): Logger {
  const pinoInstance = pino({
    name: options?.name ?? 'nexus-core',
    level: options?.level ?? process.env['LOG_LEVEL'] ?? 'info',
    transport:
      process.env['NODE_ENV'] === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    serializers: {
      err: pino.stdSerializers.err,
    },
    redact: {
      paths: [
        'apiKey',
        'authorization',
        'password',
        'secret',
        '*.apiKey',
        '*.password',
        '*.authorization',
      ],
      censor: '[REDACTED]',
    },
  });

  return pinoInstance as unknown as Logger;
}
