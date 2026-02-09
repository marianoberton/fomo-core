/**
 * MCP (Model Context Protocol) client integration.
 * Connects to external MCP servers, discovers tools, and adapts them
 * as Nexus ExecutableTool instances for the ToolRegistry.
 */
export type {
  MCPServerConfig,
  MCPConnection,
  MCPConnectionStatus,
  MCPToolInfo,
  MCPToolResult,
  MCPToolResultContent,
} from './types.js';
export { MCPConnectionError, MCPToolExecutionError, MCPTimeoutError } from './errors.js';
export { createMCPConnection } from './mcp-client.js';
export type { CreateMCPConnectionOptions } from './mcp-client.js';
export { createMCPExecutableTool, getMCPToolInputSchema } from './mcp-tool-adapter.js';
export type { MCPToolAdapterOptions } from './mcp-tool-adapter.js';
export { createMCPManager } from './mcp-manager.js';
export type { MCPManager, MCPManagerOptions, MCPServerStatus } from './mcp-manager.js';
