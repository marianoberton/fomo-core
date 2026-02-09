import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMCPExecutableTool, getMCPToolInputSchema } from './mcp-tool-adapter.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { MCPConnection, MCPToolInfo, MCPToolResult } from './types.js';
import { MCPToolExecutionError } from './errors.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockConnection(overrides?: Partial<MCPConnection>): MCPConnection {
  return {
    serverName: 'test-server',
    status: 'connected',
    listTools: vi.fn<() => Promise<MCPToolInfo[]>>().mockResolvedValue([]),
    callTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<MCPToolResult>>().mockResolvedValue({
      content: [{ type: 'text', text: 'mock result' }],
    }),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockToolInfo(overrides?: Partial<MCPToolInfo>): MCPToolInfo {
  return {
    name: 'list_events',
    description: 'Lists calendar events',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date to list events for' },
      },
    },
    ...overrides,
  };
}

const context = createTestContext({ allowedTools: ['mcp:test-server:list_events'] });

// ─── Tests ──────────────────────────────────────────────────────

describe('mcp-tool-adapter', () => {
  describe('createMCPExecutableTool', () => {
    let connection: MCPConnection;
    let toolInfo: MCPToolInfo;

    beforeEach(() => {
      connection = createMockConnection();
      toolInfo = createMockToolInfo();
    });

    describe('tool identity', () => {
      it('creates tool ID with mcp:{serverName}:{toolName} format', () => {
        const tool = createMCPExecutableTool({
          serverName: 'google-calendar',
          toolInfo,
          connection,
        });

        expect(tool.id).toBe('mcp:google-calendar:list_events');
      });

      it('uses custom prefix when provided', () => {
        const tool = createMCPExecutableTool({
          serverName: 'google-calendar',
          toolInfo,
          connection,
          prefix: 'gcal',
        });

        expect(tool.id).toBe('mcp:gcal:list_events');
      });

      it('preserves tool name from MCP server', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        expect(tool.name).toBe('list_events');
      });

      it('uses MCP tool description', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        expect(tool.description).toBe('Lists calendar events');
      });

      it('falls back to default description when empty', () => {
        toolInfo.description = '';
        const tool = createMCPExecutableTool({
          serverName: 'my-server',
          toolInfo,
          connection,
        });

        expect(tool.description).toBe('MCP tool from my-server');
      });

      it('sets category to mcp', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        expect(tool.category).toBe('mcp');
      });

      it('sets riskLevel to medium', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        expect(tool.riskLevel).toBe('medium');
      });

      it('marks tool as having side effects', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        expect(tool.sideEffects).toBe(true);
      });

      it('supports dry run', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        expect(tool.supportsDryRun).toBe(true);
      });
    });

    describe('schema validation', () => {
      it('accepts valid object input', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = tool.inputSchema.safeParse({ date: '2026-01-01' });
        expect(result.success).toBe(true);
      });

      it('accepts empty input (defaults to empty object)', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = tool.inputSchema.safeParse(undefined);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual({});
        }
      });

      it('accepts arbitrary keys (pass-through to MCP server)', () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = tool.inputSchema.safeParse({
          anything: 'goes',
          nested: { deep: true },
          number: 42,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('execute', () => {
      it('calls connection.callTool with correct arguments', async () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        await tool.execute({ date: '2026-01-01' }, context);

         
        expect(connection.callTool).toHaveBeenCalledWith(
          'list_events',
          { date: '2026-01-01' },
        );
      });

      it('returns successful result with text content', async () => {
        connection = createMockConnection({
          callTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<MCPToolResult>>().mockResolvedValue({
            content: [{ type: 'text', text: 'Event: Meeting at 10am' }],
          }),
        });

        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.execute({ date: '2026-01-01' }, context);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.success).toBe(true);
          expect(result.value.output).toBe('Event: Meeting at 10am');
          expect(result.value.metadata).toEqual({
            serverName: 'test-server',
            mcpToolName: 'list_events',
          });
        }
      });

      it('joins multiple text content items', async () => {
        connection = createMockConnection({
          callTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<MCPToolResult>>().mockResolvedValue({
            content: [
              { type: 'text', text: 'Event 1: Meeting' },
              { type: 'text', text: 'Event 2: Lunch' },
            ],
          }),
        });

        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.execute({}, context);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.output).toBe('Event 1: Meeting\nEvent 2: Lunch');
        }
      });

      it('filters non-text content', async () => {
        connection = createMockConnection({
          callTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<MCPToolResult>>().mockResolvedValue({
            content: [
              { type: 'text', text: 'text result' },
              { type: 'image', data: 'base64data', mimeType: 'image/png' },
            ],
          }),
        });

        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.execute({}, context);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.output).toBe('text result');
        }
      });

      it('handles MCP tool error (isError: true)', async () => {
        connection = createMockConnection({
          callTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<MCPToolResult>>().mockResolvedValue({
            content: [{ type: 'text', text: 'Invalid date format' }],
            isError: true,
          }),
        });

        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.execute({}, context);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.success).toBe(false);
          expect(result.value.error).toBe('Invalid date format');
          expect(result.value.output).toBe('Invalid date format');
        }
      });

      it('returns err on connection failure', async () => {
        connection = createMockConnection({
          callTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<MCPToolResult>>().mockRejectedValue(
            new Error('Connection refused'),
          ),
        });

        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.execute({}, context);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeInstanceOf(MCPToolExecutionError);
          expect(result.error.code).toBe('MCP_TOOL_EXECUTION_ERROR');
          expect(result.error.message).toContain('Connection refused');
        }
      });

      it('includes durationMs in result', async () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.execute({}, context);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
        }
      });

      it('passes empty object when input is nullish', async () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        await tool.execute(undefined, context);

         
        expect(connection.callTool).toHaveBeenCalledWith('list_events', {});
      });
    });

    describe('dryRun', () => {
      it('returns success without calling the server', async () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.dryRun({ date: '2026-01-01' }, context);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.success).toBe(true);
          expect(result.value.output).toContain('[dry-run]');
          expect(result.value.output).toContain('list_events');
          expect(result.value.metadata).toEqual(
            expect.objectContaining({ dryRun: true }),
          );
        }

         
        expect(connection.callTool).not.toHaveBeenCalled();
      });

      it('includes durationMs in dry run result', async () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

        const result = await tool.dryRun({}, context);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe('healthCheck', () => {
      it('returns true when connected', async () => {
        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

         
        expect(tool.healthCheck).toBeDefined();
        const healthFn = tool.healthCheck?.bind(tool);
        const healthy = healthFn ? await healthFn() : false;
        expect(healthy).toBe(true);
      });

      it('returns false when disconnected', async () => {
        connection = createMockConnection({ status: 'disconnected' });

        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

         
        expect(tool.healthCheck).toBeDefined();
        const healthFn = tool.healthCheck?.bind(tool);
        const healthy = healthFn ? await healthFn() : false;
        expect(healthy).toBe(false);
      });

      it('returns false when in error state', async () => {
        connection = createMockConnection({ status: 'error' });

        const tool = createMCPExecutableTool({
          serverName: 'test-server',
          toolInfo,
          connection,
        });

         
        expect(tool.healthCheck).toBeDefined();
        const healthFn = tool.healthCheck?.bind(tool);
        const healthy = healthFn ? await healthFn() : false;
        expect(healthy).toBe(false);
      });
    });
  });

  describe('getMCPToolInputSchema', () => {
    it('returns input schema from tool info', () => {
      const toolInfo: MCPToolInfo = {
        name: 'test',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      };

      const schema = getMCPToolInputSchema(toolInfo);

      expect(schema).toEqual({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      });
    });

    it('adds type: object if missing', () => {
      const toolInfo: MCPToolInfo = {
        name: 'test',
        description: 'Test tool',
        inputSchema: {
          properties: { query: { type: 'string' } },
        },
      };

      const schema = getMCPToolInputSchema(toolInfo);

      expect(schema['type']).toBe('object');
      expect(schema['properties']).toEqual({ query: { type: 'string' } });
    });

    it('returns empty object schema for missing inputSchema', () => {
      const toolInfo = {
        name: 'test',
        description: 'Test tool',
        inputSchema: undefined,
      } as unknown as MCPToolInfo;

      const schema = getMCPToolInputSchema(toolInfo);

      expect(schema).toEqual({ type: 'object', properties: {} });
    });
  });
});
