import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, ChatEvent, ToolDefinitionForProvider } from './types.js';

// ─── Mock @google/generative-ai ──────────────────────────────────────────────

const mockSendMessageStream = vi.fn();
const mockStartChat = vi.fn();
const mockCountTokens = vi.fn().mockResolvedValue({ totalTokens: 42 });
const mockGetGenerativeModel = vi.fn();

vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel = mockGetGenerativeModel;
  }

  return {
    GoogleGenerativeAI: MockGoogleGenerativeAI,
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
      HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
      HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    },
    HarmBlockThreshold: {
      BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
    },
  };
});

const { createGoogleProvider } = await import('./google.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal async stream from an array of chunks */
function makeStream(chunks: unknown[], finalResponse: unknown) {
  const stream = {
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
  };
  return {
    stream,
    response: Promise.resolve(finalResponse),
  };
}

describe('createGoogleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default model instance mock
    mockGetGenerativeModel.mockReturnValue({
      startChat: mockStartChat,
      countTokens: mockCountTokens,
    });
    mockStartChat.mockReturnValue({ sendMessageStream: mockSendMessageStream });
  });

  const createProvider = () =>
    createGoogleProvider({ apiKey: 'test-key', model: 'gemini-2.0-flash' });

  // ─── Metadata ──────────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('has correct id and displayName', () => {
      const provider = createProvider();
      expect(provider.id).toBe('google:gemini-2.0-flash');
      expect(provider.displayName).toContain('Google');
      expect(provider.displayName).toContain('gemini-2.0-flash');
    });

    it('returns context window from model registry', () => {
      const provider = createProvider();
      expect(provider.getContextWindow()).toBe(1_048_576);
    });

    it('reports tool support', () => {
      const provider = createProvider();
      expect(provider.supportsToolUse()).toBe(true);
    });
  });

  // ─── formatTools ───────────────────────────────────────────────────────────

  describe('formatTools', () => {
    it('converts tool definitions to Google function declaration format', () => {
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

      const toolObj = formatted[0] as { functionDeclarations: unknown[] };
      expect(toolObj.functionDeclarations).toHaveLength(1);

      const fn = toolObj.functionDeclarations[0] as Record<string, unknown>;
      expect(fn['name']).toBe('search');
      expect(fn['description']).toBe('Search the web');
      expect(fn['parameters']).toEqual(tools[0]?.inputSchema);
    });
  });

  // ─── formatToolResult ──────────────────────────────────────────────────────

  describe('formatToolResult', () => {
    it('formats a successful tool result', () => {
      const provider = createProvider();
      const result = provider.formatToolResult({
        toolUseId: 'tool-123',
        content: '{"results": []}',
        isError: false,
      });

      const r = result as Record<string, unknown>;
      expect(r['type']).toBe('tool_result');
      expect(r['toolUseId']).toBe('tool-123');
      expect(r['isError']).toBe(false);
    });

    it('formats an error tool result', () => {
      const provider = createProvider();
      const result = provider.formatToolResult({
        toolUseId: 'tool-456',
        content: 'Something went wrong',
        isError: true,
      });

      const r = result as Record<string, unknown>;
      expect(r['isError']).toBe(true);
    });
  });

  // ─── chat streaming ────────────────────────────────────────────────────────

  describe('chat streaming', () => {
    it('yields message_start, content_delta, and message_end for text responses', async () => {
      const provider = createProvider();

      const chunks = [
        {
          candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
        },
        {
          candidates: [{ content: { parts: [{ text: ' world' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      ];

      mockSendMessageStream.mockResolvedValue(
        makeStream(chunks, {
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      );

      const collected: ChatEvent[] = [];
      for await (const event of provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 1024,
        temperature: 0.7,
      })) {
        collected.push(event);
      }

      expect(collected.some((e) => e.type === 'message_start')).toBe(true);

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

    it('yields tool_use events for function call responses', async () => {
      const provider = createProvider();

      const chunks = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'search',
                      args: { query: 'hello' },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15 },
        },
      ];

      mockSendMessageStream.mockResolvedValue(
        makeStream(chunks, {
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15 },
        }),
      );

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

    it('uses system prompt if provided', async () => {
      const provider = createProvider();

      mockSendMessageStream.mockResolvedValue(
        makeStream(
          [{ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }],
          { usageMetadata: {} },
        ),
      );

      const collected: ChatEvent[] = [];
      for await (const event of provider.chat({
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant.',
        maxTokens: 512,
        temperature: 0.5,
      })) {
        collected.push(event);
      }

      // Verify getGenerativeModel was called with systemInstruction
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.objectContaining({
            parts: [{ text: 'You are a helpful assistant.' }],
          }),
        }),
      );
    });

    it('yields error event on API failure', async () => {
      const provider = createProvider();

      mockSendMessageStream.mockRejectedValue(new Error('API quota exceeded'));

      const collected: ChatEvent[] = [];
      for await (const event of provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 1024,
        temperature: 0.7,
      })) {
        collected.push(event);
      }

      const errorEvent = collected.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === 'error') {
        expect(errorEvent.error.message).toContain('API quota exceeded');
      }
    });
  });

  // ─── countTokens ───────────────────────────────────────────────────────────

  describe('countTokens', () => {
    it('uses the Google token counting API', async () => {
      const provider = createProvider();
      const messages: Message[] = [{ role: 'user', content: 'Hello world' }];
      const count = await provider.countTokens(messages);
      expect(count).toBe(42);
    });

    it('falls back to char estimation on API failure', async () => {
      mockGetGenerativeModel.mockReturnValue({
        startChat: mockStartChat,
        countTokens: vi.fn().mockRejectedValue(new Error('quota exceeded')),
      });

      const provider = createProvider();
      const messages: Message[] = [{ role: 'user', content: 'Hello' }]; // 5 chars → ~2 tokens
      const count = await provider.countTokens(messages);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });
  });
});
