/**
 * Integration test for the project live-events WS route.
 *
 * Starts a real Fastify instance on a random port, connects a `ws` client,
 * and checks:
 *   - master key connects + receives events emitted on the bus
 *   - scoped key matching the requested projectId connects
 *   - scoped key for a different project is rejected with close code 1008
 *   - missing API key is rejected with close code 1008
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { wsProjectRoutes } from './ws-project.js';
import { createProjectEventBus } from '@/api/events/event-bus.js';
import type { ProjectEventBus } from '@/api/events/event-bus.js';
import type { ApiKeyService } from '@/security/api-key-service.js';
import { createMockLogger } from '@/testing/fixtures/routes.js';
import type { ProjectId, SessionId } from '@/core/types.js';

const MASTER_KEY = 'nx_master_0000000000000000000000000000000000000000000000000000000000';
const SCOPED_A_KEY = 'nx_scopedA_000000000000000000000000000000000000000000000000000000000';
const SCOPED_B_KEY = 'nx_scopedB_000000000000000000000000000000000000000000000000000000000';

function createMockApiKeyService(): ApiKeyService {
  return {
    generateApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listApiKeys: vi.fn(),
    validateApiKey: vi.fn().mockImplementation((raw: string) => {
      if (raw === MASTER_KEY) return Promise.resolve({ valid: true, projectId: null, scopes: ['*'] });
      if (raw === SCOPED_A_KEY) return Promise.resolve({ valid: true, projectId: 'proj-a', scopes: ['*'] });
      if (raw === SCOPED_B_KEY) return Promise.resolve({ valid: true, projectId: 'proj-b', scopes: ['*'] });
      return Promise.resolve({ valid: false, projectId: null, scopes: [] });
    }),
  };
}

async function startServer(eventBus: ProjectEventBus, apiKeyService: ApiKeyService): Promise<{ app: FastifyInstance; port: number }> {
  const app = Fastify({ logger: false });
  await app.register(websocketPlugin);

  const deps = {
    eventBus,
    apiKeyService,
    logger: createMockLogger(),
    // Cast: wsProjectRoutes only uses these three fields of RouteDependencies
  } as unknown as Parameters<typeof wsProjectRoutes>[1];

  wsProjectRoutes(app, deps);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, port };
}

// Use Node 22's built-in WebSocket (global) so we don't need `ws` as a direct dep.
// The global WebSocket is always available in our runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GlobalWebSocket: any = (globalThis as unknown as { WebSocket: unknown }).WebSocket;

interface TestSocket {
  readyState: number;
  addEventListener(ev: string, fn: (e: unknown) => void, opts?: { once?: boolean }): void;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

/**
 * Open a WS connection. Because the server performs async auth AFTER the HTTP
 * upgrade succeeds, an authenticated connection will stay open, while a rejected
 * one will receive `close` shortly after `open`. We resolve only if the
 * connection stays open for a short grace window.
 */
function connect(url: string, graceMs = 150): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const socket: TestSocket = new GlobalWebSocket(url) as TestSocket;
    let opened = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const openTimeout = setTimeout(() => { reject(new Error('open timeout')); }, 3000);

    socket.addEventListener('open', () => {
      opened = true;
      clearTimeout(openTimeout);
      // Wait grace period; if close arrives, it's a rejection.
      graceTimer = setTimeout(() => { resolve(socket); }, graceMs);
    }, { once: true });

    socket.addEventListener('close', (e: unknown) => {
      const evt = e as { code: number; reason: string };
      const err = new Error(`closed ${String(evt.code)}: ${evt.reason}`);
      (err as unknown as { code: number }).code = evt.code;
      if (!opened) {
        clearTimeout(openTimeout);
        reject(err);
      } else if (graceTimer) {
        clearTimeout(graceTimer);
        reject(err);
      }
    }, { once: true });

    socket.addEventListener('error', () => {
      if (!opened) {
        clearTimeout(openTimeout);
        reject(new Error('ws error'));
      }
    }, { once: true });
  });
}

function waitForClose(socket: TestSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.addEventListener('close', (e: unknown) => {
      const evt = e as { code: number; reason: string };
      resolve({ code: evt.code, reason: evt.reason });
    }, { once: true });
  });
}

function waitForMessage(socket: TestSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error('message timeout')); }, timeoutMs);
    socket.addEventListener('message', (e: unknown) => {
      clearTimeout(timeout);
      const evt = e as { data: string };
      resolve(evt.data);
    }, { once: true });
  });
}

describe('wsProjectRoutes', () => {
  let app: FastifyInstance;
  let port: number;
  let eventBus: ProjectEventBus;

  beforeEach(async () => {
    eventBus = createProjectEventBus();
    const apiKeyService = createMockApiKeyService();
    const started = await startServer(eventBus, apiKeyService);
    app = started.app;
    port = started.port;
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects connection with missing API key (close 1008)', async () => {
    await expect(
      connect(`ws://127.0.0.1:${String(port)}/ws/project/proj-a`),
    ).rejects.toMatchObject({ code: 1008 });
  });

  it('rejects cross-project scoped key (close 1008)', async () => {
    await expect(
      connect(`ws://127.0.0.1:${String(port)}/ws/project/proj-a?apiKey=${SCOPED_B_KEY}`),
    ).rejects.toMatchObject({ code: 1008 });
  });

  it('accepts master key and delivers events for the requested project', async () => {
    const socket = await connect(`ws://127.0.0.1:${String(port)}/ws/project/proj-a?apiKey=${MASTER_KEY}`);

    const messagePromise = waitForMessage(socket);

    // Give the server a tick to install the listener before emitting.
    await new Promise((r) => setTimeout(r, 50));

    eventBus.emit({
      kind: 'message.inbound',
      projectId: 'proj-a' as ProjectId,
      sessionId: 'sess-1' as SessionId,
      text: 'hola',
      channel: 'whatsapp',
      ts: Date.now(),
    });

    const raw = await messagePromise;
    const parsed = JSON.parse(raw) as { kind: string; projectId: string; text: string };
    expect(parsed.kind).toBe('message.inbound');
    expect(parsed.projectId).toBe('proj-a');
    expect(parsed.text).toBe('hola');

    socket.close();
    await waitForClose(socket);
  });

  it('accepts scoped key matching the project', async () => {
    const socket = await connect(`ws://127.0.0.1:${String(port)}/ws/project/proj-a?apiKey=${SCOPED_A_KEY}`);
    // Connected — close cleanly.
    socket.close();
    const { code } = await waitForClose(socket);
    // 1005 = no status received (client close), 1000 = normal
    expect([1000, 1005]).toContain(code);
  });

  it('does not deliver events for other projects', async () => {
    const socket = await connect(`ws://127.0.0.1:${String(port)}/ws/project/proj-a?apiKey=${MASTER_KEY}`);
    await new Promise((r) => setTimeout(r, 50));

    const receivedMessages: string[] = [];
    socket.addEventListener('message', (e: unknown) => {
      const evt = e as { data: string };
      receivedMessages.push(evt.data);
    });

    eventBus.emit({
      kind: 'message.inbound',
      projectId: 'proj-b' as ProjectId,
      sessionId: 'sess-1' as SessionId,
      text: 'otro proyecto',
      channel: 'whatsapp',
      ts: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(receivedMessages).toHaveLength(0);

    socket.close();
    await waitForClose(socket);
  });
});
