import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatEvent, ToolDefinitionForProvider } from './types.js';

// Mock the OpenAI SDK
const mockCreate = vi.fn();
vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
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
  return { default: MockOpenAI };
});

const { createOpenAIProvider } = await import('./openai.js');

describe('createOpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createProvider = (overrides?: { model?: string; providerLabel?: string }): ReturnType<typeof createOpenAIProvider> => {
    return createOpenAIProvider({
      apiKey: 'test-key',
      model: overrides?.model ?? 'gpt-4o',
      providerLabel: overrides?.providerLabel,
    });
  };

  describe('metadata', () => {
    it('has correct id and displayName', () => {
      const provider = createProvider();
      expect(provider.id).toBe('openai:gpt-4o');
      expect(provider.displayName).toContain('Openai');
    });

    it('uses custom provider label', () => {
      const provider = createProvider({ providerLabel: 'google' });
      expect(provider.id).toBe('google:gpt-4o');
      expect(provider.displayName).toContain('Google');
    });

    it('returns known context window for gpt-4o', () => {
      const provider = createProvider();
      expect(provider.getContextWindow()).toBe(128_000);
    });

    it('reports tool support', () => {
      const provider = createProvider();
      expect(provider.supportsToolUse()).toBe(true);
    });
  });

  describe('formatTools', () => {
    it('converts tool definitions to OpenAI function calling format', () => {
      const provider = createProvider();
      const tools: ToolDefinitionForProvider[] = [
        {
          name: 'calculator',
          description: 'Perform math',
          inputSchema: {
            type: 'object',
            properties: { expression: { type: 'string' } },
            required: ['expression'],
          },
        },
      ];

      const formatted = provider.formatTools(tools);
      expect(formatted).toHaveLength(1);

      const tool = formatted[0] as Record<string, unknown>;
      expect(tool['type']).toBe('function');

      const fn = tool['function'] as Record<string, unknown>;
      expect(fn['name']).toBe('calculator');
      expect(fn['description']).toBe('Perform math');
      expect(fn['parameters']).toEqual(tools[0]?.inputSchema);
    });
  });

  describe('formatToolResult', () => {
    it('formats a successful tool result', () => {
      const provider = createProvider();
      const result = provider.formatToolResult({
        toolUseId: 'call_123',
        content: '42',
        isError: false,
      });

      const r = result as Record<string, unknown>;
      expect(r['role']).toBe('tool');
      expect(r['tool_call_id']).toBe('call_123');
      expect(r['content']).toBe('42');
    });

    it('prefixes error results', () => {
      const provider = createProvider();
      const result = provider.formatToolResult({
        toolUseId: 'call_456',
        content: 'Division by zero',
        isError: true,
      });

      const r = result as Record<string, unknown>;
      expect(r['content']).toBe('Error: Division by zero');
    });
  });

  describe('chat streaming', () => {
    it('yields content_delta events for text responses', async () => {
      const provider = createProvider();

      const chunks = [
        { id: 'chatcmpl-001', choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
        { id: 'chatcmpl-001', choices: [{ delta: { content: ' world' }, finish_reason: null }] },
        {
          id: 'chatcmpl-001',
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      ];

      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: () => {
              if (i < chunks.length) {
                return Promise.resolve({ value: chunks[i++], done: false });
              }
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
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
      if (messageEnd?.type === 'message_end') {
        expect(messageEnd.stopReason).toBe('end_turn');
        expect(messageEnd.usage.inputTokens).toBe(10);
        expect(messageEnd.usage.outputTokens).toBe(5);
      }
    });

    it('yields tool_use events for function calls', async () => {
      const provider = createProvider();

      const chunks = [
        {
          id: 'chatcmpl-002',
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_001', function: { name: 'search', arguments: '' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-002',
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"query":' } }],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-002',
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-002',
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 20, completion_tokens: 15 },
        },
      ];

      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: () => {
              if (i < chunks.length) {
                return Promise.resolve({ value: chunks[i++], done: false });
              }
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
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
        expect(toolStart.id).toBe('call_001');
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
    it('estimates tokens based on character count', async () => {
      const provider = createProvider();
      const count = await provider.countTokens([
        { role: 'user', content: 'Hello world' }, // 11 chars -> ~3 tokens
      ]);
      expect(count).toBeGreaterThan(0);
      expect(count).toBe(Math.ceil(11 / 4));
    });

    it('handles structured content in token counting', async () => {
      const provider = createProvider();
      const count = await provider.countTokens([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Use the tool' },
            { type: 'tool_result', toolUseId: 'tu_1', content: 'result data' },
          ],
        },
      ]);
      expect(count).toBeGreaterThan(0);
    });
  });
});
