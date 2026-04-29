import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { createMockWahaServer } from './mock-waha-server.js';

describe('MockWahaServer', () => {
  const mock = createMockWahaServer([
    { to: '+5491112345001', responses: ['Hola! Soy el agente.', 'Le puedo ayudar.'], latencyMs: 10 },
    { to: '+5491112345002', responses: ['No disponible.'], latencyMs: 10 },
  ]);
  let baseUrl: string;

  beforeAll(async () => {
    const { port } = await mock.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await mock.stop();
  });

  it('getPort returns the listening port', () => {
    expect(mock.getPort()).toBeGreaterThan(0);
  });

  it('POST /api/sessions/:name/start returns WORKING', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/test-session/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; status: string };
    expect(body.status).toBe('WORKING');
    expect(body.name).toBe('test-session');
  });

  it('GET /api/sessions returns started sessions', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string; status: string }>;
    expect(body.some((s) => s.name === 'test-session')).toBe(true);
  });

  it('POST /api/sendText records the message and returns a message id', async () => {
    mock.resetMessages();
    const res = await fetch(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'test-session', chatId: '+5491112345001', text: 'Consulto por autos' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toMatch(/^mock_/);

    const messages = mock.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('Consulto por autos');
    expect(messages[0]?.chatId).toBe('+5491112345001');
  });

  it('POST /api/sendText cycles scripted responses per chatId', async () => {
    mock.resetMessages();

    await fetch(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'sess', chatId: '+5491112345001', text: 'Msg 1' }),
    });
    await fetch(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'sess', chatId: '+5491112345001', text: 'Msg 2' }),
    });
    await fetch(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'sess', chatId: '+5491112345001', text: 'Msg 3' }),
    });

    expect(mock.getSentMessages()).toHaveLength(3);
  });

  it('POST /api/startTyping returns ok', async () => {
    const res = await fetch(`${baseUrl}/api/startTyping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'test-session', chatId: '+5491112345001' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('POST /api/stopTyping returns ok', async () => {
    const res = await fetch(`${baseUrl}/api/stopTyping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'test-session', chatId: '+5491112345001' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('resetMessages clears the message log', async () => {
    await fetch(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'sess', chatId: '+5491112345001', text: 'hello' }),
    });
    mock.resetMessages();
    expect(mock.getSentMessages()).toHaveLength(0);
  });

  it('getSentMessages returns a copy (mutations do not affect internal state)', () => {
    const msgs = mock.getSentMessages();
    const originalLength = msgs.length;
    msgs.push({ session: 'x', chatId: 'y', text: 'z', timestamp: '', wahaMessageId: '' });
    expect(mock.getSentMessages()).toHaveLength(originalLength);
  });

  describe('webhook delivery', () => {
    it('fires webhook to provided url after latencyMs', async () => {
      let received: unknown = null;

      // Minimal inline receiver using Fastify
      const receiver = Fastify({ logger: false });
      receiver.post('/', async (req, reply) => {
        received = req.body;
        await reply.code(200).send({ ok: true });
      });
      await receiver.listen({ port: 0, host: '127.0.0.1' });
      const receiverAddr = receiver.server.address();
      const receiverPort =
        typeof receiverAddr === 'object' && receiverAddr !== null ? receiverAddr.port : 0;
      const receiverUrl = `http://127.0.0.1:${receiverPort}`;

      const mockWithWebhook = createMockWahaServer(
        [{ to: '+5491199990001', responses: ['Respuesta automática'], latencyMs: 30 }],
        receiverUrl,
      );
      const { port } = await mockWithWebhook.start();

      await fetch(`http://127.0.0.1:${port}/api/sendText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: 'probe-session',
          chatId: '+5491199990001',
          text: 'Hola, consulto sobre el servicio',
        }),
      });

      // Wait for webhook to fire (latencyMs=30 + network)
      await new Promise<void>((resolve) => setTimeout(resolve, 150));

      await mockWithWebhook.stop();
      await receiver.close();

      expect(received).not.toBeNull();
      const payload = received as { event: string; payload: { body: string } };
      expect(payload.event).toBe('message');
      expect(payload.payload.body).toBe('Respuesta automática');
    });
  });
});
