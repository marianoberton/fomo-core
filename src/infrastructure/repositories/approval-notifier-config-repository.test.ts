import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createApprovalNotifierConfigRepository,
  TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
} from './approval-notifier-config-repository.js';
import type { PrismaClient } from '@prisma/client';
import type { SecretService } from '@/secrets/types.js';

// ─── Helpers ───────────────────────────────────────────────────

function makePrisma(initialMetadata: unknown = null, projectExists = true) {
  const state: { metadata: unknown } = { metadata: initialMetadata };
  const findUnique = vi.fn().mockImplementation(() => {
    if (!projectExists) return Promise.resolve(null);
    return Promise.resolve({ metadata: state.metadata });
  });
  const update = vi.fn().mockImplementation((args: { data: { metadata?: unknown } }) => {
    state.metadata = args.data.metadata ?? state.metadata;
    return Promise.resolve({ metadata: state.metadata });
  });
  const prisma = {
    project: { findUnique, update },
  } as unknown as PrismaClient;
  return { prisma, state, findUnique, update };
}

function makeSecretService(initial: Record<string, string> = {}): SecretService {
  const store = new Map(Object.entries(initial));
  return {
    set: vi.fn().mockImplementation((projectId: string, key: string, value: string) => {
      store.set(`${projectId}::${key}`, value);
      return Promise.resolve({
        id: 'sec-1',
        projectId,
        key,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
    get: vi.fn().mockImplementation((projectId: string, key: string) => {
      const v = store.get(`${projectId}::${key}`);
      if (v === undefined) return Promise.reject(new Error('not found'));
      return Promise.resolve(v);
    }),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockImplementation((projectId: string, key: string) => {
      const existed = store.delete(`${projectId}::${key}`);
      return Promise.resolve(existed);
    }),
    exists: vi.fn().mockImplementation((projectId: string, key: string) => {
      return Promise.resolve(store.has(`${projectId}::${key}`));
    }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('ApprovalNotifierConfigRepository', () => {
  let prismaCtx: ReturnType<typeof makePrisma>;
  let secretService: SecretService;

  beforeEach(() => {
    prismaCtx = makePrisma({});
    secretService = makeSecretService();
  });

  describe('getTelegramConfig', () => {
    it('returns null when the project does not exist', async () => {
      prismaCtx = makePrisma(null, false);
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      expect(await repo.getTelegramConfig('missing')).toBeNull();
    });

    it('returns a snapshot with hasToken=false when no secret is stored', async () => {
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      const config = await repo.getTelegramConfig('proj-1');
      expect(config).toEqual({
        enabled: false,
        hasToken: false,
        chatId: null,
        dashboardBaseUrl: null,
        lastTestedAt: null,
        lastTestResult: null,
      });
    });

    it('returns hasToken=true when a secret is stored', async () => {
      secretService = makeSecretService({
        [`proj-1::${TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY}`]: 'token-value',
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      const config = await repo.getTelegramConfig('proj-1');
      expect(config?.hasToken).toBe(true);
    });
  });

  describe('setTelegramConfig', () => {
    it('stores the bot token encrypted in SecretService and metadata in project.metadata', async () => {
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      const result = await repo.setTelegramConfig('proj-1', {
        enabled: true,
        botToken: 'TOKEN',
        chatId: '-100123',
        dashboardBaseUrl: 'https://dashboard.fomo.app',
      });

      expect(secretService.set).toHaveBeenCalledWith(
        'proj-1',
        TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
        'TOKEN',
        expect.any(String),
      );
      expect(result.hasToken).toBe(true);
      expect(result.chatId).toBe('-100123');
      expect(result.dashboardBaseUrl).toBe('https://dashboard.fomo.app');
      expect(result.enabled).toBe(true);

      // Verify the metadata was actually written to the project row.
      const saved = prismaCtx.update.mock.calls[0] as [{ data: { metadata: unknown } }];
      const meta = saved[0].data.metadata as {
        approvalNotifier: { telegram: { chatId: string; enabled: boolean } };
      };
      expect(meta.approvalNotifier.telegram.chatId).toBe('-100123');
      expect(meta.approvalNotifier.telegram.enabled).toBe(true);
    });

    it('deletes the secret when botToken is empty string', async () => {
      secretService = makeSecretService({
        [`proj-1::${TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY}`]: 'existing',
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });

      await repo.setTelegramConfig('proj-1', { botToken: '' });

      expect(secretService.delete).toHaveBeenCalledWith(
        'proj-1',
        TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
      );
      expect(secretService.set).not.toHaveBeenCalled();
    });

    it('leaves the secret untouched when botToken is omitted', async () => {
      prismaCtx = makePrisma({
        approvalNotifier: { telegram: { enabled: true, chatId: 'old' } },
      });
      secretService = makeSecretService({
        [`proj-1::${TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY}`]: 'existing',
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });

      await repo.setTelegramConfig('proj-1', { chatId: 'new' });

      expect(secretService.set).not.toHaveBeenCalled();
      expect(secretService.delete).not.toHaveBeenCalled();
    });

    it('preserves other metadata keys when only updating approvalNotifier', async () => {
      prismaCtx = makePrisma({
        otherKey: 'preserve me',
        approvalNotifier: { telegram: { chatId: 'original' } },
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });

      await repo.setTelegramConfig('proj-1', { chatId: 'updated' });

      const saved = prismaCtx.update.mock.calls[0] as [{ data: { metadata: unknown } }];
      const meta = saved[0].data.metadata as Record<string, unknown>;
      expect(meta['otherKey']).toBe('preserve me');
    });
  });

  describe('deleteTelegramConfig', () => {
    it('deletes the secret and flips enabled to false', async () => {
      prismaCtx = makePrisma({
        approvalNotifier: { telegram: { enabled: true, chatId: 'keep' } },
      });
      secretService = makeSecretService({
        [`proj-1::${TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY}`]: 'existing',
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });

      await repo.deleteTelegramConfig('proj-1');

      expect(secretService.delete).toHaveBeenCalledWith(
        'proj-1',
        TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY,
      );
      const saved = prismaCtx.update.mock.calls[0] as [{ data: { metadata: unknown } }];
      const meta = saved[0].data.metadata as {
        approvalNotifier: { telegram: { enabled: boolean; chatId?: string } };
      };
      expect(meta.approvalNotifier.telegram.enabled).toBe(false);
      // chatId is preserved so the admin can re-enable without re-typing it.
      expect(meta.approvalNotifier.telegram.chatId).toBe('keep');
    });
  });

  describe('recordTestResult', () => {
    it('writes lastTestedAt + lastTestResult to metadata', async () => {
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });

      await repo.recordTestResult('proj-1', 'success');
      const saved = prismaCtx.update.mock.calls[0] as [{ data: { metadata: unknown } }];
      const meta = saved[0].data.metadata as {
        approvalNotifier: { telegram: { lastTestResult: string; lastTestedAt: string } };
      };
      expect(meta.approvalNotifier.telegram.lastTestResult).toBe('success');
      expect(meta.approvalNotifier.telegram.lastTestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('resolveTelegramConfig', () => {
    it('returns null when no chatId is configured', async () => {
      prismaCtx = makePrisma({
        approvalNotifier: { telegram: { enabled: true } },
      });
      secretService = makeSecretService({
        [`proj-1::${TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY}`]: 'TOKEN',
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      expect(await repo.resolveTelegramConfig('proj-1')).toBeNull();
    });

    it('returns null when enabled is false', async () => {
      prismaCtx = makePrisma({
        approvalNotifier: { telegram: { enabled: false, chatId: '1' } },
      });
      secretService = makeSecretService({
        [`proj-1::${TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY}`]: 'TOKEN',
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      expect(await repo.resolveTelegramConfig('proj-1')).toBeNull();
    });

    it('returns null when no bot token is stored', async () => {
      prismaCtx = makePrisma({
        approvalNotifier: { telegram: { enabled: true, chatId: '1' } },
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      expect(await repo.resolveTelegramConfig('proj-1')).toBeNull();
    });

    it('returns full config when all pieces are present', async () => {
      prismaCtx = makePrisma({
        approvalNotifier: {
          telegram: {
            enabled: true,
            chatId: 'chat-1',
            dashboardBaseUrl: 'https://dashboard.fomo.app',
          },
        },
      });
      secretService = makeSecretService({
        [`proj-1::${TELEGRAM_APPROVAL_BOT_TOKEN_SECRET_KEY}`]: 'TOKEN',
      });
      const repo = createApprovalNotifierConfigRepository({
        prisma: prismaCtx.prisma,
        secretService,
      });
      const resolved = await repo.resolveTelegramConfig('proj-1');
      expect(resolved).toEqual({
        botToken: 'TOKEN',
        chatId: 'chat-1',
        dashboardBaseUrl: 'https://dashboard.fomo.app',
        enabled: true,
      });
    });
  });
});
