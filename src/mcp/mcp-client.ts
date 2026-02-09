/**
 * Creates MCP connections using the @modelcontextprotocol/sdk.
 * Supports stdio (subprocess) and SSE (HTTP) transports.
 * Returns our MCPConnection interface, hiding SDK details from the rest of the system.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createLogger } from '@/observability/logger.js';
import type {
  MCPServerConfig,
  MCPConnection,
  MCPConnectionStatus,
  MCPToolInfo,
  MCPToolResult,
} from './types.js';
import { MCPConnectionError } from './errors.js';

const logger = createLogger({ name: 'mcp-client' });

/** Options for creating an MCP connection. */
export interface CreateMCPConnectionOptions {
  /** Server configuration. */
  config: MCPServerConfig;
  /** Connection timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

/**
 * Creates a live connection to an MCP server.
 * Handles transport creation, env var resolution, and SDK initialization.
 */
export async function createMCPConnection(
  options: CreateMCPConnectionOptions,
): Promise<MCPConnection> {
  const { config, timeoutMs = 30_000 } = options;

  logger.info('Connecting to MCP server', {
    component: 'mcp-client',
    serverName: config.name,
    transport: config.transport,
  });

  const client = new Client(
    { name: 'nexus-core', version: '1.0.0' },
    { capabilities: {} },
  );

  const transport = createTransport(config);

  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MCPConnectionError(
      config.name,
      message,
      error instanceof Error ? error : undefined,
    );
  }

  logger.info('MCP server connected', {
    component: 'mcp-client',
    serverName: config.name,
  });

  let status: MCPConnectionStatus = 'connected';

  // Track disconnection
  transport.onclose = () => {
    status = 'disconnected';
    logger.info('MCP server disconnected', {
      component: 'mcp-client',
      serverName: config.name,
    });
  };

  transport.onerror = (error: Error) => {
    status = 'error';
    logger.error('MCP server transport error', {
      component: 'mcp-client',
      serverName: config.name,
      error: error.message,
    });
  };

  return {
    get serverName() {
      return config.name;
    },

    get status() {
      return status;
    },

    async listTools(): Promise<MCPToolInfo[]> {
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
    },

    async callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<MCPToolResult> {
      const result = await client.callTool({ name, arguments: args });

      // The SDK returns a union type — we only handle the content-based result
      if (!('content' in result)) {
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      const content = result.content as MCPToolResult['content'];
      return {
        content: content.map((c) => {
          const item: MCPToolResult['content'][number] = {
            type: c.type,
          };
          if ('text' in c && typeof c.text === 'string') item.text = c.text;
          if ('data' in c && typeof c.data === 'string') item.data = c.data;
          if ('mimeType' in c && typeof c.mimeType === 'string') item.mimeType = c.mimeType;
          return item;
        }),
        isError: 'isError' in result ? (result.isError === true) : undefined,
      };
    },

    async close(): Promise<void> {
      status = 'disconnected';
      await transport.close();
      logger.info('MCP connection closed', {
        component: 'mcp-client',
        serverName: config.name,
      });
    },
  };
}

/**
 * Creates the appropriate transport based on server config.
 * Resolves env var names to actual values from process.env.
 */
// eslint-disable-next-line @typescript-eslint/no-deprecated -- SSE support intentional
function createTransport(config: MCPServerConfig): StdioClientTransport | SSEClientTransport {
  switch (config.transport) {
    case 'stdio': {
      if (!config.command) {
        throw new MCPConnectionError(
          config.name,
          'stdio transport requires a "command" field',
        );
      }

      const env = resolveEnvVars(config.env);

      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env as Record<string, string>, ...env },
        stderr: 'pipe',
      });
    }
    case 'sse': {
      if (!config.url) {
        throw new MCPConnectionError(
          config.name,
          'sse transport requires a "url" field',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-deprecated -- SSE support intentional
      return new SSEClientTransport(new URL(config.url));
    }
  }
}

/**
 * Resolves environment variable references.
 * Config values are env var NAMES (e.g. { GOOGLE_TOKEN: "GOOGLE_API_KEY" }),
 * and we resolve them to actual values from process.env.
 */
function resolveEnvVars(
  envConfig: Record<string, string> | undefined,
): Record<string, string> {
  if (!envConfig) return {};

  const resolved: Record<string, string> = {};
  for (const [key, envVarName] of Object.entries(envConfig)) {
    const value = process.env[envVarName];
    if (value !== undefined) {
      resolved[key] = value;
    } else {
      logger.warn('MCP env var not found', {
        component: 'mcp-client',
        key,
        envVarName,
      });
    }
  }
  return resolved;
}
