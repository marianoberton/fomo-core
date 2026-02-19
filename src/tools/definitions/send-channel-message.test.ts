/**
 * Tests for the send-channel-message tool.
 * 3 levels: schema validation, dry-run, execution (with mocked channel resolver).
 */
import { describe, it, expect, vi } from 'vitest';
import { createSendChannelMessageTool } from './send-channel-message.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { ChannelAdapter, SendResult } from '@/channels/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockAdapter(): ChannelAdapter {
  return {
    channelType: 'whatsapp',
    send: vi.fn(() => Promise.resolve({ success: true, channelMessageId: 'msg-123' } as SendResult)),
    parseInbound: vi.fn(() => Promise.resolve(null)),
    isHealthy: vi.fn(() => Promise.resolve(true)),
  };
}

function createMockChannelResolver(overrides?: Partial<ChannelResolver>): ChannelResolver {
  return {
    resolveAdapter: vi.fn(() => Promise.resolve(createMockAdapter())),
    resolveIntegration: vi.fn(() => Promise.resolve(null)),
    resolveProjectByIntegration: vi.fn(() => Promise.resolve(null)),
    resolveProjectByAccount: vi.fn(() => Promise.resolve(null)),
    send: vi.fn(() => Promise.resolve({ success: true, channelMessageId: 'msg-123' } as SendResult)),
    invalidate: vi.fn(),
    ...overrides,
  };
}

const context = createTestContext({ allowedTools: ['send-channel-message'] });

// ─── Tests ──────────────────────────────────────────────────────

describe('send-channel-message tool', () => {
  // ─── Level 1: Schema Validation ─────────────────────────────

  describe('schema validation', () => {
    const tool = createSendChannelMessageTool({
      channelResolver: createMockChannelResolver(),
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
      for (const channel of ['whatsapp', 'telegram', 'slack', 'chatwoot']) {
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

    it('rejects email channel type (removed)', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'email',
        recipientIdentifier: 'user@test.com',
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
    it('returns success with adapter status when adapter is configured', async () => {
      const tool = createSendChannelMessageTool({
        channelResolver: createMockChannelResolver(),
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
        expect(output['adapterConfigured']).toBe(true);
      }
    });

    it('shows adapterConfigured=false when no adapter', async () => {
      const tool = createSendChannelMessageTool({
        channelResolver: createMockChannelResolver({
          resolveAdapter: vi.fn(() => Promise.resolve(null)),
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
        expect(output['adapterConfigured']).toBe(false);
      }
    });
  });

  // ─── Level 3: Execution ────────────────────────────────────

  describe('execution', () => {
    it('sends message via channel resolver', async () => {
      const sendMock = vi.fn(() => Promise.resolve({
        success: true,
        channelMessageId: 'wa-msg-456',
      } as SendResult));

      const resolver = createMockChannelResolver({ send: sendMock });
      const tool = createSendChannelMessageTool({ channelResolver: resolver });

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
      expect(sendMock).toHaveBeenCalledWith(
        'test-project',
        'whatsapp',
        {
          channel: 'whatsapp',
          recipientIdentifier: '+5491112345678',
          content: 'Hello from the agent!',
        },
      );
    });

    it('returns error when no adapter is configured', async () => {
      const tool = createSendChannelMessageTool({
        channelResolver: createMockChannelResolver({
          resolveAdapter: vi.fn(() => Promise.resolve(null)),
        }),
      });

      const result = await tool.execute({
        channel: 'slack',
        recipientIdentifier: '#general',
        message: 'Hello',
      }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No slack integration configured');
      }
    });

    it('returns error when send fails', async () => {
      const tool = createSendChannelMessageTool({
        channelResolver: createMockChannelResolver({
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
        channelResolver: createMockChannelResolver(),
      });

      expect(tool.riskLevel).toBe('medium');
      expect(tool.requiresApproval).toBe(true);
      expect(tool.sideEffects).toBe(true);
    });
  });
});
