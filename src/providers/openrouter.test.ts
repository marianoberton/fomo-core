import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatEvent, ToolDefinitionForProvider } from './types.js';

// Mock the OpenAI SDK (OpenRouter reuses it with different base URL)
const mockCreate = vi.fn();
let capturedClientOptions: { baseURL?: string; defaultHeaders?: Record<string, string> } = {};

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    static APIError = class APIError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = 'APIError';
      }
    };
    constructor(options: { baseURL?: string; defaultHeaders?: Record<string, string> }) {
      capturedClientOptions = options;
    }
  }
  return { default: MockOpenAI };
});

const { createOpenRouterProvider } = await import('./openrouter.js');

// ─── Helpers ────────────────────────────────────────────────────

function makeProvider(model = 'openai/gpt-4o-mini') {
  return createOpenRouterProvider({ apiKey: 'or-test-key', model });
}

async function* makeStream(
  chunks: object[],
): AsyncGenerator<object> {
  for (const chunk of chunks) yield chunk;
}

function collectEvents(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  return (async () => {
    const events: ChatEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
  })();
}

// ─── Tests ──────────────────────────────────────────────────────

describe('createOpenRouterProvider', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    capturedClientOptions = {};
  });

  // ── Client setup ────────────────────────────────────────────

  describe('client setup', () => {
    it('points to OpenRouter base URL', () => {
      makeProvider();
      expect(capturedClientOptions.baseURL).toBe('https://openrouter.ai/api/v1');
    });

    it('sets required OpenRouter headers', () => {
      makeProvider();
      expect(capturedClientOptions.defaultHeaders?.['HTTP-Referer']).toBeTruthy();
      expect(capturedClientOptions.defaultHeaders?.['X-Title']).toBe('Nexus Core');
    });

    it('uses custom siteUrl and siteName when provided', () => {
      createOpenRouterProvider({
        apiKey: 'key',
        model: 'openai/gpt-4o',
        siteUrl: 'https://myclient.com',
        siteName: 'MyApp',
      });
      expect(capturedClientOptions.defaultHeaders?.['HTTP-Referer']).toBe('https://myclient.com');
      expect(capturedClientOptions.defaultHeaders?.['X-Title']).toBe('MyApp');
    });
  });

  // ── Metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('builds correct id and displayName', () => {
      const p = makeProvider('anthropic/claude-haiku-4-5');
      expect(p.id).toBe('openrouter:anthropic/claude-haiku-4-5');
      expect(p.displayName).toBe('OpenRouter anthropic/claude-haiku-4-5');
    });

    it('returns known context window for registered model', () => {
      const p = makeProvider('openai/gpt-4o');
      expect(p.getContextWindow()).toBe(128_000);
    });

    it('falls back to conservative defaults for unknown model', () => {
      const p = makeProvider('unknown-provider/unknown-model');
      expect(p.getContextWindow()).toBe(8_192);
    });

    it('reports tool support for standard models', () => {
      expect(makeProvider('openai/gpt-4o-mini').supportsToolUse()).toBe(true);
    });
  });

  // ── formatTools ─────────────────────────────────────────────

  describe('formatTools', () => {
    it('formats tool definitions in OpenAI function-calling format', () => {
      const tools: ToolDefinitionForProvider[] = [{
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      }];
      const formatted = makeProvider().formatTools(tools);
      expect(formatted).toHaveLength(1);
      const tool = formatted[0] as { type: string; function: { name: string } };
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBe('search');
    });
  });

  // ── formatToolResult ─────────────────────────────────────────

  describe('formatToolResult', () => {
    it('formats successful tool result', () => {
      const result = makeProvider().formatToolResult({
        toolUseId: 'call_123',
        content: 'Paris',
        isError: false,
      });
      expect(result).toMatchObject({ role: 'tool', tool_call_id: 'call_123', content: 'Paris' });
    });

    it('prefixes error results with Error:', () => {
      const result = makeProvider().formatToolResult({
        toolUseId: 'call_456',
        content: 'timeout',
        isError: true,
      });
      expect((result as { content: string }).content).toMatch(/^Error:/);
    });
  });

  // ── chat — text streaming ───────────────────────────────────

  describe('chat — text streaming', () => {
    it('yields message_start, content_delta, and message_end', async () => {
      mockCreate.mockResolvedValue(makeStream([
        { id: 'or-msg-1', choices: [{ delta: { content: 'Hola' }, finish_reason: null }], usage: null },
        { id: 'or-msg-1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
        { id: 'or-msg-1', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      ]));

      const events = await collectEvents(makeProvider().chat({
        messages: [{ role: 'user', content: '¿Hola?' }],
        maxTokens: 100,
        temperature: 0,
      }));

      expect(events[0]).toMatchObject({ type: 'message_start', messageId: 'or-msg-1' });
      expect(events[1]).toMatchObject({ type: 'content_delta', text: 'Hola' });
      const end = events.at(-1) as { type: string; usage: { inputTokens: number; outputTokens: number } };
      expect(end.type).toBe('message_end');
      expect(end.usage.inputTokens).toBe(10);
      expect(end.usage.outputTokens).toBe(5);
    });

    it('logs cost when OpenRouter returns total_cost in usage', async () => {
      mockCreate.mockResolvedValue(makeStream([
        { id: 'or-msg-2', choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
        {
          id: 'or-msg-2',
          choices: [],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_cost: 0.00045 },
        },
      ]));

      // Should not throw — cost is logged at debug level
      const events = await collectEvents(makeProvider().chat({
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 50,
        temperature: 0,
      }));

      const end = events.at(-1) as { type: string; usage: object };
      expect(end.type).toBe('message_end');
    });
  });

  // ── chat — model override (ModelRouter) ─────────────────────

  describe('chat — model override', () => {
    it('uses params.model when provided, ignoring constructor model', async () => {
      mockCreate.mockResolvedValue(makeStream([
        { id: 'id', choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
        { id: 'id', choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      ]));

      await collectEvents(makeProvider('openai/gpt-4o').chat({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 50,
        temperature: 0,
        model: 'meta-llama/llama-3.3-70b-instruct',
      }));

      const callArg = mockCreate.mock.calls[0]?.[0] as { model: string };
      expect(callArg.model).toBe('meta-llama/llama-3.3-70b-instruct');
    });
  });

  // ── chat — tool calls ────────────────────────────────────────

  describe('chat — tool calls', () => {
    it('assembles tool_use events from streaming deltas', async () => {
      mockCreate.mockResolvedValue(makeStream([
        {
          id: 'or-3',
          choices: [{
            delta: { tool_calls: [{ index: 0, id: 'call_abc', function: { name: 'calculator', arguments: '' } }] },
            finish_reason: null,
          }],
          usage: null,
        },
        {
          id: 'or-3',
          choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"expr":"1+1"}' } }] },
            finish_reason: null,
          }],
          usage: null,
        },
        {
          id: 'or-3',
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: null,
        },
        { id: 'or-3', choices: [], usage: { prompt_tokens: 20, completion_tokens: 15 } },
      ]));

      const events = await collectEvents(makeProvider().chat({
        messages: [{ role: 'user', content: 'calculate 1+1' }],
        maxTokens: 200,
        temperature: 0,
      }));

      const start = events.find((e) => e.type === 'tool_use_start') as { type: string; name: string };
      const end = events.find((e) => e.type === 'tool_use_end') as { type: string; input: object };
      const msgEnd = events.at(-1) as { type: string; stopReason: string };

      expect(start.name).toBe('calculator');
      expect(end.input).toEqual({ expr: '1+1' });
      expect(msgEnd.stopReason).toBe('tool_use');
    });
  });

  // ── countTokens ──────────────────────────────────────────────

  describe('countTokens', () => {
    it('estimates tokens from message character count', async () => {
      const count = await makeProvider().countTokens([
        { role: 'user', content: 'Hello world' }, // 11 chars → ~3 tokens
      ]);
      expect(count).toBeGreaterThan(0);
    });
  });
});
