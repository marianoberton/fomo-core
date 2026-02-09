/**
 * MCP (Model Context Protocol) types for connecting external tool servers.
 * MCP servers expose tools that the agent can discover and use dynamically.
 */

// ─── Server Configuration ──────────────────────────────────────

/** Configuration for a single MCP server connection. */
export interface MCPServerConfig {
  /** Unique identifier for this server (e.g. "google-calendar"). */
  name: string;
  /** Transport type: stdio spawns a subprocess, sse connects via HTTP. */
  transport: 'stdio' | 'sse';
  /** For stdio: command to run (e.g. "npx"). */
  command?: string;
  /** For stdio: arguments for the command (e.g. ["-y", "@anthropic/mcp-google-calendar"]). */
  args?: string[];
  /** For stdio: env var NAMES to resolve and pass to the subprocess. */
  env?: Record<string, string>;
  /** For sse: URL of the MCP server (e.g. "http://localhost:8080/mcp"). */
  url?: string;
  /** Namespace prefix for tool IDs. Defaults to server name. */
  toolPrefix?: string;
}

// ─── Connection ────────────────────────────────────────────────

/** Status of an MCP server connection. */
export type MCPConnectionStatus = 'connected' | 'disconnected' | 'error';

/** Represents a live connection to an MCP server. */
export interface MCPConnection {
  /** The server name from config. */
  readonly serverName: string;
  /** Current connection status. */
  readonly status: MCPConnectionStatus;
  /** List tools available on this server. */
  listTools(): Promise<MCPToolInfo[]>;
  /** Call a tool on this server. */
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;
  /** Close the connection and clean up resources. */
  close(): Promise<void>;
}

// ─── Tool Info ─────────────────────────────────────────────────

/** Tool information as reported by an MCP server. */
export interface MCPToolInfo {
  /** Tool name as defined by the MCP server. */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
}

/** Result of calling a tool on an MCP server. */
export interface MCPToolResult {
  /** Array of content items returned by the tool. */
  content: MCPToolResultContent[];
  /** Whether the tool call resulted in an error. */
  isError?: boolean;
}

/** A single content item in an MCP tool result. */
export interface MCPToolResultContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}
