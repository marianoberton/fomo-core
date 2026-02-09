import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MCPServerConfig, MCPConnection, MCPToolInfo, MCPToolResult } from './types.js';

// ─── Hoisted mocks ──────────────────────────────────────────────

const { mockCreateMCPConnection } = vi.hoisted(() => ({
  mockCreateMCPConnection: vi.fn(),
}));

vi.mock('./mcp-client.js', () => ({
  createMCPConnection: mockCreateMCPConnection,
}));

import { createMCPManager } from './mcp-manager.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockConnection(
  serverName: string,
  tools: MCPToolInfo[] = [],
  overrides?: Partial<MCPConnection>,
): MCPConnection {
  return {
    serverName,
    status: 'connected',
    listTools: vi.fn<() => Promise<MCPToolInfo[]>>().mockResolvedValue(tools),
    callTool: vi.fn<(name: string, args: Record<string, unknown>) => Promise<MCPToolResult>>().mockResolvedValue({
      content: [{ type: 'text', text: 'mock result' }],
    }),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

const calendarTools: MCPToolInfo[] = [
  {
    name: 'list_events',
    description: 'Lists calendar events',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
  },
  {
    name: 'create_event',
    description: 'Creates an event',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  },
];

const emailTools: MCPToolInfo[] = [
  {
    name: 'send_email',
    description: 'Sends an email',
    inputSchema: { type: 'object', properties: { to: { type: 'string' } } },
  },
];

// ─── Tests ──────────────────────────────────────────────────────

describe('mcp-manager', () => {
  beforeEach(() => {
    mockCreateMCPConnection.mockReset();
  });

  describe('connectAll', () => {
    it('connects to multiple MCP servers', async () => {
      const calendarConn = createMockConnection('google-calendar', calendarTools);
      const emailConn = createMockConnection('gmail', emailTools);

      mockCreateMCPConnection
        .mockResolvedValueOnce(calendarConn)
        .mockResolvedValueOnce(emailConn);

      const manager = createMCPManager();
      const configs: MCPServerConfig[] = [
        { name: 'google-calendar', transport: 'stdio', command: 'npx' },
        { name: 'gmail', transport: 'stdio', command: 'npx' },
      ];

      await manager.connectAll(configs);

      expect(manager.getTools()).toHaveLength(3);
      expect(manager.listConnections()).toHaveLength(2);
    });

    it('discovers and wraps tools as ExecutableTool', async () => {
      const conn = createMockConnection('google-calendar', calendarTools);
      mockCreateMCPConnection.mockResolvedValue(conn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'google-calendar', transport: 'stdio', command: 'npx' },
      ]);

      const tools = manager.getTools();
      expect(tools).toHaveLength(2);
      expect(tools[0]?.id).toBe('mcp:google-calendar:list_events');
      expect(tools[1]?.id).toBe('mcp:google-calendar:create_event');
      expect(tools[0]?.category).toBe('mcp');
    });

    it('respects custom toolPrefix', async () => {
      const conn = createMockConnection('google-calendar', calendarTools);
      mockCreateMCPConnection.mockResolvedValue(conn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'google-calendar', transport: 'stdio', command: 'npx', toolPrefix: 'gcal' },
      ]);

      const tools = manager.getTools();
      expect(tools[0]?.id).toBe('mcp:gcal:list_events');
      expect(tools[1]?.id).toBe('mcp:gcal:create_event');
    });

    it('handles connection failures gracefully', async () => {
      const emailConn = createMockConnection('gmail', emailTools);

      mockCreateMCPConnection
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(emailConn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'broken-server', transport: 'stdio', command: 'broken' },
        { name: 'gmail', transport: 'stdio', command: 'npx' },
      ]);

      // Should still have gmail tools even though broken-server failed
      expect(manager.getTools()).toHaveLength(1);
      expect(manager.getTools()[0]?.id).toBe('mcp:gmail:send_email');
      expect(manager.listConnections()).toHaveLength(1);
    });

    it('handles tool discovery failures gracefully', async () => {
      const conn = createMockConnection('broken-tools', [], {
        listTools: vi.fn<() => Promise<MCPToolInfo[]>>().mockRejectedValue(new Error('list failed')),
      });
      mockCreateMCPConnection.mockResolvedValue(conn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'broken-tools', transport: 'stdio', command: 'npx' },
      ]);

      // Connection succeeded but tool discovery failed — still graceful
      expect(manager.getTools()).toHaveLength(0);
    });

    it('passes timeout option to createMCPConnection', async () => {
      const conn = createMockConnection('test', []);
      mockCreateMCPConnection.mockResolvedValue(conn);

      const manager = createMCPManager({ timeoutMs: 5000 });
      await manager.connectAll([
        { name: 'test', transport: 'stdio', command: 'npx' },
      ]);

      expect(mockCreateMCPConnection).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 5000 }),
      );
    });
  });

  describe('disconnect', () => {
    it('disconnects a specific server and removes its tools', async () => {
      const calendarConn = createMockConnection('google-calendar', calendarTools);
      const emailConn = createMockConnection('gmail', emailTools);

      mockCreateMCPConnection
        .mockResolvedValueOnce(calendarConn)
        .mockResolvedValueOnce(emailConn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'google-calendar', transport: 'stdio', command: 'npx' },
        { name: 'gmail', transport: 'stdio', command: 'npx' },
      ]);

      expect(manager.getTools()).toHaveLength(3);

      await manager.disconnect('google-calendar');

      expect(manager.getTools()).toHaveLength(1);
      expect(manager.getTools()[0]?.id).toBe('mcp:gmail:send_email');
       
      expect(calendarConn.close).toHaveBeenCalled();
      expect(manager.getConnection('google-calendar')).toBeUndefined();
    });

    it('no-ops for unknown server name', async () => {
      const manager = createMCPManager();
      await manager.disconnect('nonexistent');
      // Should not throw
    });
  });

  describe('disconnectAll', () => {
    it('disconnects all servers and clears tools', async () => {
      const calendarConn = createMockConnection('google-calendar', calendarTools);
      const emailConn = createMockConnection('gmail', emailTools);

      mockCreateMCPConnection
        .mockResolvedValueOnce(calendarConn)
        .mockResolvedValueOnce(emailConn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'google-calendar', transport: 'stdio', command: 'npx' },
        { name: 'gmail', transport: 'stdio', command: 'npx' },
      ]);

      await manager.disconnectAll();

      expect(manager.getTools()).toHaveLength(0);
      expect(manager.listConnections()).toHaveLength(0);
       
      expect(calendarConn.close).toHaveBeenCalled();
       
      expect(emailConn.close).toHaveBeenCalled();
    });
  });

  describe('getConnection', () => {
    it('returns connection by server name', async () => {
      const conn = createMockConnection('test-server', []);
      mockCreateMCPConnection.mockResolvedValue(conn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'test-server', transport: 'stdio', command: 'npx' },
      ]);

      expect(manager.getConnection('test-server')).toBe(conn);
    });

    it('returns undefined for unknown server', () => {
      const manager = createMCPManager();
      expect(manager.getConnection('unknown')).toBeUndefined();
    });
  });

  describe('listConnections', () => {
    it('returns status info for all connections', async () => {
      const calendarConn = createMockConnection('google-calendar', calendarTools);
      const emailConn = createMockConnection('gmail', emailTools);

      mockCreateMCPConnection
        .mockResolvedValueOnce(calendarConn)
        .mockResolvedValueOnce(emailConn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'google-calendar', transport: 'stdio', command: 'npx' },
        { name: 'gmail', transport: 'stdio', command: 'npx' },
      ]);

      const statuses = manager.listConnections();

      expect(statuses).toHaveLength(2);
      expect(statuses).toEqual(
        expect.arrayContaining([
          { name: 'google-calendar', status: 'connected', toolCount: 2 },
          { name: 'gmail', status: 'connected', toolCount: 1 },
        ]),
      );
    });
  });

  describe('getToolSchemas', () => {
    it('returns JSON Schemas for all MCP tools', async () => {
      const conn = createMockConnection('google-calendar', calendarTools);
      mockCreateMCPConnection.mockResolvedValue(conn);

      const manager = createMCPManager();
      await manager.connectAll([
        { name: 'google-calendar', transport: 'stdio', command: 'npx' },
      ]);

      const schemas = manager.getToolSchemas();

      expect(schemas.size).toBe(2);
      expect(schemas.get('mcp:google-calendar:list_events')).toEqual({
        type: 'object',
        properties: { date: { type: 'string' } },
      });
    });
  });
});
