import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTelegramApprovalNotifier,
  buildMessage,
} from './telegram-approval-notifier.js';
import type { ApprovalNotificationContext } from './types.js';
import type { ApprovalRequest } from '@/security/types.js';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import type {
  ApprovalNotifierConfigRepository,
  ResolvedTelegramConfig,
} from '@/infrastructure/repositories/approval-notifier-config-repository.js';

// ─── Fixtures ──────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

function makePrisma(projectMetadata: unknown = null): PrismaClient {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue(
        projectMetadata === undefined ? null : { metadata: projectMetadata },
      ),
    },
  } as unknown as PrismaClient;
}

function makeConfigRepo(
  resolved: ResolvedTelegramConfig | null | 'throw' = null,
): ApprovalNotifierConfigRepository {
  const resolveMock =
    resolved === 'throw'
      ? vi.fn().mockRejectedValue(new Error('repo exploded'))
      : vi.fn().mockResolvedValue(resolved);
  return {
    getTelegramConfig: vi.fn().mockResolvedValue(null),
    setTelegramConfig: vi.fn().mockResolvedValue(null),
    deleteTelegramConfig: vi.fn().mockResolvedValue(undefined),
    recordTestResult: vi.fn().mockResolvedValue(undefined),
    resolveTelegramConfig: resolveMock,
  };
}

const sampleContext: ApprovalNotificationContext = {
  approvalId: 'appr_123',
  projectId: 'proj-mp' as ProjectId,
  projectName: 'Market Paper',
  agentId: 'agt-1',
  agentName: 'Reactivadora',
  leadName: 'Juan Pérez',
  leadContact: '+54 11 1234-5678',
  contactId: 'ct-1',
  sessionId: 'sess-1',
  actionSummary: 'Enviar mejora de presupuesto',
  toolId: 'send-channel-message',
  toolInput: { body: 'secret price' },
  riskLabel: 'Alto',
  riskLevel: 'high',
  requestedAt: new Date('2026-04-24T10:00:00Z'),
};

const sampleRequest: ApprovalRequest = {
  id: 'appr_123' as ApprovalId,
  projectId: 'proj-mp' as ProjectId,
  sessionId: 'sess-1' as SessionId,
  toolCallId: 'tc-1' as ToolCallId,
  toolId: 'send-channel-message',
  toolInput: { body: 'secret price' },
  riskLevel: 'high',
  status: 'pending',
  requestedAt: new Date('2026-04-24T10:00:00Z'),
  expiresAt: new Date('2026-04-24T10:30:00Z'),
};

// ─── Legacy env-only tests (preserved backward compat) ────────

