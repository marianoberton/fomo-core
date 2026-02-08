/**
 * AgentStreamEvent — Events streamed from the agent runner to clients.
 *
 * Used by the WebSocket `/chat/stream` endpoint to provide real-time
 * feedback during agent execution. These are client-facing events,
 * distinct from the internal TraceEvent types used for observability.
 */

/** Events streamed from server to client during an agent run. */
export type AgentStreamEvent =
  | AgentStartEvent
  | ContentDeltaEvent
  | ToolUseStartEvent
  | ToolResultEvent
  | TurnCompleteEvent
  | AgentCompleteEvent
  | StreamErrorEvent;

/** Agent run has been initiated. */
export interface AgentStartEvent {
  readonly type: 'agent_start';
  readonly sessionId: string;
  readonly traceId: string;
}

/** Streaming text chunk from the LLM. */
export interface ContentDeltaEvent {
  readonly type: 'content_delta';
  readonly text: string;
}

/** A tool call is about to be executed. */
export interface ToolUseStartEvent {
  readonly type: 'tool_use_start';
  readonly toolCallId: string;
  readonly toolId: string;
  readonly input: Record<string, unknown>;
}

/** A tool call has completed (success or failure). */
export interface ToolResultEvent {
  readonly type: 'tool_result';
  readonly toolCallId: string;
  readonly toolId: string;
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string;
}

/** One agent turn has completed (LLM call + tool executions). */
export interface TurnCompleteEvent {
  readonly type: 'turn_complete';
  readonly turnNumber: number;
}

/** The full agent run has completed. */
export interface AgentCompleteEvent {
  readonly type: 'agent_complete';
  readonly response: string;
  readonly usage: {
    readonly totalTokens: number;
    readonly costUSD: number;
  };
  readonly status: string;
}

/** An error occurred during the agent run. */
export interface StreamErrorEvent {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}
