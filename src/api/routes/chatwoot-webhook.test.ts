/**
 * Tests for the path-token-based Chatwoot webhook auth.
 *
 * Chatwoot v4.12.x Agent Bots don't sign their outgoing webhooks, so auth is
 * handled by a high-entropy `pathToken` embedded in the URL plus a secondary
 * check that the payload's `account.id` matches the integration's expected
 * accountId.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  chatwootWebhookRoutes,
  generateChatwootPathToken,
  type ChatwootWebhookDeps,
} from './chatwoot-webhook.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';
import type { ProjectId } from '@/core/types.js';

// ─── Helpers ────────────────────────────────────────────────────

const PROJECT_ID = 'proj_test_chatwoot' as ProjectId;
const ACCOUNT_ID = 7;
const VALID_TOKEN = 'a'.repeat(64);
const UNKNOWN_TOKEN = 'b'.repeat(64);

function makeMessageCreatedPayload(overrides?: {
  messageType?: 'incoming' | 'outgoing';
  senderType?: 'contact' | 'user';
  event?: string;
  accountId?: number;
}): Record<string, unknown> {
  return {
    event: overrides?.event ?? 'message_created',
    message_type: overrides?.messageType ?? 'incoming',
    content: 'hola',
    account: { id: overrides?.accountId ?? ACCOUNT_ID },
    conversation: { id: 42 },
    sender: { type: overrides?.senderType ?? 'contact', id: 99 },
  };
}

interface Fixture {
  app: FastifyInstance;
  enqueue: ReturnType<typeof vi.fn>;
  runAgent: ReturnType<typeof vi.fn>;
}

async function buildApp(opts?: { knownToken?: string | null }): Promise<Fixture> {
  const baseDeps = createMockDeps();
  baseDeps.channelResolver.resolveProjectByAccount.mockResolvedValue(PROJECT_ID);

  const knownToken = opts?.knownToken === undefined ? VALID_TOKEN : opts.knownToken;

  baseDeps.channelIntegrationRepository.findActiveChatwootByPathToken.mockImplementation(
    (token: string) => {
      if (knownToken !== null && token === knownToken) {
        return Promise.resolve({
          id: 'int_1',
          projectId: PROJECT_ID,
          provider: 'chatwoot',
          config: {
            baseUrl: 'https://chat.example',
            accountId: ACCOUNT_ID,
            inboxId: 1,
            agentBotId: 1,
            pathToken: knownToken,
            apiTokenSecretKey: 'CW_API',
          },
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    },
  );

  const handoffManager = {
    shouldEscalateFromResponse: vi.fn().mockReturnValue(false),
    shouldEscalateFromMessage: vi.fn().mockReturnValue(false),
    escalate: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stripHandoffMarker: vi.fn((s: string) => s),
  };
  const runAgent = vi.fn().mockResolvedValue({ response: 'hi' });
  const enqueue = vi.fn().mockResolvedValue(undefined);

  const deps: ChatwootWebhookDeps = {
    ...baseDeps,
    channelResolver: baseDeps.channelResolver as unknown as ChatwootWebhookDeps['channelResolver'],
    handoffManager: handoffManager as unknown as ChatwootWebhookDeps['handoffManager'],
    webhookQueue: { enqueue } as unknown as ChatwootWebhookDeps['webhookQueue'],
    runAgent: runAgent as unknown as ChatwootWebhookDeps['runAgent'],
  };

  const app = Fastify();
  chatwootWebhookRoutes(app, deps);
  await app.ready();
  return { app, enqueue, runAgent };
}

// ─── Token generator ────────────────────────────────────────────

describe('generateChatwootPathToken', () => {
  it('produces a 64-char lowercase hex string', () => {
    const t = generateChatwootPathToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces a fresh token on each call', () => {
    const a = generateChatwootPathToken();
    const b = generateChatwootPathToken();
    expect(a).not.toBe(b);
  });
});

// ─── Path-token auth & filters ──────────────────────────────────

describe('POST /webhooks/chatwoot/:pathToken', () => {
  it('returns 200 and enqueues on a known token + matching account.id + valid payload', async () => {
    const { app, enqueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${VALID_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: makeMessageCreatedPayload(),
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const job = enqueue.mock.calls[0]?.[0] as { projectId: ProjectId; conversationId: number };
    expect(job.projectId).toBe(PROJECT_ID);
    expect(job.conversationId).toBe(42);
  });

  it('returns 401 when the path token is unknown', async () => {
    const { app, enqueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${UNKNOWN_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: makeMessageCreatedPayload(),
    });
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is malformed (non-hex / wrong length)', async () => {
    const { app, enqueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot/short',
      headers: { 'content-type': 'application/json' },
      payload: makeMessageCreatedPayload(),
    });
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 401 when the token matches but account.id mismatches', async () => {
    const { app, enqueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${VALID_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: makeMessageCreatedPayload({ accountId: 999 }),
    });
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 401 when the body has no account.id at all', async () => {
    const { app, enqueue } = await buildApp();
    const noAccount = { event: 'message_created', conversation: { id: 1 } };
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${VALID_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: noAccount,
    });
    expect(res.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 200 without enqueueing on a non-message_created event', async () => {
    const { app, enqueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${VALID_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: makeMessageCreatedPayload({ event: 'conversation_updated' }),
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 200 without enqueueing for outgoing messages', async () => {
    const { app, enqueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${VALID_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: makeMessageCreatedPayload({ messageType: 'outgoing' }),
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 200 without enqueueing when message_type is "outgoing" (human takeover)', async () => {
    const { app, enqueue } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${VALID_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: makeMessageCreatedPayload({ messageType: 'outgoing' }),
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues incoming messages even when sender.type is missing (Chatwoot v4.12.1)', async () => {
    const { app, enqueue } = await buildApp();
    const payload = makeMessageCreatedPayload();
    // Chatwoot v4.12.1 omits sender.type at root of AgentBot deliveries
    delete (payload as { sender?: { type?: unknown } }).sender?.type;
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/chatwoot/${VALID_TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
