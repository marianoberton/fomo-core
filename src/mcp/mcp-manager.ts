/**
 * Manages multiple MCP server connections for a project.
 * Discovers tools from all connected servers and exposes them as ExecutableTool instances.
 *
 * Lazy-connection design:
 * - Tool metadata (name, description, schema) is cached after the first successful connection.
 * - On subsequent requests, tools are registered from the cache — no connection attempted.
 * - Actual server connections are established at tool execute() time via ensureConnectedInternal().
 * - This means: if an agent turn uses no MCP tools, no server is contacted.
 */
import { createLogger } from '@/observability/logger.js';
import type { ExecutableTool } from '@/tools/types.js';
import type { MCPServerConfig, MCPConnection, MCPToolInfo } from './types.js';
import { MCPConnectionError } from './errors.js';
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
  /**
   * Connect to all configured MCP servers eagerly (one-shot setup).
   * Failures are logged and skipped — agent continues without those tools.
   */
  connectAll(configs: MCPServerConfig[]): Promise<void>;
  /**
   * Prepare tools for an agent run.
   * Uses cached tool info for previously-seen servers (no connection attempted).
   * Connects only for servers seen for the first time.
   * Returns the list of registered tool IDs for this agent's servers.
   */
  prepareTools(configs: MCPServerConfig[]): Promise<string[]>;
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
  /** Connection timeout per server in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
}

/**
 * Creates a manager that handles multiple MCP server connections.
 * Failed connections are logged and skipped — the agent continues without those tools.
 */
export function createMCPManager(options?: MCPManagerOptions): MCPManager {
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const connections = new Map<string, MCPConnection>();
  const tools = new Map<string, ExecutableTool>();
  const toolSchemas = new Map<string, Record<string, unknown>>();
  /** Maps server name → set of tool IDs belonging to that server. */
  const serverToolIds = new Map<string, Set<string>>();
  /** In-memory cache of tool info per server — populated on first connect, persists across requests. */
  const toolInfoCache = new Map<string, MCPToolInfo[]>();
  /** Known server configs — stored so ensureConnectedInternal can reconnect dropped connections. */
  const pendingConfigs = new Map<string, MCPServerConfig>();

  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Ensures a server is connected. Called at tool execute() time.
   * Returns the existing connection if healthy, or reconnects if dropped.
   *
   * Performs a lightweight ping to verify the connection is actually alive
   * (TCP connections can appear connected but be dead).
   */
  async function ensureConnectedInternal(serverName: string): Promise<MCPConnection> {
    const existing = connections.get(serverName);

    if (existing?.status === 'connected') {
      // Verify the connection is actually alive with a lightweight call
      try {
        await Promise.race([
          existing.listTools(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 3000),
          ),
        ]);
        return existing;
      } catch {
        logger.warn('MCP connection stale — reconnecting', {
          component: 'mcp-manager',
          serverName,
        });
        // Fall through to reconnect
        connections.delete(serverName);
      }
    }

    const config = pendingConfigs.get(serverName);
    if (!config) {
      throw new MCPConnectionError(serverName, `No config stored for MCP server "${serverName}" — cannot reconnect`);
    }

    logger.info('Reconnecting to MCP server', { component: 'mcp-manager', serverName });
    const connection = await createMCPConnection({ config, timeoutMs });
    connections.set(serverName, connection);
    return connection;
  }

  /**
   * Register tools from cached tool info without opening a connection.
   * Creates lazy ExecutableTool instances that connect on first execute().
   * Returns the list of registered tool IDs.
   */
  function registerToolsFromInfo(config: MCPServerConfig, toolInfoList: MCPToolInfo[]): string[] {
    const registeredIds: string[] = [];
    const existing = serverToolIds.get(config.name) ?? new Set<string>();

    for (const toolInfo of toolInfoList) {
      const executableTool = createMCPExecutableTool({
        serverName: config.name,
        toolInfo,
        getConnection: () => ensureConnectedInternal(config.name),
        getConnectionStatus: () => connections.get(config.name)?.status ?? 'unconnected',
        prefix: config.toolPrefix,
      });

      tools.set(executableTool.id, executableTool);
      toolSchemas.set(executableTool.id, getMCPToolInputSchema(toolInfo));
      existing.add(executableTool.id);
      registeredIds.push(executableTool.id);
    }

    serverToolIds.set(config.name, existing);
    return registeredIds;
  }

  return {
    async connectAll(configs: MCPServerConfig[]): Promise<void> {
      const results = await Promise.allSettled(
        configs.map(async (config) => {
          try {
            pendingConfigs.set(config.name, config);
            logger.info('Connecting to MCP server', {
              component: 'mcp-manager',
              serverName: config.name,
            });

            const connection = await createMCPConnection({ config, timeoutMs });
            connections.set(config.name, connection);

            // Discover tools
            const serverTools = await connection.listTools();
            toolInfoCache.set(config.name, serverTools);

            logger.info('Discovered MCP tools', {
              component: 'mcp-manager',
              serverName: config.name,
              toolCount: serverTools.length,
              tools: serverTools.map((t) => t.name),
            });

            registerToolsFromInfo(config, serverTools);
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

    async prepareTools(configs: MCPServerConfig[]): Promise<string[]> {
      const allRegisteredIds: string[] = [];
      const toConnect: MCPServerConfig[] = [];

      for (const config of configs) {
        pendingConfigs.set(config.name, config);
        const cached = toolInfoCache.get(config.name);
        if (cached) {
          // Known server — register from cache without connecting
          const ids = registerToolsFromInfo(config, cached);
          allRegisteredIds.push(...ids);
        } else {
          // First time seeing this server — must connect to discover tools
          toConnect.push(config);
        }
      }

      if (toConnect.length > 0) {
        await Promise.allSettled(
          toConnect.map(async (config) => {
            try {
              logger.info('Connecting to MCP server (first time)', {
                component: 'mcp-manager',
                serverName: config.name,
              });

              const connection = await createMCPConnection({ config, timeoutMs });
              connections.set(config.name, connection);

              const serverTools = await connection.listTools();
              toolInfoCache.set(config.name, serverTools);

              logger.info('Discovered and cached MCP tools', {
                component: 'mcp-manager',
                serverName: config.name,
                toolCount: serverTools.length,
                tools: serverTools.map((t) => t.name),
              });

              const ids = registerToolsFromInfo(config, serverTools);
              allRegisteredIds.push(...ids);
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error('Failed to connect to MCP server', {
                component: 'mcp-manager',
                serverName: config.name,
                error: message,
              });
            }
          }),
        );
      }

      return allRegisteredIds;
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
