/**
 * Mock WAHA server for research module integration tests.
 *
 * Implements the subset of WAHA HTTP endpoints that WahaResearchClient calls:
 *   POST /api/sessions/:name/start  → transitions session to WORKING
 *   POST /api/sendText              → records outbound message, triggers scripted reply
 *   POST /api/startTyping           → no-op (acknowledges)
 *   POST /api/stopTyping            → no-op (acknowledges)
 *   GET  /api/sessions              → lists registered sessions
 *
 * Webhook simulation: when `sendText` is called with a `chatId` that matches
 * a configured `MockAgentConfig.to`, the server fires an HTTP POST to
 * `webhookUrl` after `latencyMs` with a WAHA-shaped inbound payload.
 * Responses are cycled in order (index % responses.length).
 *
 * Usage in tests:
 *   const mock = createMockWahaServer([{ to: '+549111...', responses: ['Hola!'], latencyMs: 50 }])
 *   const { port } = await mock.start()
 *   // configure WahaResearchClient with baseUrl: `http://127.0.0.1:${port}`
 *   await mock.stop()
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Defines how the mock agent behaves when a message is sent to `to`. */
export interface MockAgentConfig {
  /** E.164 phone number of the competitor agent being simulated. */
  to: string;
  /** Scripted responses, cycled in order. */
  responses: readonly string[];
  /** Delay in milliseconds before the mock fires the inbound webhook. */
  latencyMs: number;
}

export interface SentMessage {
  session: string;
  chatId: string;
  text: string;
  timestamp: string;
  wahaMessageId: string;
}

export interface MockWahaServer {
  /** Start listening. Returns the port chosen (0 → random). */
  start: () => Promise<{ port: number }>;
  /** Gracefully close the server. */
  stop: () => Promise<void>;
  /** All messages received by POST /api/sendText since start or last reset. */
  getSentMessages: () => SentMessage[];
  /** Clear the sent message log. */
  resetMessages: () => void;
  /** The port the server is listening on (0 until start() resolves). */
  getPort: () => number;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a standalone Fastify server that mimics WAHA's API surface.
 *
 * @param configs    One entry per simulated competitor agent phone number.
 * @param webhookUrl Where to POST inbound webhook payloads. If omitted,
 *                   the server only records outbound messages without firing webhooks.
 */
export function createMockWahaServer(
  configs: readonly MockAgentConfig[],
  webhookUrl?: string,
): MockWahaServer {
  const configByPhone = new Map(configs.map((c) => [c.to, c]));
  const responseIndexByPhone = new Map(configs.map((c) => [c.to, 0]));
  const sessions = new Map<string, { name: string; status: string }>();
  const sentMessages: SentMessage[] = [];
  let messageCounter = 0;
  let serverPort = 0;

  const server: FastifyInstance = Fastify({ logger: false });

  // ── POST /api/sessions/:name/start ──────────────────────────────────────
  server.post<{ Params: { name: string } }>(
    '/api/sessions/:name/start',
    async (req, reply) => {
      const { name } = req.params;
      sessions.set(name, { name, status: 'WORKING' });
      await reply.code(200).send({ name, status: 'WORKING' });
    },
  );

  // ── GET /api/sessions ───────────────────────────────────────────────────
  server.get('/api/sessions', async (_req, reply) => {
    await reply.code(200).send(Array.from(sessions.values()));
  });

  // ── POST /api/sendText ──────────────────────────────────────────────────
  server.post<{
    Body: { session: string; chatId: string; text: string };
  }>('/api/sendText', async (req, reply) => {
    const { session, chatId, text } = req.body as {
      session: string;
      chatId: string;
      text: string;
    };

    messageCounter++;
    const wahaMessageId = `mock_${Date.now()}_${messageCounter}`;
    const timestamp = new Date().toISOString();

    sentMessages.push({ session, chatId, text, timestamp, wahaMessageId });

    // Schedule scripted reply if a config exists for this chatId
    if (webhookUrl) {
      const cfg = configByPhone.get(chatId);
      if (cfg && cfg.responses.length > 0) {
        const idx = responseIndexByPhone.get(chatId) ?? 0;
        const responseText = cfg.responses[idx % cfg.responses.length] ?? '';
        responseIndexByPhone.set(chatId, idx + 1);

        // Fire webhook after latency — detached from request lifecycle
        const webhookTarget = webhookUrl;
        setTimeout(() => {
          const payload = {
            event: 'message',
            session,
            payload: {
              id: `inbound_${Date.now()}_${messageCounter}`,
              from: `${chatId}@c.us`,
              body: responseText,
              timestamp: Math.floor(Date.now() / 1000),
            },
          };

          // Use built-in fetch (Node 22 ships it natively)
          fetch(webhookTarget, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => {
            // Webhook delivery failures are silently ignored in test helpers
          });
        }, cfg.latencyMs);
      }
    }

    await reply.code(200).send({ id: wahaMessageId });
  });

  // ── POST /api/startTyping ────────────────────────────────────────────────
  server.post<{ Body: { session: string; chatId: string } }>(
    '/api/startTyping',
    async (_req, reply) => {
      await reply.code(200).send({ ok: true });
    },
  );

  // ── POST /api/stopTyping ─────────────────────────────────────────────────
  server.post<{ Body: { session: string; chatId: string } }>(
    '/api/stopTyping',
    async (_req, reply) => {
      await reply.code(200).send({ ok: true });
    },
  );

  return {
    start: async () => {
      await server.listen({ port: 0, host: '127.0.0.1' });
      const address = server.server.address();
      serverPort = typeof address === 'object' && address !== null ? address.port : 0;
      return { port: serverPort };
    },

    stop: async () => {
      await server.close();
    },

    getSentMessages: () => [...sentMessages],

    resetMessages: () => {
      sentMessages.length = 0;
      for (const phone of responseIndexByPhone.keys()) {
        responseIndexByPhone.set(phone, 0);
      }
    },

    getPort: () => serverPort,
  };
}
