/**
 * Tests for the send-channel-message tool.
 * 3 levels: schema validation, dry-run, execution (with mocked channel router).
 */
import { describe, it, expect, vi } from 'vitest';
import { createSendChannelMessageTool } from './send-channel-message.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { ChannelRouter } from '@/channels/channel-router.js';
import type { ChannelType, SendResult } from '@/channels/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockChannelRouter(overrides?: Partial<ChannelRouter>): ChannelRouter {
  return {
    registerAdapter: vi.fn(),
    getAdapter: vi.fn(() => ({
      channelType: 'whatsapp' as ChannelType,
      send: vi.fn(),
      parseInbound: vi.fn(),
      isHealthy: vi.fn(() => Promise.resolve(true)),
    })),
    send: vi.fn(() => Promise.resolve({ success: true, channelMessageId: 'msg-123' } as SendResult)),
    parseInbound: vi.fn(() => Promise.resolve(null)),
    listChannels: vi.fn(() => ['whatsapp', 'telegram'] as ChannelType[]),
    isHealthy: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

const context = createTestContext({ allowedTools: ['send-channel-message'] });

// ─── Tests ──────────────────────────────────────────────────────

describe('send-channel-message tool', () => {
  // ─── Level 1: Schema Validation ─────────────────────────────

  describe('schema validation', () => {
    const tool = createSendChannelMessageTool({
      channelRouter: createMockChannelRouter(),
    });

    it('accepts valid input', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'whatsapp',
        recipientIdentifier: '+5491112345678',
        message: 'Hello!',
      });
      expect(result.success).toBe(true);
    });

    it('accepts all valid channel types', () => {
      for (const channel of ['whatsapp', 'telegram', 'slack', 'email', 'chatwoot']) {
        const result = tool.inputSchema.safeParse({
          channel,
          recipientIdentifier: 'test-id',
          message: 'Hello',
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid channel type', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'sms',
        recipientIdentifier: '+123',
        message: 'Hello',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty recipientIdentifier', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'whatsapp',
        recipientIdentifier: '',
        message: 'Hello',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty message', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'whatsapp',
        recipientIdentifier: '+123',
        message: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing fields', () => {
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ─── Level 2: Dry Run ──────────────────────────────────────

  describe('dry run', () => {
    it('returns success with adapter status when adapter exists', async () => {
      const tool = createSendChannelMessageTool({
        channelRouter: createMockChannelRouter(),
      });

      const result = await tool.dryRun({
        channel: 'whatsapp',
        recipientIdentifier: '+5491112345678',
        message: 'Hello',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['channel']).toBe('whatsapp');
        expect(output['adapterRegistered']).toBe(true);
        expect(output['availableChannels']).toEqual(['whatsapp', 'telegram']);
      }
    });

    it('shows adapterRegistered=false when no adapter', async () => {
      const tool = createSendChannelMessageTool({
        channelRouter: createMockChannelRouter({
          getAdapter: vi.fn(() => undefined),
          listChannels: vi.fn(() => [] as ChannelType[]),
        }),
      });

      const result = await tool.dryRun({
        channel: 'slack',
        recipientIdentifier: '#general',
        message: 'Hello',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['adapterRegistered']).toBe(false);
      }
    });
  });

  // ─── Level 3: Execution ────────────────────────────────────

  describe('execution', () => {
    it('sends message via channel router', async () => {
      const sendMock = vi.fn(() => Promise.resolve({
        success: true,
        channelMessageId: 'wa-msg-456',
      } as SendResult));

      const router = createMockChannelRouter({ send: sendMock });
      const tool = createSendChannelMessageTool({ channelRouter: router });

      const result = await tool.execute({
        channel: 'whatsapp',
        recipientIdentifier: '+5491112345678',
        message: 'Hello from the agent!',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { success: boolean; channelMessageId: string };
        expect(output.success).toBe(true);
        expect(output.channelMessageId).toBe('wa-msg-456');
      }

      expect(sendMock).toHaveBeenCalledOnce();
      expect(sendMock).toHaveBeenCalledWith({
        channel: 'whatsapp',
        recipientIdentifier: '+5491112345678',
        content: 'Hello from the agent!',
      });
    });

    it('returns error when no adapter is registered', async () => {
      const tool = createSendChannelMessageTool({
        channelRouter: createMockChannelRouter({
          getAdapter: vi.fn(() => undefined),
          listChannels: vi.fn(() => ['whatsapp'] as ChannelType[]),
        }),
      });

      const result = await tool.execute({
        channel: 'slack',
        recipientIdentifier: '#general',
        message: 'Hello',
      }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No adapter registered');
        expect(result.error.message).toContain('slack');
      }
    });

    it('returns error when send fails', async () => {
      const tool = createSendChannelMessageTool({
        channelRouter: createMockChannelRouter({
          send: vi.fn(() => Promise.resolve({
            success: false,
            error: 'Message delivery failed',
          } as SendResult)),
        }),
      });

      const result = await tool.execute({
        channel: 'whatsapp',
        recipientIdentifier: '+123',
        message: 'Hello',
      }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Message delivery failed');
      }
    });

    it('has correct risk level and approval settings', () => {
      const tool = createSendChannelMessageTool({
        channelRouter: createMockChannelRouter(),
      });

      expect(tool.riskLevel).toBe('medium');
      expect(tool.requiresApproval).toBe(true);
      expect(tool.sideEffects).toBe(true);
    });
  });
});
