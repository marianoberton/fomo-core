import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { approvalNotifierConfigRoutes } from './approval-notifier-config.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';
import type { TelegramConfig } from '@/infrastructure/repositories/approval-notifier-config-repository.js';

// ─── Helpers ───────────────────────────────────────────────────

function makeConfig(partial: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    enabled: false,
    hasToken: false,
    chatId: null,
    dashboardBaseUrl: null,
    lastTestedAt: null,
    lastTestResult: null,
    ...partial,
  };
}

function createApp(options: {
  fetchImpl?: ReturnType<typeof vi.fn>;
  envDashboardBaseUrl?: string;
} = {}): {
  app: FastifyInstance;
  deps: ReturnType<typeof createMockDeps>;
  fetchImpl: ReturnType<typeof vi.fn>;
} {
  const deps = createMockDeps();
  // Stub project.findUnique for the project-name lookup inside /test.
  (deps.prisma as unknown as { project: unknown }).project = {
    findUnique: vi.fn().mockResolvedValue({ name: 'Market Paper' }),
  };

  const fetchImpl = options.fetchImpl ?? vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true }),
  });

  const app = Fastify();
  registerErrorHandler(app);
  approvalNotifierConfigRoutes(app, deps, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    envDashboardBaseUrl: options.envDashboardBaseUrl,
  });
  return { app, deps, fetchImpl };
}

// ─── GET ───────────────────────────────────────────────────────

describe('GET /projects/:projectId/approval-notifier-config', () => {
  it('returns the current config and never exposes the bot token', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({
        enabled: true,
        hasToken: true,
        chatId: '-100123456789',
        dashboardBaseUrl: 'https://dashboard.fomo.app',
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/approval-notifier-config',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      success: boolean;
      data: { telegram: TelegramConfig };
    }>();
    expect(body.success).toBe(true);
    expect(body.data.telegram.hasToken).toBe(true);
    expect(body.data.telegram.chatId).toBe('-100123456789');
    // The response must NEVER include the plaintext token.
    expect(JSON.stringify(body)).not.toContain('botToken');
  });

  it('returns 404 when the project does not exist', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/unknown/approval-notifier-config',
    });

    expect(response.statusCode).toBe(404);
  });
});

// ─── PUT ───────────────────────────────────────────────────────

describe('PUT /projects/:projectId/approval-notifier-config', () => {
  it('persists the bot token via configRepo.setTelegramConfig', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig(),
    );
    deps.approvalNotifierConfigRepository.setTelegramConfig.mockResolvedValue(
      makeConfig({ enabled: true, hasToken: true, chatId: '-100123456789' }),
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/approval-notifier-config',
      payload: {
        telegram: {
          enabled: true,
          botToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
          chatId: '-100123456789',
          dashboardBaseUrl: 'https://dashboard.fomo.app',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.approvalNotifierConfigRepository.setTelegramConfig).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        enabled: true,
        botToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
        chatId: '-100123456789',
        dashboardBaseUrl: 'https://dashboard.fomo.app',
      }),
    );
  });

  it('passes botToken="" through so the repo can delete the secret', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true }),
    );
    deps.approvalNotifierConfigRepository.setTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: false }),
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/approval-notifier-config',
      payload: { telegram: { botToken: '' } },
    });

    expect(response.statusCode).toBe(200);
    const call = deps.approvalNotifierConfigRepository.setTelegramConfig.mock.calls[0] as [
      string,
      { botToken?: string | null },
    ];
    expect(call[1].botToken).toBe('');
  });

  it('updates non-token fields without touching the stored token', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true }),
    );
    deps.approvalNotifierConfigRepository.setTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true, chatId: '999' }),
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/approval-notifier-config',
      payload: { telegram: { chatId: '999' } },
    });

    expect(response.statusCode).toBe(200);
    const call = deps.approvalNotifierConfigRepository.setTelegramConfig.mock.calls[0] as [
      string,
      { botToken?: string | null; chatId?: string },
    ];
    expect(call[1].botToken).toBeUndefined();
    expect(call[1].chatId).toBe('999');
  });

  it('rejects malformed bot tokens with 400', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig(),
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/approval-notifier-config',
      payload: { telegram: { botToken: 'not-a-real-token' } },
    });

    expect(response.statusCode).toBe(400);
    expect(deps.approvalNotifierConfigRepository.setTelegramConfig).not.toHaveBeenCalled();
  });

  it('rejects non-numeric chatId with 400', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig(),
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/approval-notifier-config',
      payload: { telegram: { chatId: 'abc-def' } },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed dashboard URL with 400', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig(),
    );

    const response = await app.inject({
      method: 'PUT',
      url: '/projects/proj-1/approval-notifier-config',
      payload: { telegram: { dashboardBaseUrl: 'not-a-url' } },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when the project does not exist', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/projects/unknown/approval-notifier-config',
      payload: { telegram: { chatId: '123' } },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ─── DELETE ────────────────────────────────────────────────────

describe('DELETE /projects/:projectId/approval-notifier-config/telegram', () => {
  it('deletes the config via configRepo.deleteTelegramConfig', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true }),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: '/projects/proj-1/approval-notifier-config/telegram',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { deleted: boolean } }>();
    expect(body.data.deleted).toBe(true);
    expect(
      deps.approvalNotifierConfigRepository.deleteTelegramConfig,
    ).toHaveBeenCalledWith('proj-1');
  });

  it('returns 404 when the project does not exist', async () => {
    const { app, deps } = createApp();
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(null);

    const response = await app.inject({
      method: 'DELETE',
      url: '/projects/unknown/approval-notifier-config/telegram',
    });

    expect(response.statusCode).toBe(404);
    expect(
      deps.approvalNotifierConfigRepository.deleteTelegramConfig,
    ).not.toHaveBeenCalled();
  });
});

