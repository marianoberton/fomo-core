/**
 * Adapts MCP server tools into Nexus ExecutableTool instances.
 * Once adapted, MCP tools are indistinguishable from native tools
 * in the ToolRegistry and agent loop.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import type { MCPConnection, MCPToolInfo } from './types.js';
import { MCPToolExecutionError } from './errors.js';

const logger = createLogger({ name: 'mcp-tool-adapter' });

/** Options for creating an MCP executable tool. */
export interface MCPToolAdapterOptions {
  /** The MCP server name (for logging and error context). */
  serverName: string;
  /** Tool info as reported by the MCP server. */
  toolInfo: MCPToolInfo;
  /** Live connection to the MCP server. */
  connection: MCPConnection;
  /** Namespace prefix for the tool ID. Defaults to serverName. */
  prefix?: string;
}

/**
 * Creates a Nexus ExecutableTool that delegates execution to an MCP server.
 * The tool ID is namespaced as `mcp:{prefix}:{toolName}` to avoid collisions.
 */
export function createMCPExecutableTool(options: MCPToolAdapterOptions): ExecutableTool {
  const { serverName, toolInfo, connection, prefix } = options;
  const toolPrefix = prefix ?? serverName;
  const toolId = `mcp:${toolPrefix}:${toolInfo.name}`;

  // Build a Zod schema that passes through validation to the MCP server.
  // MCP servers define their own JSON Schema — we accept any object here
  // and let the server reject invalid input with a meaningful error.
  const inputSchema = z.record(z.string(), z.unknown()).optional().default({});

  return {
    id: toolId,
    name: toolInfo.name,
    description: toolInfo.description ? toolInfo.description : `MCP tool from ${serverName}`,
    category: 'mcp',
    inputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const startTime = Date.now();

      try {
        logger.info('Executing MCP tool', {
          component: 'mcp-tool-adapter',
          toolId,
          serverName,
          mcpToolName: toolInfo.name,
        });

        const toolInput = (input ?? {}) as Record<string, unknown>;
        const mcpResult = await connection.callTool(toolInfo.name, toolInput);

        const durationMs = Date.now() - startTime;

        // Extract text content from MCP result
        const textParts = mcpResult.content
          .filter((c): c is typeof c & { text: string } => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text);
        const output = textParts.length === 1 ? (textParts[0] ?? '') : textParts.join('\n');

        if (mcpResult.isError) {
          logger.warn('MCP tool returned error', {
            component: 'mcp-tool-adapter',
            toolId,
            serverName,
            output,
            durationMs,
          });

          return ok({
            success: false,
            output,
            error: output !== '' ? output : 'MCP tool returned an error',
            durationMs,
            metadata: { serverName, mcpToolName: toolInfo.name },
          });
        }

        logger.debug('MCP tool executed successfully', {
          component: 'mcp-tool-adapter',
          toolId,
          serverName,
          durationMs,
        });

        return ok({
          success: true,
          output,
          durationMs,
          metadata: { serverName, mcpToolName: toolInfo.name },
        });
      } catch (error: unknown) {
        const durationMs = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);

        logger.error('MCP tool execution failed', {
          component: 'mcp-tool-adapter',
          toolId,
          serverName,
          error: message,
          durationMs,
        });

        return err(
          new MCPToolExecutionError(serverName, toolInfo.name, message,
            error instanceof Error ? error : undefined),
        );
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const startTime = Date.now();

      // Validate input shape (basic check — the MCP server defines the real schema)
      const parseResult = inputSchema.safeParse(input);
      if (!parseResult.success) {
        return err(
          new MCPToolExecutionError(
            serverName,
            toolInfo.name,
            `Input validation failed: ${parseResult.error.message}`,
          ),
        );
      }

      return Promise.resolve(ok({
        success: true,
        output: `[dry-run] Would call MCP tool "${toolInfo.name}" on server "${serverName}"`,
        durationMs: Date.now() - startTime,
        metadata: { serverName, mcpToolName: toolInfo.name, dryRun: true },
      }));
    },

    healthCheck(): Promise<boolean> {
      return Promise.resolve(connection.status === 'connected');
    },
  };
}

/**
 * Get the JSON Schema for an MCP tool's input, suitable for LLM providers.
 * Falls back to an empty object schema if the MCP server doesn't provide one.
 */
export function getMCPToolInputSchema(toolInfo: MCPToolInfo): Record<string, unknown> {
  const schema = toolInfo.inputSchema as Record<string, unknown> | undefined;
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  // Ensure it has type: "object" at the top level (required by OpenAI)
  if (!('type' in schema)) {
    return { type: 'object', properties: {}, ...schema };
  }
  return schema;
}
