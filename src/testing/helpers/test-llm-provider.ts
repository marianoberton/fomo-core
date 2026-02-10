/**
 * Mock LLM provider for testing.
 * Provides configurable responses without real API calls.
 */
import type { LLMProvider, ChatParams, ChatEvent, Message, ToolDefinition } from '@/providers/types.js';

/** Configuration for mock LLM provider. */
export interface MockLLMProviderConfig {
  /** Predefined text responses to return. */
  responses?: string[];
  /** Predefined tool calls to return. */
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  /** Usage tokens to report. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Whether to simulate streaming delay. */
  simulateDelay?: boolean;
  /** Delay between chunks in ms. */
  delayMs?: number;
}

/**
 * Create a mock LLM provider for testing.
 * Simulates streaming responses without calling real APIs.
 *
 * @param config - Mock provider configuration.
 * @returns Mock LLM provider instance.
 */
export function createMockLLMProvider(config?: MockLLMProviderConfig): LLMProvider {
  const {
    responses = ['Mock response from test provider.'],
    toolCalls = [],
    usage = { inputTokens: 10, outputTokens: 20 },
    simulateDelay = false,
    delayMs = 10,
  } = config || {};

  return {
    id: 'mock:test-provider',
    displayName: 'Mock Test Provider',

    /**
     * Simulate streaming chat response.
     * Yields text chunks, tool calls, and usage.
     */
    async *chat(params: ChatParams): AsyncGenerator<ChatEvent> {
      void params; // Unused in mock

      // Yield message start
      yield {
        type: 'message_start',
        message: {
          id: 'mock-msg-1',
          role: 'assistant',
          content: [],
        },
      };

      // Yield text response as chunks
      const responseText = responses[0] || '';
      const words = responseText.split(' ');

      for (const word of words) {
        if (simulateDelay) {
          await delay(delayMs);
        }

        yield {
          type: 'content_delta',
          delta: {
            type: 'text',
            text: word + ' ',
          },
        };
      }

      // Yield tool calls if configured
      for (const toolCall of toolCalls) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          },
        };
      }

      // Yield usage
      yield {
        type: 'usage',
        usage,
      };

      // Yield message end
      yield {
        type: 'message_end',
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      };
    },

    /**
     * Mock token counting.
     * Returns estimated count based on string length.
     */
    countTokens: async (messages: Message[]): Promise<number> => {
      const totalChars = messages.reduce((sum, msg) => {
        if (typeof msg.content === 'string') {
          return sum + msg.content.length;
        }
        return sum;
      }, 0);
      return Math.ceil(totalChars / 4); // Rough estimate: 4 chars per token
    },

    /**
     * Get mock context window.
     */
    getContextWindow: (): number => {
      return 200_000;
    },

    /**
     * Reports tool support.
     */
    supportsToolUse: (): boolean => {
      return true;
    },

    /**
     * Format tools (pass-through for mock).
     */
    formatTools: (tools: ToolDefinition[]): unknown[] => {
      return tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.id,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    },

    /**
     * Format tool result (pass-through for mock).
     */
    formatToolResult: (result: { toolCallId: string; output: unknown; error?: string }): unknown => {
      return {
        type: 'tool_result',
        tool_call_id: result.toolCallId,
        content: result.error || JSON.stringify(result.output),
      };
    },
  };
}

/**
 * Helper to introduce delay in async generator.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
