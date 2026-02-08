import { describe, it, expect, vi } from 'vitest';
import { createToolRegistry } from './tool-registry.js';
import { createTestContext, createEchoTool, createDangerousTool } from '@/testing/index.js';

describe('ToolRegistry', () => {
  describe('register / unregister', () => {
    it('registers a tool and makes it retrievable', () => {
      const registry = createToolRegistry();
      const echo = createEchoTool();
      registry.register(echo);

      expect(registry.has('echo')).toBe(true);
      expect(registry.get('echo')).toBe(echo);
    });

    it('lists all registered tool IDs', () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());
      registry.register(createDangerousTool());

      expect(registry.listAll()).toEqual(
        expect.arrayContaining(['echo', 'dangerous-action']),
      );
    });

    it('unregisters a tool', () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());

      expect(registry.unregister('echo')).toBe(true);
      expect(registry.has('echo')).toBe(false);
    });

    it('returns false when unregistering a non-existent tool', () => {
      const registry = createToolRegistry();
      expect(registry.unregister('nope')).toBe(false);
    });

    it('returns undefined for unregistered tools', () => {
      const registry = createToolRegistry();
      expect(registry.get('nope')).toBeUndefined();
    });
  });

  describe('RBAC enforcement', () => {
    it('listForContext only returns tools in the allowedTools set', () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());
      registry.register(createDangerousTool());

      const ctx = createTestContext({ allowedTools: ['echo'] });
      const available = registry.listForContext(ctx);

      expect(available).toHaveLength(1);
      expect(available[0]!.id).toBe('echo');
    });

    it('blocks tool execution when not in allowedTools', async () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());

      const ctx = createTestContext({ allowedTools: [] });
      const result = await registry.resolve('echo', { message: 'hi' }, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_ALLOWED');
      }
    });

    it('returns hallucination error for non-existent tools', async () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());

      const ctx = createTestContext({ allowedTools: ['echo', 'ghost-tool'] });
      const result = await registry.resolve('ghost-tool', {}, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_HALLUCINATION');
      }
    });
  });

  describe('input validation', () => {
    it('rejects invalid input against tool schema', async () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());

      const ctx = createTestContext({ allowedTools: ['echo'] });
      // Echo expects { message: string }, send a number instead
      const result = await registry.resolve('echo', { message: 123 } as unknown as Record<string, unknown>, ctx);

      expect(result.ok).toBe(false);
    });

    it('accepts valid input and executes', async () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());

      const ctx = createTestContext({ allowedTools: ['echo'] });
      const result = await registry.resolve('echo', { message: 'hello' }, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.output).toEqual({ echo: 'hello' });
      }
    });
  });

  describe('approval gate', () => {
    it('blocks high-risk tools when no approval gate is configured', async () => {
      const registry = createToolRegistry();
      registry.register(createDangerousTool());

      const ctx = createTestContext({ allowedTools: ['dangerous-action'] });
      const result = await registry.resolve('dangerous-action', { target: 'db' }, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('APPROVAL_REQUIRED');
      }
    });

    it('blocks when approval gate denies', async () => {
      const approvalGate = vi.fn().mockResolvedValue({
        approved: false,
        approvalId: 'appr-001',
      });
      const registry = createToolRegistry({ approvalGate });
      registry.register(createDangerousTool());

      const ctx = createTestContext({ allowedTools: ['dangerous-action'] });
      const result = await registry.resolve('dangerous-action', { target: 'db' }, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('APPROVAL_REQUIRED');
      }
      expect(approvalGate).toHaveBeenCalledWith('dangerous-action', { target: 'db' }, ctx);
    });

    it('allows execution when approval gate approves', async () => {
      const approvalGate = vi.fn().mockResolvedValue({
        approved: true,
        approvalId: 'appr-002',
      });
      const registry = createToolRegistry({ approvalGate });
      registry.register(createDangerousTool());

      const ctx = createTestContext({ allowedTools: ['dangerous-action'] });
      const result = await registry.resolve('dangerous-action', { target: 'db' }, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.output).toEqual({ executed: 'db' });
      }
    });

    it('does not check approval gate for low-risk tools', async () => {
      const approvalGate = vi.fn();
      const registry = createToolRegistry({ approvalGate });
      registry.register(createEchoTool());

      const ctx = createTestContext({ allowedTools: ['echo'] });
      await registry.resolve('echo', { message: 'hi' }, ctx);

      expect(approvalGate).not.toHaveBeenCalled();
    });
  });

  describe('dry run', () => {
    it('executes dryRun without approval checks', async () => {
      const registry = createToolRegistry();
      registry.register(createDangerousTool());

      const ctx = createTestContext({ allowedTools: ['dangerous-action'] });
      const result = await registry.resolveDryRun('dangerous-action', { target: 'db' }, ctx);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.output).toEqual({ wouldExecute: 'db', dryRun: true });
      }
    });

    it('still enforces RBAC for dry runs', async () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());

      const ctx = createTestContext({ allowedTools: [] });
      const result = await registry.resolveDryRun('echo', { message: 'hi' }, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_ALLOWED');
      }
    });
  });

  describe('formatForProvider', () => {
    it('formats allowed tools for LLM consumption', () => {
      const registry = createToolRegistry();
      registry.register(createEchoTool());
      registry.register(createDangerousTool());

      const ctx = createTestContext({ allowedTools: ['echo'] });
      const formatted = registry.formatForProvider(ctx);

      expect(formatted).toHaveLength(1);
      expect(formatted[0]!.name).toBe('echo');
      expect(formatted[0]!.description).toBe('Echoes the input message back.');
    });
  });
});
