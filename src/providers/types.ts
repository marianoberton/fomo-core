import type { TraceId } from '@/core/types.js';

// ─── Messages ───────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface Message {
  role: MessageRole;
  content: string | MessageContent[];
}

// ─── Chat Parameters ────────────────────────────────────────────

export interface ChatParams {
  messages: Message[];
  systemPrompt?: string;
  /** Provider-formatted tool definitions. */
  tools?: unknown[];
  maxTokens: number;
  temperature: number;
  stopSequences?: string[];
  traceId?: TraceId;
}

// ─── Streaming Events ───────────────────────────────────────────

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type ChatEvent =
  | { type: 'content_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialInput: string }
  | { type: 'tool_use_end'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_end'; stopReason: StopReason; usage: TokenUsage }
  | { type: 'error'; error: Error };

// ─── Tool Formatting ────────────────────────────────────────────

export interface ToolDefinitionForProvider {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── Provider Interface ─────────────────────────────────────────

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;

  /** Stream a chat completion. */
  chat(params: ChatParams): AsyncGenerator<ChatEvent>;

  /** Count tokens for a set of messages. */
  countTokens(messages: Message[]): Promise<number>;

  /** Get the model's context window size in tokens. */
  getContextWindow(): number;

  /** Whether this provider supports tool use. */
  supportsToolUse(): boolean;

  /** Format tool definitions for this provider's API format. */
  formatTools(tools: ToolDefinitionForProvider[]): unknown[];

  /** Format a tool result for this provider's API format. */
  formatToolResult(result: { toolUseId: string; content: string; isError: boolean }): unknown;
}
