// Core module — agent loop, execution engine, shared types
export type {
  AgentConfig,
  ApprovalId,
  CostConfig,
  ExecutionContext,
  ExecutionStatus,
  ExecutionTrace,
  FailoverConfig,
  LLMProviderConfig,
  MemoryConfig,
  MessageId,
  ProjectId,
  PromptLayerId,
  PromptSnapshot,
  ScheduledTaskId,
  ScheduledTaskRunId,
  SessionId,
  ToolCallId,
  TraceEvent,
  TraceEventType,
  TraceId,
  UsageRecordId,
} from './types.js';

export type { Result } from './result.js';
export { ok, err, isOk, isErr, unwrap } from './result.js';

export {
  NexusError,
  BudgetExceededError,
  ToolNotAllowedError,
  ToolHallucinationError,
  ApprovalRequiredError,
  ProviderError,
  ValidationError,
  SessionError,
  RateLimitError,
} from './errors.js';

export { createAgentRunner } from './agent-runner.js';
export type { AgentRunner, AgentRunnerOptions } from './agent-runner.js';

export type {
  AgentStreamEvent,
  AgentStartEvent,
  ContentDeltaEvent,
  ToolUseStartEvent,
  ToolResultEvent,
  TurnCompleteEvent,
  AgentCompleteEvent,
  StreamErrorEvent,
} from './stream-events.js';
