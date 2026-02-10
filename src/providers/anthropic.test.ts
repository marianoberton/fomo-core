import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, ChatEvent, ToolDefinitionForProvider } from './types.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: mockCreate,
      countTokens: vi.fn().mockResolvedValue({ input_tokens: 42 }),
    };
    static APIError = class APIError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = 'APIError';
      }
    };
  }
  return { default: MockAnthropic };
});

const { createAnthropicProvider } = await import('./anthropic.js');

describe('createAnthropicProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createProvider = (): ReturnType<typeof createAnthropicProvider> => {
    return createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5-20250929',
    });
  };

  describe('metadata', () => {
    it('has correct id and displayName', () => {
      const provider = createProvider();
      expect(provider.id).toBe('anthropic:claude-sonnet-4-5-20250929');
      expect(provider.displayName).toContain('Anthropic');
    });

    it('returns known context window', () => {
      const provider = createProvider();
      expect(provider.getContextWindow()).toBe(1_000_000);
    });

    it('reports tool support', () => {
      const provider = createProvider();
      expect(provider.supportsToolUse()).toBe(true);
    });
  });

  describe('formatTools', () => {
    it('converts tool definitions to Anthropic format', () => {
      const provider = createProvider();
      const tools: ToolDefinitionForProvider[] = [
        {
          name: 'search',
          description: 'Search the web',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ];

      const formatted = provider.formatTools(tools);
      expect(formatted).toHaveLength(1);

      const tool = formatted[0] as Record<string, unknown>;
      expect(tool['name']).toBe('search');
      expect(tool['description']).toBe('Search the web');
      expect(tool['input_schema']).toEqual(tools[0]?.inputSchema);
    });
  });

  describe('formatToolResult', () => {
    it('formats a successful tool result', () => {
      const provider = createProvider();
      const result = provider.formatToolResult({
        toolUseId: 'tu_123',
        content: '{"results": []}',
        isError: false,
      });

      const r = result as Record<string, unknown>;
      expect(r['type']).toBe('tool_result');
      expect(r['tool_use_id']).toBe('tu_123');
      expect(r['is_error']).toBe(false);
    });

    it('formats an error tool result', () => {
      const provider = createProvider();
      const result = provider.formatToolResult({
        toolUseId: 'tu_456',
        content: 'Something went wrong',
        isError: true,
      });

      const r = result as Record<string, unknown>;
      expect(r['is_error']).toBe(true);
    });
  });

  describe('chat streaming', () => {
    it('yields content_delta events for text responses', async () => {
      const provider = createProvider();

      const events = [
        { type: 'message_start', message: { id: 'msg_001' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
        { type: 'message_stop' },
      ];

      mockCreate.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: () => {
              if (i < events.length) {
                return Promise.resolve({ value: events[i++], done: false });
              }
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
        finalMessage: () =>
          Promise.resolve({
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      });

      const collected: ChatEvent[] = [];
      for await (const event of provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 1024,
        temperature: 0.7,
      })) {
        collected.push(event);
      }

      expect(collected.some((e) => e.type === 'message_start')).toBe(true);
      expect(collected.some((e) => e.type === 'content_delta')).toBe(true);
      expect(collected.some((e) => e.type === 'message_end')).toBe(true);

      const textDeltas = collected.filter((e) => e.type === 'content_delta');
      expect(textDeltas).toHaveLength(2);

      const messageEnd = collected.find((e) => e.type === 'message_end');
      expect(messageEnd).toBeDefined();
      if (messageEnd?.type === 'message_end') {
        expect(messageEnd.stopReason).toBe('end_turn');
        expect(messageEnd.usage.inputTokens).toBe(10);
        expect(messageEnd.usage.outputTokens).toBe(5);
      }
    });

    it('yields tool_use events for tool calls', async () => {
      const provider = createProvider();

      const events = [
        { type: 'message_start', message: { id: 'msg_002' } },
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tu_001', name: 'search' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"query":' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '"hello"}' },
        },
        { type: 'content_block_stop' },
        { type: 'message_stop' },
      ];

      mockCreate.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: () => {
              if (i < events.length) {
                return Promise.resolve({ value: events[i++], done: false });
              }
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
        finalMessage: () =>
          Promise.resolve({
            stop_reason: 'tool_use',
            usage: { input_tokens: 20, output_tokens: 15 },
          }),
      });

      const collected: ChatEvent[] = [];
      for await (const event of provider.chat({
        messages: [{ role: 'user', content: 'Search for hello' }],
        maxTokens: 1024,
        temperature: 0.7,
      })) {
        collected.push(event);
      }

      const toolStart = collected.find((e) => e.type === 'tool_use_start');
      expect(toolStart).toBeDefined();
      if (toolStart?.type === 'tool_use_start') {
        expect(toolStart.id).toBe('tu_001');
        expect(toolStart.name).toBe('search');
      }

      const toolEnd = collected.find((e) => e.type === 'tool_use_end');
      expect(toolEnd).toBeDefined();
      if (toolEnd?.type === 'tool_use_end') {
        expect(toolEnd.input).toEqual({ query: 'hello' });
      }

      const messageEnd = collected.find((e) => e.type === 'message_end');
      if (messageEnd?.type === 'message_end') {
        expect(messageEnd.stopReason).toBe('tool_use');
      }
    });
  });

  describe('countTokens', () => {
    it('uses the Anthropic token counting API', async () => {
      const provider = createProvider();
      const messages: Message[] = [{ role: 'user', content: 'Hello world' }];
      const count = await provider.countTokens(messages);
      expect(count).toBe(42);
    });
  });

  describe('message conversion', () => {
    it('handles messages with tool_result content', async () => {
      const provider = createProvider();

      // Set up a minimal stream mock for the message conversion to be tested
      mockCreate.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ value: undefined, done: true }),
        }),
        finalMessage: () =>
          Promise.resolve({
            stop_reason: 'end_turn',
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
      });

      const messages: Message[] = [
        { role: 'user', content: 'Use the search tool' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_001', name: 'search', input: { query: 'test' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'tu_001', content: 'Found results', isError: false },
          ],
        },
      ];

      // Just verify it doesn't throw during conversion
      const gen = provider.chat({
        messages,
        maxTokens: 1024,
        temperature: 0.7,
      });

      // Consume the generator
      const collected: ChatEvent[] = [];
      for await (const event of gen) {
        collected.push(event);
      }

      // Verify the stream was called (message conversion succeeded)
      expect(mockCreate).toHaveBeenCalled();
    });
  });
});
