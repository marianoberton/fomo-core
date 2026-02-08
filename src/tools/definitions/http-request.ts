/**
 * HTTP request tool — make HTTP requests to external APIs.
 *
 * Includes SSRF protection (blocks private/reserved IP ranges),
 * URL validation, response size limits, and timeout support.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'http-request' });

const MAX_RESPONSE_SIZE = 1_048_576; // 1MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

export interface HttpRequestToolOptions {
  /** Glob-like URL patterns to allow. If set, only matching URLs are permitted. */
  allowedUrlPatterns?: string[];
}

const methodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const inputSchema = z.object({
  url: z.string().url(),
  method: methodSchema,
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().default(DEFAULT_TIMEOUT_MS),
});

const outputSchema = z.object({
  status: z.number(),
  headers: z.record(z.string()),
  body: z.unknown(),
  durationMs: z.number(),
});

// ─── SSRF Protection ───────────────────────────────────────────

/**
 * Block private, reserved, and loopback IP ranges.
 * Checks both IPv4 and IPv6 patterns.
 */
const BLOCKED_IPV4_PREFIXES = [
  '10.',          // 10.0.0.0/8
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.', // 172.16.0.0/12
  '192.168.',     // 192.168.0.0/16
  '127.',         // 127.0.0.0/8 (loopback)
  '169.254.',     // 169.254.0.0/16 (link-local)
  '0.',           // 0.0.0.0/8
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  '0.0.0.0',
  '[::1]',
  '[::0]',
  '[0:0:0:0:0:0:0:0]',
  '[0:0:0:0:0:0:0:1]',
];

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Check exact blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(lower)) return true;

  // Check IPv4 prefixes
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }

  // Check IPv6 private ranges (fc00::/7 = ULA, fe80::/10 = link-local)
  if (lower.startsWith('[fc') || lower.startsWith('[fd')) return true;
  if (lower.startsWith('[fe8') || lower.startsWith('[fe9') || lower.startsWith('[fea') || lower.startsWith('[feb')) return true;

  return false;
}

function validateUrl(urlStr: string, allowedPatterns?: string[]): URL {
  const parsed = new URL(urlStr);

  // Only HTTP(S) allowed
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  // SSRF check
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Blocked host: requests to private/reserved IPs are not allowed`);
  }

  // URL allowlist check
  if (allowedPatterns && allowedPatterns.length > 0) {
    const matches = allowedPatterns.some((pattern) => matchUrlPattern(urlStr, pattern));
    if (!matches) {
      throw new Error(`URL not in allowlist: ${urlStr}`);
    }
  }

  return parsed;
}

/** Simple URL pattern matching: supports * as wildcard. */
function matchUrlPattern(url: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return regex.test(url);
}

/** Strip sensitive headers for logging. */
function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie') {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create an HTTP request tool for making external API calls. */
export function createHttpRequestTool(options?: HttpRequestToolOptions): ExecutableTool {
  const allowedPatterns = options?.allowedUrlPatterns;

  return {
    id: 'http-request',
    name: 'HTTP Request',
    description:
      'Make HTTP requests to external APIs. Supports GET, POST, PUT, PATCH, DELETE methods. ' +
      'Includes SSRF protection (blocks private IPs) and response size limits (1MB). ' +
      'Returns status code, headers, and response body.',
    category: 'integration',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // Validate URL + SSRF check
        validateUrl(parsed.url, allowedPatterns);

        // Build fetch options
        const fetchOptions: RequestInit = {
          method: parsed.method,
          headers: parsed.headers,
          signal: AbortSignal.any([
                context.abortSignal,
                AbortSignal.timeout(parsed.timeout),
              ]),
        };

        if (parsed.body !== undefined && parsed.method !== 'GET') {
          fetchOptions.body = typeof parsed.body === 'string'
            ? parsed.body
            : JSON.stringify(parsed.body);
        }

        logger.info('Making HTTP request', {
          component: 'http-request',
          projectId: context.projectId,
          traceId: context.traceId,
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers ? sanitizeHeadersForLog(parsed.headers) : undefined,
        });

        const response = await fetch(parsed.url, fetchOptions);

        // Read response with size limit
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        if (reader) {
          let done = false;
          while (!done) {
            const readResult = await reader.read();
            done = readResult.done;
            if (readResult.value) {
              totalSize += readResult.value.length;
              if (totalSize > MAX_RESPONSE_SIZE) {
                reader.cancel().catch(() => { /* intentionally ignored */ });
                throw new Error(`Response body exceeds ${String(MAX_RESPONSE_SIZE)} bytes limit`);
              }
              chunks.push(readResult.value);
            }
          }
        }

        const bodyBuffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          bodyBuffer.set(chunk, offset);
          offset += chunk.length;
        }
        const bodyText = new TextDecoder().decode(bodyBuffer);

        // Try to parse as JSON, fall back to text
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(bodyText) as unknown;
        } catch {
          responseBody = bodyText;
        }

        // Extract response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const durationMs = Date.now() - startTime;

        logger.info('HTTP request completed', {
          component: 'http-request',
          projectId: context.projectId,
          traceId: context.traceId,
          method: parsed.method,
          url: parsed.url,
          status: response.status,
          durationMs,
        });

        return ok({
          success: true,
          output: {
            status: response.status,
            headers: responseHeaders,
            body: responseBody,
            durationMs,
          },
          durationMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('HTTP request failed', {
          component: 'http-request',
          projectId: context.projectId,
          traceId: context.traceId,
          method: parsed.method,
          url: parsed.url,
          error: message,
        });
        return err(new ToolExecutionError('http-request', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      try {
        // Validate URL + SSRF check without making the request
        validateUrl(parsed.url, allowedPatterns);

        return Promise.resolve(ok({
          success: true,
          output: {
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers ?? {},
            hasBody: parsed.body !== undefined,
            timeout: parsed.timeout,
            dryRun: true,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('http-request', message)));
      }
    },
  };
}
