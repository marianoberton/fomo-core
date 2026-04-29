/**
 * HTTP client for the WAHA (WhatsApp HTTP API) multi-session endpoint.
 *
 * Design decisions:
 * - Exponential backoff on 5xx (WAHA is flaky during session warm-up).
 * - 4xx → fail immediately (misconfiguration, not transient).
 * - AbortController enforces a 10s timeout per request.
 * - Returns Result<T, ResearchError> — never throws for expected failures.
 */
import type { Logger } from '@/observability/logger.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ResearchError } from './errors.js';

// ─── Public surface ──────────────────────────────────────────────────

export type WahaSessionStatus = 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED';

export interface WahaSessionInfo {
  name: string;
  status: WahaSessionStatus;
}

export interface WahaMessage {
  id: string;
  from: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  body: string;
  fromMe: boolean;
}

export interface WahaResearchClient {
  createSession(name: string): Promise<Result<{ name: string; status: WahaSessionStatus }, ResearchError>>;
  getSessionQR(name: string): Promise<Result<{ qr: string; status: WahaSessionStatus }, ResearchError>>;
  getSessionStatus(name: string): Promise<Result<{ name: string; status: WahaSessionStatus }, ResearchError>>;
  listSessions(): Promise<Result<WahaSessionInfo[], ResearchError>>;
  stopSession(name: string): Promise<Result<void, ResearchError>>;
  sendText(session: string, to: string, text: string): Promise<Result<{ id: string }, ResearchError>>;
  startTyping(session: string, to: string, durationMs: number): Promise<Result<void, ResearchError>>;
  stopTyping(session: string, to: string): Promise<Result<void, ResearchError>>;
  getMessages(session: string, chatId: string, limit: number): Promise<Result<WahaMessage[], ResearchError>>;
  configureWebhook(sessionName: string, webhookUrl: string, hmacSecret: string): Promise<Result<void, ResearchError>>;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface CreateWahaResearchClientOptions {
  baseUrl: string;
  apiKey: string;
  logger: Logger;
  /** Override fetch for unit tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  retryConfig?: RetryConfig;
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

const REQUEST_TIMEOUT_MS = 10_000;

// ─── Factory ────────────────────────────────────────────────────────

export function createWahaResearchClient(opts: CreateWahaResearchClientOptions): WahaResearchClient {
  const { baseUrl, apiKey, logger } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retry = opts.retryConfig ?? DEFAULT_RETRY;

  // ── Internal helpers ─────────────────────────────────────────────

  async function wahaFetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result<T, ResearchError>> {
    const url = `${baseUrl}${path}`;
    let attempt = 0;

    while (attempt < retry.maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetchImpl(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        logger.info('waha request', {
          component: 'research-waha-client',
          method,
          path,
          status: response.status,
          attempt,
        });

        // 4xx → immediate failure, no retry
        if (response.status >= 400 && response.status < 500) {
          const text = await response.text().catch(() => '');
          return err(new ResearchError({
            message: `WAHA ${method} ${path} → ${response.status}: ${text}`,
            code: 'WAHA_SESSION_NOT_WORKING',
          }));
        }

        // 5xx → retry after backoff
        if (response.status >= 500) {
          if (attempt >= retry.maxAttempts) {
            return err(new ResearchError({
              message: `WAHA ${method} ${path} → ${response.status} after ${attempt} attempts`,
              code: 'WAHA_UNREACHABLE',
            }));
          }
          const delay = Math.min(retry.baseDelayMs * 2 ** (attempt - 1), retry.maxDelayMs);
          logger.warn('waha 5xx, retrying', {
            component: 'research-waha-client',
            method,
            path,
            status: response.status,
            attempt,
            delayMs: delay,
          });
          await sleep(delay);
          continue;
        }

        // 204 No Content
        if (response.status === 204) {
          return ok(undefined as T);
        }

        const data = await response.json() as T;
        return ok(data);
      } catch (e) {
        clearTimeout(timeoutId);

        const isAbort = e instanceof Error && e.name === 'AbortError';
        if (isAbort || attempt >= retry.maxAttempts) {
          logger.error('waha request failed', {
            component: 'research-waha-client',
            method,
            path,
            attempt,
            error: e instanceof Error ? e.message : String(e),
          });
          return err(new ResearchError({
            message: isAbort
              ? `WAHA ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`
              : `WAHA ${method} ${path} network error: ${e instanceof Error ? e.message : String(e)}`,
            code: 'WAHA_UNREACHABLE',
            cause: e instanceof Error ? e : undefined,
          }));
        }

        const delay = Math.min(retry.baseDelayMs * 2 ** (attempt - 1), retry.maxDelayMs);
        await sleep(delay);
      }
    }

    // Should never reach here
    return err(new ResearchError({
      message: `WAHA ${method} ${path} exhausted retries`,
      code: 'WAHA_UNREACHABLE',
    }));
  }

  // ── Public methods ───────────────────────────────────────────────

  async function createSession(name: string): Promise<Result<{ name: string; status: WahaSessionStatus }, ResearchError>> {
    return wahaFetch('POST', '/api/sessions', { name });
  }

  async function getSessionQR(name: string): Promise<Result<{ qr: string; status: WahaSessionStatus }, ResearchError>> {
    return wahaFetch('GET', `/api/sessions/${encodeURIComponent(name)}/auth/qr`);
  }

  async function getSessionStatus(name: string): Promise<Result<{ name: string; status: WahaSessionStatus }, ResearchError>> {
    return wahaFetch('GET', `/api/sessions/${encodeURIComponent(name)}`);
  }

  async function listSessions(): Promise<Result<WahaSessionInfo[], ResearchError>> {
    return wahaFetch<WahaSessionInfo[]>('GET', '/api/sessions');
  }

  async function stopSession(name: string): Promise<Result<void, ResearchError>> {
    return wahaFetch<void>('DELETE', `/api/sessions/${encodeURIComponent(name)}`);
  }

  async function sendText(session: string, to: string, text: string): Promise<Result<{ id: string }, ResearchError>> {
    return wahaFetch('POST', `/api/sendText`, {
      session,
      chatId: to,
      text,
    });
  }

  async function startTyping(session: string, to: string, durationMs: number): Promise<Result<void, ResearchError>> {
    return wahaFetch<void>('POST', `/api/startTyping`, {
      session,
      chatId: to,
      durationMs,
    });
  }

  async function stopTyping(session: string, to: string): Promise<Result<void, ResearchError>> {
    return wahaFetch<void>('POST', `/api/stopTyping`, {
      session,
      chatId: to,
    });
  }

  async function getMessages(session: string, chatId: string, limit: number): Promise<Result<WahaMessage[], ResearchError>> {
    const params = new URLSearchParams({ session, chatId, limit: String(limit) });
    return wahaFetch<WahaMessage[]>('GET', `/api/messages?${params.toString()}`);
  }

  async function configureWebhook(
    sessionName: string,
    webhookUrl: string,
    hmacSecret: string,
  ): Promise<Result<void, ResearchError>> {
    // WAHA webhook config — set on the session object directly via PATCH
    return wahaFetch<void>('PUT', `/api/sessions/${encodeURIComponent(sessionName)}/webhooks`, {
      url: webhookUrl,
      events: ['message'],
      hmac: { key: hmacSecret },
    });
  }

  return {
    createSession,
    getSessionQR,
    getSessionStatus,
    listSessions,
    stopSession,
    sendText,
    startTyping,
    stopTyping,
    getMessages,
    configureWebhook,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