describe('createTelegramApprovalNotifier (env-only, legacy path)', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
    });
  });

  it('posts to Telegram sendMessage with markdown body + link on happy path', async () => {
    const prisma = makePrisma(null);
    const logger = makeLogger();
    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: '1234567',
      dashboardBaseUrl: 'https://dashboard.fomo.app',
      prisma,
      logger,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { body: string; method: string }];
    expect(url).toBe('https://api.telegram.org/botBOT_TOKEN/sendMessage');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body) as {
      chat_id: string;
      text: string;
      parse_mode: string;
      disable_web_page_preview: boolean;
    };
    expect(body.chat_id).toBe('1234567');
    expect(body.parse_mode).toBe('Markdown');
    expect(body.disable_web_page_preview).toBe(true);
    expect(body.text).toContain('🔔 *Acción requiere aprobación*');
    expect(body.text).toContain('Reactivadora');
    expect(body.text).toContain('Market Paper');
    expect(body.text).toContain('Juan Pérez');
    expect(body.text).toContain('+54 11 1234-5678');
    expect(body.text).toContain('Enviar mejora de presupuesto');
    expect(body.text).toContain('Alto');
    expect(body.text).toContain('https://dashboard.fomo.app/approvals/appr_123');

    // Confirm no PII from the tool input leaks into the message
    expect(body.text).not.toContain('secret price');

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('approval_sent'),
      expect.objectContaining({ event: 'approval_sent', approvalId: 'appr_123' }),
    );
  });

  it('is a no-op when bot token is missing and warns once at startup', async () => {
    const prisma = makePrisma(null);
    const logger = makeLogger();
    const notifier = createTelegramApprovalNotifier({
      botToken: undefined,
      defaultChatId: '1234567',
      dashboardBaseUrl: 'https://dashboard.fomo.app',
      prisma,
      logger,
      fetchImpl,
    });

    // Warn should be called once at factory creation, not per request.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('disabled'),
      expect.objectContaining({ hasBotToken: false }),
    );

    await notifier(sampleContext, sampleRequest);
    await notifier(sampleContext, sampleRequest);

    expect(fetchImpl).not.toHaveBeenCalled();
    // Still only the single startup warn — no per-request spam.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when dashboard URL is missing', async () => {
    const prisma = makePrisma(null);
    const logger = makeLogger();
    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: '1234567',
      dashboardBaseUrl: undefined,
      prisma,
      logger,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('disabled'),
      expect.objectContaining({ hasDashboardBaseUrl: false }),
    );
  });

  it('uses project.metadata.approvalNotifier.telegram.chatId override when enabled', async () => {
    const prisma = makePrisma({
      approvalNotifier: { telegram: { enabled: true, chatId: '999777' } },
    });
    const logger = makeLogger();
    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: '1234567',
      dashboardBaseUrl: 'https://dashboard.fomo.app',
      prisma,
      logger,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);

    const [, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { chat_id: string };
    expect(body.chat_id).toBe('999777');
  });

  it('ignores override when enabled is false and falls back to default', async () => {
    const prisma = makePrisma({
      approvalNotifier: { telegram: { enabled: false, chatId: '999777' } },
    });
    const logger = makeLogger();
    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: '1234567',
      dashboardBaseUrl: 'https://dashboard.fomo.app',
      prisma,
      logger,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);

    const [, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { chat_id: string };
    expect(body.chat_id).toBe('1234567');
  });

  it('skips when no default chat_id and no override is set', async () => {
    const prisma = makePrisma(null);
    const logger = makeLogger();
    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: undefined,
      dashboardBaseUrl: 'https://dashboard.fomo.app',
      prisma,
      logger,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no config resolved'),
      expect.objectContaining({ approvalId: 'appr_123' }),
    );
  });

  it('logs error and does not throw when Telegram API returns non-ok body', async () => {
    const prisma = makePrisma(null);
    const logger = makeLogger();
    fetchImpl.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ ok: false, description: 'chat not found' }),
    });

    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: '1234567',
      dashboardBaseUrl: 'https://dashboard.fomo.app',
      prisma,
      logger,
      fetchImpl,
    });

    await expect(notifier(sampleContext, sampleRequest)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('API error'),
      expect.objectContaining({ description: 'chat not found', httpStatus: 400 }),
    );
  });

  it('logs error and does not throw when fetch itself rejects', async () => {
    const prisma = makePrisma(null);
    const logger = makeLogger();
    fetchImpl.mockRejectedValueOnce(new Error('network down'));

    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: '1234567',
      dashboardBaseUrl: 'https://dashboard.fomo.app',
      prisma,
      logger,
      fetchImpl,
    });

    await expect(notifier(sampleContext, sampleRequest)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('fetch failed'),
      expect.objectContaining({ error: 'network down' }),
    );
  });

  it('strips trailing slash from dashboard URL when building the link', async () => {
    const prisma = makePrisma(null);
    const logger = makeLogger();
    const notifier = createTelegramApprovalNotifier({
      botToken: 'BOT_TOKEN',
      defaultChatId: '1234567',
      dashboardBaseUrl: 'https://dashboard.fomo.app/',
      prisma,
      logger,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);
    const [, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { text: string };
    expect(body.text).toContain('https://dashboard.fomo.app/approvals/appr_123');
    expect(body.text).not.toContain('.app//approvals');
  });
});

// ─── Per-project config path (configRepo) ─────────────────────

