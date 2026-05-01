/**
 * Tests for Chatwoot v4.12.1 webhook HMAC verification + route behavior.
 *
 * Spec under test:
 *   X-Chatwoot-Signature: "sha256=" + hex(HMAC-SHA256(secret, `${ts}.${rawBody}`))
 *   X-Chatwoot-Timestamp: unix seconds, must be within 300s of now
 *   X-Chatwoot-Delivery:  UUID, logged for correlation, not validated
 *
 * Fastify is wired with the same encapsulated raw-body parser used in main.ts
 * so route tests exercise byte-exact verification against the wire payload.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  chatwootWebhookRoutes,
  registerChatwootRawBodyParser,
  verifyChatwootHmac,
  type ChatwootWebhookDeps,
} from './chatwoot-webhook.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';
import type { ProjectId } from '@/core/types.js';

// ─── Helpers ────────────────────────────────────────────────────

const SECRET = 'test_signing_secret_abc123';
const PROJECT_ID = 'proj_test_chatwoot' as ProjectId;
const ACCOUNT_ID = 7;
const NOW = 1_777_700_000; // fixed unix seconds

function signPayload(secret: string, timestamp: number, rawBody: string): string {
  const hex = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `sha256=${hex}`;
}

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
  deps: ChatwootWebhookDeps;
  runAgent: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
}

async function buildApp(opts?: {
  secret?: string | null;
  resolveProject?: ProjectId | null;
}): Promise<Fixture> {
  const baseDeps = createMockDeps();
  baseDeps.channelResolver.resolveProjectByAccount.mockResolvedValue(
    opts?.resolveProject === undefined ? PROJECT_ID : opts.resolveProject,
  );

  const secret = opts?.secret === undefined ? SECRET : opts.secret;
  baseDeps.channelIntegrationRepository.findByProjectAndProvider.mockResolvedValue({
    id: 'int_1',
    projectId: PROJECT_ID,
    provider: 'chatwoot',
    config: {
      baseUrl: 'https://chat.example',
      accountId: ACCOUNT_ID,
      inboxId: 1,
      agentBotId: 1,
      apiTokenSecretKey: 'CW_API',
      webhookSecretKey: 'CW_HMAC',
    },
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  if (secret === null) {
    baseDeps.secretService.get.mockRejectedValue(new Error('not found'));
  } else {
    baseDeps.secretService.get.mockResolvedValue(secret);
  }

  const handoffManager = {
    shouldEscalateFromResponse: vi.fn().mockReturnValue(false),
    shouldEscalateFromMessage: vi.fn().mockReturnValue(false),
    escalate: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stripHandoffMarker: vi.fn((s: string) => s),
  };
  const runAgent = vi.fn().mockResolvedValue({ response: 'hi' });

  // Provide a webhookQueue so the route takes the fast async path. This keeps
  // the test focused on auth + filtering — the inline-processing branch is
  // tested separately when the inbound processor pipeline is exercised.
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const webhookQueue = { enqueue } as unknown as ChatwootWebhookDeps['webhookQueue'];

  const deps: ChatwootWebhookDeps = {
    ...baseDeps,
    channelResolver: baseDeps.channelResolver as unknown as ChatwootWebhookDeps['channelResolver'],
    handoffManager: handoffManager as unknown as ChatwootWebhookDeps['handoffManager'],
    webhookQueue,
    runAgent: runAgent as unknown as ChatwootWebhookDeps['runAgent'],
  };

  const app = Fastify();
  await app.register(async (scope) => {
    registerChatwootRawBodyParser(scope);
    chatwootWebhookRoutes(scope, deps);
  });
  await app.ready();
  return { app, deps, runAgent, enqueue };
}

// ─── verifyChatwootHmac (pure unit) ─────────────────────────────

describe('verifyChatwootHmac', () => {
  const rawBody = '{"event":"message_created"}';

  it('accepts a correctly signed payload', () => {
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: signPayload(SECRET, NOW, rawBody),
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts signatures without the "sha256=" prefix', () => {
    const hex = createHmac('sha256', SECRET).update(`${NOW}.${rawBody}`).digest('hex');
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: hex,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects missing signature header', () => {
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: undefined,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('rejects missing timestamp header', () => {
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: signPayload(SECRET, NOW, rawBody),
      timestampHeader: undefined,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_timestamp' });
  });

  it('rejects non-numeric timestamp', () => {
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: signPayload(SECRET, NOW, rawBody),
      timestampHeader: 'not-a-number',
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_timestamp' });
  });

  it('rejects timestamps older than 300s', () => {
    const oldTs = NOW - 301;
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: signPayload(SECRET, oldTs, rawBody),
      timestampHeader: String(oldTs),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'timestamp_drift' });
  });

  it('rejects timestamps too far in the future', () => {
    const futureTs = NOW + 600;
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: signPayload(SECRET, futureTs, rawBody),
      timestampHeader: String(futureTs),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'timestamp_drift' });
  });

  it('rejects when raw body was tampered post-signing', () => {
    const tampered = '{"event":"message_created","extra":"x"}';
    const result = verifyChatwootHmac({
      rawBody: tampered,
      signatureHeader: signPayload(SECRET, NOW, rawBody),
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects when secret does not match', () => {
    const result = verifyChatwootHmac({
      rawBody,
      signatureHeader: signPayload(SECRET, NOW, rawBody),
      timestampHeader: String(NOW),
      secret: 'wrong-secret',
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });
});

// ─── Route-level tests ──────────────────────────────────────────

describe('POST /webhooks/chatwoot — auth & filters', () => {
  // Tests use real time so Fastify's internal async (setImmediate, microtasks)
  // is unaffected. Each test signs against the actual `now` so freshness checks
  // always pass for the happy path.
  function nowTs(): number {
    return Math.floor(Date.now() / 1000);
  }

  it('returns 200 and enqueues the webhook on a correctly signed message_created/incoming/contact event', async () => {
    const { app, enqueue } = await buildApp();
    const payload = makeMessageCreatedPayload();
    const rawBody = JSON.stringify(payload);
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload(SECRET, ts, rawBody),
        'x-chatwoot-timestamp': String(ts),
        'x-chatwoot-delivery': 'delivery-uuid-123',
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const job = enqueue.mock.calls[0]?.[0] as { projectId: ProjectId; conversationId: number };
    expect(job.projectId).toBe(PROJECT_ID);
    expect(job.conversationId).toBe(42);
  });

  it('returns 401 when signature header is missing', async () => {
    const { app } = await buildApp();
    const rawBody = JSON.stringify(makeMessageCreatedPayload());
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-timestamp': String(ts),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when timestamp header is missing', async () => {
    const { app } = await buildApp();
    const rawBody = JSON.stringify(makeMessageCreatedPayload());
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload(SECRET, ts, rawBody),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when signed with the wrong secret', async () => {
    const { app } = await buildApp();
    const rawBody = JSON.stringify(makeMessageCreatedPayload());
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload('wrong-secret', ts, rawBody),
        'x-chatwoot-timestamp': String(ts),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the timestamp drift exceeds 300s', async () => {
    const { app } = await buildApp();
    const rawBody = JSON.stringify(makeMessageCreatedPayload());
    const staleTs = nowTs() - 600;

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload(SECRET, staleTs, rawBody),
        'x-chatwoot-timestamp': String(staleTs),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the raw body is tampered post-signing', async () => {
    const { app } = await buildApp();
    const original = JSON.stringify(makeMessageCreatedPayload());
    const ts = nowTs();
    const sig = signPayload(SECRET, ts, original);
    const tampered = original.replace('"hola"', '"injected"');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': sig,
        'x-chatwoot-timestamp': String(ts),
      },
      payload: tampered,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the account.id has no matching ChannelIntegration', async () => {
    const { app } = await buildApp({ resolveProject: null, secret: null });
    const rawBody = JSON.stringify(makeMessageCreatedPayload());
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload(SECRET, ts, rawBody),
        'x-chatwoot-timestamp': String(ts),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 without enqueueing on a non-message_created event', async () => {
    const { app, enqueue } = await buildApp();
    const payload = makeMessageCreatedPayload({ event: 'conversation_updated' });
    const rawBody = JSON.stringify(payload);
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload(SECRET, ts, rawBody),
        'x-chatwoot-timestamp': String(ts),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 200 without enqueueing for outgoing messages (echoes from agents)', async () => {
    const { app, enqueue } = await buildApp();
    const payload = makeMessageCreatedPayload({ messageType: 'outgoing' });
    const rawBody = JSON.stringify(payload);
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload(SECRET, ts, rawBody),
        'x-chatwoot-timestamp': String(ts),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 200 without enqueueing when sender.type is "user" (human takeover)', async () => {
    const { app, enqueue } = await buildApp();
    const payload = makeMessageCreatedPayload({ senderType: 'user' });
    const rawBody = JSON.stringify(payload);
    const ts = nowTs();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': signPayload(SECRET, ts, rawBody),
        'x-chatwoot-timestamp': String(ts),
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
