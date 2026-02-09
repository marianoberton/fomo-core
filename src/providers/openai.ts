/**
 * OpenAI LLM provider adapter.
 * Wraps the openai SDK to implement the LLMProvider interface.
 * Also usable for OpenAI-compatible APIs (Ollama, etc.) via baseUrl.
 */
import OpenAI from 'openai';

import { ProviderError } from '@/core/errors.js';
import { createLogger } from '@/observability/logger.js';
import { getModelMeta } from './models.js';
import type {
  ChatEvent,
  ChatParams,
  LLMProvider,
  Message,
  ToolDefinitionForProvider,
} from './types.js';

const logger = createLogger({ name: 'openai-provider' });

/** Configuration for the OpenAI provider. */
export interface OpenAIProviderOptions {
  /** API key. Resolved from env at construction time. */
  apiKey: string;
  /** Model identifier (e.g. 'gpt-4o'). */
  model: string;
  /** Custom base URL (for Ollama, proxies, etc.). */
  baseUrl?: string;
  /** Provider label for logging/display. Defaults to 'openai'. */
  providerLabel?: string;
}

/**
 * Convert our internal Message format to OpenAI's chat completion format.
 */
function toOpenAIMessages(
  messages: Message[],
  systemPrompt?: string,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : '' });
      continue;
    }

    if (typeof msg.content === 'string') {
      if (msg.role === 'assistant') {
        result.push({ role: 'assistant', content: msg.content });
      } else {
        result.push({ role: 'user', content: msg.content });
      }
      continue;
    }

    // Handle structured content
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
    const textParts: string[] = [];
    const toolResults: { toolCallId: string; content: string }[] = [];

    for (const part of msg.content) {
      switch (part.type) {
        case 'text':
          textParts.push(part.text);
          break;
        case 'tool_use':
          toolCalls.push({
            id: part.id,
            type: 'function',
            function: {
              name: part.name,
              arguments: JSON.stringify(part.input),
            },
          });
          break;
        case 'tool_result':
          toolResults.push({
            toolCallId: part.toolUseId,
            content: part.content,
          });
          break;
      }
    }

    // Assistant message with possible tool calls
    if (msg.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: textParts.join('') === '' ? null : textParts.join(''),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else if (toolResults.length > 0) {
      // Tool results are individual "tool" role messages in OpenAI's format
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          tool_call_id: tr.toolCallId,
          content: tr.content,
        });
      }
    } else {
      result.push({ role: 'user', content: textParts.join('') });
    }
  }

  return result;
}

/**
 * Format tool definitions for the OpenAI function calling API.
 */
function toOpenAITools(
  tools: ToolDefinitionForProvider[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * OpenAI provider implementing the LLMProvider interface.
 */
export function createOpenAIProvider(options: OpenAIProviderOptions): LLMProvider {
  const label = options.providerLabel ?? 'openai';
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
  });
  const meta = getModelMeta(options.model);

  return {
    id: `${label}:${options.model}`,
    displayName: `${label.charAt(0).toUpperCase()}${label.slice(1)} ${options.model}`,

    async *chat(params: ChatParams): AsyncGenerator<ChatEvent> {
      const openaiMessages = toOpenAIMessages(params.messages, params.systemPrompt);
      const tools = params.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;

      logger.debug('Starting OpenAI chat stream', {
        component: label,
        model: options.model,
        messageCount: openaiMessages.length,
        hasTools: !!tools?.length,
        traceId: params.traceId,
      });

      try {
        const stream = await client.chat.completions.create({
          model: options.model,
          messages: openaiMessages,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          stream: true,
          ...(tools?.length ? { tools } : {}),
          ...(params.stopSequences?.length ? { stop: params.stopSequences } : {}),
        });

        let messageId = '';
        // Track tool calls being assembled from deltas
        const toolCallBuffers = new Map<number, {
          id: string;
          name: string;
          argumentsJson: string;
        }>();

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice) continue;

          // First chunk has the message ID
          if (chunk.id && !messageId) {
            messageId = chunk.id;
            yield { type: 'message_start', messageId };
          }

          const delta = choice.delta;

          // Text content
          if (delta.content) {
            yield { type: 'content_delta', text: delta.content };
          }

          // Tool call deltas
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              let buffer = toolCallBuffers.get(idx);

              if (!buffer && tc.id) {
                buffer = { id: tc.id, name: tc.function?.name ?? '', argumentsJson: '' };
                toolCallBuffers.set(idx, buffer);
                yield { type: 'tool_use_start', id: buffer.id, name: buffer.name };
              }

              if (buffer && tc.function?.arguments) {
                buffer.argumentsJson += tc.function.arguments;
                yield {
                  type: 'tool_use_delta',
                  id: buffer.id,
                  partialInput: tc.function.arguments,
                };
              }
            }
          }

          // Stream end
          if (choice.finish_reason) {
            // Flush all pending tool calls
            for (const [, buffer] of toolCallBuffers) {
              let parsedInput: Record<string, unknown> = {};
              try {
                parsedInput = JSON.parse(buffer.argumentsJson ? buffer.argumentsJson : '{}') as unknown as Record<string, unknown>;
              } catch {
                logger.warn('Failed to parse tool call arguments', {
                  component: label,
                  toolId: buffer.id,
                  toolName: buffer.name,
                });
              }
              yield { type: 'tool_use_end', id: buffer.id, name: buffer.name, input: parsedInput };
            }
            toolCallBuffers.clear();

            const stopReason = choice.finish_reason === 'tool_calls'
              ? 'tool_use' as const
              : choice.finish_reason === 'length'
                ? 'max_tokens' as const
                : choice.finish_reason === 'stop'
                  ? 'end_turn' as const
                  : 'end_turn' as const;

            // Usage comes on the final chunk
            const usage = chunk.usage;
            yield {
              type: 'message_end',
              stopReason,
              usage: {
                inputTokens: usage?.prompt_tokens ?? 0,
                outputTokens: usage?.completion_tokens ?? 0,
              },
            };
          }
        }
      } catch (error) {
        if (error instanceof OpenAI.APIError) {
          logger.error('OpenAI API error', {
            component: label,
            status: error.status,
            errorMessage: error.message,
            traceId: params.traceId,
          });
          yield {
            type: 'error',
            error: new ProviderError(label, `${error.status}: ${error.message}`, error),
          };
        } else {
          throw error;
        }
      }
    },

    countTokens(messages: Message[]): Promise<number> {
      // OpenAI doesn't have a dedicated token counting endpoint.
      // Rough estimate: ~4 chars per token for English text.
      let totalChars = 0;
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          totalChars += msg.content.length;
        } else {
          for (const part of msg.content) {
            if (part.type === 'text') totalChars += part.text.length;
            else if (part.type === 'tool_result') totalChars += part.content.length;
            else totalChars += JSON.stringify(part.input).length;
          }
        }
      }
      return Promise.resolve(Math.ceil(totalChars / 4));
    },

    getContextWindow(): number {
      return meta.contextWindow;
    },

    supportsToolUse(): boolean {
      return meta.supportsTools;
    },

    formatTools(tools: ToolDefinitionForProvider[]): unknown[] {
      return toOpenAITools(tools);
    },

    formatToolResult(result: {
      toolUseId: string;
      content: string;
      isError: boolean;
    }): unknown {
      return {
        role: 'tool',
        tool_call_id: result.toolUseId,
        content: result.isError ? `Error: ${result.content}` : result.content,
      };
    },
  };
}
