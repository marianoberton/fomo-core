/**
 * MCP-specific error classes.
 * All extend NexusError for consistent error handling across the system.
 */
import { NexusError } from '@/core/errors.js';

/** Thrown when connecting to an MCP server fails. */
export class MCPConnectionError extends NexusError {
  constructor(serverName: string, message: string, cause?: Error) {
    super({
      message: `MCP server "${serverName}" connection failed: ${message}`,
      code: 'MCP_CONNECTION_ERROR',
      statusCode: 503,
      cause,
      context: { serverName },
    });
    this.name = 'MCPConnectionError';
  }
}

/** Thrown when calling a tool on an MCP server fails. */
export class MCPToolExecutionError extends NexusError {
  constructor(serverName: string, toolName: string, message: string, cause?: Error) {
    super({
      message: `MCP tool "${toolName}" on "${serverName}" failed: ${message}`,
      code: 'MCP_TOOL_EXECUTION_ERROR',
      statusCode: 502,
      cause,
      context: { serverName, toolName },
    });
    this.name = 'MCPToolExecutionError';
  }
}

/** Thrown when an MCP operation exceeds its timeout. */
export class MCPTimeoutError extends NexusError {
  constructor(serverName: string, operation: string, timeoutMs: number) {
    super({
      message: `MCP server "${serverName}" timed out during ${operation} after ${timeoutMs}ms`,
      code: 'MCP_TIMEOUT',
      statusCode: 504,
      context: { serverName, operation, timeoutMs },
    });
    this.name = 'MCPTimeoutError';
  }
}
