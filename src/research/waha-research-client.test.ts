import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWahaResearchClient } from './waha-research-client.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mock logger ─────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

// ─── Fetch factory helpers ───────────────────────────────────────────

function makeFetch(responses: Array<{ status: number; body?: unknown }>): typeof fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[Math.min(callIndex++, responses.length - 1)] ?? { status: 500 };
    return {
      status: resp.status,
      json: async () => resp.body,
      text: async () => (resp.body !== undefined ? JSON.stringify(resp.body) : ''),
    } as Response;
  });
}

function makeTimeoutFetch(): typeof fetch {
  return vi.fn((_url: RequestInfo | URL, opts?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      // Listen for abort signal
      const signal = (opts as RequestInit | undefined)?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener('abort', () => {
          const e = new DOMException('The operation was aborted.', 'AbortError');
          reject(e);
        });
      }
    });
  });
}

// ─── Test helpers ────────────────────────────────────────────────────

const BASE = 'http://waha.test';
const API_KEY = 'test-key';

function makeClient(fetchImpl: typeof fetch, logger?: Logger) {
  return createWahaResearchClient({
    baseUrl: BASE,
    apiKey: API_KEY,
    logger: logger ?? makeLogger(),
    fetchImpl,
    retryConfig: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('WahaResearchClient', () => {
  describe('createSession', () => {
    it('returns ok on 200', async () => {
      const f = makeFetch([{ status: 200, body: { name: 'phone-01', status: 'STARTING' } }]);
      const client = makeClient(f);
      const result = await client.createSession('phone-01');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('phone-01');
        expect(result.value.status).toBe('STARTING');
      }
    });

    it('sends correct headers', async () => {
      const f = makeFetch([{ status: 200, body: { name: 'phone-01', status: 'STARTING' } }]);
      const client = makeClient(f);
      await client.createSession('phone-01');
      const [, callOpts] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect((callOpts.headers as Record<string, string>)['X-Api-Key']).toBe(API_KEY);
      expect((callOpts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('fails immediately on 404 (4xx no retry)', async () => {
      const f = makeFetch([{ status: 404, body: 'not found' }]);
      const client = makeClient(f);
      const result = await client.createSession('phone-01');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('WAHA_SESSION_NOT_WORKING');
      }
      expect((f as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it('retries on 502 and succeeds on 3rd attempt', async () => {
      const f = makeFetch([
        { status: 502 },
        { status: 502 },
        { status: 200, body: { name: 'phone-01', status: 'STARTING' } },
      ]);
      const client = makeClient(f);
      const result = await client.createSession('phone-01');
      expect(result.ok).toBe(true);
      expect((f as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    });

    it('fails with WAHA_UNREACHABLE after exhausting retries on 5xx', async () => {
      const f = makeFetch([{ status: 503 }, { status: 503 }, { status: 503 }]);
      const client = makeClient(f);
      const result = await client.createSession('phone-01');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('WAHA_UNREACHABLE');
      }
      expect((f as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    });
  });

  describe('getSessionQR', () => {
    it('returns qr and status', async () => {
      const f = makeFetch([{ status: 200, body: { qr: 'data:image/png;base64,abc', status: 'SCAN_QR_CODE' } }]);
      const client = makeClient(f);
      const result = await client.getSessionQR('phone-01');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.qr).toBe('data:image/png;base64,abc');
        expect(result.value.status).toBe('SCAN_QR_CODE');
      }
    });
  });

  describe('listSessions', () => {
    it('returns array of sessions', async () => {
      const sessions = [
        { name: 'phone-01', status: 'WORKING' },
        { name: 'phone-02', status: 'SCAN_QR_CODE' },
      ];
      const f = makeFetch([{ status: 200, body: sessions }]);
      const client = makeClient(f);
      const result = await client.listSessions();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.name).toBe('phone-01');
      }
    });
  });

  describe('stopSession', () => {
    it('returns ok on 204', async () => {
      const f = makeFetch([{ status: 204 }]);
      const client = makeClient(f);
      const result = await client.stopSession('phone-01');
      expect(result.ok).toBe(true);
    });
  });

  describe('sendText', () => {
    it('posts to /api/sendText and returns message id', async () => {
      const f = makeFetch([{ status: 200, body: { id: 'msg-001' } }]);
      const client = makeClient(f);
      const result = await client.sendText('phone-01', '+54911234@c.us', 'Hello!');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('msg-001');
      }
      const [url, opts] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/api/sendText`);
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body['session']).toBe('phone-01');
      expect(body['text']).toBe('Hello!');
    });
  });

  describe('configureWebhook', () => {
    it('sends PUT with correct payload', async () => {
      const f = makeFetch([{ status: 200, body: {} }]);
      const client = makeClient(f);
      const result = await client.configureWebhook('phone-01', 'https://api.fomo.com/webhook', 'secret');
      expect(result.ok).toBe(true);
      const [url, opts] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/sessions/phone-01/webhooks');
      expect(opts.method).toBe('PUT');
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body['url']).toBe('https://api.fomo.com/webhook');
      expect((body['hmac'] as Record<string, unknown>)['key']).toBe('secret');
    });
  });

  describe('timeout handling', () => {
    it('returns WAHA_UNREACHABLE on timeout', async () => {
      // Use very short timeout — we override it via monkey-patching
      const f = makeTimeoutFetch();
      // Create client with normal timeout — but the mock fetch never resolves
      // and the real AbortController will fire after REQUEST_TIMEOUT_MS (10s).
      // To avoid slow tests, we abuse the fact that if the signal is already
      // aborted, fetch rejects immediately.
      const client = createWahaResearchClient({
        baseUrl: BASE,
        apiKey: API_KEY,
        logger: makeLogger(),
        fetchImpl: vi.fn(async (_url: RequestInfo | URL, opts?: RequestInit) => {
          // Simulate immediate abort
          const signal = (opts as RequestInit | undefined)?.signal as AbortSignal | undefined;
          if (signal) signal.dispatchEvent(new Event('abort'));
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }),
        retryConfig: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 5 },
      });
      void f; // suppress unused warning
      const result = await client.createSession('phone-01');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('WAHA_UNREACHABLE');
      }
    });
  });

  describe('network error handling', () => {
    it('returns WAHA_UNREACHABLE on network error after retries', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = createWahaResearchClient({
        baseUrl: BASE,
        apiKey: API_KEY,
        logger: makeLogger(),
        fetchImpl,
        retryConfig: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
      });
      const result = await client.listSessions();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('WAHA_UNREACHABLE');
      }
      expect(fetchImpl.mock.calls.length).toBe(2);
    });
  });
});
