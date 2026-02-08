/**
 * Anthropic LLM provider adapter.
 * Wraps the @anthropic-ai/sdk to implement the LLMProvider interface.
 */
import Anthropic from '@anthropic-ai/sdk';

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

const logger = createLogger({ name: 'anthropic-provider' });

/** Configuration for the Anthropic provider. */
export interface AnthropicProviderOptions {
  /** API key. Resolved from env at construction time. */
  apiKey: string;
  /** Model identifier (e.g. 'claude-sonnet-4-5-20250929'). */
  model: string;
  /** Custom base URL (for proxies). */
  baseUrl?: string;
}

/**
 * Convert our internal Message format to Anthropic's API format.
 */
function toAnthropicMessages(
  messages: Message[],
): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      continue;
    }

    const blocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const part of msg.content) {
      switch (part.type) {
        case 'text':
          blocks.push({ type: 'text', text: part.text });
          break;
        case 'tool_use':
          blocks.push({
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.input,
          });
          break;
        case 'tool_result':
          blocks.push({
            type: 'tool_result',
            tool_use_id: part.toolUseId,
            content: part.content,
            is_error: part.isError,
          });
          break;
      }
    }

    result.push({ role: msg.role as 'user' | 'assistant', content: blocks });
  }

  return result;
}

/**
 * Format tool definitions for the Anthropic API.
 */
function toAnthropicTools(
  tools: ToolDefinitionForProvider[],
): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));
}

/**
 * Anthropic provider implementing the LLMProvider interface.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
  });
  const meta = getModelMeta(options.model);

  return {
    id: `anthropic:${options.model}`,
    displayName: `Anthropic ${options.model}`,

    async *chat(params: ChatParams): AsyncGenerator<ChatEvent> {
      const anthropicMessages = toAnthropicMessages(params.messages);
      const tools = params.tools as Anthropic.Messages.Tool[] | undefined;

      logger.debug('Starting Anthropic chat stream', {
        component: 'anthropic',
        model: options.model,
        messageCount: anthropicMessages.length,
        hasTools: !!tools?.length,
        traceId: params.traceId,
      });

      try {
        const stream = client.messages.stream({
          model: options.model,
          messages: anthropicMessages,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
          ...(tools?.length ? { tools } : {}),
          ...(params.stopSequences?.length ? { stop_sequences: params.stopSequences } : {}),
        });

        let currentToolId: string | undefined;
        let currentToolName: string | undefined;
        let toolInputJson = '';

        for await (const event of stream) {
          switch (event.type) {
            case 'message_start':
              yield { type: 'message_start', messageId: event.message.id };
              break;

            case 'content_block_start':
              if (event.content_block.type === 'tool_use') {
                currentToolId = event.content_block.id;
                currentToolName = event.content_block.name;
                toolInputJson = '';
                yield {
                  type: 'tool_use_start',
                  id: currentToolId,
                  name: currentToolName,
                };
              }
              break;

            case 'content_block_delta':
              if (event.delta.type === 'text_delta') {
                yield { type: 'content_delta', text: event.delta.text };
              } else if (event.delta.type === 'input_json_delta') {
                toolInputJson += event.delta.partial_json;
                if (currentToolId) {
                  yield {
                    type: 'tool_use_delta',
                    id: currentToolId,
                    partialInput: event.delta.partial_json,
                  };
                }
              }
              break;

            case 'content_block_stop':
              if (currentToolId) {
                let parsedInput: Record<string, unknown> = {};
                try {
                  parsedInput = JSON.parse(toolInputJson || '{}') as Record<string, unknown>;
                } catch {
                  logger.warn('Failed to parse tool input JSON', {
                    component: 'anthropic',
                    toolId: currentToolId,
                    toolName: currentToolName,
                  });
                }
                yield {
                  type: 'tool_use_end',
                  id: currentToolId,
                  name: currentToolName || '',
                  input: parsedInput,
                };
                currentToolId = undefined;
                currentToolName = undefined;
                toolInputJson = '';
              }
              break;

            case 'message_stop': {
              const finalMessage = await stream.finalMessage();
              const stopReason = finalMessage.stop_reason === 'tool_use'
                ? 'tool_use' as const
                : finalMessage.stop_reason === 'max_tokens'
                  ? 'max_tokens' as const
                  : finalMessage.stop_reason === 'stop_sequence'
                    ? 'stop_sequence' as const
                    : 'end_turn' as const;
              yield {
                type: 'message_end',
                stopReason,
                usage: {
                  inputTokens: finalMessage.usage.input_tokens,
                  outputTokens: finalMessage.usage.output_tokens,
                  cacheReadTokens: (finalMessage.usage as unknown as Record<string, unknown>)['cache_read_input_tokens'] as number | undefined,
                  cacheWriteTokens: (finalMessage.usage as unknown as Record<string, unknown>)['cache_creation_input_tokens'] as number | undefined,
                },
              };
              break;
            }
          }
        }
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          logger.error('Anthropic API error', {
            component: 'anthropic',
            status: error.status,
            errorMessage: error.message,
            traceId: params.traceId,
          });
          yield {
            type: 'error',
            error: new ProviderError('anthropic', `${error.status}: ${error.message}`, error),
          };
        } else {
          throw error;
        }
      }
    },

    async countTokens(messages: Message[]): Promise<number> {
      const anthropicMessages = toAnthropicMessages(messages);
      try {
        const result = await client.messages.countTokens({
          model: options.model,
          messages: anthropicMessages,
        });
        return result.input_tokens;
      } catch {
        // Fallback: rough estimate of ~4 chars per token
        let totalChars = 0;
        for (const msg of messages) {
          if (typeof msg.content === 'string') {
            totalChars += msg.content.length;
          } else {
            for (const part of msg.content) {
              if (part.type === 'text') totalChars += part.text.length;
              else if (part.type === 'tool_result') totalChars += part.content.length;
            }
          }
        }
        return Math.ceil(totalChars / 4);
      }
    },

    getContextWindow(): number {
      return meta.contextWindow;
    },

    supportsToolUse(): boolean {
      return meta.supportsTools;
    },

    formatTools(tools: ToolDefinitionForProvider[]): unknown[] {
      return toAnthropicTools(tools);
    },

    formatToolResult(result: {
      toolUseId: string;
      content: string;
      isError: boolean;
    }): unknown {
      return {
        type: 'tool_result',
        tool_use_id: result.toolUseId,
        content: result.content,
        is_error: result.isError,
      };
    },
  };
}
