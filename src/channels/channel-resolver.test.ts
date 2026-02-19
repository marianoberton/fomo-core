/**
 * Tests for the generalized ChannelResolver.
 * Verifies adapter creation, caching, invalidation, and send routing for all providers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChannelResolver } from './channel-resolver.js';
import type { ChannelIntegration, ChannelIntegrationRepository, IntegrationProvider } from './types.js';
import type { SecretService } from '@/secrets/types.js';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';

// ─── Mock Factories ─────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createMockSecretService(): {
  [K in keyof SecretService]: ReturnType<typeof vi.fn>;
} {
  return {
    set: vi.fn(),
    get: vi.fn((_, key: string) => {
      const secrets: Record<string, string> = {
        'tg-bot-token': 'bot123:ABC',
        'wa-access-token': 'whatsapp-token-xyz',
        'slack-bot-token': 'xoxb-slack-123',
        'slack-signing-secret': 'slack-signing-456',
      };
      const value = secrets[key];
      if (!value) return Promise.reject(new Error(`Secret "${key}" not found`));
      return Promise.resolve(value);
    }),
    list: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
  };
}

function createMockIntegrationRepo(): {
  [K in keyof ChannelIntegrationRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByProject: vi.fn(),
    findByProjectAndProvider: vi.fn(),
    findByProviderAccount: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listActive: vi.fn(),
  };
}

function makeIntegration(
  provider: IntegrationProvider,
  config: Record<string, unknown>,
  overrides?: Partial<ChannelIntegration>,
): ChannelIntegration {
  return {
    id: `int-${provider}-1`,
    projectId: 'proj-1' as ProjectId,
    provider,
    config: config as unknown as ChannelIntegration['config'],
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ChannelResolver', () => {
  let repo: ReturnType<typeof createMockIntegrationRepo>;
  let secretService: ReturnType<typeof createMockSecretService>;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockIntegrationRepo();
    secretService = createMockSecretService();
    logger = createMockLogger();
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function createResolver() {
    return createChannelResolver({
      integrationRepository: repo,
      secretService,
      logger,
    });
  }

  // ─── resolveAdapter ─────────────────────────────────────────

  describe('resolveAdapter', () => {
    it('creates Telegram adapter with resolved secret', async () => {
      const integration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();
      const adapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');

      expect(adapter).not.toBeNull();
      expect(adapter?.channelType).toBe('telegram');
       
      expect(secretService.get).toHaveBeenCalledWith('proj-1', 'tg-bot-token');
    });

    it('creates WhatsApp adapter with resolved secret', async () => {
      const integration = makeIntegration('whatsapp', {
        accessTokenSecretKey: 'wa-access-token',
        phoneNumberId: 'phone-123',
        apiVersion: 'v19.0',
      });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();
      const adapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'whatsapp');

      expect(adapter).not.toBeNull();
      expect(adapter?.channelType).toBe('whatsapp');
       
      expect(secretService.get).toHaveBeenCalledWith('proj-1', 'wa-access-token');
    });

    it('creates Slack adapter with bot token and signing secret', async () => {
      const integration = makeIntegration('slack', {
        botTokenSecretKey: 'slack-bot-token',
        signingSecretSecretKey: 'slack-signing-secret',
      });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();
      const adapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'slack');

      expect(adapter).not.toBeNull();
      expect(adapter?.channelType).toBe('slack');
       
      expect(secretService.get).toHaveBeenCalledWith('proj-1', 'slack-bot-token');
       
      expect(secretService.get).toHaveBeenCalledWith('proj-1', 'slack-signing-secret');
    });

    it('creates Chatwoot adapter from env var', async () => {
      const originalEnv = process.env['CHATWOOT_API_TOKEN'];
      process.env['CHATWOOT_API_TOKEN'] = 'cw-token-abc';

      const integration = makeIntegration('chatwoot', {
        baseUrl: 'https://chat.example.com',
        apiTokenEnvVar: 'CHATWOOT_API_TOKEN',
        accountId: 1,
        inboxId: 1,
        agentBotId: 1,
      });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();
      const adapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'chatwoot');

      expect(adapter).not.toBeNull();
      expect(adapter?.channelType).toBe('chatwoot');

      // Restore env
      if (originalEnv === undefined) {
        delete process.env['CHATWOOT_API_TOKEN'];
      } else {
        process.env['CHATWOOT_API_TOKEN'] = originalEnv;
      }
    });

    it('returns null when no integration found', async () => {
      repo.findByProjectAndProvider.mockResolvedValue(null);

      const resolver = createResolver();
      const adapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');

      expect(adapter).toBeNull();
    });

    it('returns null when integration is paused', async () => {
      const integration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' }, {
        status: 'paused',
      });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();
      const adapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');

      expect(adapter).toBeNull();
    });

    it('returns null when secret resolution fails', async () => {
      const integration = makeIntegration('telegram', { botTokenSecretKey: 'missing-secret' });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();
      const adapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');

      expect(adapter).toBeNull();
    });

    it('caches adapters by projectId:provider', async () => {
      const integration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();

      const adapter1 = await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');
      const adapter2 = await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');

      expect(adapter1).toBe(adapter2);
       
      expect(repo.findByProjectAndProvider).toHaveBeenCalledTimes(1);
    });

    it('uses different cache entries for different providers', async () => {
      const tgIntegration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' });
      const slackIntegration = makeIntegration('slack', { botTokenSecretKey: 'slack-bot-token' });
      repo.findByProjectAndProvider
        .mockResolvedValueOnce(tgIntegration)
        .mockResolvedValueOnce(slackIntegration);

      const resolver = createResolver();

      const tgAdapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');
      const slackAdapter = await resolver.resolveAdapter('proj-1' as ProjectId, 'slack');

      expect(tgAdapter).not.toBe(slackAdapter);
      expect(tgAdapter?.channelType).toBe('telegram');
      expect(slackAdapter?.channelType).toBe('slack');
    });
  });

  // ─── invalidate ──────────────────────────────────────────────

  describe('invalidate', () => {
    it('clears cached adapters for a project', async () => {
      const integration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();

      await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');
      resolver.invalidate('proj-1' as ProjectId);
      await resolver.resolveAdapter('proj-1' as ProjectId, 'telegram');

      // Should have been called twice (cache cleared)
       
      expect(repo.findByProjectAndProvider).toHaveBeenCalledTimes(2);
    });
  });

  // ─── send ────────────────────────────────────────────────────

  describe('send', () => {
    it('delegates to adapter.send()', async () => {
      // Stub global fetch so the real Telegram adapter doesn't call the API
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 99 } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const integration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' });
      repo.findByProjectAndProvider.mockResolvedValue(integration);

      const resolver = createResolver();

      const result = await resolver.send('proj-1' as ProjectId, 'telegram', {
        channel: 'telegram',
        recipientIdentifier: '12345',
        content: 'Hello!',
      });

      expect(result.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it('returns error when no adapter configured', async () => {
      repo.findByProjectAndProvider.mockResolvedValue(null);

      const resolver = createResolver();
      const result = await resolver.send('proj-1' as ProjectId, 'telegram', {
        channel: 'telegram',
        recipientIdentifier: '12345',
        content: 'Hello!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No telegram adapter configured');
    });
  });

  // ─── resolveIntegration ──────────────────────────────────────

  describe('resolveIntegration', () => {
    it('returns integration from repository', async () => {
      const integration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' });
      repo.findById.mockResolvedValue(integration);

      const resolver = createResolver();
      const result = await resolver.resolveIntegration('int-telegram-1');

      expect(result).toBe(integration);
    });

    it('returns null when not found', async () => {
      repo.findById.mockResolvedValue(null);

      const resolver = createResolver();
      const result = await resolver.resolveIntegration('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── resolveProjectByIntegration ─────────────────────────────

  describe('resolveProjectByIntegration', () => {
    it('returns projectId from integration', async () => {
      const integration = makeIntegration('telegram', { botTokenSecretKey: 'tg-bot-token' });
      repo.findById.mockResolvedValue(integration);

      const resolver = createResolver();
      const projectId = await resolver.resolveProjectByIntegration('int-telegram-1');

      expect(projectId).toBe('proj-1');
    });

    it('returns null when integration not found', async () => {
      repo.findById.mockResolvedValue(null);

      const resolver = createResolver();
      const projectId = await resolver.resolveProjectByIntegration('nonexistent');

      expect(projectId).toBeNull();
    });
  });

  // ─── resolveProjectByAccount ──────────────────────────────────

  describe('resolveProjectByAccount', () => {
    it('returns projectId for Chatwoot account', async () => {
      const integration = makeIntegration('chatwoot', {
        baseUrl: 'https://chat.example.com',
        apiTokenEnvVar: 'CHATWOOT_API_TOKEN',
        accountId: 42,
        inboxId: 1,
        agentBotId: 1,
      });
      repo.findByProviderAccount.mockResolvedValue(integration);

      const resolver = createResolver();
      const projectId = await resolver.resolveProjectByAccount(42);

      expect(projectId).toBe('proj-1');
       
      expect(repo.findByProviderAccount).toHaveBeenCalledWith('chatwoot', 42);
    });

    it('returns null when no matching Chatwoot integration', async () => {
      repo.findByProviderAccount.mockResolvedValue(null);

      const resolver = createResolver();
      const projectId = await resolver.resolveProjectByAccount(999);

      expect(projectId).toBeNull();
    });
  });
});
