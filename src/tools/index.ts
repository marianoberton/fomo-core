// Tool system — registry + definitions
export type {
  ExecutableTool,
  RiskLevel,
  ToolCallEvent,
  ToolDefinition,
  ToolResult,
} from './types.js';

export { createToolRegistry } from './registry/index.js';
export type { ToolRegistry, ToolRegistryOptions, ApprovalGateCallback } from './registry/index.js';