// ─── POST /test ────────────────────────────────────────────────

describe('POST /projects/:projectId/approval-notifier-config/test', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    });
  });

  it('returns 400 with NOTIFIER_NOT_CONFIGURED when no config is set', async () => {
    const { app, deps } = createApp({ fetchImpl });
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig(),
    );
    deps.approvalNotifierConfigRepository.resolveTelegramConfig.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/approval-notifier-config/test',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('NOTIFIER_NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the override chatId from the body when provided', async () => {
    const { app, deps } = createApp({ fetchImpl });
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true }),
    );
    deps.approvalNotifierConfigRepository.resolveTelegramConfig.mockResolvedValue({
      botToken: 'STORED_TOKEN',
      chatId: 'stored_chat',
      dashboardBaseUrl: 'https://stored.example.com',
      enabled: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/approval-notifier-config/test',
      payload: { chatId: '-100999888777' },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api.telegram.org/botSTORED_TOKEN/sendMessage');
    const payload = JSON.parse(init.body) as { chat_id: string };
    expect(payload.chat_id).toBe('-100999888777');
  });

  it('records success and returns sentAt on a successful send', async () => {
    const { app, deps } = createApp({ fetchImpl });
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true, chatId: 'stored_chat' }),
    );
    deps.approvalNotifierConfigRepository.resolveTelegramConfig.mockResolvedValue({
      botToken: 'STORED_TOKEN',
      chatId: 'stored_chat',
      dashboardBaseUrl: 'https://stored.example.com',
      enabled: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/approval-notifier-config/test',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { success: boolean; sentAt?: string } }>();
    expect(body.data.success).toBe(true);
    expect(body.data.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(
      deps.approvalNotifierConfigRepository.recordTestResult,
    ).toHaveBeenCalledWith('proj-1', 'success');
  });

  it('records the failure reason when Telegram returns ok=false', async () => {
    fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ ok: false, description: 'chat not found' }),
    });
    const { app, deps } = createApp({ fetchImpl });
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true }),
    );
    deps.approvalNotifierConfigRepository.resolveTelegramConfig.mockResolvedValue({
      botToken: 'STORED_TOKEN',
      chatId: 'stored_chat',
      dashboardBaseUrl: null,
      enabled: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/approval-notifier-config/test',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { success: boolean; error?: string } }>();
    expect(body.data.success).toBe(false);
    expect(body.data.error).toBe('chat not found');
    expect(
      deps.approvalNotifierConfigRepository.recordTestResult,
    ).toHaveBeenCalledWith('proj-1', 'failed: chat not found');
  });

  it('records the failure reason when fetch itself rejects', async () => {
    fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const { app, deps } = createApp({ fetchImpl });
    deps.approvalNotifierConfigRepository.getTelegramConfig.mockResolvedValue(
      makeConfig({ hasToken: true }),
    );
    deps.approvalNotifierConfigRepository.resolveTelegramConfig.mockResolvedValue({
      botToken: 'STORED_TOKEN',
      chatId: 'stored_chat',
      dashboardBaseUrl: null,
      enabled: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/approval-notifier-config/test',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { success: boolean; error?: string } }>();
    expect(body.data.success).toBe(false);
    expect(body.data.error).toBe('network down');
    expect(
      deps.approvalNotifierConfigRepository.recordTestResult,
    ).toHaveBeenCalledWith('proj-1', 'failed: network down');
  });
});
