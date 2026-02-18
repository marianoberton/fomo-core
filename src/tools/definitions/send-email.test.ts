/**
 * Tests for the send-email tool (Resend API).
 * 3 levels: schema validation, dry-run, execution (with mocked fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSendEmailTool } from './send-email.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { SecretService } from '@/secrets/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockSecretService(overrides?: Partial<SecretService>): SecretService {
  return {
    set: vi.fn(),
    get: vi.fn((_, key: string) => {
      if (key === 'RESEND_API_KEY') return Promise.resolve('re_test_key');
      if (key === 'RESEND_FROM_EMAIL') return Promise.resolve('sender@example.com');
      return Promise.reject(new Error(`Secret not found: ${key}`));
    }),
    list: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve(false)),
    exists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

const context = createTestContext({ allowedTools: ['send-email'] });

// ─── Tests ──────────────────────────────────────────────────────

describe('send-email tool', () => {
  // ─── Level 1: Schema Validation ─────────────────────────────

  describe('schema validation', () => {
    const tool = createSendEmailTool({
      secretService: createMockSecretService(),
    });

    it('accepts valid email input', () => {
      const result = tool.inputSchema.safeParse({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Hi there!',
      });
      expect(result.success).toBe(true);
    });

    it('accepts input with replyTo', () => {
      const result = tool.inputSchema.safeParse({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Hi there!',
        replyTo: 'reply@example.com',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email address', () => {
      const result = tool.inputSchema.safeParse({
        to: 'not-an-email',
        subject: 'Hello',
        body: 'Hi',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing to field', () => {
      const result = tool.inputSchema.safeParse({
        subject: 'Hello',
        body: 'Hi',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty subject', () => {
      const result = tool.inputSchema.safeParse({
        to: 'user@example.com',
        subject: '',
        body: 'Hi',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty body', () => {
      const result = tool.inputSchema.safeParse({
        to: 'user@example.com',
        subject: 'Hello',
        body: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid replyTo', () => {
      const result = tool.inputSchema.safeParse({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Hi',
        replyTo: 'not-email',
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Level 2: Dry Run ──────────────────────────────────────

  describe('dry run', () => {
    it('returns success with configuration status', async () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService(),
      });

      const result = await tool.dryRun({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Hello',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['to']).toBe('user@example.com');
        expect(output['apiKeyConfigured']).toBe(true);
      }
    });

    it('shows apiKeyConfigured=false when not set', async () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService({
          exists: vi.fn(() => Promise.resolve(false)),
        }),
      });

      const result = await tool.dryRun({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Hello',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['apiKeyConfigured']).toBe(false);
        expect(output['fromAddressConfigured']).toBe(false);
      }
    });
  });

  // ─── Level 3: Execution ────────────────────────────────────

  describe('execution', () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      fetchMock.mockReset();
    });

    it('sends email via Resend API and returns messageId', async () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService(),
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-123' }), { status: 200 }),
      );

      const result = await tool.execute({
        to: 'user@example.com',
        subject: 'Hello',
        body: '<p>Hello world</p>',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { sent: boolean; messageId: string };
        expect(output.sent).toBe(true);
        expect(output.messageId).toBe('msg-123');
      }

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer re_test_key');
      const body = JSON.parse(init.body as string) as Record<string, string>;
      expect(body['from']).toBe('sender@example.com');
      expect(body['to']).toBe('user@example.com');
    });

    it('uses default from address when RESEND_FROM_EMAIL is not configured', async () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService({
          get: vi.fn((_, key: string) => {
            if (key === 'RESEND_API_KEY') return Promise.resolve('re_test_key');
            return Promise.reject(new Error(`Secret not found: ${key}`));
          }),
        }),
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-456' }), { status: 200 }),
      );

      const result = await tool.execute({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Test',
      }, context);

      expect(result.ok).toBe(true);
      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as Record<string, string>;
      expect(body['from']).toBe('onboarding@resend.dev');
    });

    it('includes replyTo when provided', async () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService(),
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-789' }), { status: 200 }),
      );

      await tool.execute({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Test',
        replyTo: 'reply@example.com',
      }, context);

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as Record<string, string>;
      expect(body['reply_to']).toBe('reply@example.com');
    });

    it('returns error when Resend API returns error', async () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService(),
      });

      fetchMock.mockResolvedValueOnce(
        new Response('Invalid API key', { status: 403 }),
      );

      const result = await tool.execute({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Test',
      }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('403');
      }
    });

    it('returns error when RESEND_API_KEY is missing', async () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService({
          get: vi.fn(() => Promise.reject(new Error('Secret not found: RESEND_API_KEY'))),
        }),
      });

      const result = await tool.execute({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'Test',
      }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('RESEND_API_KEY');
      }
    });

    it('has correct risk level and approval settings', () => {
      const tool = createSendEmailTool({
        secretService: createMockSecretService(),
      });

      expect(tool.riskLevel).toBe('high');
      expect(tool.requiresApproval).toBe(true);
      expect(tool.sideEffects).toBe(true);
    });
  });
});
