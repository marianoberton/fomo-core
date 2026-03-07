/**
 * OpenRouter LLM provider adapter.
 *
 * OpenRouter exposes an OpenAI-compatible API that proxies 200+ models
 * (Anthropic, OpenAI, Meta, Mistral, DeepSeek, Qwen, etc.) through a single
 * endpoint with unified billing and cost tracking.
 *
 * Why OpenRouter?
 * - Single API key and dashboard for all provider costs
 * - Actual cost per request is returned in `usage.total_cost` (USD)
 * - Automatic failover across provider instances
 * - Model IDs use format: `provider/model-name`
 *   e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4-5`, `meta-llama/llama-3.3-70b-instruct`
 *
 * @see https://openrouter.ai/docs
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

const logger = createLogger({ name: 'openrouter-provider' });

/** Configuration for the OpenRouter provider. */
export interface OpenRouterProviderOptions {
  /** OpenRouter API key (from https://openrouter.ai/keys). */
  apiKey: string;
  /**
   * Model identifier in OpenRouter format: `provider/model-name`.
   * Examples: `openai/gpt-4o`, `anthropic/claude-sonnet-4-5`,
   *           `meta-llama/llama-3.3-70b-instruct`, `deepseek/deepseek-chat`
   */
  model: string;
  /**
   * HTTP Referer sent with every request.
   * Shown in OpenRouter usage logs and allows free-tier boosts for some models.
   * Defaults to https://nexus-core.fomo.ai
   */
  siteUrl?: string;
  /**
   * App name shown in OpenRouter dashboard.
   * Defaults to 'Nexus Core'.
   */
  siteName?: string;
}

// ─── Message conversion (reuse OpenAI format) ───────────────────

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
            function: { name: part.name, arguments: JSON.stringify(part.input) },
          });
          break;
        case 'tool_result':
          toolResults.push({ toolCallId: part.toolUseId, content: part.content });
          break;
      }
    }

    if (msg.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: textParts.join('') === '' ? null : textParts.join(''),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else if (toolResults.length > 0) {
      for (const tr of toolResults) {
        result.push({ role: 'tool', tool_call_id: tr.toolCallId, content: tr.content });
      }
    } else {
      result.push({ role: 'user', content: textParts.join('') });
    }
  }

  return result;
}

function toOpenAITools(
  tools: ToolDefinitionForProvider[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

// ─── Factory ────────────────────────────────────────────────────

/**
 * Create an OpenRouter LLM provider.
 *
 * @param options Provider configuration (API key, model, site info)
 */
export function createOpenRouterProvider(options: OpenRouterProviderOptions): LLMProvider {
  const siteUrl = options.siteUrl ?? 'https://nexus-core.fomo.ai';
  const siteName = options.siteName ?? 'Nexus Core';

  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': siteUrl,
      'X-Title': siteName,
    },
  });

  const meta = getModelMeta(options.model);

  return {
    id: `openrouter:${options.model}`,
    displayName: `OpenRouter ${options.model}`,

    async *chat(params: ChatParams): AsyncGenerator<ChatEvent> {
      const effectiveModel = params.model ?? options.model;
      const openaiMessages = toOpenAIMessages(params.messages, params.systemPrompt);
      const tools = params.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;

      logger.debug('Starting OpenRouter chat stream', {
        component: 'openrouter',
        model: effectiveModel,
        messageCount: openaiMessages.length,
        hasTools: !!tools?.length,
        traceId: params.traceId,
      });

      try {
        const stream = await client.chat.completions.create({
          model: effectiveModel,
          messages: openaiMessages,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools?.length ? { tools } : {}),
          ...(params.stopSequences?.length ? { stop: params.stopSequences } : {}),
        });

        let messageId = '';
        const toolCallBuffers = new Map<number, {
          id: string;
          name: string;
          argumentsJson: string;
        }>();
        let finalStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | undefined;
        let finalUsage: {
          prompt_tokens: number;
          completion_tokens: number;
          total_cost?: number;
        } | undefined;

        for await (const chunk of stream) {
          if (chunk.id && !messageId) {
            messageId = chunk.id;
            yield { type: 'message_start', messageId };
          }

          // OpenRouter returns cost in usage chunk — capture it
          if (chunk.usage) {
            const usageWithCost = chunk.usage as {
              prompt_tokens: number;
              completion_tokens: number;
              total_cost?: number;
            };
            finalUsage = {
              prompt_tokens: usageWithCost.prompt_tokens,
              completion_tokens: usageWithCost.completion_tokens,
              total_cost: usageWithCost.total_cost,
            };

            if (usageWithCost.total_cost !== undefined) {
              logger.debug('OpenRouter request cost', {
                component: 'openrouter',
                model: effectiveModel,
                totalCostUsd: usageWithCost.total_cost,
                traceId: params.traceId,
              });
            }
          }

          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          if (delta.content) {
            yield { type: 'content_delta', text: delta.content };
          }

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
                yield { type: 'tool_use_delta', id: buffer.id, partialInput: tc.function.arguments };
              }
            }
          }

          if (choice.finish_reason) {
            for (const [, buffer] of toolCallBuffers) {
              let parsedInput: Record<string, unknown> = {};
              try {
                parsedInput = JSON.parse(buffer.argumentsJson || '{}') as Record<string, unknown>;
              } catch {
                logger.warn('Failed to parse tool call arguments', {
                  component: 'openrouter',
                  toolId: buffer.id,
                  toolName: buffer.name,
                });
              }
              yield { type: 'tool_use_end', id: buffer.id, name: buffer.name, input: parsedInput };
            }
            toolCallBuffers.clear();

            finalStopReason =
              choice.finish_reason === 'tool_calls' ? 'tool_use'
              : choice.finish_reason === 'length' ? 'max_tokens'
              : 'end_turn';
          }
        }

        if (!finalStopReason) {
          throw new Error('Stream ended without finish_reason');
        }

        yield {
          type: 'message_end',
          stopReason: finalStopReason,
          usage: {
            inputTokens: finalUsage?.prompt_tokens ?? 0,
            outputTokens: finalUsage?.completion_tokens ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof OpenAI.APIError) {
          const httpStatus = (error as { status?: number }).status;
          logger.error(
            `OpenRouter API error status=${httpStatus ?? 'none'} model=${effectiveModel}: ${error.message}`,
            { component: 'openrouter', traceId: params.traceId },
          );
          yield {
            type: 'error',
            error: new ProviderError('openrouter', `${httpStatus ?? 'none'}: ${error.message}`, error),
          };
        } else {
          throw error;
        }
      }
    },

    countTokens(messages: Message[]): Promise<number> {
      let totalChars = 0;
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          totalChars += msg.content.length;
        } else {
          for (const part of msg.content) {
            if (part.type === 'text') totalChars += part.text.length;
            else if (part.type === 'tool_result') totalChars += part.content.length;
            else if (part.type === 'tool_use') totalChars += JSON.stringify(part.input).length;
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

    formatToolResult(result: { toolUseId: string; content: string; isError: boolean }): unknown {
      return {
        role: 'tool',
        tool_call_id: result.toolUseId,
        content: result.isError ? `Error: ${result.content}` : result.content,
      };
    },
  };
}