describe('createTelegramApprovalNotifier (configRepo-first)', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    });
  });

  it('uses per-project config when configRepo returns a resolved value', async () => {
    const logger = makeLogger();
    const configRepo = makeConfigRepo({
      botToken: 'PROJECT_TOKEN',
      chatId: 'project_chat_id',
      dashboardBaseUrl: 'https://proj.example.com',
      enabled: true,
    });
    const notifier = createTelegramApprovalNotifier({
      botToken: 'ENV_TOKEN',
      defaultChatId: 'env_chat',
      dashboardBaseUrl: 'https://env.example.com',
      prisma: makePrisma(null),
      logger,
      configRepo,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);

    const [url, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api.telegram.org/botPROJECT_TOKEN/sendMessage');
    const body = JSON.parse(init.body) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('project_chat_id');
    expect(body.text).toContain('https://proj.example.com/approvals/appr_123');
  });

  it('falls back to env config when configRepo returns null', async () => {
    const logger = makeLogger();
    const configRepo = makeConfigRepo(null);
    const notifier = createTelegramApprovalNotifier({
      botToken: 'ENV_TOKEN',
      defaultChatId: 'env_chat',
      dashboardBaseUrl: 'https://env.example.com',
      prisma: makePrisma(null),
      logger,
      configRepo,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);

    const [url, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api.telegram.org/botENV_TOKEN/sendMessage');
    const body = JSON.parse(init.body) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('env_chat');
    expect(body.text).toContain('https://env.example.com/approvals/appr_123');
  });

  it('uses env dashboardBaseUrl when per-project dashboardBaseUrl is null', async () => {
    const logger = makeLogger();
    const configRepo = makeConfigRepo({
      botToken: 'PROJECT_TOKEN',
      chatId: 'project_chat_id',
      dashboardBaseUrl: null,
      enabled: true,
    });
    const notifier = createTelegramApprovalNotifier({
      botToken: 'ENV_TOKEN',
      defaultChatId: 'env_chat',
      dashboardBaseUrl: 'https://env.example.com',
      prisma: makePrisma(null),
      logger,
      configRepo,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);

    const [, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { text: string };
    expect(body.text).toContain('https://env.example.com/approvals/appr_123');
  });

  it('does not emit startup warn when configRepo is provided (per-project may fill in)', () => {
    const logger = makeLogger();
    const configRepo = makeConfigRepo(null);
    createTelegramApprovalNotifier({
      botToken: undefined,
      defaultChatId: undefined,
      dashboardBaseUrl: undefined,
      prisma: makePrisma(null),
      logger,
      configRepo,
      fetchImpl,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throttles "no config resolved" warn to once per projectId per window', async () => {
    const logger = makeLogger();
    const configRepo = makeConfigRepo(null);
    const notifier = createTelegramApprovalNotifier({
      botToken: undefined,
      defaultChatId: undefined,
      dashboardBaseUrl: undefined,
      prisma: makePrisma(null),
      logger,
      configRepo,
      fetchImpl,
      warnThrottleMs: 1000,
    });

    await notifier(sampleContext, sampleRequest);
    await notifier(sampleContext, sampleRequest);
    await notifier(sampleContext, sampleRequest);

    const unconfiguredWarns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('no config resolved'),
    );
    expect(unconfiguredWarns).toHaveLength(1);

    // Different project should warn independently.
    await notifier({ ...sampleContext, projectId: 'other' as ProjectId }, sampleRequest);
    const warnsAfter = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('no config resolved'),
    );
    expect(warnsAfter).toHaveLength(2);
  });

  it('falls back to env when configRepo throws', async () => {
    const logger = makeLogger();
    const configRepo = makeConfigRepo('throw');
    const notifier = createTelegramApprovalNotifier({
      botToken: 'ENV_TOKEN',
      defaultChatId: 'env_chat',
      dashboardBaseUrl: 'https://env.example.com',
      prisma: makePrisma(null),
      logger,
      configRepo,
      fetchImpl,
    });

    await notifier(sampleContext, sampleRequest);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('per-project resolution failed'),
      expect.objectContaining({ error: 'repo exploded' }),
    );
  });
});

describe('buildMessage', () => {
  it('uses only the lead name when leadContact is null', () => {
    const text = buildMessage(
      { ...sampleContext, leadContact: null },
      'https://dashboard.fomo.app',
    );
    expect(text).toContain('Juan Pérez');
    expect(text).not.toContain(' — '); // dash separator only appears when contact is present
  });

  it('escapes markdown-sensitive characters in agent and lead fields', () => {
    const text = buildMessage(
      {
        ...sampleContext,
        agentName: 'Agente_bold*',
        leadName: 'Juan [Perez]',
      },
      'https://dashboard.fomo.app',
    );
    expect(text).toContain('Agente\\_bold\\*');
    expect(text).toContain('Juan \\[Perez\\]');
  });
});
