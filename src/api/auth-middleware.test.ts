import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createLogger } from '@/observability/logger.js';
import { registerAuthMiddleware } from './auth-middleware.js';

// ─── Helpers ────────────────────────────────────────────────────

const TEST_KEY = 'test-secret-key-1234567890abcdef';

async function buildServer(apiKey: string): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  const logger = createLogger();

  await server.register(
    async (prefixed) => {
      registerAuthMiddleware(prefixed, apiKey, logger);

      // A protected endpoint
      prefixed.get('/projects', async () => ({ ok: true }));

      // A webhook endpoint (exempt)
      prefixed.post('/webhooks/chatwoot', async () => ({ received: true }));
      prefixed.post('/webhooks/telegram-approval', async () => ({ received: true }));
    },
    { prefix: '/api/v1' },
  );

  await server.ready();
  return server;
}

// ─── Suite: auth enabled ────────────────────────────────────────

describe('registerAuthMiddleware — auth enabled', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer(TEST_KEY);
  });

  afterAll(async () => {
    await server.close();
  });

  it('allows requests with valid Bearer token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${TEST_KEY}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests with no Authorization header (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Missing') });
  });

  it('rejects requests with wrong token (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Invalid API key' });
  });

  it('rejects requests with malformed Authorization header (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid Authorization format') });
  });

  it('rejects requests with empty Bearer value (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows webhook routes WITHOUT Authorization header', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/chatwoot',
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows telegram-approval webhook WITHOUT Authorization header', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/telegram-approval',
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows query strings on webhook routes', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/chatwoot?hub.verify_token=abc',
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Suite: auth disabled (no NEXUS_API_KEY) ────────────────────

describe('registerAuthMiddleware — auth disabled (empty key)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer(''); // Empty key = open mode
  });

  afterAll(async () => {
    await server.close();
  });

  it('allows all requests without any Authorization header', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
    });
    expect(res.statusCode).toBe(200);
  });

  it('still serves webhook routes normally', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/chatwoot',
    });
    expect(res.statusCode).toBe(200);
  });
});
