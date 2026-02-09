import { describe, it, expect, vi } from 'vitest';
import { createSendNotificationTool } from './send-notification.js';
import type { NotificationSender } from './send-notification.js';
import { createTestContext } from '@/testing/fixtures/context.js';

const context = createTestContext({ allowedTools: ['send-notification'] });

function createMockSender(
  result: { success: boolean; response?: unknown } = { success: true },
): NotificationSender {
  return {
    send: vi.fn().mockResolvedValue(result),
  };
}

describe('send-notification', () => {
  describe('schema validation', () => {
    const tool = createSendNotificationTool();

    it('accepts a valid webhook notification', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'webhook',
        target: 'https://hooks.slack.com/services/xxx',
        subject: 'Alert',
        message: 'Something happened',
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional metadata', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'webhook',
        target: 'https://hooks.example.com/notify',
        subject: 'Test',
        message: 'Test message',
        metadata: { priority: 'high', tags: ['alert'] },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing channel', () => {
      const result = tool.inputSchema.safeParse({
        target: 'https://example.com',
        subject: 'Test',
        message: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects unsupported channel', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'email',
        target: 'user@example.com',
        subject: 'Test',
        message: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid target URL', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'webhook',
        target: 'not-a-url',
        subject: 'Test',
        message: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty subject', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'webhook',
        target: 'https://example.com/hook',
        subject: '',
        message: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty message', () => {
      const result = tool.inputSchema.safeParse({
        channel: 'webhook',
        target: 'https://example.com/hook',
        subject: 'Test',
        message: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('tool definition', () => {
    const tool = createSendNotificationTool();

    it('is high risk', () => {
      expect(tool.riskLevel).toBe('high');
    });

    it('requires approval', () => {
      expect(tool.requiresApproval).toBe(true);
    });

    it('has side effects', () => {
      expect(tool.sideEffects).toBe(true);
    });
  });

  describe('dry run', () => {
    const tool = createSendNotificationTool();

    it('validates and returns payload without sending', async () => {
      const result = await tool.dryRun(
        {
          channel: 'webhook',
          target: 'https://hooks.example.com/notify',
          subject: 'Alert',
          message: 'Server is down',
        },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['channel']).toBe('webhook');
        expect(output['target']).toBe('https://hooks.example.com/notify');
        expect(output['subject']).toBe('Alert');
      }
    });

    it('blocks SSRF target in dry run', async () => {
      const result = await tool.dryRun(
        {
          channel: 'webhook',
          target: 'http://192.168.1.1/internal',
          subject: 'Test',
          message: 'Test',
        },
        context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Blocked host');
      }
    });

    it('blocks localhost target in dry run', async () => {
      const result = await tool.dryRun(
        {
          channel: 'webhook',
          target: 'http://localhost:8080/hook',
          subject: 'Test',
          message: 'Test',
        },
        context,
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('execution', () => {
    it('sends notification via injected sender', async () => {
      const sender = createMockSender({ success: true, response: { id: 'notif-1' } });
      const tool = createSendNotificationTool({ sender });

      const result = await tool.execute(
        {
          channel: 'webhook',
          target: 'https://hooks.example.com/notify',
          subject: 'Alert',
          message: 'Server is down',
          metadata: { severity: 'critical' },
        },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as {
          sent: boolean;
          channel: string;
          timestamp: string;
          response: unknown;
        };
        expect(output.sent).toBe(true);
        expect(output.channel).toBe('webhook');
        expect(output.timestamp).toBeDefined();
        expect(output.response).toEqual({ id: 'notif-1' });
      }

       
      expect(sender.send).toHaveBeenCalledWith({
        channel: 'webhook',
        target: 'https://hooks.example.com/notify',
        subject: 'Alert',
        message: 'Server is down',
        metadata: { severity: 'critical' },
      });
    });

    it('reports unsuccessful send', async () => {
      const sender = createMockSender({ success: false, response: { error: 'timeout' } });
      const tool = createSendNotificationTool({ sender });

      const result = await tool.execute(
        {
          channel: 'webhook',
          target: 'https://hooks.example.com/notify',
          subject: 'Test',
          message: 'Test',
        },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { sent: boolean };
        expect(output.sent).toBe(false);
      }
    });

    it('blocks SSRF target in execute', async () => {
      const sender = createMockSender();
      const tool = createSendNotificationTool({ sender });

      const result = await tool.execute(
        {
          channel: 'webhook',
          target: 'http://10.0.0.1/internal',
          subject: 'Test',
          message: 'Test',
        },
        context,
      );

      expect(result.ok).toBe(false);
       
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('returns error when sender throws', async () => {
      const sender = createMockSender();
      (sender.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection refused'),
      );
      const tool = createSendNotificationTool({ sender });

      const result = await tool.execute(
        {
          channel: 'webhook',
          target: 'https://hooks.example.com/notify',
          subject: 'Test',
          message: 'Test',
        },
        context,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('includes durationMs in result', async () => {
      const sender = createMockSender();
      const tool = createSendNotificationTool({ sender });

      const result = await tool.execute(
        {
          channel: 'webhook',
          target: 'https://hooks.example.com/notify',
          subject: 'Test',
          message: 'Test',
        },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
