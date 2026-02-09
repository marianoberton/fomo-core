/**
 * Manages multiple MCP server connections for a project.
 * Discovers tools from all connected servers and exposes them as ExecutableTool instances.
 */
import { createLogger } from '@/observability/logger.js';
import type { ExecutableTool } from '@/tools/types.js';
import type { MCPServerConfig, MCPConnection } from './types.js';
import { createMCPConnection } from './mcp-client.js';
import { createMCPExecutableTool, getMCPToolInputSchema } from './mcp-tool-adapter.js';

const logger = createLogger({ name: 'mcp-manager' });

/** Status of a managed MCP server connection. */
export interface MCPServerStatus {
  name: string;
  status: string;
  toolCount: number;
}

/** Public interface for the MCP manager. */
export interface MCPManager {
  /** Connect to all configured MCP servers. Failures are logged and skipped. */
  connectAll(configs: MCPServerConfig[]): Promise<void>;
  /** Disconnect a specific server by name. */
  disconnect(serverName: string): Promise<void>;
  /** Disconnect all servers and clean up resources. */
  disconnectAll(): Promise<void>;
  /** Get a connection by server name. */
  getConnection(serverName: string): MCPConnection | undefined;
  /** List status of all managed connections. */
  listConnections(): MCPServerStatus[];
  /** Get all MCP tools as ExecutableTool instances (ready for ToolRegistry). */
  getTools(): ExecutableTool[];
  /** Get JSON Schemas for all MCP tools (for LLM provider formatting). */
  getToolSchemas(): Map<string, Record<string, unknown>>;
}

/** Options for creating an MCP manager. */
export interface MCPManagerOptions {
  /** Connection timeout per server in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

/**
 * Creates a manager that handles multiple MCP server connections.
 * Failed connections are logged and skipped — the agent continues without those tools.
 */
export function createMCPManager(options?: MCPManagerOptions): MCPManager {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const connections = new Map<string, MCPConnection>();
  const tools = new Map<string, ExecutableTool>();
  const toolSchemas = new Map<string, Record<string, unknown>>();
  /** Maps server name → set of tool IDs belonging to that server. */
  const serverToolIds = new Map<string, Set<string>>();

  return {
    async connectAll(configs: MCPServerConfig[]): Promise<void> {
      const results = await Promise.allSettled(
        configs.map(async (config) => {
          try {
            logger.info('Connecting to MCP server', {
              component: 'mcp-manager',
              serverName: config.name,
            });

            const connection = await createMCPConnection({ config, timeoutMs });
            connections.set(config.name, connection);

            // Discover tools
            const serverTools = await connection.listTools();
            logger.info('Discovered MCP tools', {
              component: 'mcp-manager',
              serverName: config.name,
              toolCount: serverTools.length,
              tools: serverTools.map((t) => t.name),
            });

            // Wrap each tool as an ExecutableTool
            const toolIds = new Set<string>();
            for (const toolInfo of serverTools) {
              const executableTool = createMCPExecutableTool({
                serverName: config.name,
                toolInfo,
                connection,
                prefix: config.toolPrefix,
              });
              tools.set(executableTool.id, executableTool);
              toolSchemas.set(executableTool.id, getMCPToolInputSchema(toolInfo));
              toolIds.add(executableTool.id);
            }
            serverToolIds.set(config.name, toolIds);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('Failed to connect to MCP server', {
              component: 'mcp-manager',
              serverName: config.name,
              error: message,
            });
            // Don't rethrow — graceful degradation
          }
        }),
      );

      const connected = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      logger.info('MCP manager initialization complete', {
        component: 'mcp-manager',
        connected,
        failed,
        totalTools: tools.size,
      });
    },

    async disconnect(serverName: string): Promise<void> {
      const connection = connections.get(serverName);
      if (!connection) return;

      // Remove tools for this server
      const ids = serverToolIds.get(serverName);
      if (ids) {
        for (const toolId of ids) {
          tools.delete(toolId);
          toolSchemas.delete(toolId);
        }
        serverToolIds.delete(serverName);
      }

      await connection.close();
      connections.delete(serverName);

      logger.info('MCP server disconnected', {
        component: 'mcp-manager',
        serverName,
      });
    },

    async disconnectAll(): Promise<void> {
      const closePromises = [...connections.values()].map((c) => c.close());
      await Promise.allSettled(closePromises);
      connections.clear();
      tools.clear();
      toolSchemas.clear();
      serverToolIds.clear();

      logger.info('All MCP servers disconnected', {
        component: 'mcp-manager',
      });
    },

    getConnection(serverName: string): MCPConnection | undefined {
      return connections.get(serverName);
    },

    listConnections(): MCPServerStatus[] {
      return [...connections.entries()].map(([name, conn]) => ({
        name,
        status: conn.status,
        toolCount: serverToolIds.get(name)?.size ?? 0,
      }));
    },

    getTools(): ExecutableTool[] {
      return [...tools.values()];
    },

    getToolSchemas(): Map<string, Record<string, unknown>> {
      return new Map(toolSchemas);
    },
  };
}
