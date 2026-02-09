import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPConnectionError } from './errors.js';

// ─── Hoisted mocks (must be declared before vi.mock factories) ──

const {
  mockConnect,
  mockListTools,
  mockCallTool,
  mockClientConstructor,
  mockStdioConstructor,
  mockSSEConstructor,
} = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const listTools = vi.fn().mockResolvedValue({
    tools: [
      {
        name: 'list_events',
        description: 'Lists calendar events',
        inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
      },
      {
        name: 'create_event',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  });
  const callTool = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'result' }],
    isError: false,
  });

  return {
    mockConnect: connect,
    mockListTools: listTools,
    mockCallTool: callTool,
    mockClientConstructor: vi.fn().mockImplementation(() => ({
      connect,
      listTools,
      callTool,
    })),
    mockStdioConstructor: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
      onerror: undefined,
    })),
    mockSSEConstructor: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
      onerror: undefined,
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mockClientConstructor,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mockStdioConstructor,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mockSSEConstructor,
}));

// Import after mocks are set up
import { createMCPConnection } from './mcp-client.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('mcp-client', () => {
  beforeEach(() => {
    // Reset call history but keep implementations
    mockConnect.mockClear().mockResolvedValue(undefined);
    mockListTools.mockClear().mockResolvedValue({
      tools: [
        {
          name: 'list_events',
          description: 'Lists calendar events',
          inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
        },
        {
          name: 'create_event',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
    mockCallTool.mockClear().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
      isError: false,
    });
    mockClientConstructor.mockClear().mockImplementation(() => ({
      connect: mockConnect,
      listTools: mockListTools,
      callTool: mockCallTool,
    }));
    mockStdioConstructor.mockClear().mockImplementation(() => ({
      start: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
      onerror: undefined,
    }));
    mockSSEConstructor.mockClear().mockImplementation(() => ({
      start: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
      onerror: undefined,
    }));
  });

  describe('createMCPConnection — stdio', () => {
    it('creates connection with stdio transport', async () => {
      const conn = await createMCPConnection({
        config: {
          name: 'test-server',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@anthropic/mcp-server'],
        },
      });

      expect(conn.serverName).toBe('test-server');
      expect(conn.status).toBe('connected');
      expect(mockStdioConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'npx',
          args: ['-y', '@anthropic/mcp-server'],
          stderr: 'pipe',
        }),
      );
    });

    it('throws MCPConnectionError for stdio without command', async () => {
      await expect(
        createMCPConnection({
          config: {
            name: 'test-server',
            transport: 'stdio',
          },
        }),
      ).rejects.toThrow(MCPConnectionError);
    });

    it('resolves env var names from process.env', async () => {
      const originalEnv = process.env['TEST_API_KEY'];
      process.env['TEST_API_KEY'] = 'secret-value-123';

      try {
        await createMCPConnection({
          config: {
            name: 'test-server',
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { API_KEY: 'TEST_API_KEY' },
          },
        });

        expect(mockStdioConstructor).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            env: expect.objectContaining({ API_KEY: 'secret-value-123' }),
          }),
        );
      } finally {
        if (originalEnv === undefined) {
          delete process.env['TEST_API_KEY'];
        } else {
          process.env['TEST_API_KEY'] = originalEnv;
        }
      }
    });

    it('skips unresolvable env vars', async () => {
      delete process.env['NONEXISTENT_VAR_XYZ'];

      await createMCPConnection({
        config: {
          name: 'test-server',
          transport: 'stdio',
          command: 'node',
          env: { API_KEY: 'NONEXISTENT_VAR_XYZ' },
        },
      });

      // Should not have the env var in the resolved env
      const firstCall = mockStdioConstructor.mock.calls[0] as Record<string, unknown>[] | undefined;
      expect(firstCall).toBeDefined();
      const passedConfig = firstCall?.[0];
      const passedEnv = passedConfig?.['env'] as Record<string, string> | undefined;
      expect(passedEnv?.['API_KEY']).toBeUndefined();
    });
  });

  describe('createMCPConnection — sse', () => {
    it('creates connection with SSE transport', async () => {
      const conn = await createMCPConnection({
        config: {
          name: 'remote-server',
          transport: 'sse',
          url: 'http://localhost:8080/mcp',
        },
      });

      expect(conn.serverName).toBe('remote-server');
      expect(conn.status).toBe('connected');
      expect(mockSSEConstructor).toHaveBeenCalledWith(
        new URL('http://localhost:8080/mcp'),
      );
    });

    it('throws MCPConnectionError for sse without url', async () => {
      await expect(
        createMCPConnection({
          config: {
            name: 'remote-server',
            transport: 'sse',
          },
        }),
      ).rejects.toThrow(MCPConnectionError);
    });
  });

  describe('createMCPConnection — connection failure', () => {
    it('wraps SDK errors in MCPConnectionError', async () => {
      mockConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        createMCPConnection({
          config: {
            name: 'broken-server',
            transport: 'stdio',
            command: 'broken',
          },
        }),
      ).rejects.toThrow(MCPConnectionError);
    });

    it('includes server name in error', async () => {
      mockConnect.mockRejectedValueOnce(new Error('timeout'));

      try {
        await createMCPConnection({
          config: {
            name: 'slow-server',
            transport: 'stdio',
            command: 'slow',
          },
        });
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(MCPConnectionError);
        expect((error as MCPConnectionError).message).toContain('slow-server');
      }
    });

    it('passes timeout option to client.connect', async () => {
      await createMCPConnection({
        config: {
          name: 'test-server',
          transport: 'stdio',
          command: 'npx',
        },
        timeoutMs: 5000,
      });

      expect(mockConnect).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ timeout: 5000 }),
      );
    });
  });

  describe('MCPConnection interface', () => {
    it('listTools returns tool info from server', async () => {
      const conn = await createMCPConnection({
        config: {
          name: 'test-server',
          transport: 'stdio',
          command: 'npx',
        },
      });

      const tools = await conn.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({
        name: 'list_events',
        description: 'Lists calendar events',
        inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
      });
      expect(tools[1]).toEqual({
        name: 'create_event',
        description: '',
        inputSchema: { type: 'object', properties: {} },
      });
    });

    it('callTool delegates to SDK client', async () => {
      const conn = await createMCPConnection({
        config: {
          name: 'test-server',
          transport: 'stdio',
          command: 'npx',
        },
      });

      const result = await conn.callTool('list_events', { date: '2026-01-01' });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'list_events',
        arguments: { date: '2026-01-01' },
      });
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe('result');
    });

    it('callTool handles isError flag', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'error happened' }],
        isError: true,
      });

      const conn = await createMCPConnection({
        config: {
          name: 'test-server',
          transport: 'stdio',
          command: 'npx',
        },
      });

      const result = await conn.callTool('fail_tool', {});

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe('error happened');
    });

    it('close sets status to disconnected', async () => {
      const conn = await createMCPConnection({
        config: {
          name: 'test-server',
          transport: 'stdio',
          command: 'npx',
        },
      });

      expect(conn.status).toBe('connected');
      await conn.close();
      expect(conn.status).toBe('disconnected');
    });
  });
});
