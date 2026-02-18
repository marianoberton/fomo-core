/**
 * Tests for the web-search tool (Tavily API).
 * 3 levels: schema validation, dry-run, execution (with mocked fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSearchTool } from './web-search.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { SecretService } from '@/secrets/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockSecretService(overrides?: Partial<SecretService>): SecretService {
  return {
    set: vi.fn(),
    get: vi.fn(() => Promise.resolve('tvly-test-key')),
    list: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve(false)),
    exists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

const context = createTestContext({ allowedTools: ['web-search'] });

// ─── Tests ──────────────────────────────────────────────────────

describe('web-search tool', () => {
  // ─── Level 1: Schema Validation ─────────────────────────────

  describe('schema validation', () => {
    const tool = createWebSearchTool({
      secretService: createMockSecretService(),
    });

    it('accepts a valid query', () => {
      const result = tool.inputSchema.safeParse({ query: 'weather in Buenos Aires' });
      expect(result.success).toBe(true);
    });

    it('accepts query with maxResults', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', maxResults: 3 });
      expect(result.success).toBe(true);
    });

    it('rejects empty query', () => {
      const result = tool.inputSchema.safeParse({ query: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing query', () => {
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects maxResults above 10', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', maxResults: 11 });
      expect(result.success).toBe(false);
    });

    it('rejects maxResults below 1', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', maxResults: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer maxResults', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', maxResults: 2.5 });
      expect(result.success).toBe(false);
    });

    it('defaults maxResults to 5', () => {
      const result = tool.inputSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as { maxResults: number };
        expect(data.maxResults).toBe(5);
      }
    });
  });

  // ─── Level 2: Dry Run ──────────────────────────────────────

  describe('dry run', () => {
    it('returns success with apiKeyConfigured=true when secret exists', async () => {
      const tool = createWebSearchTool({
        secretService: createMockSecretService({ exists: vi.fn(() => Promise.resolve(true)) }),
      });

      const result = await tool.dryRun({ query: 'test query' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['apiKeyConfigured']).toBe(true);
        expect(output['query']).toBe('test query');
      }
    });

    it('returns apiKeyConfigured=false when secret is missing', async () => {
      const tool = createWebSearchTool({
        secretService: createMockSecretService({ exists: vi.fn(() => Promise.resolve(false)) }),
      });

      const result = await tool.dryRun({ query: 'test query' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['apiKeyConfigured']).toBe(false);
      }
    });
  });

  // ─── Level 3: Execution ────────────────────────────────────

  describe('execution', () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      fetchMock.mockReset();
    });

    it('calls Tavily API and returns results', async () => {
      const tool = createWebSearchTool({
        secretService: createMockSecretService(),
      });

      const tavilyResponse = {
        results: [
          { title: 'Result 1', url: 'https://example.com', content: 'Snippet 1', score: 0.95 },
          { title: 'Result 2', url: 'https://example.org', content: 'Snippet 2', score: 0.87 },
        ],
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(tavilyResponse), { status: 200 }),
      );

      const result = await tool.execute({ query: 'test query', maxResults: 5 }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { results: unknown[]; query: string };
        expect(output.results).toHaveLength(2);
        expect(output.query).toBe('test query');
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.tavily.com/search');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['api_key']).toBe('tvly-test-key');
      expect(body['query']).toBe('test query');
      expect(body['max_results']).toBe(5);
    });

    it('returns error when Tavily API responds with error status', async () => {
      const tool = createWebSearchTool({
        secretService: createMockSecretService(),
      });

      fetchMock.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      const result = await tool.execute({ query: 'test' }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('401');
      }
    });

    it('returns error when secret is not found', async () => {
      const tool = createWebSearchTool({
        secretService: createMockSecretService({
          get: vi.fn(() => Promise.reject(new Error('Secret not found: TAVILY_API_KEY'))),
        }),
      });

      const result = await tool.execute({ query: 'test' }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('TAVILY_API_KEY');
      }
    });

    it('handles empty results', async () => {
      const tool = createWebSearchTool({
        secretService: createMockSecretService(),
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );

      const result = await tool.execute({ query: 'obscure query' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { results: unknown[] };
        expect(output.results).toHaveLength(0);
      }
    });
  });
});
