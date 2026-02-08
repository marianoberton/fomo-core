import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHttpRequestTool } from './http-request.js';
import { createTestContext } from '@/testing/fixtures/context.js';

const context = createTestContext({ allowedTools: ['http-request'] });

describe('http-request', () => {
  describe('schema validation', () => {
    const tool = createHttpRequestTool();

    it('accepts a valid GET request', () => {
      const result = tool.inputSchema.safeParse({
        url: 'https://api.example.com/data',
        method: 'GET',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a POST with body and headers', () => {
      const result = tool.inputSchema.safeParse({
        url: 'https://api.example.com/data',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { key: 'value' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts custom timeout', () => {
      const result = tool.inputSchema.safeParse({
        url: 'https://api.example.com/data',
        method: 'GET',
        timeout: 5000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing url', () => {
      const result = tool.inputSchema.safeParse({ method: 'GET' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid url', () => {
      const result = tool.inputSchema.safeParse({ url: 'not-a-url', method: 'GET' });
      expect(result.success).toBe(false);
    });

    it('rejects missing method', () => {
      const result = tool.inputSchema.safeParse({ url: 'https://example.com' });
      expect(result.success).toBe(false);
    });

    it('rejects unsupported method', () => {
      const result = tool.inputSchema.safeParse({
        url: 'https://example.com',
        method: 'OPTIONS',
      });
      expect(result.success).toBe(false);
    });

    it('rejects timeout exceeding max', () => {
      const result = tool.inputSchema.safeParse({
        url: 'https://example.com',
        method: 'GET',
        timeout: 120_000,
      });
      expect(result.success).toBe(false);
    });

    it('rejects timeout below minimum', () => {
      const result = tool.inputSchema.safeParse({
        url: 'https://example.com',
        method: 'GET',
        timeout: 100,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dry run', () => {
    const tool = createHttpRequestTool();

    it('validates and returns request details without sending', async () => {
      const result = await tool.dryRun(
        { url: 'https://api.example.com/data', method: 'POST', body: { key: 'val' } },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['method']).toBe('POST');
        expect(output['url']).toBe('https://api.example.com/data');
        expect(output['hasBody']).toBe(true);
      }
    });

    it('blocks private IPs in dry run', async () => {
      const result = await tool.dryRun(
        { url: 'http://192.168.1.1/admin', method: 'GET' },
        context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toContain('Blocked host');
      }
    });

    it('blocks localhost in dry run', async () => {
      const result = await tool.dryRun(
        { url: 'http://localhost:8080/api', method: 'GET' },
        context,
      );
      expect(result.ok).toBe(false);
    });

    it('blocks 10.x.x.x in dry run', async () => {
      const result = await tool.dryRun(
        { url: 'http://10.0.0.1/internal', method: 'GET' },
        context,
      );
      expect(result.ok).toBe(false);
    });

    it('blocks 127.x.x.x in dry run', async () => {
      const result = await tool.dryRun(
        { url: 'http://127.0.0.1:3000/api', method: 'GET' },
        context,
      );
      expect(result.ok).toBe(false);
    });

    it('blocks 169.254.x.x (link-local) in dry run', async () => {
      const result = await tool.dryRun(
        { url: 'http://169.254.169.254/latest/meta-data/', method: 'GET' },
        context,
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('URL allowlist', () => {
    const tool = createHttpRequestTool({
      allowedUrlPatterns: ['https://api.example.com/*', 'https://cdn.example.com/*'],
    });

    it('allows matching URL', async () => {
      const result = await tool.dryRun(
        { url: 'https://api.example.com/v1/data', method: 'GET' },
        context,
      );
      expect(result.ok).toBe(true);
    });

    it('blocks non-matching URL', async () => {
      const result = await tool.dryRun(
        { url: 'https://evil.com/steal', method: 'GET' },
        context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not in allowlist');
      }
    });
  });

  describe('execution', () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      fetchMock.mockReset();
    });

    it('makes a GET request and returns response', async () => {
      const tool = createHttpRequestTool();
      const mockHeaders = new Headers({ 'content-type': 'application/json' });
      const mockBody = JSON.stringify({ data: 'test' });

      fetchMock.mockResolvedValueOnce(
        new Response(mockBody, { status: 200, headers: mockHeaders }),
      );

      const result = await tool.execute(
        { url: 'https://api.example.com/data', method: 'GET' },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as {
          status: number;
          body: unknown;
          headers: Record<string, string>;
        };
        expect(output.status).toBe(200);
        expect(output.body).toEqual({ data: 'test' });
        expect(output.headers['content-type']).toBe('application/json');
      }
    });

    it('makes a POST request with body', async () => {
      const tool = createHttpRequestTool();

      fetchMock.mockResolvedValueOnce(
        new Response('{"created":true}', { status: 201 }),
      );

      const result = await tool.execute(
        {
          url: 'https://api.example.com/create',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { name: 'test' },
        },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { status: number };
        expect(output.status).toBe(201);
      }

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/create',
        expect.objectContaining({
          method: 'POST',
          body: '{"name":"test"}',
        }),
      );
    });

    it('returns text body when JSON parsing fails', async () => {
      const tool = createHttpRequestTool();

      fetchMock.mockResolvedValueOnce(
        new Response('plain text response', { status: 200 }),
      );

      const result = await tool.execute(
        { url: 'https://api.example.com/text', method: 'GET' },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { body: string };
        expect(output.body).toBe('plain text response');
      }
    });

    it('blocks SSRF attempt to private IP', async () => {
      const tool = createHttpRequestTool();

      const result = await tool.execute(
        { url: 'http://192.168.1.1/admin', method: 'GET' },
        context,
      );

      expect(result.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns error on fetch failure', async () => {
      const tool = createHttpRequestTool();

      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await tool.execute(
        { url: 'https://api.example.com/fail', method: 'GET' },
        context,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toContain('Network error');
      }
    });

    it('includes durationMs in output', async () => {
      const tool = createHttpRequestTool();

      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const result = await tool.execute(
        { url: 'https://api.example.com/data', method: 'GET' },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
