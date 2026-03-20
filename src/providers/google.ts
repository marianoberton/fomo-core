/**
 * Google Gemini LLM provider adapter.
 * Wraps the @google/generative-ai SDK to implement the LLMProvider interface.
 */
import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type Tool,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';

import { ProviderError } from '@/core/errors.js';
import { createLogger } from '@/observability/logger.js';
import { getModelMeta } from './models.js';
import type {
  ChatEvent,
  ChatParams,
  LLMProvider,
  Message,
  ToolDefinitionForProvider,
  ImageContent,
  AudioContent,
  VideoContent,
} from './types.js';

const logger = createLogger({ name: 'google-provider' });

/** Configuration for the Google Gemini provider. */
export interface GoogleProviderOptions {
  /** API key. Resolved from env at construction time. */
  apiKey: string;
  /** Model identifier (e.g. 'gemini-2.0-flash'). */
  model: string;
}

/**
 * Convert our internal Message format to Google's Content format.
 * System messages are excluded (handled separately via systemInstruction).
 */
function toGoogleMessages(messages: Message[]): Content[] {
  const result: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const parts: Part[] = [];

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else {
      for (const part of msg.content) {
        switch (part.type) {
          case 'text':
            parts.push({ text: part.text });
            break;
          case 'tool_use':
            // Assistant tool calls become functionCall parts
            parts.push({
              functionCall: {
                name: part.name,
                args: part.input,
              },
            });
            break;
          case 'tool_result':
            // Tool results become functionResponse parts (must be in 'user' role)
            parts.push({
              functionResponse: {
                name: part.toolUseId, // We use toolUseId as name fallback
                response: {
                  content: part.content,
                  isError: part.isError ?? false,
                },
              },
            });
            break;
          case 'image': {
            const imgPart = part;
            parts.push({
              inlineData: { mimeType: imgPart.mimeType, data: imgPart.data },
            });
            break;
          }
          case 'audio': {
            const audioPart = part;
            parts.push({
              inlineData: { mimeType: audioPart.mimeType, data: audioPart.data },
            });
            break;
          }
          case 'video': {
            const videoPart = part;
            parts.push({
              fileData: { mimeType: videoPart.mimeType, fileUri: videoPart.fileUri },
            });
            break;
          }
        }
      }
    }

    if (parts.length === 0) continue;

    // Google uses 'model' instead of 'assistant'
    const role = msg.role === 'assistant' ? 'model' : 'user';
    result.push({ role, parts });
  }

  return result;
}

/**
 * Format tool definitions for the Google API.
 */
function toGoogleTools(tools: ToolDefinitionForProvider[]): Tool[] {
  const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as unknown as FunctionDeclaration['parameters'],
  }));
  return [{ functionDeclarations }];
}

/**
 * Google Gemini provider implementing the LLMProvider interface.
 */
export function createGoogleProvider(options: GoogleProviderOptions): LLMProvider {
  const genAI = new GoogleGenerativeAI(options.apiKey);
  const meta = getModelMeta(options.model);

  // Safety settings — allow all content categories at minimum block threshold
  // so we don't interfere with legitimate business use cases
  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  ];

  return {
    id: `google:${options.model}`,
    displayName: `Google ${options.model}`,

    async *chat(params: ChatParams): AsyncGenerator<ChatEvent> {
      const googleMessages = toGoogleMessages(params.messages);
      const systemPrompt = params.systemPrompt ??
        params.messages.find((m) => m.role === 'system')?.content as string | undefined;

      const tools = params.tools as Tool[] | undefined;

      logger.debug('Starting Google Gemini chat stream', {
        component: 'google',
        model: options.model,
        messageCount: googleMessages.length,
        hasTools: !!tools?.length,
        traceId: params.traceId,
      });

      try {
        const generationConfig = {
          maxOutputTokens: params.maxTokens,
          temperature: params.temperature,
          stopSequences: params.stopSequences,
        };

        const modelInstance = genAI.getGenerativeModel({
          model: params.model ?? options.model,
          systemInstruction: systemPrompt ? { role: 'system', parts: [{ text: systemPrompt }] } : undefined,
          generationConfig,
          safetySettings,
          ...(tools?.length ? { tools } : {}),
        });

        // Generate a synthetic message ID
        const messageId = `google-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        yield { type: 'message_start', messageId };

        const chat = modelInstance.startChat({ history: googleMessages.slice(0, -1) });
        const lastMessage = googleMessages[googleMessages.length - 1];
        const lastParts = lastMessage?.parts ?? [{ text: '' }];

        const result = await chat.sendMessageStream(lastParts);

        let inputTokens = 0;
        let outputTokens = 0;
        let hasToolCall = false;

        // Track tool calls accumulation
        const toolCalls: { name: string; args: Record<string, unknown> }[] = [];

        for await (const chunk of result.stream) {
          const candidates = chunk.candidates ?? [];
          for (const candidate of candidates) {
            for (const part of candidate.content?.parts ?? []) {
              if ('text' in part && part.text) {
                yield { type: 'content_delta', text: part.text };
              } else if ('functionCall' in part && part.functionCall) {
                hasToolCall = true;
                const fc = part.functionCall;
                const toolId = `tool-${Date.now()}-${toolCalls.length}`;
                const args = (fc.args ?? {}) as Record<string, unknown>;
                toolCalls.push({ name: fc.name ?? '', args });

                yield { type: 'tool_use_start', id: toolId, name: fc.name ?? '' };
                yield {
                  type: 'tool_use_delta',
                  id: toolId,
                  partialInput: JSON.stringify(args),
                };
                yield {
                  type: 'tool_use_end',
                  id: toolId,
                  name: fc.name ?? '',
                  input: args,
                };
              }
            }
          }

          // Collect token usage if available
          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
          }
        }

        // Get final usage from the aggregated response
        const response = await result.response;
        if (response.usageMetadata) {
          inputTokens = response.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = response.usageMetadata.candidatesTokenCount ?? outputTokens;
        }

        const stopReason = hasToolCall ? 'tool_use' as const : 'end_turn' as const;
        yield {
          type: 'message_end',
          stopReason,
          usage: { inputTokens, outputTokens },
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('Google Gemini API error', {
          component: 'google',
          errorMessage: errMsg,
          traceId: params.traceId,
        });
        yield {
          type: 'error',
          error: new ProviderError('google', errMsg, error instanceof Error ? error : undefined),
        };
      }
    },

    async countTokens(messages: Message[]): Promise<number> {
      try {
        const googleMessages = toGoogleMessages(messages);
        const modelInstance = genAI.getGenerativeModel({ model: options.model });
        const result = await modelInstance.countTokens({ contents: googleMessages });
        return result.totalTokens;
      } catch {
        // Fallback: rough estimate ~4 chars per token
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
      return toGoogleTools(tools);
    },

    formatToolResult(result: {
      toolUseId: string;
      content: string;
      isError: boolean;
    }): unknown {
      return {
        type: 'tool_result',
        toolUseId: result.toolUseId,
        content: result.content,
        isError: result.isError,
      };
    },
  };
}
